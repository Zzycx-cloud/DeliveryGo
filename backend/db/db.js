const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Render'da persistent disk ulangan bo'lsa, DB_PATH shu diskka ishora qiladi
// (masalan: /var/data/deligo.sqlite). Agar DB_PATH berilmasa, eski joyida
// (lokal development uchun) saqlanadi.
const dbPath = process.env.DB_PATH || path.join(__dirname, 'deligo.sqlite');

// Agar papka mavjud bo'lmasa (masalan disk hali yaratilmagan bo'lsa), yaratamiz
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`[db] SQLite fayli: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  language TEXT DEFAULT 'uz',
  is_banned INTEGER DEFAULT 0,
  ban_reason TEXT,
  fine_amount INTEGER DEFAULT 0,
  plus_member INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'admin', -- super_admin | admin | restaurant_admin
  restaurant_id INTEGER,
  added_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'restaurant', -- restaurant | oshxona
  address TEXT,
  phone TEXT,
  rating REAL DEFAULT 5.0,
  commission_percent REAL DEFAULT 15,
  is_active INTEGER DEFAULT 1,
  image_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  image_url TEXT,
  is_available INTEGER DEFAULT 1,
  FOREIGN KEY(restaurant_id) REFERENCES restaurants(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  restaurant_id INTEGER NOT NULL,
  items_json TEXT NOT NULL,
  total_amount INTEGER NOT NULL,
  payment_method TEXT DEFAULT 'cash', -- card | cash
  status TEXT DEFAULT 'new', -- new | accepted | cooking | on_way | delivered | cancelled
  address TEXT,
  source TEXT DEFAULT 'app', -- app | web | bot
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(restaurant_id) REFERENCES restaurants(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// Default settings
const defaults = {
  plus_monthly_price: '29000',
  plus_discount_percent: '10',
  delivery_base_price: '12000',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) insertSetting.run(k, v);

// Ensure super admin from .env always exists
const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'ibragimovfkhan@gmail.com';
db.prepare(`
  INSERT INTO admins (email, role, added_by)
  SELECT ?, 'super_admin', 'system'
  WHERE NOT EXISTS (SELECT 1 FROM admins WHERE email = ?)
`).run(superAdminEmail, superAdminEmail);

module.exports = db;
