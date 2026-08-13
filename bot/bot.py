"""
DeliGo Telegram Bot
--------------------
Ishga tushirish:
    pip install -r requirements.txt
    cp .env.example .env   # va BOT_TOKEN, BACKEND_URL, BOT_SECRET ni to'ldiring
    python bot.py

Eslatma: backend server (../backend) ishga tushirilgan bo'lishi kerak,
chunki bot barcha ma'lumotlarni /api/bot/... orqali backenddan oladi.
"""

import asyncio
import logging
import os

import aiohttp
import aiohttp.web
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, Router, F
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message, CallbackQuery, ReplyKeyboardMarkup, KeyboardButton,
    InlineKeyboardMarkup, InlineKeyboardButton, ReplyKeyboardRemove,
)

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:4000")
BOT_SECRET = os.getenv("BOT_SECRET")

logging.basicConfig(level=logging.INFO)
router = Router()

# ===================== VAQTINCHALIK XOTIRA (savat, til) =====================
user_lang = {}      # {telegram_id: "uz"/"ru"/"en"}
user_cart = {}      # {telegram_id: {"restaurant_id": int, "items": {item_id: {"name","price","qty"}}}}
restaurants_cache = {}  # {telegram_id: [list of restaurants]} - admin uchun tanlashda

TEXT = {
    "uz": {
        "choose_lang": "Tilni tanlang / Выберите язык / Choose language",
        "welcome": "Xush kelibsiz, DeliGo botiga! 🍔\nTelefon raqamingizni ulashing:",
        "share_phone": "📱 Raqamni ulashish",
        "main_menu": "Asosiy menyu",
        "restaurants": "🍽 Restoranlar",
        "my_orders": "📦 Mening buyurtvalarim",
        "admin_panel": "🛡 Admin panel",
        "banned": "🚫 Siz bloklangansiz. Sabab: {reason}",
        "choose_restaurant": "Restoranni tanlang:",
        "empty_menu": "Bu joyda hali taomlar yo'q.",
        "added_to_cart": "✅ Qo'shildi: {name}",
        "cart_empty": "Savat bo'sh",
        "cart_title": "🛒 Savat:\n{lines}\nJami: {total} so'm",
        "checkout": "✅ Rasmiylashtirish",
        "ask_address": "Yetkazib berish manzilini kiriting:",
        "ask_payment": "To'lov usulini tanlang:",
        "cash": "💵 Naqd pul",
        "card": "💳 Karta",
        "order_done": "🎉 Buyurtma qabul qilindi! Tez orada tayyorlashadi.",
        "no_orders": "Hali buyurtma yo'q",
    },
}
# Oddiylik uchun ru/en ham uz matnlaridan foydalanadi (kengaytirish oson)
TEXT["ru"] = TEXT["uz"]
TEXT["en"] = TEXT["uz"]


def t(uid, key, **kwargs):
    lang = user_lang.get(uid, "uz")
    return TEXT[lang][key].format(**kwargs)


async def api_get(path):
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{BACKEND_URL}{path}", headers={"x-bot-secret": BOT_SECRET}) as resp:
            return await resp.json(), resp.status


async def api_post(path, payload):
    async with aiohttp.ClientSession() as session:
        async with session.post(f"{BACKEND_URL}{path}", json=payload, headers={"x-bot-secret": BOT_SECRET}) as resp:
            return await resp.json(), resp.status


# ===================== STATES =====================
class Checkout(StatesGroup):
    waiting_address = State()
    waiting_payment = State()


class AddAdmin(StatesGroup):
    waiting_email = State()
    waiting_role = State()
    waiting_restaurant = State()


# ===================== START =====================
@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext):
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🇺🇿 O'zbek", callback_data="lang_uz")],
        [InlineKeyboardButton(text="🇷🇺 Русский", callback_data="lang_ru")],
        [InlineKeyboardButton(text="🇬🇧 English", callback_data="lang_en")],
    ])
    await message.answer(TEXT["uz"]["choose_lang"], reply_markup=kb)


@router.callback_query(F.data.startswith("lang_"))
async def choose_lang(callback: CallbackQuery):
    lang = callback.data.split("_")[1]
    user_lang[callback.from_user.id] = lang
    await callback.message.delete()

    kb = ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=t(callback.from_user.id, "share_phone"), request_contact=True)]],
        resize_keyboard=True,
    )
    await callback.message.answer(t(callback.from_user.id, "welcome"), reply_markup=kb)


@router.message(F.contact)
async def got_contact(message: Message):
    uid = message.from_user.id
    phone = message.contact.phone_number
    data, status = await api_post("/api/bot/register", {
        "telegram_id": uid, "phone": phone, "language": user_lang.get(uid, "uz"),
    })

    if status != 200:
        await message.answer("Xatolik: backend bilan bog'lanib bo'lmadi. Admin bilan bog'laning.")
        return

    if data.get("isBanned"):
        await message.answer(t(uid, "banned", reason=data.get("banReason") or "-"), reply_markup=ReplyKeyboardRemove())
        return

    await show_main_menu(message, is_admin=data.get("isAdmin"))


