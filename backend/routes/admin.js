const express = require('express');
const db = require('../db/db');
const { auth, requireAdmin, requireSeniorAdmin, requireOwner } = require('../middleware');
const { logAdminAdded, logEvent, sendTelegramMessage } = require('../telegram');
const { isRealSmtpConfigured, sendMailWithTimeout } = require('../utils/mailer');

const router = express.Router();

function writeAdminLog(actor, action, details) {
  db.prepare('INSERT INTO admin_logs (actor, action, details) VALUES (?, ?, ?)').run(actor, action, details || '');
}

// Statistika (dashboard uchun) — restoran admini FAQAT o'z restoranining statistikasini ko'radi
router.get('/stats', auth, requireAdmin, (req, res) => {
  if (req.admin.role === 'restaurant_admin') {
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.admin.restaurant_id);
    const ordersCount = db.prepare('SELECT COUNT(*) c FROM orders WHERE restaurant_id = ?').get(req.admin.restaurant_id).c;
    const revenue = db.prepare(
      "SELECT COALESCE(SUM(total_amount),0) s FROM orders WHERE restaurant_id = ? AND status = 'delivered'"
    ).get(req.admin.restaurant_id).s;
    return res.json({
      scope: 'restaurant',
      restaurantName: restaurant ? restaurant.name : null,
      ordersCount,
      revenue,
    });
  }
  const usersCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const restaurantsCount = db.prepare('SELECT COUNT(*) c FROM restaurants').get().c;
  const ordersCount = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  const revenue = db.prepare("SELECT COALESCE(SUM(total_amount),0) s FROM orders WHERE status = 'delivered'").get().s;
  res.json({ scope: 'global', usersCount, restaurantsCount, ordersCount, revenue });
});

// Keng statistika (kunlar bo'yicha + top restoranlar) — web panel uchun ham
// restoran admini uchun faqat o'z restoranining kunlik statistikasi qaytadi, boshqa restoranlar ko'rinmaydi
router.get('/wide-stats', auth, requireAdmin, (req, res) => {
  if (req.admin.role === 'restaurant_admin') {
    const byDay = db.prepare(`
      SELECT substr(created_at, 1, 10) day, COUNT(*) orders, COALESCE(SUM(total_amount),0) revenue
      FROM orders WHERE restaurant_id = ? GROUP BY day ORDER BY day DESC LIMIT 7
    `).all(req.admin.restaurant_id);
    return res.json({ scope: 'restaurant', byDay, topRestaurants: [] });
  }
  const byDay = db.prepare(`
    SELECT substr(created_at, 1, 10) day, COUNT(*) orders, COALESCE(SUM(total_amount),0) revenue
    FROM orders GROUP BY day ORDER BY day DESC LIMIT 7
  `).all();
  const topRestaurants = db.prepare(`
    SELECT r.name, COUNT(o.id) orders, COALESCE(SUM(o.total_amount),0) revenue
    FROM restaurants r LEFT JOIN orders o ON o.restaurant_id = r.id
    GROUP BY r.id ORDER BY revenue DESC LIMIT 5
  `).all();
  res.json({ scope: 'global', byDay, topRestaurants });
});

