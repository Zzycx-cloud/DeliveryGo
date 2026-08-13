# DeliGo — yetkazib berish platformasi (MVP)

Yandex Go / Yandex Eda uslubidagi to'liq platforma: **backend API + web-ilova (PWA) + Telegram bot + admin panel**.

Bu paket **sinovdan o'tgan, ishlaydigan MVP (asosiy versiya)**. Haqiqiy productionga chiqarish uchun quyidagi
qismlarni o'zingiz ulashingiz kerak bo'ladi (pastda tushuntirilgan): SMTP email, Telegram bot token, hosting,
haqiqiy to'lov shlyuzi (Payme/Click/Uzcard).

## Tuzilma

```
deligo/
├── backend/          Node.js + Express + SQLite API server
│   ├── server.js      Asosiy server (shu server web-ilovani ham xizmat qiladi)
│   ├── routes/         auth.js, restaurants.js, orders.js, admin.js, bot.js
│   ├── db/db.js        SQLite sxema (avtomatik yaratiladi)
│   ├── telegram.js     Telegram kanallariga log/buyurtma yuborish
│   └── .env.example    Sozlamalar namunasi
├── frontend/          Web-ilova (sayt + PWA — telefonga "ilova kabi" o'rnatiladi)
│   ├── index.html      G→O animatsiyali splash, til tanlash, asosiy oqim, admin panel
│   ├── style.css
│   └── app.js
└── bot/               Telegram bot (Python, aiogram 3)
    ├── bot.py
    ├── requirements.txt
    └── .env.example
```

## 1) Backend'ni ishga tushirish

```bash
cd backend
npm install
cp .env.example .env
# .env faylni oching va quyidagilarni to'ldiring:
#   SMTP_USER / SMTP_PASS   — Gmail App Password (kod emailga yuborilishi uchun)
#   TELEGRAM_BOT_TOKEN      — @BotFather dan olingan token
#   BOT_SECRET              — bot.py dagi BOT_SECRET bilan bir xil bo'lsin
npm start
```

Server `http://localhost:4000` da ishga tushadi va **shu manzil orqali sayt/web-ilova ham ochiladi**
(chunki backend frontend papkasini xizmat qiladi).

> SMTP sozlanmagan bo'lsa, tizim "dev rejimi"da ishlaydi: tasdiqlash kodi konsolga (`[DEV] email uchun kod: 123456`)
> chiqariladi va API javobida `dev_code` maydonida qaytariladi — shu orqali email yubormasdan ham sinab ko'rishingiz mumkin.

### Boshlang'ich sozlamalar (kod ichida qat'iy o'rnatilgan)
- **Ikkala asoschi (owner):** `ibragimovfkhan@gmail.com` (Telegram ID: `7203210832`) va
  `ahmadzanovdovudbek@gmail.com` (Telegram ID: `6600336418`) — ikkalasi ham teng huquqli, to'liq
  huquqli va himoyalangan owner (`backend/config/founders.js`, kerak bo'lsa `.env` orqali ham
  almashtirish mumkin: `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_TELEGRAM_ID` va
  `SUPER_ADMIN_2_EMAIL`/`SUPER_ADMIN_2_TELEGRAM_ID`).
- **Buyurtmalar log kanali:** `-1004443453718` — har bir yangi buyurtma shu Telegram kanaliga yuboriladi.
- **Umumiy log kanali:** `-1004495081262` — ro'yxatdan o'tish, ilova ochilishi, taom/admin qo'shilishi shu yerga yoziladi.
- **Dostavchiklar kanali:** `-1004338194529` (`TELEGRAM_COURIERS_CHANNEL_ID`) — yangi buyurtma tushganda shu kanalga
  faol dostavchiklar ro'yxati bilan tugmalar yuboriladi; kanaldagi admin "tanlash" tugmasini bosib buyurtmani
  o'sha dostavchiga tayinlaydi (dostavchi va mijozga avtomatik xabar boradi).

Botni shu kanallarga xabar yozа olishi uchun **bot HAR UCHALA kanalga ham admin qilib qo'shilgan bo'lishi kerak.**

### Muhim: bot va backend alohida hostinglarda ishlaganda

`bot/.env` dagi `BACKEND_URL` **backend haqiqiy hosting manzili** bo'lishi SHART (masalan
`https://deligo-backend.onrender.com`), `http://localhost:4000` EMAS — aks holda bot admin panel
buyruqlari, taom/restoran qo'shish, statistika va boshqa hammasi ishlamaydi, chunki bot backendga
umuman ulana olmaydi. Bu eng ko'p uchraydigan "bot ishlamayapti" sababi.

### Bot admin panel (menyu, /addadmin YO'Q)

