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

function requireSuperAdmin(req, res, next) {
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(req.user.email);
  if (!admin || admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'Faqat bosh admin uchun ruxsat' });
  }
  req.admin = admin;
  next();
}

module.exports = { auth, requireAdmin, requireSuperAdmin };
