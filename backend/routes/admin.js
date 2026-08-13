const express = require('express');
const db = require('../db/db');
const { auth, requireAdmin, requireSuperAdmin } = require('../middleware');
const { logAdminAdded, logEvent } = require('../telegram');

const router = express.Router();

// Statistika (dashboard uchun)
router.get('/stats', auth, requireAdmin, (req, res) => {
  const usersCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const restaurantsCount = db.prepare('SELECT COUNT(*) c FROM restaurants').get().c;
  const ordersCount = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  const revenue = db.prepare("SELECT COALESCE(SUM(total_amount),0) s FROM orders WHERE status = 'delivered'").get().s;
  res.json({ usersCount, restaurantsCount, ordersCount, revenue });
});

// Foydalanuvchilar ro'yxati
router.get('/users', auth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY id DESC').all());
});

// Ban berish
router.post('/users/:id/ban', auth, requireAdmin, (req, res) => {
  const { reason } = req.body;
  db.prepare('UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?').run(reason || '', req.params.id);
  logEvent(`🚫 Foydalanuvchi bloklandi (ID:${req.params.id}) — Kim: ${req.user.email}, Sabab: ${reason || '-'}`);
  res.json({ ok: true });
});

// Ban olib tashlash
router.post('/users/:id/unban', auth, requireAdmin, (req, res) => {
  db.prepare('UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Shtraf berish (masalan pul jarima - hisobga yoziladi)
router.post('/users/:id/fine', auth, requireAdmin, (req, res) => {
  const { amount } = req.body;
  db.prepare('UPDATE users SET fine_amount = fine_amount + ? WHERE id = ?').run(amount || 0, req.params.id);
  logEvent(`💸 Foydalanuvchiga shtraf: ${amount} so'm (ID:${req.params.id}) — Kim: ${req.user.email}`);
  res.json({ ok: true });
});

// Plyus a'zolik berish/olib tashlash
router.post('/users/:id/plus', auth, requireAdmin, (req, res) => {
  const { enabled } = req.body;
  db.prepare('UPDATE users SET plus_member = ? WHERE id = ?').run(enabled ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// Adminlar ro'yxati (faqat super_admin)
router.get('/admins', auth, requireSuperAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM admins ORDER BY id DESC').all());
});

// Yangi admin qo'shish (faqat super_admin) - restoran/oshxona tanlanadi
router.post('/admins', auth, requireSuperAdmin, (req, res) => {
  const { email, role, restaurant_id } = req.body;
  if (!email) return res.status(400).json({ error: 'Email kerak' });
  const validRoles = ['admin', 'restaurant_admin', 'super_admin'];
  const finalRole = validRoles.includes(role) ? role : 'admin';

  if (finalRole === 'restaurant_admin' && !restaurant_id) {
    return res.status(400).json({ error: 'restaurant_admin uchun restaurant_id kerak (qaysi restoran/oshxona)' });
  }

  db.prepare(
    'INSERT OR REPLACE INTO admins (email, role, restaurant_id, added_by) VALUES (?, ?, ?, ?)'
  ).run(email, finalRole, restaurant_id || null, req.user.email);

  const restaurant = restaurant_id ? db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurant_id) : null;
  logAdminAdded(req.user.email, email, restaurant ? restaurant.name : null);

  res.json({ ok: true });
});

// Admin o'chirish
router.delete('/admins/:email', auth, requireSuperAdmin, (req, res) => {
  db.prepare('DELETE FROM admins WHERE email = ?').run(req.params.email);
  res.json({ ok: true });
});

// Sozlamalar (Plyus narxi, chegirma, yetkazib berish narxi)
router.get('/settings', auth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

router.post('/settings', auth, requireSuperAdmin, (req, res) => {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [key, value] of Object.entries(req.body)) {
    upsert.run(key, String(value));
  }
  res.json({ ok: true });
});

module.exports = router;
