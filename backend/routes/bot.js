const express = require('express');
const db = require('../db/db');
const { logOrder, logRegistration, logAdminAdded, logEvent } = require('../telegram');

const router = express.Router();

// Bot -> Backend so'rovlarini himoya qiluvchi maxfiy kalit
function checkBotSecret(req, res, next) {
  const secret = req.headers['x-bot-secret'];
  if (!secret || secret !== process.env.BOT_SECRET) {
    return res.status(401).json({ error: 'Bot kaliti noto\'g\'ri' });
  }
  next();
}
router.use(checkBotSecret);

// Telegram foydalanuvchisini ro'yxatdan o'tkazish / topish (telegram_id orqali)
router.post('/register', (req, res) => {
  const { telegram_id, phone, language } = req.body;
  const email = `tg${telegram_id}@deligo.bot`; // bot foydalanuvchilari uchun ichki email
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  let isNew = false;
  if (!user) {
    const info = db
      .prepare('INSERT INTO users (email, phone, language) VALUES (?, ?, ?)')
      .run(email, phone || '', language || 'uz');
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    isNew = true;
    logRegistration(user);
  } else if (phone && !user.phone) {
    db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  const superAdminPhone = (process.env.SUPER_ADMIN_PHONE || '').replace(/\D/g, '');
  const isSuperAdminByPhone = phone && superAdminPhone && phone.replace(/\D/g, '').endsWith(superAdminPhone.slice(-9));

  res.json({
    ok: true,
    user,
    isNew,
    isBanned: !!user.is_banned,
    banReason: user.ban_reason,
    isAdmin: !!admin || isSuperAdminByPhone,
    adminRole: admin ? admin.role : (isSuperAdminByPhone ? 'super_admin' : null),
  });
});

// Restoranlar ro'yxati
router.get('/restaurants', (req, res) => {
  res.json(db.prepare('SELECT * FROM restaurants WHERE is_active = 1').all());
});

// Bitta restoran + menyu
router.get('/restaurants/:id', (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Topilmadi' });
  const items = db.prepare('SELECT * FROM menu_items WHERE restaurant_id = ? AND is_available = 1').all(req.params.id);
  res.json({ ...restaurant, menu: items });
});

// Buyurtma berish (bot orqali)
router.post('/order', (req, res) => {
  const { telegram_id, restaurant_id, items, address, payment_method } = req.body;
  const email = `tg${telegram_id}@deligo.bot`;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(404).json({ error: 'Avval ro\'yxatdan o\'ting (/start)' });
  if (user.is_banned) return res.status(403).json({ error: `Siz bloklangansiz: ${user.ban_reason || ''}` });

  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurant_id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });

  let total = 0;
  for (const it of items) total += it.price * it.qty;
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((s) => [s.key, s.value]));
  if (user.plus_member) total = Math.round(total * (1 - Number(settings.plus_discount_percent) / 100));
  total += Number(settings.delivery_base_price || 0);

  const info = db
    .prepare(`INSERT INTO orders (user_id, restaurant_id, items_json, total_amount, payment_method, address, source)
               VALUES (?, ?, ?, ?, ?, ?, 'bot')`)
    .run(user.id, restaurant.id, JSON.stringify(items), total, payment_method || 'cash', address || '');

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
  logOrder(order, restaurant, user);
  res.json({ ok: true, order });
});

// Foydalanuvchi buyurtmalari
router.get('/my-orders/:telegram_id', (req, res) => {
  const email = `tg${req.params.telegram_id}@deligo.bot`;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.json([]);
  res.json(db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(user.id));
});

// Admin qo'shish (faqat super_admin telegram orqali, restoran so'raladi agar restaurant_admin bo'lsa)
router.post('/add-admin', (req, res) => {
  const { by_telegram_id, new_email, role, restaurant_id } = req.body;
  const byEmail = `tg${by_telegram_id}@deligo.bot`;
  const byAdmin = db.prepare('SELECT * FROM admins WHERE email = ?').get(byEmail);

  const superAdminPhone = (process.env.SUPER_ADMIN_PHONE || '').replace(/\D/g, '');
  const byUser = db.prepare('SELECT * FROM users WHERE email = ?').get(byEmail);
  const isSuperByPhone = byUser && byUser.phone && superAdminPhone && byUser.phone.replace(/\D/g, '').endsWith(superAdminPhone.slice(-9));

  if (!(byAdmin && byAdmin.role === 'super_admin') && !isSuperByPhone) {
    return res.status(403).json({ error: 'Faqat bosh admin yangi admin qo\'sha oladi' });
  }

  const validRoles = ['admin', 'restaurant_admin', 'super_admin'];
  const finalRole = validRoles.includes(role) ? role : 'admin';
  if (finalRole === 'restaurant_admin' && !restaurant_id) {
    return res.status(400).json({ error: 'Qaysi restoran/oshxona uchun ekanini tanlang' });
  }

  db.prepare('INSERT OR REPLACE INTO admins (email, role, restaurant_id, added_by) VALUES (?, ?, ?, ?)')
    .run(new_email, finalRole, restaurant_id || null, byEmail);

  const restaurant = restaurant_id ? db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurant_id) : null;
  logAdminAdded(byEmail, new_email, restaurant ? restaurant.name : null);

  res.json({ ok: true });
});

module.exports = router;
