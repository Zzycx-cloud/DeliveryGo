require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const restaurantRoutes = require('./routes/restaurants');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const botRoutes = require('./routes/bot');
const { logAppDownloadPing } = require('./telegram');

const app = express();
app.use(cors());
app.use(express.json());

// Frontend'ni ham shu serverdan xizmat qilamiz (sayt = ilovaning web varianti)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use('/api/auth', authRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/bot', botRoutes);

// Ilova ochilganda ping (statistikaga log yozadi)
app.post('/api/ping-open', (req, res) => {
  logAppDownloadPing(req.body.email);
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'DeliGo backend' }));

// Telegram orqali (bot bilan) yuklangan rasmlarni (masalan taom rasmi) saytda ko'rsatish uchun proksi.
// Bot foydalanuvchi yuborgan fotosuratning file_id sini oladi, biz shu yerda uni haqiqiy rasm baytlariga
// aylantiramiz — shu bilan bot tokeni brauzerga hech qachon ko'rinmaydi.
app.get('/api/photo/:file_id', async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.status(404).end();
    const fetch = require('node-fetch');
    const infoResp = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${req.params.file_id}`);
    const info = await infoResp.json();
    if (!info.ok) return res.status(404).end();
    const fileResp = await fetch(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`);
    res.set('Content-Type', fileResp.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    fileResp.body.pipe(res);
  } catch (err) {
    console.error('Rasm proksi xato:', err.message);
    res.status(500).end();
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`DeliGo backend ${PORT}-portda ishga tushdi`);
  console.log(`Sayt/ilova: http://localhost:${PORT}`);
});
