const jwt = require('jsonwebtoken');
const db = require('./db/db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Token yo\'q' });
  try {
    const token = header.replace('Bearer ', '');
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token noto\'g\'ri yoki muddati tugagan' });
  }
}

function requireAdmin(req, res, next) {
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(req.user.email);
  if (!admin) return res.status(403).json({ error: 'Admin huquqi yo\'q' });
  req.admin = admin;
  next();
}

// Owner (bosh egasi) yoki katta admin (senior_admin) — sozlamalar, broadcast,
// oddiy admin/restoran admini qo'shish/olib tashlash uchun yetarli
function requireSeniorAdmin(req, res, next) {
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(req.user.email);
  if (!admin || !['owner', 'senior_admin'].includes(admin.role)) {
    return res.status(403).json({ error: 'Faqat katta admin yoki owner uchun ruxsat' });
  }
  req.admin = admin;
  next();
}

// Faqat owner — yangi owner/katta admin qo'shish, boshqa adminlarni to'liq boshqarish
function requireOwner(req, res, next) {
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(req.user.email);
  if (!admin || admin.role !== 'owner') {
    return res.status(403).json({ error: 'Faqat owner uchun ruxsat' });
  }
  req.admin = admin;
  next();
}

// Eski nom bilan mosligi uchun (ba'zi joylarda hali ishlatiladi) — owner talab qiladi
const requireSuperAdmin = requireOwner;

module.exports = { auth, requireAdmin, requireSuperAdmin, requireSeniorAdmin, requireOwner };