async def show_main_menu(message: Message, is_admin=False):
    uid = message.from_user.id
    rows = [
        [KeyboardButton(text=t(uid, "restaurants"))],
        [KeyboardButton(text=t(uid, "my_orders"))],
    ]
    if is_admin:
        rows.append([KeyboardButton(text=t(uid, "admin_panel"))])
    kb = ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True)
    await message.answer(t(uid, "main_menu"), reply_markup=kb)


# ===================== RESTORANLAR =====================
@router.message(F.text.in_([TEXT["uz"]["restaurants"]]))
async def list_restaurants(message: Message):
    uid = message.from_user.id
    data, status = await api_get("/api/bot/restaurants")
    if status != 200 or not data:
        await message.answer(t(uid, "empty_menu"))
        return
    restaurants_cache[uid] = data
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"{'🍲' if r['type']=='oshxona' else '🍽️'} {r['name']}", callback_data=f"rest_{r['id']}")]
        for r in data
    ])
    await message.answer(t(uid, "choose_restaurant"), reply_markup=kb)


@router.callback_query(F.data.startswith("rest_"))
async def open_restaurant(callback: CallbackQuery):
    uid = callback.from_user.id
    rid = int(callback.data.split("_")[1])
    data, status = await api_get(f"/api/bot/restaurants/{rid}")
    if status != 200:
        await callback.answer("Topilmadi", show_alert=True)
        return

    user_cart[uid] = {"restaurant_id": rid, "restaurant_name": data["name"], "items": {}}

    if not data["menu"]:
        await callback.message.answer(t(uid, "empty_menu"))
        return

    buttons = [
        [InlineKeyboardButton(text=f"{m['name']} — {m['price']:,} so'm", callback_data=f"add_{m['id']}_{m['name']}_{m['price']}")]
        for m in data["menu"]
    ]
    buttons.append([InlineKeyboardButton(text=t(uid, "checkout"), callback_data="checkout")])
    await callback.message.answer(data["name"], reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))


@router.callback_query(F.data.startswith("add_"))
async def add_to_cart(callback: CallbackQuery):
    uid = callback.from_user.id
    _, item_id, name, price = callback.data.split("_", 3)
    cart = user_cart.setdefault(uid, {"restaurant_id": None, "items": {}})
    item = cart["items"].setdefault(item_id, {"name": name, "price": int(price), "qty": 0})
    item["qty"] += 1
    await callback.answer(t(uid, "added_to_cart", name=name))


@router.callback_query(F.data == "checkout")
async def start_checkout(callback: CallbackQuery, state: FSMContext):
    uid = callback.from_user.id
    cart = user_cart.get(uid)
    if not cart or not cart["items"]:
        await callback.answer(t(uid, "cart_empty"), show_alert=True)
        return
    lines = "\n".join(f"{i['name']} × {i['qty']} = {i['price']*i['qty']:,} so'm" for i in cart["items"].values())
    total = sum(i["price"] * i["qty"] for i in cart["items"].values())
    await callback.message.answer(t(uid, "cart_title", lines=lines, total=f"{total:,}"))
    await callback.message.answer(t(uid, "ask_address"))
    await state.set_state(Checkout.waiting_address)


@router.message(Checkout.waiting_address)
async def got_address(message: Message, state: FSMContext):
    uid = message.from_user.id
    await state.update_data(address=message.text)
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=t(uid, "cash"), callback_data="pay_cash")],
        [InlineKeyboardButton(text=t(uid, "card"), callback_data="pay_card")],
    ])
    await message.answer(t(uid, "ask_payment"), reply_markup=kb)
    await state.set_state(Checkout.waiting_payment)


@router.callback_query(Checkout.waiting_payment, F.data.startswith("pay_"))
async def got_payment(callback: CallbackQuery, state: FSMContext):
    uid = callback.from_user.id
    payment_method = callback.data.split("_")[1]
    fsm_data = await state.get_data()
    cart = user_cart.get(uid)

    items = [{"id": iid, "name": i["name"], "price": i["price"], "qty": i["qty"]} for iid, i in cart["items"].items()]
    payload = {
        "telegram_id": uid,
        "restaurant_id": cart["restaurant_id"],
        "items": items,
        "address": fsm_data.get("address"),
        "payment_method": payment_method,
    }
    data, status = await api_post("/api/bot/order", payload)
    if status == 200:
        await callback.message.answer(t(uid, "order_done"))
        user_cart[uid] = {"restaurant_id": None, "items": {}}
    else:
        await callback.message.answer(f"Xatolik: {data.get('error')}")
    await state.clear()


