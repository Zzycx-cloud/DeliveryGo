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
    waiting_telegram_id = State()
    waiting_restaurant = State()


class AddPlace(StatesGroup):
    waiting_name = State()
    waiting_address = State()
    waiting_phone = State()


class AddMenuItem(StatesGroup):
    waiting_restaurant = State()
    waiting_name = State()
    waiting_price = State()
    waiting_photo = State()


class AddCourier(StatesGroup):
    waiting_telegram_id = State()
    waiting_name = State()


class BanUser(StatesGroup):
    waiting_target = State()
    waiting_reason = State()


class UnbanUser(StatesGroup):
    waiting_target = State()


class Broadcast(StatesGroup):
    waiting_text = State()


# {telegram_id: "owner"/"senior_admin"/"admin"/"restaurant_admin"/None}
user_admin_role = {}
# {telegram_id: role kutilayotgan yangi admin uchun ("owner"/"senior_admin"/"admin"/"restaurant_admin")}
pending_new_admin_role = {}
# {telegram_id: "restaurant"/"oshxona" - AddPlace flow uchun}
pending_place_type = {}
# {telegram_id: yangi taom uchun {"restaurant_id", "name", "price"}}
pending_menu_item = {}


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

    user_admin_role[uid] = data.get("adminRole")
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


# ===================== ADMIN PANEL (asosiy) =====================
ROLE_LABELS = {
    "owner": "👑 Owner",
    "senior_admin": "🌟 Katta admin",
    "admin": "🛠 Oddiy admin",
    "restaurant_admin": "🍽 Restoran admini",
}


