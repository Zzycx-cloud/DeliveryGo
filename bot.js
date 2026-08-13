const express = require('express');
const db = require('../db/db');
const { logOrder, logRegistration, logAdminAdded, logEvent, logItemAdded } = require('../telegram');

const router = express.Router();

function writeAdminLog(actor, action, details) {
  db.prepare('INSERT INTO admin_logs (actor, action, details) VALUES (?, ?, ?)').run(actor, action, details || '');
}

// Telegram id -> shu foydalanuvchining admin yozuvini topadi (email orqali YOKI telegram_id orqali,
// chunki owner botga birinchi marta kirganda hali "tg<id>@deligo.bot" emaili admins jadvalida bo'lmasligi mumkin)
function findAdminByTelegramId(telegramId) {
  const byTgId = db.prepare('SELECT * FROM admins WHERE telegram_id = ?').get(String(telegramId));
  if (byTgId) return byTgId;
  const email = `tg${telegramId}@deligo.bot`;
  return db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
}

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

  // Owner/adminni telegram_id orqali topamiz (eng ishonchli usul), topilmasa email orqali
  let admin = findAdminByTelegramId(telegram_id);

  // Agar bu founder (SUPER_ADMIN_TELEGRAM_ID) bo'lsa, lekin hali admins jadvalida shu telegram_id
  // yozilmagan bo'lsa (masalan birinchi marta botga /start bosayotgan bo'lsa) — bog'lab qo'yamiz
  const founderTelegramId = (process.env.SUPER_ADMIN_TELEGRAM_ID || '').replace(/\D/g, '');
  if (!admin && founderTelegramId && String(telegram_id) === founderTelegramId) {
    const founderRow = db.prepare('SELECT * FROM admins WHERE is_founder = 1').get();
    if (founderRow) {
      db.prepare('UPDATE admins SET telegram_id = ? WHERE id = ?').run(String(telegram_id), founderRow.id);
      admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(founderRow.id);
    }
  }
  // Bog'langan bo'lsa endi shu foydalanuvchi emailiga ham admin huquqini biriktiramiz
  if (admin && admin.email !== email && !admin.email.startsWith('tg')) {
    // asosiy owner email (masalan gmail) bilan emas, bot ichidagi tg-email bilan ham ishlashi uchun
    // faqat telegram_id orqali tekshiruv yetarli — email ustunini o'zgartirmaymiz, aynan shu joyda ruxsat beramiz
  }

  const superAdminPhone = (process.env.SUPER_ADMIN_PHONE || '').replace(/\D/g, '');
  const isSuperAdminByPhone = phone && superAdminPhone && phone.replace(/\D/g, '').endsWith(superAdminPhone.slice(-9));

  res.json({
    ok: true,
    user,
    isNew,
    isBanned: !!user.is_banned,
    banReason: user.ban_reason,
    isAdmin: !!admin || isSuperAdminByPhone,
    adminRole: admin ? admin.role : (isSuperAdminByPhone ? 'owner' : null),
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

// Admin qo'shish — ierarxiya: owner -> owner/katta admin/oddiy admin/restoran admini qo'sha oladi
//                              katta admin -> faqat oddiy admin/restoran admini qo'sha oladi
router.post('/add-admin', (req, res) => {
  const { by_telegram_id, new_email, new_telegram_id, role, restaurant_id } = req.body;
  const byAdmin = findAdminByTelegramId(by_telegram_id);
  const byEmail = byAdmin ? byAdmin.email : `tg${by_telegram_id}@deligo.bot`;

  if (!byAdmin || !['owner', 'senior_admin'].includes(byAdmin.role)) {
    return res.status(403).json({ error: 'Faqat owner yoki katta admin yangi admin qo\'sha oladi' });
  }

  const validRoles = ['owner', 'senior_admin', 'admin', 'restaurant_admin'];
  const finalRole = validRoles.includes(role) ? role : 'admin';

  if (['owner', 'senior_admin'].includes(finalRole) && byAdmin.role !== 'owner') {
    return res.status(403).json({ error: 'Owner yoki katta admin qo\'shish faqat owner uchun ruxsat etilgan' });
  }
  if (finalRole === 'restaurant_admin' && !restaurant_id) {
    return res.status(400).json({ error: 'Qaysi restoran/oshxona uchun ekanini tanlang' });
  }

  const finalEmail = new_email || (new_telegram_id ? `tg${new_telegram_id}@deligo.bot` : null);
  if (!finalEmail) return res.status(400).json({ error: 'Email yoki telegram ID kerak' });

  db.prepare('INSERT OR REPLACE INTO admins (email, telegram_id, role, restaurant_id, added_by) VALUES (?, ?, ?, ?, ?)')
    .run(finalEmail, new_telegram_id || null, finalRole, restaurant_id || null, byEmail);

  const restaurant = restaurant_id ? db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurant_id) : null;
  logAdminAdded(byEmail, finalEmail, restaurant ? restaurant.name : null);
  writeAdminLog(byEmail, 'admin_qoshildi', `${finalEmail} — ${finalRole}${restaurant ? ' (' + restaurant.name + ')' : ''}`);

  res.json({ ok: true });
});

// Admin olib tashlash (bot orqali) — founder himoyalangan, katta admin owner/katta adminni o'chira olmaydi
router.post('/remove-admin', (req, res) => {
  const { by_telegram_id, target_email } = req.body;
  const byAdmin = findAdminByTelegramId(by_telegram_id);
  if (!byAdmin || !['owner', 'senior_admin'].includes(byAdmin.role)) {
    return res.status(403).json({ error: 'Faqat owner yoki katta admin admin o\'chira oladi' });
  }
  const target = db.prepare('SELECT * FROM admins WHERE email = ?').get(target_email);
  if (!target) return res.status(404).json({ error: 'Admin topilmadi' });
  if (target.is_founder) return res.status(403).json({ error: 'Bosh owner (founder) o\'chirilmaydi' });
  if (['owner', 'senior_admin'].includes(target.role) && byAdmin.role !== 'owner') {
    return res.status(403).json({ error: 'Owner yoki katta adminni faqat owner o\'chira oladi' });
  }
  db.prepare('DELETE FROM admins WHERE email = ?').run(target_email);
  writeAdminLog(byAdmin.email, 'admin_ochirildi', `${target.email} (${target.role})`);
  res.json({ ok: true });
});

// Adminlar ro'yxati (bot uchun)
router.get('/admins', (req, res) => {
  res.json(db.prepare('SELECT * FROM admins ORDER BY id DESC').all());
});

// Admin log (bot uchun, oxirgi 30 ta)
router.get('/admin-logs', (req, res) => {
  res.json(db.prepare('SELECT * FROM admin_logs ORDER BY id DESC LIMIT 30').all());
});

// Statistika (bot uchun qisqa)
router.get('/stats', (req, res) => {
  const usersCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const restaurantsCount = db.prepare('SELECT COUNT(*) c FROM restaurants').get().c;
  const ordersCount = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  const revenue = db.prepare("SELECT COALESCE(SUM(total_amount),0) s FROM orders WHERE status = 'delivered'").get().s;
  res.json({ usersCount, restaurantsCount, ordersCount, revenue });
});

// Keng statistika (bot uchun)
router.get('/wide-stats', (req, res) => {
  const byDay = db.prepare(`
    SELECT substr(created_at, 1, 10) day, COUNT(*) orders, COALESCE(SUM(total_amount),0) revenue
    FROM orders GROUP BY day ORDER BY day DESC LIMIT 7
  `).all();
  const topRestaurants = db.prepare(`
    SELECT r.name, COUNT(o.id) orders, COALESCE(SUM(o.total_amount),0) revenue
    FROM restaurants r LEFT JOIN orders o ON o.restaurant_id = r.id
    GROUP BY r.id ORDER BY revenue DESC LIMIT 5
  `).all();
  res.json({ byDay, topRestaurants });
});

// Restoran/oshxona qo'shish (bot orqali, admin bo'lishi kerak)
router.post('/restaurants', (req, res) => {
  const { by_telegram_id, name, type, address, phone } = req.body;
  const byAdmin = findAdminByTelegramId(by_telegram_id);
  if (!byAdmin || byAdmin.role === 'restaurant_admin') {
    return res.status(403).json({ error: 'Sizda restoran/oshxona qo\'shish huquqi yo\'q' });
  }
  if (!name) return res.status(400).json({ error: 'Nomi kerak' });
  const info = db
    .prepare('INSERT INTO restaurants (name, type, address, phone) VALUES (?, ?, ?, ?)')
    .run(name, type === 'oshxona' ? 'oshxona' : 'restaurant', address || '', phone || '');
  writeAdminLog(byAdmin.email, 'restoran_qoshildi', `${name} (${type || 'restaurant'})`);
  logEvent(`🏬 <b>Yangi ${type === 'oshxona' ? 'oshxona' : 'restoran'} qo'shildi</b>\nNomi: ${name}\nKim: ${byAdmin.email}`);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// Menyuga taom qo'shish (bot orqali)
router.post('/restaurants/:id/menu', (req, res) => {
  const { by_telegram_id, name, description, price, image_url } = req.body;
  const byAdmin = findAdminByTelegramId(by_telegram_id);
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });
  if (!byAdmin) return res.status(403).json({ error: 'Admin huquqi yo\'q' });
  if (byAdmin.role === 'restaurant_admin' && byAdmin.restaurant_id !== restaurant.id) {
    return res.status(403).json({ error: 'Faqat o\'z restoraningizga taom qo\'sha olasiz' });
  }
  if (!name || !price) return res.status(400).json({ error: 'Nom va narx kerak' });
  const info = db
    .prepare('INSERT INTO menu_items (restaurant_id, name, description, price, image_url) VALUES (?, ?, ?, ?, ?)')
    .run(restaurant.id, name, description || '', price, image_url || '');
  logItemAdded(byAdmin.email, name, restaurant.name);
  res.json({ ok: true, id: info.lastInsertRowid });
});

module.exports = router;