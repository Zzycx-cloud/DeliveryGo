/**
 * SMTP orqali kod nega kelmayotganini tekshirish uchun.
 *
 * Ishlatish (backend papkasida, .env to'ldirilgan holda):
 *   node test-smtp.js sizning-email@gmail.com
 *
 * Bu skript to'g'ridan-to'g'ri Gmail SMTP serveriga ulanib, sinov xat yuboradi
 * va nima uchun ishlamayotganini ANIQ xato matni bilan ko'rsatadi (parol xato,
 * ulanish bloklangan, timeout va h.k.).
 */
require('dotenv').config();
const nodemailer = require('nodemailer');

const to = process.argv[2];
if (!to) {
  console.log('Ishlatish: node test-smtp.js sizning-email@gmail.com');
  process.exit(1);
}

console.log('--- SMTP sozlamalari ---');
console.log('HOST:', process.env.SMTP_HOST);
console.log('PORT:', process.env.SMTP_PORT);
console.log('USER:', process.env.SMTP_USER);
console.log('PASS uzunligi:', (process.env.SMTP_PASS || '').length, 'belgidan iborat');
console.log('------------------------');

const port = Number(process.env.SMTP_PORT || 465);
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465,
  requireTLS: port !== 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 15000,
  logger: true,
  debug: true,
});

transporter.verify().then(() => {
  console.log('✅ SMTP serverga ulanish MUVAFFAQIYATLI (login/parol to\'g\'ri).');
  return transporter.sendMail({
    from: `"DeliGo (test)" <${process.env.SMTP_USER}>`,
    to,
    subject: 'DeliGo - SMTP sinov xati',
    text: 'Agar shu xatni oldingiz — SMTP to\'g\'ri ishlayapti!',
  });
}).then((info) => {
  console.log('✅ Xat YUBORILDI:', info.messageId);
  console.log(`${to} manziliga (va SPAM papkasiga ham) qarang.`);
  process.exit(0);
}).catch((err) => {
  console.error('❌ XATO:', err.message);
  if (err.code) console.error('   code:', err.code);
  if (err.command) console.error('   command:', err.command);
  if (err.response) console.error('   response:', err.response);
  console.log('\nEng ko\'p uchraydigan sabablar:');
  console.log('1) SMTP_PASS oddiy Gmail paroli emas, "App password" (16 ta belgi) bo\'lishi SHART.');
  console.log('   -> Google hisobda 2-bosqichli tasdiqlash (2FA) YOQILGAN bo\'lishi kerak,');
  console.log('      keyin https://myaccount.google.com/apppasswords orqali yangi parol oling.');
  console.log('2) Hosting (Render/Railway va h.k.) chiquvchi SMTP portini (465/587) bloklagan bo\'lishi mumkin.');
  console.log('3) SMTP_HOST/SMTP_PORT .env da noto\'g\'ri yozilgan bo\'lishi mumkin.');
  process.exit(1);
});
