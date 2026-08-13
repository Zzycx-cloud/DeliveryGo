const nodemailer = require('nodemailer');
const fetch = require('node-fetch');

// === Resend (HTTPS API, 443-port — hech qachon hosting tomonidan bloklanmaydi) ===
// Ko'p bepul hostinglar (Render Free va h.k.) chiquvchi SMTP portlarini (465/587) bloklaydi,
// shu sabab Gmail SMTP "timeout" bilan ishlamay qoladi. RESEND_API_KEY sozlansa, kod
// SMTP o'rniga shu orqali (oddiy HTTPS so'rov bilan) email yuboradi — bu deyarli har doim ishlaydi.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'DeliGo <onboarding@resend.dev>';

// === Brevo (HTTPS API, 443-port) ===
// Resend'dan farqi: Brevo'da butun DOMEN emas, faqat BITTA email manzilni tasdiqlash yetarli
// (Brevo dashboard -> Senders -> Add a sender -> emailingizga kelgan tasdiqlash havolasini bosasiz).
// Domeningiz bo'lmasa, shu yo'l bilan istalgan qabul qiluvchiga xat yuborish mumkin bo'ladi.
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_FROM_EMAIL = process.env.BREVO_FROM_EMAIL; // Brevo'da "sender" sifatida tasdiqlangan email
const BREVO_FROM_NAME = process.env.BREVO_FROM_NAME || 'DeliGo';

function isBrevoConfigured() {
  return !!(BREVO_API_KEY && BREVO_FROM_EMAIL);
}

async function sendMailViaBrevo({ to, subject, text }) {
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: BREVO_FROM_EMAIL, name: BREVO_FROM_NAME },
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Brevo xato: ${data.message || resp.status}`);
  }
  return data;
}

function isResendConfigured() {
  return !!RESEND_API_KEY;
}

async function sendMailViaResend({ to, subject, text }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, text }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Resend xato: ${data.message || resp.status}`);
  }
  return data;
}

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 = implicit TLS (secure:true). 587 = STARTTLS (secure:false, requireTLS:true).
    // Portga qarab avtomatik tanlanadi — noto'g'ri kombinatsiya (masalan 587+secure:true)
    // Gmail bilan "Greeting never received" / ulanish uzilishi xatosiga olib keladi.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 12000,
    logger: process.env.SMTP_DEBUG === '1',
    debug: process.env.SMTP_DEBUG === '1',
  });
  return transporter;
}

function isRealSmtpConfigured() {
  if (isBrevoConfigured() || isResendConfigured()) return true;
  return !!(process.env.SMTP_USER && !process.env.SMTP_USER.includes('your_email') && process.env.SMTP_PASS);
}

function sendMailWithTimeout(options, ms = 12000) {
  if (isBrevoConfigured()) {
    return Promise.race([
      sendMailViaBrevo(options),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Brevo timeout')), ms)),
    ]);
  }
  if (isResendConfigured()) {
    return Promise.race([
      sendMailViaResend(options),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Resend timeout')), ms)),
    ]);
  }
  const mailer = getTransporter();
  if (!mailer) return Promise.reject(new Error('SMTP sozlanmagan'));
  return Promise.race([
    mailer.sendMail({ from: `"DeliGo" <${process.env.SMTP_USER}>`, ...options }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP timeout')), ms)),
  ]);
}

module.exports = { getTransporter, isRealSmtpConfigured, sendMailWithTimeout };