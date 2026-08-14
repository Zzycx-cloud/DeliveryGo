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
  telegram_id TEXT,
  role TEXT DEFAULT 'admin', -- owner | senior_admin (katta admin) | admin (oddiy admin) | restaurant_admin
  restaurant_id INTEGER,
  is_founder INTEGER DEFAULT 0, -- bosh owner - hech kim (2-owner ham) o'chira olmaydi
  added_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,       -- kim bajardi (email yoki tg<id>)
  action TEXT NOT NULL,      -- masalan: admin_qoshildi, admin_ochirildi, restoran_qoshildi, ban, shtraf
  details TEXT,
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

CREATE TABLE IF NOT EXISTS couriers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  is_active INTEGER DEFAULT 1,
  added_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Eski (oldin yaratilgan) baza fayllarida yangi ustunlar bo'lmasligi mumkin — xavfsiz migratsiya
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('admins', 'telegram_id', 'TEXT');
ensureColumn('admins', 'is_founder', 'INTEGER DEFAULT 0');
ensureColumn('orders', 'courier_id', 'INTEGER');
ensureColumn('orders', 'courier_telegram_id', 'TEXT');
ensureColumn('orders', 'courier_name', 'TEXT');
ensureColumn('menu_items', 'category', 'TEXT');

// Default settings
const defaults = {
  plus_monthly_price: '29000',
  plus_discount_percent: '10',
  delivery_base_price: '12000',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaults)) insertSetting.run(k, v);

// Bosh owner'lar (asoschilar) — ikkalasi ham .env yoki backend/config/founders.js dan doim
// mavjud bo'lishi kerak — email orqali ham, Telegram ID orqali ham kirganida owner huquqi
// berilishi uchun ikkalasi ham saqlanadi. Ikkala asoschi ham teng huquqli owner va himoyalangan
// (is_founder=1) — bir-birini ham hech kim o'chira olmaydi.
const { FOUNDERS } = require('../config/founders');

for (const founder of FOUNDERS) {
  const existingFounder = db.prepare('SELECT * FROM admins WHERE email = ?').get(founder.email);
  if (!existingFounder) {
    db.prepare(
      'INSERT INTO admins (email, telegram_id, role, is_founder, added_by) VALUES (?, ?, ?, 1, ?)'
    ).run(founder.email, founder.telegramId || null, 'owner', 'system');
  } else {
    // Har ehtimolga qarshi: har bir asoschi har doim owner + himoyalangan bo'lib qolsin,
    // va agar telegram_id .env/config da yangilangan bo'lsa shu yerga ham yozib qo'yamiz.
    db.prepare(
      "UPDATE admins SET role = 'owner', is_founder = 1, telegram_id = COALESCE(NULLIF(?, ''), telegram_id) WHERE email = ?"
    ).run(founder.telegramId || '', founder.email);
  }
}

module.exports = db;