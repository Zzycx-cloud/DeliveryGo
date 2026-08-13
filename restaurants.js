const express = require('express');
const db = require('../db/db');
const { auth, requireAdmin } = require('../middleware');
const { logItemAdded } = require('../telegram');

const router = express.Router();

// Ochiq: barcha restoranlar ro'yxati
router.get('/', (req, res) => {
  const { type, q } = req.query;
  let sql = 'SELECT * FROM restaurants WHERE is_active = 1';
  const params = [];
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  if (q) {
    sql += ' AND name LIKE ?';
    params.push(`%${q}%`);
  }
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// Bitta restoran + menyu
router.get('/:id', (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Topilmadi' });
  const items = db.prepare('SELECT * FROM menu_items WHERE restaurant_id = ? AND is_available = 1').all(req.params.id);
  res.json({ ...restaurant, menu: items });
});

// Admin: restoran qo'shish
router.post('/', auth, requireAdmin, (req, res) => {
  const { name, type, address, phone, commission_percent, image_url } = req.body;
  if (!name) return res.status(400).json({ error: 'Nomi kerak' });

  // restaurant_admin bo'lsa faqat o'z restoranini ko'radi, yangi restoran qo'sha olmaydi
  if (req.admin.role === 'restaurant_admin') {
    return res.status(403).json({ error: 'Sizda restoran qo\'shish huquqi yo\'q' });
  }

  const info = db
    .prepare(
      'INSERT INTO restaurants (name, type, address, phone, commission_percent, image_url) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(name, type || 'restaurant', address || '', phone || '', commission_percent || 15, image_url || '');

  res.json({ ok: true, id: info.lastInsertRowid });
});

// Admin: menyuga taom qo'shish
router.post('/:id/menu', auth, requireAdmin, (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });

  if (req.admin.role === 'restaurant_admin' && req.admin.restaurant_id !== restaurant.id) {
    return res.status(403).json({ error: 'Faqat o\'z restoraningizga taom qo\'sha olasiz' });
  }

  const { name, description, price, image_url } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nom va narx kerak' });

  const info = db
    .prepare('INSERT INTO menu_items (restaurant_id, name, description, price, image_url) VALUES (?, ?, ?, ?, ?)')
    .run(restaurant.id, name, description || '', price, image_url || '');

  logItemAdded(req.user.email, name, restaurant.name);
  res.json({ ok: true, id: info.lastInsertRowid });
});

module.exports = router;
