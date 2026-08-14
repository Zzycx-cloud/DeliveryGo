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

// Admin: restoranni tahrirlash
router.patch('/:id', auth, requireAdmin, (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });
  if (req.admin.role === 'restaurant_admin' && req.admin.restaurant_id !== restaurant.id) {
    return res.status(403).json({ error: 'Faqat o\'z restoraningizni tahrirlay olasiz' });
  }
  const { name, type, address, phone, commission_percent, image_url } = req.body;
  db.prepare(
    `UPDATE restaurants SET
      name = COALESCE(?, name), type = COALESCE(?, type), address = COALESCE(?, address),
      phone = COALESCE(?, phone), commission_percent = COALESCE(?, commission_percent),
      image_url = COALESCE(?, image_url)
     WHERE id = ?`
  ).run(name ?? null, type ?? null, address ?? null, phone ?? null, commission_percent ?? null, image_url ?? null, restaurant.id);
  res.json({ ok: true });
});

// Admin: restoranni o'chirish (yashirish — is_active = 0, tarixiy buyurtmalar buzilmasligi uchun)
router.delete('/:id', auth, requireAdmin, (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });
  if (req.admin.role === 'restaurant_admin') {
    return res.status(403).json({ error: 'Sizda restoran o\'chirish huquqi yo\'q' });
  }
  db.prepare('UPDATE restaurants SET is_active = 0 WHERE id = ?').run(restaurant.id);
  res.json({ ok: true });
});

// Admin: restoranning BARCHA taomlari (mavjud bo'lmaganlari ham) — boshqaruv uchun
router.get('/:id/menu-admin', auth, requireAdmin, (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });
  if (req.admin.role === 'restaurant_admin' && req.admin.restaurant_id !== restaurant.id) {
    return res.status(403).json({ error: 'Ruxsat yo\'q' });
  }
  res.json(db.prepare('SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY id DESC').all(restaurant.id));
});

// Admin: menyuga taom qo'shish
router.post('/:id/menu', auth, requireAdmin, (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });

  if (req.admin.role === 'restaurant_admin' && req.admin.restaurant_id !== restaurant.id) {
    return res.status(403).json({ error: 'Faqat o\'z restoraningizga taom qo\'sha olasiz' });
  }

  const { name, description, price, image_url, category } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nom va narx kerak' });

  const info = db
    .prepare('INSERT INTO menu_items (restaurant_id, name, description, price, image_url, category) VALUES (?, ?, ?, ?, ?, ?)')
    .run(restaurant.id, name, description || '', price, image_url || '', category || '');

  logItemAdded(req.user.email, name, restaurant.name);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// Admin: taomni tahrirlash (narx, nom, tavsif, rasm, kategoriya, mavjudligi)
router.patch('/:id/menu/:itemId', auth, requireAdmin, (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });
  if (req.admin.role === 'restaurant_admin' && req.admin.restaurant_id !== restaurant.id) {
    return res.status(403).json({ error: 'Ruxsat yo\'q' });
  }
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?').get(req.params.itemId, restaurant.id);
  if (!item) return res.status(404).json({ error: 'Taom topilmadi' });

  const { name, description, price, image_url, category, is_available } = req.body;
  db.prepare(
    `UPDATE menu_items SET
      name = COALESCE(?, name), description = COALESCE(?, description), price = COALESCE(?, price),
      image_url = COALESCE(?, image_url), category = COALESCE(?, category),
      is_available = COALESCE(?, is_available)
     WHERE id = ?`
  ).run(
    name ?? null, description ?? null, price ?? null, image_url ?? null, category ?? null,
    typeof is_available === 'boolean' ? (is_available ? 1 : 0) : null,
    item.id
  );
  res.json({ ok: true });
});

// Admin: taomni o'chirish
router.delete('/:id/menu/:itemId', auth, requireAdmin, (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });
  if (req.admin.role === 'restaurant_admin' && req.admin.restaurant_id !== restaurant.id) {
    return res.status(403).json({ error: 'Ruxsat yo\'q' });
  }
  db.prepare('DELETE FROM menu_items WHERE id = ? AND restaurant_id = ?').run(req.params.itemId, restaurant.id);
  res.json({ ok: true });
});

module.exports = router;
