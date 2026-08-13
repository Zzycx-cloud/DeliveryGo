const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // Ulanishni ochiq saqlaymiz (pool) — shu sabab har bir kod uchun qaytadan
    // handshake qilib o'tirmaydi, kod tezroq yetib boradi.
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    // Render ba'zan chiquvchi SMTP ulanishlarni sekinlashtiradi/bloklaydi —
    // shu sabab qisqa timeout qo'yamiz, aks holda so'rov cheksiz "osilib" qoladi
    connectionTimeout: 6000,
    greetingTimeout: 6000,
    socketTimeout: 6000,
  });
  return transporter;
}

function isRealSmtpConfigured() {
  return !!(process.env.SMTP_USER && !process.env.SMTP_USER.includes('your_email') && process.env.SMTP_PASS);
}

function sendMailWithTimeout(options, ms = 9000) {
  const mailer = getTransporter();
  if (!mailer) return Promise.reject(new Error('SMTP sozlanmagan'));
  return Promise.race([
    mailer.sendMail({ from: `"DeliGo" <${process.env.SMTP_USER}>`, ...options }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP timeout')), ms)),
  ]);
}

module.exports = { getTransporter, isRealSmtpConfigured, sendMailWithTimeout };