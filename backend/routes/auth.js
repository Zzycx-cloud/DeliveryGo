const express = require('express');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const db = require('../db/db');
const { logRegistration } = require('../telegram');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // Render ba'zan chiquvchi SMTP ulanishlarni sekinlashtiradi/bloklaydi —
    // shu sabab qisqa timeout qo'yamiz, aks holda so'rov cheksiz "osilib" qoladi
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
  return transporter;
}

function sendMailWithTimeout(mailer, options, ms = 9000) {
  return Promise.race([
    mailer.sendMail(options),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP timeout')), ms)),
  ]);
}

// 1) Kod so'rash
router.post('/request-code', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email noto\'g\'ri' });
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  db.prepare('INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)').run(email, code, expiresAt);

  const isRealSmtp = process.env.SMTP_USER && !process.env.SMTP_USER.includes('your_email');

  // Frontend'ga DARHOL javob qaytaramiz (SMTP javobini kutmaymiz) —
  // shu sabab "Kodni kiriting" ekrani bir zumda ochiladi.
  // Hozircha sinov bosqichida bo'lgani uchun kodni javobda ham ko'rsatamiz —
  // shunda Render SMTP portini bloklab qo'ysa ham, kodni saytda ko'rib ishlata olasiz.
  // Productionga chiqqanda bu qatorni olib tashlang (xavfsizlik uchun).
  res.json({ ok: true, message: 'Kod emailga yuborildi', dev_code: code });

  if (isRealSmtp) {
    const mailer = getTransporter();
    if (mailer) {
      try {
        await sendMailWithTimeout(mailer, {
          from: `"DeliGo" <${process.env.SMTP_USER}>`,
          to: email,
          subject: 'DeliGo - Tasdiqlash kodi',
          text: `Sizning DeliGo tasdiqlash kodingiz: ${code} (5 daqiqa amal qiladi)`,
        });
      } catch (err) {
        console.error(`Email yuborishda xato (${email}):`, err.message);
        console.log(`[DEV FALLBACK] ${email} uchun kod: ${code}`);
      }
    }
  } else {
    console.log(`[DEV] ${email} uchun kod: ${code}`);
  }
});

// 2) Kodni tasdiqlash -> token
router.post('/verify-code', (req, res) => {
  const { email, code, language } = req.body;
  const row = db
    .prepare('SELECT * FROM otp_codes WHERE email = ? AND code = ? AND used = 0 ORDER BY id DESC LIMIT 1')
    .get(email, code);

  if (!row) return res.status(400).json({ error: 'Kod noto\'g\'ri' });
  if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Kod muddati tugagan' });

  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(row.id);

  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  let isNew = false;
  if (!user) {
    const info = db
      .prepare('INSERT INTO users (email, language) VALUES (?, ?)')
      .run(email, language || 'uz');
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    isNew = true;
    logRegistration(user);
  }

  if (user.is_banned) {
    return res.status(403).json({ error: `Siz bloklangansiz. Sabab: ${user.ban_reason || 'ko\'rsatilmagan'}` });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);

  const token = jwt.sign({ userId: user.id, email: user.email, role: admin ? admin.role : 'user' }, JWT_SECRET, {
    expiresIn: '30d',
  });

  res.json({ ok: true, token, user, isAdmin: !!admin, adminRole: admin ? admin.role : null, isNew });
});

module.exports = router;