def admin_root_kb(uid: int) -> InlineKeyboardMarkup:
    role = user_admin_role.get(uid) or "admin"
    is_senior_plus = role in ("owner", "senior_admin")
    rows = [[InlineKeyboardButton(text="🍔 Taom qo'shish (rasm + narx)", callback_data="menuitem_start")]]
    if role != "restaurant_admin":
        rows = [
            [InlineKeyboardButton(text="🍽 Restoran qo'shish", callback_data="place_restaurant")],
            [InlineKeyboardButton(text="🍲 Oshxona qo'shish", callback_data="place_oshxona")],
        ] + rows
    if is_senior_plus:
        rows.append([InlineKeyboardButton(text="🚴 Dostavchik qo'shish", callback_data="courier_add")])
        rows.append([InlineKeyboardButton(text="🚴 Dostavchiklar ro'yxati", callback_data="courier_list")])
        rows.append([InlineKeyboardButton(text="🚫 Foydalanuvchini bloklash", callback_data="ban_start")])
        rows.append([InlineKeyboardButton(text="✅ Blokdan chiqarish", callback_data="unban_start")])
        rows.append([InlineKeyboardButton(text="📢 Xabar yuborish (broadcast)", callback_data="broadcast_start")])
    rows.append([InlineKeyboardButton(text="⚙️ Admin sozlamalari", callback_data="admin_settings")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def admin_settings_kb(role: str) -> InlineKeyboardMarkup:
    is_owner = role == "owner"
    is_senior_plus = role in ("owner", "senior_admin")
    rows = [
        [InlineKeyboardButton(text="📊 Statistika", callback_data="astat")],
        [InlineKeyboardButton(text="📋 Admin log", callback_data="alog")],
        [InlineKeyboardButton(text="📈 Keng statistika", callback_data="awide")],
    ]
    if is_owner:
        rows.append([InlineKeyboardButton(text="👑 Owner qo'shish", callback_data="addrole_owner")])
    if is_owner:
        rows.append([InlineKeyboardButton(text="➕ Katta admin qo'shish", callback_data="addrole_senior_admin")])
    if is_senior_plus:
        rows.append([InlineKeyboardButton(text="➕ Oddiy admin qo'shish", callback_data="addrole_admin")])
        rows.append([InlineKeyboardButton(text="🏪 Restoran admini qo'shish", callback_data="addrole_restaurant_admin")])
        rows.append([InlineKeyboardButton(text="➖ Admin olib tashlash", callback_data="admin_remove_list")])
        rows.append([InlineKeyboardButton(text="🏅 Adminlar ro'yxati", callback_data="admin_list")])
    rows.append([InlineKeyboardButton(text="⬅️ Orqaga", callback_data="admin_root")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


@router.message(F.text.in_([TEXT["uz"]["admin_panel"]]))
async def admin_panel(message: Message):
    await message.answer("🛡 Admin panel", reply_markup=admin_root_kb(message.from_user.id))


@router.callback_query(F.data == "admin_root")
async def admin_root(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.edit_text("🛡 Admin panel", reply_markup=admin_root_kb(callback.from_user.id))


@router.callback_query(F.data == "admin_settings")
async def admin_settings(callback: CallbackQuery):
    uid = callback.from_user.id
    role = user_admin_role.get(uid) or "admin"
    await callback.message.edit_text("⚙️ Admin sozlamalari", reply_markup=admin_settings_kb(role))


# ---------- Restoran / Oshxona qo'shish ----------
@router.callback_query(F.data.startswith("place_"))
async def place_start(callback: CallbackQuery, state: FSMContext):
    place_type = callback.data.split("_", 1)[1]  # restaurant | oshxona
    pending_place_type[callback.from_user.id] = place_type
    label = "Oshxona" if place_type == "oshxona" else "Restoran"
    await callback.message.answer(f"{label} nomini kiriting:")
    await state.set_state(AddPlace.waiting_name)


@router.message(AddPlace.waiting_name)
async def place_name(message: Message, state: FSMContext):
    await state.update_data(name=message.text.strip())
    await message.answer("Manzilini kiriting (yoki '-' agar hozircha kerak bo'lmasa):")
    await state.set_state(AddPlace.waiting_address)


@router.message(AddPlace.waiting_address)
async def place_address(message: Message, state: FSMContext):
    await state.update_data(address=message.text.strip())
    await message.answer("Telefon raqamini kiriting (yoki '-'):")
    await state.set_state(AddPlace.waiting_phone)


@router.message(AddPlace.waiting_phone)
async def place_phone(message: Message, state: FSMContext):
    uid = message.from_user.id
    fsm_data = await state.get_data()
    place_type = pending_place_type.get(uid, "restaurant")
    payload = {
        "by_telegram_id": uid,
        "name": fsm_data["name"],
        "type": place_type,
        "address": None if fsm_data["address"] == "-" else fsm_data["address"],
        "phone": None if message.text.strip() == "-" else message.text.strip(),
    }
    data, status = await api_post("/api/bot/restaurants", payload)
    if status == 200:
        label = "Oshxona" if place_type == "oshxona" else "Restoran"
        await message.answer(f"✅ {label} qo'shildi: {fsm_data['name']}", reply_markup=admin_root_kb(uid))
    else:
        await message.answer(f"❌ Xatolik: {data.get('error')}")
    await state.clear()


# ---------- Taom qo'shish (rasm + narx) ----------
@router.callback_query(F.data == "menuitem_start")
async def menuitem_start(callback: CallbackQuery, state: FSMContext):
    uid = callback.from_user.id
    data, status = await api_get("/api/bot/restaurants")
    restaurants_cache[uid] = data if status == 200 else []
    if not restaurants_cache[uid]:
        await callback.message.answer("Hozircha restoran/oshxona yo'q. Avval uni qo'shing.")
        await callback.answer()
        return
    buttons = [
        [InlineKeyboardButton(text=f"{'🍲' if r['type']=='oshxona' else '🍽️'} {r['name']}", callback_data=f"mipick_{r['id']}")]
        for r in restaurants_cache[uid]
    ]
    await callback.message.answer("Qaysi restoran/oshxonaga taom qo'shamiz?", reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))
    await state.set_state(AddMenuItem.waiting_restaurant)
    await callback.answer()


@router.callback_query(AddMenuItem.waiting_restaurant, F.data.startswith("mipick_"))
async def menuitem_pick_restaurant(callback: CallbackQuery, state: FSMContext):
    rid = int(callback.data.split("_")[1])
    pending_menu_item[callback.from_user.id] = {"restaurant_id": rid}
    await callback.message.answer("Taom nomini kiriting:")
    await state.set_state(AddMenuItem.waiting_name)
    await callback.answer()


@router.message(AddMenuItem.waiting_name)
async def menuitem_got_name(message: Message, state: FSMContext):
    uid = message.from_user.id
    pending_menu_item.setdefault(uid, {})["name"] = message.text.strip()
    await message.answer("Narxini kiriting (faqat raqam, so'mda, masalan 25000):")
    await state.set_state(AddMenuItem.waiting_price)


@router.message(AddMenuItem.waiting_price)
async def menuitem_got_price(message: Message, state: FSMContext):
    uid = message.from_user.id
    price_text = message.text.strip().replace(" ", "").replace(",", "")
    if not price_text.isdigit():
        await message.answer("Narx faqat raqam bo'lishi kerak. Qaytadan kiriting:")
        return
    pending_menu_item.setdefault(uid, {})["price"] = int(price_text)
    await message.answer("Endi taomning rasmini yuboring (yoki rasmsiz o'tkazish uchun '-' yozing):")
    await state.set_state(AddMenuItem.waiting_photo)


@router.message(AddMenuItem.waiting_photo, F.photo)
async def menuitem_got_photo(message: Message, state: FSMContext):
    uid = message.from_user.id
    file_id = message.photo[-1].file_id
    image_url = f"{BACKEND_URL}/api/photo/{file_id}"
    await finalize_menu_item(message, state, uid, image_url)


@router.message(AddMenuItem.waiting_photo)
async def menuitem_skip_photo(message: Message, state: FSMContext):
    uid = message.from_user.id
    if message.text and message.text.strip() == "-":
        await finalize_menu_item(message, state, uid, "")
    else:
        await message.answer("Rasm yuboring yoki o'tkazib yuborish uchun '-' yozing:")


async def finalize_menu_item(message: Message, state: FSMContext, uid: int, image_url: str):
    item = pending_menu_item.get(uid, {})
    payload = {
        "by_telegram_id": uid,
        "name": item.get("name"),
        "price": item.get("price"),
        "image_url": image_url,
    }
    data, status = await api_post(f"/api/bot/restaurants/{item.get('restaurant_id')}/menu", payload)
    if status == 200:
        await message.answer(f"✅ Taom qo'shildi: {item.get('name')} — {item.get('price'):,} so'm", reply_markup=admin_root_kb(uid))
    else:
        await message.answer(f"❌ Xatolik: {data.get('error')}")
    await state.clear()
    pending_menu_item.pop(uid, None)


# ---------- Dostavchik qo'shish / ro'yxati ----------
@router.callback_query(F.data == "courier_add")
async def courier_add_start(callback: CallbackQuery, state: FSMContext):
    await callback.message.answer("Dostavchining Telegram ID raqamini yuboring (@userinfobot orqali bilib olish mumkin):")
    await state.set_state(AddCourier.waiting_telegram_id)
    await callback.answer()


@router.message(AddCourier.waiting_telegram_id)
async def courier_got_id(message: Message, state: FSMContext):
    if not message.text.strip().isdigit():
        await message.answer("Telegram ID faqat raqamlardan iborat bo'lishi kerak. Qaytadan yuboring:")
        return
    await state.update_data(courier_telegram_id=message.text.strip())
    await message.answer("Dostavchining ismini kiriting:")
    await state.set_state(AddCourier.waiting_name)


@router.message(AddCourier.waiting_name)
async def courier_got_name(message: Message, state: FSMContext):
    uid = message.from_user.id
    fsm_data = await state.get_data()
    payload = {"by_telegram_id": uid, "telegram_id": fsm_data["courier_telegram_id"], "name": message.text.strip()}
    data, status = await api_post("/api/bot/add-courier", payload)
    if status == 200:
        await message.answer(f"✅ Dostavchik qo'shildi: {message.text.strip()}", reply_markup=admin_root_kb(uid))
    else:
        await message.answer(f"❌ Xatolik: {data.get('error')}")
    await state.clear()


@router.callback_query(F.data == "courier_list")
async def courier_list(callback: CallbackQuery):
    data, status = await api_get("/api/bot/couriers")
    if status != 200 or not data:
        await callback.message.answer("Hali dostavchik yo'q.")
        await callback.answer()
        return
    lines = [f"• {'🟢' if c['is_active'] else '🔴'} {c.get('name') or '-'} (tg: {c['telegram_id']})" for c in data]
    await callback.message.answer("🚴 Dostavchiklar:\n\n" + "\n".join(lines))
    await callback.answer()


# ---------- Dostavchik kanalidagi "tanlash" tugmasi ----------
@router.callback_query(F.data.startswith("asgcr_"))
async def assign_courier(callback: CallbackQuery):
    _, order_id, courier_id = callback.data.split("_")
    data, status = await api_post("/api/bot/assign-courier", {
        "by_telegram_id": callback.from_user.id,
        "order_id": int(order_id),
        "courier_id": int(courier_id),
    })
    if status == 200:
        await callback.message.edit_text(
            f"{callback.message.text}\n\n✅ Tayinlandi: {data.get('courier_name') or '-'}"
        )
        await callback.answer("Dostavchi tayinlandi ✅")
    else:
        await callback.answer(data.get("error", "Xatolik"), show_alert=True)


# ---------- Foydalanuvchini bloklash / blokdan chiqarish ----------
@router.callback_query(F.data == "ban_start")
async def ban_start(callback: CallbackQuery, state: FSMContext):
    await callback.message.answer("Bloklanadigan foydalanuvchining Telegram ID yoki emailini yuboring:")
    await state.set_state(BanUser.waiting_target)
    await callback.answer()


@router.message(BanUser.waiting_target)
async def ban_got_target(message: Message, state: FSMContext):
    await state.update_data(target=message.text.strip())
    await message.answer("Bloklash sababini yozing (yoki '-'):")
    await state.set_state(BanUser.waiting_reason)


@router.message(BanUser.waiting_reason)
async def ban_got_reason(message: Message, state: FSMContext):
    uid = message.from_user.id
    fsm_data = await state.get_data()
    reason = "" if message.text.strip() == "-" else message.text.strip()
    data, status = await api_post("/api/bot/ban-user", {"by_telegram_id": uid, "target": fsm_data["target"], "reason": reason})
    if status == 200:
        await message.answer(f"🚫 Bloklandi: {data.get('email')}", reply_markup=admin_root_kb(uid))
    else:
        await message.answer(f"❌ Xatolik: {data.get('error')}")
    await state.clear()


@router.callback_query(F.data == "unban_start")
async def unban_start(callback: CallbackQuery, state: FSMContext):
    await callback.message.answer("Blokdan chiqariladigan foydalanuvchining Telegram ID yoki emailini yuboring:")
    await state.set_state(UnbanUser.waiting_target)
    await callback.answer()


@router.message(UnbanUser.waiting_target)
async def unban_got_target(message: Message, state: FSMContext):
    uid = message.from_user.id
    data, status = await api_post("/api/bot/unban-user", {"by_telegram_id": uid, "target": message.text.strip()})
    if status == 200:
        await message.answer(f"✅ Blokdan chiqarildi: {data.get('email')}", reply_markup=admin_root_kb(uid))
    else:
        await message.answer(f"❌ Xatolik: {data.get('error')}")
    await state.clear()


# ---------- Broadcast (ommaviy xabar) ----------
@router.callback_query(F.data == "broadcast_start")
async def broadcast_start(callback: CallbackQuery, state: FSMContext):
    await callback.message.answer("Barcha foydalanuvchilarga (email + telegram) yuboriladigan xabar matnini kiriting:")
    await state.set_state(Broadcast.waiting_text)
    await callback.answer()


@router.message(Broadcast.waiting_text)
async def broadcast_got_text(message: Message, state: FSMContext):
    uid = message.from_user.id
    data, status = await api_post("/api/bot/broadcast", {"by_telegram_id": uid, "text": message.text})
    if status == 200:
        await message.answer("📢 Xabar yuborish boshlandi, tez orada barchaga yetib boradi.", reply_markup=admin_root_kb(uid))
    else:
        await message.answer(f"❌ Xatolik: {data.get('error')}")
    await state.clear()


# ---------- Statistika / Admin log / Keng statistika ----------
@router.callback_query(F.data == "astat")
async def show_stats(callback: CallbackQuery):
    data, status = await api_get("/api/bot/stats")
    if status != 200:
        await callback.answer("Xatolik", show_alert=True)
        return
    text = (
        f"📊 Statistika\n\n"
        f"👤 Foydalanuvchilar: {data['usersCount']}\n"
        f"🍽 Restoran/oshxonalar: {data['restaurantsCount']}\n"
        f"📦 Buyurtmalar: {data['ordersCount']}\n"
        f"💰 Tushum (yetkazilgan): {data['revenue']:,} so'm"
    )
    await callback.message.answer(text)
    await callback.answer()


@router.callback_query(F.data == "alog")
async def show_admin_log(callback: CallbackQuery):
    data, status = await api_get("/api/bot/admin-logs")
    if status != 200 or not data:
        await callback.message.answer("Admin log bo'sh.")
        await callback.answer()
        return
    lines = [f"• {row['created_at']} — {row['actor']}: {row['action']} ({row['details']})" for row in data[:15]]
    await callback.message.answer("📋 Admin log (oxirgi 15 ta):\n\n" + "\n".join(lines))
    await callback.answer()


@router.callback_query(F.data == "awide")
async def show_wide_stats(callback: CallbackQuery):
    data, status = await api_get("/api/bot/wide-stats")
    if status != 200:
        await callback.answer("Xatolik", show_alert=True)
        return
    by_day = "\n".join(f"{d['day']}: {d['orders']} ta buyurtma, {d['revenue']:,} so'm" for d in data["byDay"]) or "-"
    top = "\n".join(f"{r['name']}: {r['orders']} ta, {r['revenue']:,} so'm" for r in data["topRestaurants"]) or "-"
    await callback.message.answer(f"📈 Kunlar bo'yicha (oxirgi 7 kun):\n{by_day}\n\n🏆 TOP restoranlar:\n{top}")
    await callback.answer()


# ---------- Admin qo'shish (owner/katta admin/oddiy admin/restoran admini) ----------
@router.callback_query(F.data.startswith("addrole_"))
async def add_admin_pick_role(callback: CallbackQuery, state: FSMContext):
    role = callback.data[len("addrole_"):]
    pending_new_admin_role[callback.from_user.id] = role
    await callback.message.answer(
        f"{ROLE_LABELS.get(role, role)} qo'shish uchun yangi foydalanuvchining Telegram ID raqamini yuboring.\n"
        "(Telegram ID ni bilish uchun u @userinfobot ga /start yozishi mumkin)"
    )
    await state.set_state(AddAdmin.waiting_telegram_id)


@router.message(AddAdmin.waiting_telegram_id)
async def add_admin_got_id(message: Message, state: FSMContext):
    uid = message.from_user.id
    new_id = message.text.strip()
    if not new_id.isdigit():
        await message.answer("Telegram ID faqat raqamlardan iborat bo'lishi kerak. Qaytadan yuboring:")
        return
    await state.update_data(new_telegram_id=new_id)
    role = pending_new_admin_role.get(uid, "admin")

    if role == "restaurant_admin":
        data, status = await api_get("/api/bot/restaurants")
        restaurants_cache[uid] = data if status == 200 else []
        if not restaurants_cache[uid]:
            await message.answer("Hozircha restoran/oshxona yo'q. Avval uni qo'shing.")
            await state.clear()
            return
        buttons = [
            [InlineKeyboardButton(text=f"{'🍲' if r['type']=='oshxona' else '🍽️'} {r['name']}", callback_data=f"pickrest_{r['id']}")]
            for r in restaurants_cache[uid]
        ]
        await message.answer("Qaysi restoran yoki oshxona uchun admin bo'lsin?", reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))
        await state.set_state(AddAdmin.waiting_restaurant)
    else:
        await finalize_add_admin(message, state, uid, restaurant_id=None)


@router.callback_query(AddAdmin.waiting_restaurant, F.data.startswith("pickrest_"))
async def add_admin_restaurant(callback: CallbackQuery, state: FSMContext):
    rid = int(callback.data.split("_")[1])
    uid = callback.from_user.id
    await finalize_add_admin(callback.message, state, uid, restaurant_id=rid)


async def finalize_add_admin(message: Message, state: FSMContext, uid: int, restaurant_id):
    fsm_data = await state.get_data()
    role = pending_new_admin_role.get(uid, "admin")
    payload = {
        "by_telegram_id": uid,
        "new_telegram_id": fsm_data["new_telegram_id"],
        "role": role,
        "restaurant_id": restaurant_id,
    }
    data, status = await api_post("/api/bot/add-admin", payload)
    if status == 200:
        await message.answer(f"✅ Telegram ID {fsm_data['new_telegram_id']} — {ROLE_LABELS.get(role, role)} sifatida qo'shildi.")
    else:
        await message.answer(f"❌ Xatolik: {data.get('error')}")
    await state.clear()
    pending_new_admin_role.pop(uid, None)


# ---------- Adminlar ro'yxati / Admin olib tashlash ----------
@router.callback_query(F.data == "admin_list")
async def admin_list(callback: CallbackQuery):
    data, status = await api_get("/api/bot/admins")
    if status != 200 or not data:
        await callback.message.answer("Hali adminlar yo'q.")
        await callback.answer()
        return
    lines = []
    for a in data:
        label = ROLE_LABELS.get(a["role"], a["role"])
        founder = " ⭐ (asoschi)" if a.get("is_founder") else ""
        lines.append(f"• {label}{founder} — {a['email']} (tg: {a.get('telegram_id') or '-'})")
    await callback.message.answer("🏅 Adminlar ro'yxati:\n\n" + "\n".join(lines))
    await callback.answer()


@router.callback_query(F.data == "admin_remove_list")
async def admin_remove_list(callback: CallbackQuery):
    data, status = await api_get("/api/bot/admins")
    if status != 200 or not data:
        await callback.message.answer("Hali adminlar yo'q.")
        await callback.answer()
        return
    buttons = []
    for a in data:
        if a.get("is_founder"):
            continue  # founder hech qachon ro'yxatda ko'rinmaydi - o'chirib bo'lmaydi
        label = ROLE_LABELS.get(a["role"], a["role"])
        buttons.append([InlineKeyboardButton(text=f"❌ {label} — {a['email']}", callback_data=f"rmadmin_{a['email']}")])
    if not buttons:
        await callback.message.answer("O'chirish mumkin bo'lgan admin yo'q.")
        await callback.answer()
        return
    await callback.message.answer("Kimni olib tashlaymiz?", reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))
    await callback.answer()


@router.callback_query(F.data.startswith("rmadmin_"))
async def admin_remove_confirm(callback: CallbackQuery):
    target_email = callback.data[len("rmadmin_"):]
    data, status = await api_post("/api/bot/remove-admin", {
        "by_telegram_id": callback.from_user.id,
        "target_email": target_email,
    })
    if status == 200:
        await callback.message.answer(f"✅ {target_email} olib tashlandi.")
    else:
        await callback.message.answer(f"❌ Xatolik: {data.get('error')}")
    await callback.answer()


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