# ===================== BUYURTMALARIM =====================
@router.message(F.text.in_([TEXT["uz"]["my_orders"]]))
async def my_orders(message: Message):
    uid = message.from_user.id
    data, status = await api_get(f"/api/bot/my-orders/{uid}")
    if status != 200 or not data:
        await message.answer(t(uid, "no_orders"))
        return
    text = "\n\n".join(f"#{o['id']} — {o['total_amount']:,} so'm — {o['status']}" for o in data)
    await message.answer(text)


# ===================== ADMIN: /addadmin =====================
@router.message(F.text.in_([TEXT["uz"]["admin_panel"]]))
async def admin_panel(message: Message):
    await message.answer(
        "🛡 Admin buyruqlari:\n"
        "/addadmin — yangi admin qo'shish (faqat bosh admin uchun)\n"
        "Statistika, foydalanuvchilarni ban/shtraf qilish uchun DeliGo veb-admin panelidan foydalaning."
    )


@router.message(Command("addadmin"))
async def add_admin_start(message: Message, state: FSMContext):
    await message.answer("Yangi admin emailini kiriting:")
    await state.set_state(AddAdmin.waiting_email)


@router.message(AddAdmin.waiting_email)
async def add_admin_email(message: Message, state: FSMContext):
    await state.update_data(new_email=message.text.strip())
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Umumiy admin", callback_data="role_admin")],
        [InlineKeyboardButton(text="Restoran/Oshxona admini", callback_data="role_restaurant_admin")],
        [InlineKeyboardButton(text="Bosh admin", callback_data="role_super_admin")],
    ])
    await message.answer("Rolini tanlang:", reply_markup=kb)
    await state.set_state(AddAdmin.waiting_role)


@router.callback_query(AddAdmin.waiting_role, F.data.startswith("role_"))
async def add_admin_role(callback: CallbackQuery, state: FSMContext):
    role = callback.data[len("role_"):]
    await state.update_data(role=role)
    uid = callback.from_user.id

    if role == "restaurant_admin":
        data, status = await api_get("/api/bot/restaurants")
        restaurants_cache[uid] = data if status == 200 else []
        if not restaurants_cache[uid]:
            await callback.message.answer("Hozircha restoran/oshxona yo'q. Avval uni qo'shing.")
            await state.clear()
            return
        buttons = [
            [InlineKeyboardButton(text=f"{'🍲' if r['type']=='oshxona' else '🍽️'} {r['name']}", callback_data=f"pickrest_{r['id']}")]
            for r in restaurants_cache[uid]
        ]
        await callback.message.answer("Qaysi restoran yoki oshxona uchun admin bo'lsin?", reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))
        await state.set_state(AddAdmin.waiting_restaurant)
    else:
        await finalize_add_admin(callback.message, state, uid, restaurant_id=None)


@router.callback_query(AddAdmin.waiting_restaurant, F.data.startswith("pickrest_"))
async def add_admin_restaurant(callback: CallbackQuery, state: FSMContext):
    rid = int(callback.data.split("_")[1])
    uid = callback.from_user.id
    await finalize_add_admin(callback.message, state, uid, restaurant_id=rid)


async def finalize_add_admin(message: Message, state: FSMContext, uid: int, restaurant_id):
    fsm_data = await state.get_data()
    payload = {
        "by_telegram_id": uid,
        "new_email": fsm_data["new_email"],
        "role": fsm_data["role"],
        "restaurant_id": restaurant_id,
    }
    data, status = await api_post("/api/bot/add-admin", payload)
    if status == 200:
        await message.answer(f"✅ {fsm_data['new_email']} admin sifatida qo'shildi ({fsm_data['role']}).")
    else:
        await message.answer(f"Xatolik: {data.get('error')}")
    await state.clear()


# ===================== RENDER UCHUN HEALTH-CHECK SERVER =====================
# Render "Web Service" turida xizmatning tirikligini bilish uchun PORT'ni
# tinglashini kutadi. Bot o'zi polling qilgani uchun port ochmaydi — shu sabab
# shu yerda juda kichik HTTP server ochib, Render'ning tekshiruvini qondiramiz.
async def start_health_server():
    port = int(os.getenv("PORT", "10000"))

    async def health(request):
        return aiohttp.web.Response(text="DeliGo bot ishlayapti")

    app = aiohttp.web.Application()
    app.router.add_get("/", health)
    runner = aiohttp.web.AppRunner(app)
    await runner.setup()
    site = aiohttp.web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    logging.info(f"Health-check server {port}-portda ishga tushdi")


# ===================== RUN =====================
async def main():
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN .env faylida ko'rsatilmagan!")
    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher(storage=MemoryStorage())
    dp.include_router(router)

    await start_health_server()
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