Admin panel endi to'liq tugmali menyu: 📊 Statistika, 📋 Admin log, 📈 Keng statistika, 👑/➕ Admin
qo'shish (rolga qarab: owner, katta admin, oddiy admin, restoran admini), ➖ Admin olib tashlash,
🏅 Adminlar ro'yxati, 🍽 Restoran/🍲 Oshxona qo'shish, 🍔 Taom qo'shish (nomi + narxi + **rasmi**, rasmni
botga to'g'ridan-to'g'ri jo'natish orqali — rasm serverga Telegram file_id orqali proksi qilinadi,
`/api/photo/:file_id`), 🚴 Dostavchik qo'shish/ro'yxati, 🚫 Bloklash/✅ Blokdan chiqarish, 📢 Xabar
yuborish (email + telegram + kanal). Buning uchun `/start` qayta bosib botni qayta ishga tushiring —
eski keshlangan menyu emas, YANGI kodni ishlatayotganingizga ishonch hosil qiling (hostingga qayta
deploy qilinishi kerak).

## 2) Web-ilova (sayt)

Alohida serverga muhtoj emas — backend uni xizmat qiladi. Brauzerda `http://localhost:4000` ni oching.

Ilova quyidagilarni o'z ichiga oladi:
- Chiroyli splash: katta **G** harfi aylanib **O** ga aylanadi (DeliGo logotipi)
- Til tanlash: O'zbek / Rus / Ingliz
- Email orqali kirish (SMS emas, 6 xonali kod)
- Restoran/oshxonalar ro'yxati, qidiruv, filtr
- Restoran sahifasi — menyu, savat
- Buyurtma berish — manzil, to'lov usuli (naqd/karta)
- Buyurtmalarim, Profil (til, to'lov usuli, DeliGo Plyus)
- **Admin panel** (agar kirgan email admin bo'lsa, Profil bo'limida "Admin panel" tugmasi chiqadi):
  statistika (restoran admini faqat o'z restoranining statistikasini ko'radi, boshqasini emas), buyurtmalar
  boshqaruvi, restoran/taom qo'shish, foydalanuvchilarni ban/shtraf/plyus qilish,
  boshqa adminlar qo'shish (restoran admini uchun qaysi restoran ekani so'raladi), narx sozlamalari.

Telefonga "ilova kabi" o'rnatish uchun brauzerdagi **"Bosh ekranga qo'shish" / "Add to Home Screen"**
funksiyasidan foydalaning (to'liq PWA — manifest.json va service worker — kerak bo'lsa qo'shib beraman).

## 3) Telegram bot

```bash
cd bot
pip install -r requirements.txt
cp .env.example .env
# .env faylga BOT_TOKEN (BotFather dan) va BACKEND_URL ni kiriting
python bot.py
```

Bot imkoniyatlari:
- `/start` — til tanlash, telefon raqamini ulashish orqali ro'yxatdan o'tish
- 🍽 Restoranlar — ro'yxatdan tanlab, menyudan taom qo'shish, buyurtma berish (manzil + to'lov usuli)
- 📦 Mening buyurtvalarim
- 🛡 Admin panel — faqat adminlarga ko'rinadi. `/addadmin` buyrug'i orqali yangi admin qo'shiladi;
  agar "Restoran/Oshxona admini" tanlansa, **qaysi restoran/oshxona ekani so'raladi**.

Bot backend bilan `/api/bot/...` orqali gaplashadi (himoyalangan `x-bot-secret` kaliti orqali).

## 4) Ishlab chiqarishga (production) chiqarish uchun kerak bo'ladigan qadamlar

Bu MVP — asosiy mantiq to'liq ishlaydi, lekin haqiqiy foydalanuvchilarga chiqarish uchun:

1. **Hosting** — backend'ni doimiy ishlab turadigan serverga qo'ying (masalan Railway, Render, VPS + PM2/Docker).
2. **Haqiqiy domen + HTTPS** — sayt/ilova manzili shunga ko'chadi.
3. **SMTP** — haqiqiy email yuborish uchun (Gmail App Password yoki SendGrid/Mailgun kabi xizmat).
4. **Telegram bot tokeni** — @BotFather orqali yarating, `.env` ga qo'shing, botni ikkala kanalga admin qilib kiriting.
5. **To'lov integratsiyasi** — Payme/Click/Uzcard API kalitlari; hozir "Karta" tanlansa faqat belgilanadi,
   haqiqiy to'lov so'rovi yuborilmaydi — buni ulash uchun alohida ishlov kerak.
6. **Native mobil ilova** — hozirgi web-ilova PWA sifatida ishlaydi (brauzer orqali "ilova kabi" o‘rnatiladi).
   Agar Play Store/App Store uchun haqiqiy `.apk`/`.ipa` kerak bo'lsa, buni React Native yoki Flutter bilan
   alohida qurish kerak (bu muhitda build qilib bo'lmaydi, lekin men kodni boshqa muhitda davom ettirishga
   yordam bera olaman).

## Texnik tafsilotlar

- **Backend:** Node.js, Express, SQLite (better-sqlite3), JWT autentifikatsiya
- **Frontend:** Vanilla JS (framework'siz, tez va yengil), CSS animatsiyalar
- **Bot:** Python, aiogram 3 (async)
- **Admin rollari:** `super_admin` (hammasi), `admin` (umumiy), `restaurant_admin` (faqat o'z restorani)
