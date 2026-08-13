const express = require('express');
const db = require('../db/db');
const { auth, requireAdmin } = require('../middleware');
const { logOrder } = require('../telegram');

const router = express.Router();

// Buyurtma berish (app/web/bot)
router.post('/', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  if (user.is_banned) return res.status(403).json({ error: 'Siz bloklangansiz' });

  const { restaurant_id, items, address, payment_method, source } = req.body;
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurant_id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });
  if (!items || !items.length) return res.status(400).json({ error: 'Savat bo\'sh' });

  let total = 0;
  for (const it of items) total += it.price * it.qty;

  // Plyus a'zolarga chegirma
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((s) => [s.key, s.value]));
  if (user.plus_member) {
    total = Math.round(total * (1 - Number(settings.plus_discount_percent) / 100));
  }
  total += Number(settings.delivery_base_price || 0);

  const info = db
    .prepare(
      `INSERT INTO orders (user_id, restaurant_id, items_json, total_amount, payment_method, address, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(user.id, restaurant.id, JSON.stringify(items), total, payment_method || 'cash', address || '', source || 'app');

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
  logOrder(order, restaurant, user);

  res.json({ ok: true, order });
});

// Foydalanuvchining buyurtmalari
router.get('/my', auth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC')
    .all(req.user.userId);
  res.json(rows);
});

// Admin: barcha buyurtmalar (restaurant_admin - faqat o'zinikini)
router.get('/', auth, requireAdmin, (req, res) => {
  let rows;
  if (req.admin.role === 'restaurant_admin') {
    rows = db.prepare('SELECT * FROM orders WHERE restaurant_id = ? ORDER BY id DESC').all(req.admin.restaurant_id);
  } else {
    rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  }
  res.json(rows);
});

// Admin: status yangilash
router.patch('/:id/status', auth, requireAdmin, (req, res) => {
  const { status } = req.body;
  const valid = ['new', 'accepted', 'cooking', 'on_way', 'delivered', 'cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Status noto\'g\'ri' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
