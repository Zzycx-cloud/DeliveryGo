const nodemailer = require('nodemailer');

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
  return !!(process.env.SMTP_USER && !process.env.SMTP_USER.includes('your_email') && process.env.SMTP_PASS);
}

function sendMailWithTimeout(options, ms = 12000) {
  const mailer = getTransporter();
  if (!mailer) return Promise.reject(new Error('SMTP sozlanmagan'));
  return Promise.race([
    mailer.sendMail({ from: `"DeliGo" <${process.env.SMTP_USER}>`, ...options }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP timeout')), ms)),
  ]);
}

module.exports = { getTransporter, isRealSmtpConfigured, sendMailWithTimeout };