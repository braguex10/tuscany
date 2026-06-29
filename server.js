require('dotenv').config();
const express    = require('express');
const nodemailer = require('nodemailer');
const fs         = require('fs');
const path       = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── Configuração ──────────────────────────────────────────
const OWNER_EMAIL        = 'goncalovbbraga@gmail.com';
const MAX_LUNCH_TABLES   = 10;
const MAX_DINNER_TABLES  = 10;
const MAX_PEOPLE_TABLE   = 6;
const RESERVATIONS_FILE  = path.join(__dirname, 'reservations.json');
const LUNCH_HOURS        = ['12:00','12:30','13:00','13:30','14:00','14:30'];

// ─── Helpers ───────────────────────────────────────────────
function loadReservations() {
  try { return JSON.parse(fs.readFileSync(RESERVATIONS_FILE, 'utf8')); }
  catch { return []; }
}

function saveReservations(list) {
  fs.writeFileSync(RESERVATIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function getPeriod(hora) {
  return LUNCH_HOURS.includes(hora) ? 'almoco' : 'jantar';
}

function countTables(reservations, data, period) {
  return reservations.filter(r =>
    r.data === data && r.period === period && r.status !== 'cancelled'
  ).length;
}

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
}

// ─── POST /api/reservar ────────────────────────────────────
app.post('/api/reservar', async (req, res) => {
  const { nome, email, telefone, data, hora, pessoas, notas } = req.body;

  if (!nome || !email || !data || !hora || !pessoas)
    return res.status(400).json({ success: false, error: 'missing_fields' });

  const numPessoas = parseInt(pessoas, 10);
  if (numPessoas > MAX_PEOPLE_TABLE)
    return res.json({ success: false, error: 'max_people', max: MAX_PEOPLE_TABLE });

  const period    = getPeriod(hora);
  const maxTables = period === 'almoco' ? MAX_LUNCH_TABLES : MAX_DINNER_TABLES;
  const reservations = loadReservations();
  const used      = countTables(reservations, data, period);

  if (used >= maxTables)
    return res.json({
      success: false,
      error: 'full',
      period: period === 'almoco' ? 'almoço' : 'jantar',
    });

  // Guardar reserva
  const id = `TUS-${Date.now()}`;
  const reservation = {
    id, nome, email, telefone: telefone || '', data, hora,
    pessoas: numPessoas, notas: notas || '',
    period, status: 'confirmed',
    createdAt: new Date().toISOString(),
  };
  reservations.push(reservation);
  saveReservations(reservations);

  const remaining   = maxTables - used - 1;
  const periodLabel = period === 'almoco' ? 'Almoço' : 'Jantar';

  // ── Enviar emails ─────────────────────────────────────────
  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    try {
      const t = createTransporter();

      // Email ao proprietário
      await t.sendMail({
        from: `"Tuscany Reservas" <${process.env.GMAIL_USER}>`,
        to: OWNER_EMAIL,
        subject: `🍽️ Nova Reserva — ${nome} | ${data} ${hora}`,
        html: ownerHtml({ id, nome, email, telefone, data, hora, numPessoas, notas, periodLabel, remaining }),
      });

      // Email ao cliente
      await t.sendMail({
        from: `"Tuscany Ristorante" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `Reserva Confirmada — Tuscany | ${data} às ${hora}`,
        html: clientHtml({ id, nome, data, hora, numPessoas }),
      });

      console.log(`✓ Emails enviados para ${email} e ${OWNER_EMAIL}`);
    } catch (err) {
      console.error('⚠  Email falhou (reserva guardada na mesma):', err.message);
    }
  } else {
    console.log(`ℹ  Email não configurado. Reserva ${id} guardada localmente.`);
    console.log(`   ${nome} | ${data} ${hora} | ${numPessoas} pessoas`);
  }

  res.json({ success: true, id });
});

// ─── GET /api/disponibilidade?data=YYYY-MM-DD ──────────────
app.get('/api/disponibilidade', (req, res) => {
  const { data } = req.query;
  if (!data) return res.status(400).json({ error: 'missing data' });
  const reservations = loadReservations();
  const al = countTables(reservations, data, 'almoco');
  const ja = countTables(reservations, data, 'jantar');
  res.json({
    data,
    almoco: { usadas: al, livres: MAX_LUNCH_TABLES  - al, lotado: al >= MAX_LUNCH_TABLES },
    jantar: { usadas: ja, livres: MAX_DINNER_TABLES - ja, lotado: ja >= MAX_DINNER_TABLES },
  });
});

// ─── GET /api/reservas?password=xxx  (painel admin) ────────
app.get('/api/reservas', (req, res) => {
  if (req.query.password !== (process.env.ADMIN_PASS || 'tuscany2024'))
    return res.status(401).json({ error: 'não autorizado' });
  res.json(loadReservations());
});

// ─── Email templates ───────────────────────────────────────
function ownerHtml({ id, nome, email, telefone, data, hora, numPessoas, notas, periodLabel, remaining }) {
  return `
  <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;border:1px solid #E8E6E2;color:#1A1A1A">
    <h2 style="font-size:22px;letter-spacing:.1em;border-bottom:2px solid #C9A84C;padding-bottom:14px;margin-bottom:20px">
      TUSCANY — Nova Reserva
    </h2>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:7px 0;font-size:11px;color:#888;width:110px;text-transform:uppercase">Nome</td><td style="font-size:14px"><b>${nome}</b></td></tr>
      <tr><td style="padding:7px 0;font-size:11px;color:#888;text-transform:uppercase">Email</td><td style="font-size:14px">${email}</td></tr>
      <tr><td style="padding:7px 0;font-size:11px;color:#888;text-transform:uppercase">Telefone</td><td style="font-size:14px">${telefone || '—'}</td></tr>
      <tr><td style="padding:7px 0;font-size:11px;color:#888;text-transform:uppercase">Data</td><td style="font-size:14px">${data}</td></tr>
      <tr><td style="padding:7px 0;font-size:11px;color:#888;text-transform:uppercase">Hora</td><td style="font-size:14px">${hora} &nbsp;·&nbsp; ${periodLabel}</td></tr>
      <tr><td style="padding:7px 0;font-size:11px;color:#888;text-transform:uppercase">Pessoas</td><td style="font-size:14px">${numPessoas}</td></tr>
      ${notas ? `<tr><td style="padding:7px 0;font-size:11px;color:#888;text-transform:uppercase">Notas</td><td style="font-size:14px;font-style:italic">${notas}</td></tr>` : ''}
    </table>
    <div style="background:#F7F6F4;padding:14px;margin-top:20px;font-size:12px;color:#888;border-left:3px solid #C9A84C">
      ID: ${id} &nbsp;·&nbsp; Mesas livres (${periodLabel.toLowerCase()}): <b style="color:#C9A84C">${remaining}</b> / ${remaining + 1 <= MAX_LUNCH_TABLES ? MAX_LUNCH_TABLES : MAX_DINNER_TABLES}
    </div>
  </div>`;
}

function clientHtml({ id, nome, data, hora, numPessoas }) {
  const [y, m, d] = data.split('-');
  const dataFmt   = `${d}/${m}/${y}`;
  return `
  <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;border:1px solid #E8E6E2;color:#1A1A1A">
    <h2 style="font-size:22px;letter-spacing:.14em;border-bottom:2px solid #C9A84C;padding-bottom:14px">TUSCANY</h2>
    <p style="font-size:17px;font-style:italic;color:#555;margin:22px 0 6px">Grazie, ${nome}!</p>
    <p style="font-size:14px;color:#666;line-height:1.8;margin-bottom:24px">
      A sua reserva foi confirmada. Aguardamos a sua visita.
    </p>
    <div style="background:#F7F6F4;padding:22px;border-left:3px solid #C9A84C;margin-bottom:28px">
      <p style="margin:0;font-size:14px;line-height:2.4;color:#1A1A1A">
        📅 &nbsp;<b>${dataFmt}</b> às <b>${hora}</b><br>
        👥 &nbsp;<b>${numPessoas} pessoa${numPessoas > 1 ? 's' : ''}</b><br>
        📍 &nbsp;Rua das Flores, 42 · 1200-195 Lisboa
      </p>
    </div>
    <p style="font-size:12px;color:#aaa;margin:0">
      Para cancelar ou alterar a reserva contacte-nos:<br>
      +351 21 342 0000 &nbsp;·&nbsp; info@tuscany.pt
    </p>
    <p style="font-size:10px;color:#ccc;margin-top:20px;border-top:1px solid #E8E6E2;padding-top:14px">
      Tuscany Ristorante &nbsp;·&nbsp; ID: ${id}
    </p>
  </div>`;
}

// ─── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n✓  Tuscany → http://localhost:${PORT}`);
  console.log(`✓  Reservas → ${RESERVATIONS_FILE}`);
  if (!process.env.GMAIL_USER) {
    console.log('\n⚠  Email não configurado.');
    console.log('   Edita o ficheiro .env com as tuas credenciais Gmail.');
    console.log('   Ver instrucoes em .env.example\n');
  }
});
