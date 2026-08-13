const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db/db');
const { logRegistration, logEvent } = require('../telegram');
const { isRealSmtpConfigured, sendMailWithTimeout } = require('../utils/mailer');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
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

  // Frontend'ga DARHOL javob qaytaramiz (SMTP javobini kutmaymiz) —
  // shu sabab "Kodni kiriting" ekrani bir zumda ochiladi.
  // SMTP haqiqiy sozlangan bo'lsa (production), dev_code HECH QACHON javobda ko'rsatilmaydi —
  // faqat SMTP sozlanmagan lokal/sinov holatida ko'rinadi.
  const realSmtp = isRealSmtpConfigured();
  res.json({
    ok: true,
    message: realSmtp ? 'Kod emailga yuborildi' : 'Kod yuborildi (SMTP sozlanmagan — dev rejim)',
    ...(realSmtp ? {} : { dev_code: code }),
  });

  if (realSmtp) {
    try {
      await sendMailWithTimeout({
        to: email,
        subject: 'DeliGo - Tasdiqlash kodi',
        text: `Sizning DeliGo tasdiqlash kodingiz: ${code} (5 daqiqa amal qiladi)`,
      });
      console.log(`[SMTP OK] ${email} ga kod yuborildi`);
    } catch (err) {
      // Xatoni to'liq chiqaramiz (server console) + owner'ga Telegram log kanaliga ham yuboramiz,
      // shunda serverga kirmasdan ham nima uchun kod yetib bormayotganini ko'rish mumkin.
      const detail = [err.message, err.code, err.command, err.response].filter(Boolean).join(' | ');
      console.error(`[SMTP XATO] ${email} ga kod yuborilmadi:`, detail);
      logEvent(`⚠️ <b>SMTP xato</b> — ${email} ga kod yuborilmadi\n${detail}`);
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