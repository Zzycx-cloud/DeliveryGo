const fetch = require('node-fetch');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ORDERS_CHANNEL = process.env.TELEGRAM_ORDERS_CHANNEL_ID; // -1004443453718
const LOGS_CHANNEL = process.env.TELEGRAM_LOGS_CHANNEL_ID;     // -1004495081262
const COURIERS_CHANNEL = process.env.TELEGRAM_COURIERS_CHANNEL_ID; // -1004338194529

async function sendTelegramMessage(chatId, text, replyMarkup) {
  if (!BOT_TOKEN || !chatId) {
    console.log('[telegram:skip - token yoki chatId yo\'q]', text);
    return null;
  }
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    const data = await resp.json();
    if (!data.ok) console.error('Telegram API xato:', data.description);
    return data.result || null;
  } catch (err) {
    console.error('Telegram xabar yuborishda xato:', err.message);
    return null;
  }
}

// Kanal/chatdagi bot xabarini tahrirlash (masalan, dostavchik tayinlangach tugmalarni olib tashlash uchun)
async function editTelegramMessage(chatId, messageId, text, replyMarkup) {
  if (!BOT_TOKEN || !chatId || !messageId) return;
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  } catch (err) {
    console.error('Telegram xabarni tahrirlashda xato:', err.message);
  }
}

// Yangi buyurtma tushganda dostavchiklar kanaliga yuboriladi — har bir faol dostavchik uchun
// "Men olaman" tugmasi chiqadi (callback_data: asgcr_<orderId>_<courierId>)
async function notifyCourierChannel(order, restaurant, user, couriers) {
  if (!COURIERS_CHANNEL) return;
  const text =
    `🚴 <b>Yangi buyurtma — dostavchik kerak #${order.id}</b>\n` +
    `🍽 Restoran: ${restaurant.name}\n` +
    `📍 Manzil: ${order.address || '-'}\n` +
    `💰 Summa: ${order.total_amount.toLocaleString()} so'm\n` +
    `💳 To'lov: ${order.payment_method === 'card' ? 'Karta' : 'Naqd pul'}`;

  const buttons = (couriers || [])
    .filter((c) => c.is_active)
    .map((c) => [{ text: `🚴 ${c.name || c.telegram_id} — tanlash`, callback_data: `asgcr_${order.id}_${c.id}` }]);

  return sendTelegramMessage(COURIERS_CHANNEL, text, { inline_keyboard: buttons });
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
  editTelegramMessage,
  notifyCourierChannel,
  logOrder,
  logEvent,
  logRegistration,
  logAppDownloadPing,
  logItemAdded,
  logAdminAdded,
};
