const fetch = require('node-fetch');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ORDERS_CHANNEL = process.env.TELEGRAM_ORDERS_CHANNEL_ID; // -1004443453718
const LOGS_CHANNEL = process.env.TELEGRAM_LOGS_CHANNEL_ID;     // -1004495081262

async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN || !chatId) {
    console.log('[telegram:skip - token yoki chatId yo\'q]', text);
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (err) {
    console.error('Telegram xabar yuborishda xato:', err.message);
  }
}

function logOrder(order, restaurant, user) {
  const text =
    `🆕 <b>Yangi buyurtma #${order.id}</b>\n` +
    `🍽 Restoran: ${restaurant.name}\n` +
    `👤 Mijoz: ${user.name || user.email}\n` +
    `💳 To'lov: ${order.payment_method === 'card' ? 'Karta' : 'Naqd pul'}\n` +
    `💰 Summa: ${order.total_amount.toLocaleString()} so'm\n` +
    `📍 Manzil: ${order.address || '-'}\n` +
    `📦 Manba: ${order.source}`;
  return sendTelegramMessage(ORDERS_CHANNEL, text);
}

function logEvent(text) {
  return sendTelegramMessage(LOGS_CHANNEL, text);
}

function logRegistration(user) {
  return logEvent(`👤 <b>Yangi ro'yxatdan o'tish</b>\nEmail: ${user.email}\nTil: ${user.language}`);
}

function logAppDownloadPing(email) {
  return logEvent(`📲 <b>Ilova yuklab olindi / ochildi</b>\nFoydalanuvchi: ${email || 'mehmon'}`);
}

function logItemAdded(actorEmail, itemName, restaurantName) {
  return logEvent(`➕ <b>Yangi taom qo'shildi</b>\nKim: ${actorEmail}\nTaom: ${itemName}\nRestoran: ${restaurantName}`);
}

function logAdminAdded(actorEmail, newAdminEmail, restaurantName) {
  return logEvent(
    `🛡 <b>Yangi admin qo'shildi</b>\nKim qo'shdi: ${actorEmail}\nYangi admin: ${newAdminEmail}\n` +
    (restaurantName ? `Restoran/Oshxona: ${restaurantName}` : 'Rol: Umumiy admin')
  );
}

module.exports = {
  sendTelegramMessage,
  logOrder,
  logEvent,
  logRegistration,
  logAppDownloadPing,
  logItemAdded,
  logAdminAdded,
};
