// Ikkala asoschi (bosh owner) — kod ichida qat'iy o'rnatilgan, .env orqali ham
// almashtirish/qo'shimcha berish mumkin. Ikkalasi ham is_founder=1 bo'lib,
// hech kim (bir-birini ham) o'chira olmaydi va barcha huquqqa (owner) ega bo'ladi.
const FOUNDERS = [
  {
    email: process.env.SUPER_ADMIN_EMAIL || 'ibragimovfkhan@gmail.com',
    telegramId: (process.env.SUPER_ADMIN_TELEGRAM_ID || '7203210832').replace(/\D/g, ''),
    phone: process.env.SUPER_ADMIN_PHONE || '+998972350025',
  },
  {
    email: process.env.SUPER_ADMIN_2_EMAIL || 'ahmadzanovdovudbek@gmail.com',
    telegramId: (process.env.SUPER_ADMIN_2_TELEGRAM_ID || '6600336418').replace(/\D/g, ''),
    phone: process.env.SUPER_ADMIN_2_PHONE || '',
  },
];

module.exports = { FOUNDERS };