// Admin log (web panel uchun)
router.get('/logs', auth, requireSeniorAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM admin_logs ORDER BY id DESC LIMIT 50').all());
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

// Shtraf berish
router.post('/users/:id/fine', auth, requireAdmin, (req, res) => {
  const { amount } = req.body;
  db.prepare('UPDATE users SET fine_amount = fine_amount + ? WHERE id = ?').run(amount || 0, req.params.id);
  logEvent(`💸 Foydalanuvchiga shtraf: ${amount} so'm (ID:${req.params.id}) — Kim: ${req.user.email}`);
  res.json({ ok: true });
});

// Plyus a'zolik
router.post('/users/:id/plus', auth, requireAdmin, (req, res) => {
  const { enabled } = req.body;
  db.prepare('UPDATE users SET plus_member = ? WHERE id = ?').run(enabled ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// Adminlar ro'yxati — owner yoki katta admin ko'ra oladi
router.get('/admins', auth, requireSeniorAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM admins ORDER BY id DESC').all());
});

// Yangi admin qo'shish — ierarxiya: owner -> owner/katta admin/oddiy admin/restoran admini
//                                     katta admin -> faqat oddiy admin/restoran admini
router.post('/admins', auth, requireSeniorAdmin, (req, res) => {
  const { email, telegram_id, role, restaurant_id } = req.body;
  if (!email) return res.status(400).json({ error: 'Email kerak' });

  const validRoles = ['owner', 'senior_admin', 'admin', 'restaurant_admin'];
  const finalRole = validRoles.includes(role) ? role : 'admin';

  if (['owner', 'senior_admin'].includes(finalRole) && req.admin.role !== 'owner') {
    return res.status(403).json({ error: 'Owner yoki katta admin qo\'shish faqat owner uchun ruxsat etilgan' });
  }
  if (finalRole === 'restaurant_admin' && !restaurant_id) {
    return res.status(400).json({ error: 'restaurant_admin uchun restaurant_id kerak (qaysi restoran/oshxona)' });
  }

  db.prepare(
    'INSERT OR REPLACE INTO admins (email, telegram_id, role, restaurant_id, added_by) VALUES (?, ?, ?, ?, ?)'
  ).run(email, telegram_id || null, finalRole, restaurant_id || null, req.user.email);

  const restaurant = restaurant_id ? db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurant_id) : null;
  logAdminAdded(req.user.email, email, restaurant ? restaurant.name : null);
  writeAdminLog(req.user.email, 'admin_qoshildi', `${email} — ${finalRole}${restaurant ? ' (' + restaurant.name + ')' : ''}`);

  res.json({ ok: true });
});

// Admin o'chirish — founder himoyalangan, katta admin owner/katta adminni o'chira olmaydi
router.delete('/admins/:email', auth, requireSeniorAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM admins WHERE email = ?').get(req.params.email);
  if (!target) return res.status(404).json({ error: 'Admin topilmadi' });
  if (target.is_founder) return res.status(403).json({ error: 'Bosh owner (founder) o\'chirilmaydi' });
  if (['owner', 'senior_admin'].includes(target.role) && req.admin.role !== 'owner') {
    return res.status(403).json({ error: 'Owner yoki katta adminni faqat owner o\'chira oladi' });
  }
  db.prepare('DELETE FROM admins WHERE email = ?').run(req.params.email);
  writeAdminLog(req.user.email, 'admin_ochirildi', `${target.email} (${target.role})`);
  res.json({ ok: true });
});

// Sozlamalar (Plyus narxi, chegirma, yetkazib berish narxi)
router.get('/settings', auth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

router.post('/settings', auth, requireSeniorAdmin, (req, res) => {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [key, value] of Object.entries(req.body)) {
    upsert.run(key, String(value));
  }
  res.json({ ok: true });
});

// Ommaviy xabar (broadcast) — email, telegram bot foydalanuvchilari, kanal
router.post('/broadcast', auth, requireSeniorAdmin, async (req, res) => {
  const { text, channels } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Xabar matni kerak' });

  const wantEmail = !channels || channels.includes('email');
  const wantTelegram = !channels || channels.includes('telegram');
  const wantChannel = channels && channels.includes('channel');

  res.json({ ok: true, message: 'Xabar yuborish boshlandi' });

  let emailCount = 0;
  let telegramCount = 0;

  if (wantEmail && isRealSmtpConfigured()) {
    const users = db.prepare("SELECT email FROM users WHERE email NOT LIKE 'tg%@deligo.bot'").all();
    for (const u of users) {
      try {
        await sendMailWithTimeout({ to: u.email, subject: 'DeliGo - Xabar', text });
        emailCount++;
      } catch (err) {
        console.error(`Broadcast email xato (${u.email}):`, err.message);
      }
    }
  }

  if (wantTelegram) {
    const tgUsers = db.prepare("SELECT email FROM users WHERE email LIKE 'tg%@deligo.bot'").all();
    for (const u of tgUsers) {
      const telegramId = u.email.replace('tg', '').replace('@deligo.bot', '');
      try {
        await sendTelegramMessage(telegramId, text);
        telegramCount++;
      } catch (err) {
        console.error(`Broadcast telegram xato (${telegramId}):`, err.message);
      }
    }
  }

  if (wantChannel) {
    await logEvent(`📢 <b>E'lon</b>\n${text}`);
  }

  writeAdminLog(req.user.email, 'broadcast', `Email: ${emailCount}, Telegram: ${telegramCount}`);
  logEvent(`📤 Broadcast yuborildi — Kim: ${req.user.email}\nEmail: ${emailCount} ta, Telegram: ${telegramCount} ta`);
});

// Restoran o'chirish / faollikni o'zgartirish (owner/katta admin)
router.delete('/restaurants/:id', auth, requireSeniorAdmin, (req, res) => {
  db.prepare('UPDATE restaurants SET is_active = 0 WHERE id = ?').run(req.params.id);
  writeAdminLog(req.user.email, 'restoran_ochirildi', `ID:${req.params.id}`);
  res.json({ ok: true });
});

module.exports = router;
