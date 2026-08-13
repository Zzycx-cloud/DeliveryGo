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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`DeliGo backend ${PORT}-portda ishga tushdi`);
  console.log(`Sayt/ilova: http://localhost:${PORT}`);
});
