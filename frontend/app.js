// ===================== CONFIG =====================
const API = ''; // bo'sh — chunki backend shu domendan xizmat qiladi. Boshqa serverda bo'lsa: 'https://sizning-domeningiz.com'

// ===================== STATE =====================
const state = {
  lang: 'uz',
  email: null,
  token: null,
  isAdmin: false,
  adminRole: null,
  user: null,
  restaurants: [],
  currentRestaurant: null,
  cart: {}, // { itemId: {item, qty} }
  paymentMethod: 'cash',
  restaurantsCache: [], // for admin select
};

// ===================== I18N =====================
const I18N = {
  uz: {
    chooseLang: 'Tilni tanlang', chooseLangSub: 'Ilova tilini tanlab davom eting',
    loginTitle: 'Kirish', loginSub: 'Elektron pochtangizni kiriting, tasdiqlash kodini yuboramiz',
    sendCode: 'Kodni yuborish', codeTitle: 'Kodni kiriting', codeSub: 'Quyidagi manzilga yuborilgan 6 xonali kodni kiriting:',
    verify: 'Tasdiqlash',
  },
  ru: {
    chooseLang: 'Выберите язык', chooseLangSub: 'Выберите язык приложения, чтобы продолжить',
    loginTitle: 'Вход', loginSub: 'Введите email, мы вышлем код подтверждения',
    sendCode: 'Отправить код', codeTitle: 'Введите код', codeSub: 'Введите 6-значный код, отправленный на:',
    verify: 'Подтвердить',
  },
  en: {
    chooseLang: 'Choose language', chooseLangSub: 'Select the app language to continue',
    loginTitle: 'Sign in', loginSub: 'Enter your email, we will send a verification code',
    sendCode: 'Send code', codeTitle: 'Enter code', codeSub: '6-digit code sent to:',
    verify: 'Verify',
  },
};

function applyI18n() {
  const dict = I18N[state.lang] || I18N.uz;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });
}

const LANG_STORAGE_KEY = 'deligo_lang';
const LANG_LABELS = { uz: 'O‘zbek', ru: 'Русский', en: 'English' };

function setLang(lang) {
  if (!I18N[lang]) return;
  state.lang = lang;
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  applyI18n();
  const labelEl = document.getElementById('currentLangLabel');
  if (labelEl) labelEl.textContent = LANG_LABELS[lang] || LANG_LABELS.uz;
}

// ===================== SCREEN NAV =====================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ===================== API HELPER =====================
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xatolik yuz berdi');
  return data;
}

// ===================== SPLASH -> LANG =====================
window.addEventListener('DOMContentLoaded', () => {
  // Til avval tanlangan bo'lsa (shu qurilma/brauzerda), tilni qayta so'ramaymiz —
  // to'g'ridan-to'g'ri login ekraniga o'tamiz, o'sha tanlangan tilda.
  const savedLang = localStorage.getItem(LANG_STORAGE_KEY);
  if (savedLang && I18N[savedLang]) {
    setLang(savedLang);
    setTimeout(() => showScreen('screen-email'), 1900);
  } else {
    setTimeout(() => showScreen('screen-lang'), 1900);
  }

  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setLang(btn.dataset.lang);
      showScreen('screen-email');
    });
  });

  // Kodni kiriting ekranidan — email noto'g'ri kiritilgan bo'lsa, orqaga qaytib tahrirlash
  document.getElementById('editEmailBtn').addEventListener('click', () => {
    document.getElementById('emailInput').value = state.email || '';
    document.getElementById('codeInput').value = '';
    document.getElementById('codeErr').textContent = '';
    showScreen('screen-email');
  });

  // PROFIL — tilni o'zgartirish
  document.getElementById('langRow').addEventListener('click', () => {
    showModal(`
      <h3>🌐 Tilni tanlang</h3>
      <div class="lang-list">
        <button type="button" class="lang-btn" data-modal-lang="uz"><span class="flag">UZ</span> O‘zbek tili</button>
        <button type="button" class="lang-btn" data-modal-lang="ru"><span class="flag">RU</span> Русский язык</button>
        <button type="button" class="lang-btn" data-modal-lang="en"><span class="flag">EN</span> English</button>
      </div>
    `);
    document.querySelectorAll('#modalBox [data-modal-lang]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setLang(btn.dataset.modalLang);
        closeModal();
      });
    });
  });

  // AUTH
  document.getElementById('sendCodeBtn').addEventListener('click', sendCode);
  document.getElementById('verifyCodeBtn').addEventListener('click', verifyCode);

  // TABS
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // FILTER CHIPS
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      loadRestaurants(chip.dataset.type);
    });
  });
  document.getElementById('searchInput').addEventListener('input', debounce((e) => {
    loadRestaurants('', e.target.value);
  }, 350));

  // RESTAURANT DETAIL
  document.getElementById('backFromRestaurant').addEventListener('click', () => showScreen('screen-main'));
  document.getElementById('cartFab').addEventListener('click', openCheckout);

  // TOP CART ICON — savatda mahsulot bo'lsa checkoutga o'tadi, bo'lmasa ogohlantiradi
  document.getElementById('cartBtn').addEventListener('click', () => {
    const hasItems = Object.keys(state.cart).length > 0;
    if (!hasItems) {
      showModal(`
        <h3>🛒 Savat bo'sh</h3>
        <p class="muted">Buyurtma berish uchun avval biror restoran yoki oshxonadan taom tanlang.</p>
        <button class="btn-primary" id="cartEmptyOkBtn">Tushunarli</button>
      `);
      document.getElementById('cartEmptyOkBtn').onclick = closeModal;
      return;
    }
    if (!state.currentRestaurant) { showScreen('screen-main'); return; }
    showScreen('screen-restaurant');
    openCheckout();
  });

  // CHECKOUT
  document.getElementById('backFromCheckout').addEventListener('click', () => showScreen('screen-restaurant'));
  document.getElementById('placeOrderBtn').addEventListener('click', placeOrder);
  document.querySelectorAll('.pay-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pay-opt').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.paymentMethod = btn.dataset.pay;
      document.getElementById('currentPaymentLabel').textContent = btn.dataset.pay === 'cash' ? 'Naqd pul' : 'Karta';
    });
  });

  document.getElementById('successOkBtn').addEventListener('click', () => {
    state.cart = {};
    showScreen('screen-main');
    switchTab('orders');
    loadMyOrders();
  });

  // PROFILE
  document.getElementById('logoutRow').addEventListener('click', () => {
    Object.assign(state, { token: null, email: null, user: null, isAdmin: false, adminRole: null, cart: {} });
    showScreen('screen-email');
  });
  document.getElementById('adminPanelRow').addEventListener('click', () => {
    showScreen('screen-admin');
    loadAdminStats();
  });
  document.getElementById('plusBtn').addEventListener('click', () => {
    showModal(`
      <h3>DeliGo Plyus</h3>
      <p class="muted">Oylik obuna orqali buyurtmalaringizga chegirma va tezkor yetkazib berishga ega bo'ling.</p>
      <button class="btn-primary" id="confirmPlusBtn">Faollashtirish (demo)</button>
    `);
    document.getElementById('confirmPlusBtn').onclick = () => { closeModal(); alert('Demo rejim: to\'lov integratsiyasi ulanishi kerak.'); };
  });

  // ADMIN
  document.getElementById('backFromAdmin').addEventListener('click', () => showScreen('screen-main'));
  document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchAdminTab(btn.dataset.atab));
  });
  document.getElementById('addRestaurantBtn').addEventListener('click', openAddRestaurantModal);
  document.getElementById('addAdminBtn').addEventListener('click', openAddAdminModal);
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
  document.getElementById('sendBroadcastBtn').addEventListener('click', sendBroadcast);

  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });
});

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ===================== AUTH =====================
async function sendCode() {
  const email = document.getElementById('emailInput').value.trim();
  const errEl = document.getElementById('emailErr');
  errEl.textContent = '';
  if (!email.includes('@')) { errEl.textContent = 'Email noto\'g\'ri kiritildi'; return; }
  try {
    const data = await api('/api/auth/request-code', { method: 'POST', body: JSON.stringify({ email }) });
    state.email = email;
    document.getElementById('codeEmailLabel').textContent = email;
    document.getElementById('devCodeHint').textContent = data.dev_code ? `(DEV) Kod: ${data.dev_code}` : '';
    showScreen('screen-code');
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function verifyCode() {
  const code = document.getElementById('codeInput').value.trim();
  const errEl = document.getElementById('codeErr');
  errEl.textContent = '';
  try {
    const data = await api('/api/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({ email: state.email, code, language: state.lang }),
    });
    state.token = data.token;
    state.user = data.user;
    state.isAdmin = data.isAdmin;
    state.adminRole = data.adminRole;
    document.getElementById('profileEmail').textContent = state.user.email;
    document.getElementById('adminPanelRow').classList.toggle('hidden', !state.isAdmin);
    renderProfileBadges();
    showScreen('screen-main');
    loadRestaurants();
    api('/api/ping-open', { method: 'POST', body: JSON.stringify({ email: state.email }) }).catch(() => {});
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function renderProfileBadges() {
  const el = document.getElementById('profileBadges');
  el.innerHTML = '';
  if (state.isAdmin) {
    const b = document.createElement('span');
    b.className = 'profile-badge';
    const roleLabels = { owner: '👑 Owner', senior_admin: '🌟 Katta admin', admin: '🛠 Oddiy admin', restaurant_admin: '🍽 Restoran admini' };
    b.textContent = roleLabels[state.adminRole] || '🛡 Admin';
    el.appendChild(b);
  }
  if (state.user && state.user.plus_member) {
    const b = document.createElement('span');
    b.className = 'profile-badge';
    b.textContent = '⭐ Plyus';
    el.appendChild(b);
  }
}

// ===================== TABS =====================
function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach((t) => t.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');
  if (tab === 'orders') loadMyOrders();
}

// ===================== RESTAURANTS =====================
async function loadRestaurants(type = '', q = '') {
  try {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (q) params.set('q', q);
    const rows = await api('/api/restaurants?' + params.toString());
    state.restaurants = rows;
    const list = document.getElementById('restaurantList');
    list.innerHTML = '';
    if (!rows.length) {
      list.innerHTML = '<p class="muted">Hozircha restoran yo\'q. Admin panelidan qo\'shing.</p>';
      return;
    }
    rows.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'restaurant-card';
      card.innerHTML = `
        <div class="restaurant-card-img">${r.type === 'oshxona' ? '🍲' : '🍽️'}</div>
        <div class="restaurant-card-body">
          <div class="restaurant-card-name">${escapeHtml(r.name)}</div>
          <div class="restaurant-card-meta"><span>⭐ ${r.rating}</span><span>${r.type === 'oshxona' ? 'Oshxona' : 'Restoran'}</span></div>
        </div>`;
      card.addEventListener('click', () => openRestaurant(r.id));
      list.appendChild(card);
    });
  } catch (err) {
    console.error(err);
  }
}

async function openRestaurant(id) {
  try {
    const r = await api('/api/restaurants/' + id);
    state.currentRestaurant = r;
    state.cart = {};
    document.getElementById('restaurantName').textContent = r.name;
    document.getElementById('restaurantHero').textContent = r.type === 'oshxona' ? '🍲' : '🍽️';
    const list = document.getElementById('menuList');
    list.innerHTML = '';
    if (!r.menu.length) list.innerHTML = '<p class="muted">Menyu hali qo\'shilmagan.</p>';
    r.menu.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'menu-item';
      el.innerHTML = `
        <div>
          <div class="menu-item-name">${escapeHtml(item.name)}</div>
          <div class="menu-item-desc">${escapeHtml(item.description || '')}</div>
          ${item.category ? `<div class="menu-item-category muted" style="font-size:11px">${escapeHtml(item.category)}</div>` : ''}
          <div class="menu-item-price">${item.price.toLocaleString()} so'm</div>
        </div>
        <div class="qty-control">
          <button class="qty-btn minus" data-id="${item.id}">−</button>
          <span id="qty-${item.id}">0</span>
          <button class="qty-btn plus" data-id="${item.id}">+</button>
        </div>`;
      list.appendChild(el);
      el.querySelector('.plus').addEventListener('click', () => changeQty(item, 1));
      el.querySelector('.minus').addEventListener('click', () => changeQty(item, -1));
    });
    updateCartFab();
    showScreen('screen-restaurant');
  } catch (err) {
    alert(err.message);
  }
}

function changeQty(item, delta) {
  const cur = state.cart[item.id]?.qty || 0;
  const next = Math.max(0, cur + delta);
  if (next === 0) delete state.cart[item.id];
  else state.cart[item.id] = { item, qty: next };
  document.getElementById('qty-' + item.id).textContent = next;
  updateCartFab();
}

function updateCartFab() {
  const items = Object.values(state.cart);
  const count = items.reduce((s, x) => s + x.qty, 0);
  const total = items.reduce((s, x) => s + x.qty * x.item.price, 0);
  const fab = document.getElementById('cartFab');
  fab.classList.toggle('hidden', count === 0);
  document.getElementById('cartFabCount').textContent = count;
  document.getElementById('cartFabTotal').textContent = total.toLocaleString();
  document.getElementById('cartBadge').hidden = count === 0;
  document.getElementById('cartBadge').textContent = count;
}

// ===================== CHECKOUT =====================
function openCheckout() {
  const list = document.getElementById('checkoutCartList');
  list.innerHTML = '';
  let total = 0;
  Object.values(state.cart).forEach(({ item, qty }) => {
    total += item.price * qty;
    const row = document.createElement('div');
    row.className = 'checkout-line';
    row.innerHTML = `<span>${escapeHtml(item.name)} × ${qty}</span><span>${(item.price * qty).toLocaleString()} so'm</span>`;
    list.appendChild(row);
  });
  document.getElementById('checkoutTotal').textContent = total.toLocaleString() + " so'm";
  // To'lov usuli tugmalarini state.paymentMethod bilan sinxronlaymiz (avvalgi tanlov saqlanib qolsin)
  document.querySelectorAll('.pay-opt').forEach((b) => b.classList.toggle('active', b.dataset.pay === state.paymentMethod));
  showScreen('screen-checkout');
}

async function placeOrder() {
  const address = document.getElementById('addressInput').value.trim();
  if (!address) return alert('Manzilni kiriting');
  if (!state.token) return alert('Avval tizimga kiring');
  const items = Object.values(state.cart).map(({ item, qty }) => ({ id: item.id, name: item.name, price: item.price, qty }));
  try {
    await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        restaurant_id: state.currentRestaurant.id,
        items,
        address,
        payment_method: state.paymentMethod,
        source: 'web',
      }),
    });
    showScreen('screen-success');
  } catch (err) {
    alert(err.message);
  }
}

async function loadMyOrders() {
  try {
    const rows = await api('/api/orders/my');
    const list = document.getElementById('ordersList');
    list.innerHTML = '';
    if (!rows.length) { list.innerHTML = '<p class="muted">Hali buyurtma yo\'q.</p>'; return; }
    rows.forEach((o) => {
      const el = document.createElement('div');
      el.className = 'order-card';
      el.innerHTML = `
        <div class="order-card-top"><span>Buyurtma #${o.id}</span><span class="order-status">${statusLabel(o.status)}</span></div>
        <div class="muted" style="margin-top:6px">${o.total_amount.toLocaleString()} so'm • ${o.payment_method === 'cash' ? 'Naqd' : 'Karta'}</div>`;
      list.appendChild(el);
    });
  } catch (err) { console.error(err); }
}

function statusLabel(s) {
  return { new: 'Yangi', accepted: 'Qabul qilindi', cooking: 'Tayyorlanmoqda', on_way: 'Yo\'lda', delivered: 'Yetkazildi', cancelled: 'Bekor qilindi' }[s] || s;
}

// ===================== ADMIN PANEL =====================
function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.atab === tab));
  document.querySelectorAll('.admin-tab-content').forEach((c) => c.classList.add('hidden'));
  document.getElementById('atab-' + tab).classList.remove('hidden');
  if (tab === 'stats') loadAdminStats();
  if (tab === 'orders') loadAdminOrders();
  if (tab === 'restaurants') loadAdminRestaurants();
  if (tab === 'users') loadAdminUsers();
  if (tab === 'admins') loadAdminAdmins();
  if (tab === 'settings') loadAdminSettings();

  const isSuper = ['owner','senior_admin'].includes(state.adminRole);
  document.querySelectorAll('.admin-super-only').forEach((el) => el.classList.toggle('hidden', !isSuper));
}

async function loadAdminStats() {
  const s = await api('/api/admin/stats');
  if (s.scope === 'restaurant') {
    // Restoran admini — faqat o'z restoranining statistikasi
    document.getElementById('statGrid').innerHTML = `
      <div class="stat-card" style="grid-column:1/-1"><div class="stat-label">${escapeHtml(s.restaurantName || 'Sizning restoraningiz')}</div></div>
      <div class="stat-card"><div class="stat-num">${s.ordersCount}</div><div class="stat-label">Buyurtmalar</div></div>
      <div class="stat-card"><div class="stat-num">${s.revenue.toLocaleString()}</div><div class="stat-label">Aylanma (so'm)</div></div>`;
  } else {
    document.getElementById('statGrid').innerHTML = `
      <div class="stat-card"><div class="stat-num">${s.usersCount}</div><div class="stat-label">Foydalanuvchilar</div></div>
      <div class="stat-card"><div class="stat-num">${s.restaurantsCount}</div><div class="stat-label">Restoranlar</div></div>
      <div class="stat-card"><div class="stat-num">${s.ordersCount}</div><div class="stat-label">Buyurtmalar</div></div>
      <div class="stat-card"><div class="stat-num">${s.revenue.toLocaleString()}</div><div class="stat-label">Aylanma (so'm)</div></div>`;
  }
  const isSuper = ['owner','senior_admin'].includes(state.adminRole);
  document.querySelectorAll('.admin-super-only').forEach((el) => el.classList.toggle('hidden', !isSuper));
}

async function loadAdminOrders() {
  const rows = await api('/api/orders');
  const list = document.getElementById('adminOrdersList');
  list.innerHTML = '';
  rows.forEach((o) => {
    const el = document.createElement('div');
    el.className = 'admin-row';
    el.innerHTML = `
      <div class="admin-row-info">
        <div class="admin-row-title">#${o.id} — ${o.total_amount.toLocaleString()} so'm</div>
        <div class="admin-row-sub">${o.payment_method} • ${o.address || ''}</div>
      </div>
      <select class="mini-btn status-select">
        ${['new','accepted','cooking','on_way','delivered','cancelled'].map(s => `<option value="${s}" ${s===o.status?'selected':''}>${statusLabel(s)}</option>`).join('')}
      </select>`;
    el.querySelector('.status-select').addEventListener('change', async (e) => {
      await api(`/api/orders/${o.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) });
    });
    list.appendChild(el);
  });
}

async function loadAdminRestaurants() {
  const rows = await api('/api/restaurants');
  state.restaurantsCache = rows;
  const list = document.getElementById('adminRestaurantsList');
  list.innerHTML = '';
  rows.forEach((r) => {
    const el = document.createElement('div');
    el.className = 'admin-row';
    el.innerHTML = `
      <div class="admin-row-info">
        <div class="admin-row-title">${escapeHtml(r.name)}</div>
        <div class="admin-row-sub">${r.type === 'oshxona' ? 'Oshxona' : 'Restoran'} • Komissiya: ${r.commission_percent}%</div>
      </div>
      <button class="mini-btn accent">⚙️ Boshqarish</button>`;
    el.querySelector('button').addEventListener('click', () => openManageRestaurantModal(r));
    list.appendChild(el);
  });
}

async function loadAdminUsers() {
  const rows = await api('/api/admin/users');
  const list = document.getElementById('adminUsersList');
  list.innerHTML = '';
  rows.forEach((u) => {
    const el = document.createElement('div');
    el.className = 'admin-row';
    el.innerHTML = `
      <div class="admin-row-info">
        <div class="admin-row-title">${escapeHtml(u.email)} ${u.is_banned ? '🚫' : ''}</div>
        <div class="admin-row-sub">Shtraf: ${u.fine_amount.toLocaleString()} so'm ${u.plus_member ? '• ⭐ Plyus' : ''}</div>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; max-width:130px">
        <button class="mini-btn ${u.is_banned ? '' : 'danger'} ban-btn">${u.is_banned ? 'Ban olish' : 'Ban'}</button>
        <button class="mini-btn fine-btn">Shtraf</button>
        <button class="mini-btn accent plus-btn">${u.plus_member ? 'Plyusni olish' : 'Plyus berish'}</button>
      </div>`;
    el.querySelector('.ban-btn').addEventListener('click', async () => {
      if (u.is_banned) { await api(`/api/admin/users/${u.id}/unban`, { method: 'POST' }); }
      else {
        const reason = prompt('Ban sababi:') || '';
        await api(`/api/admin/users/${u.id}/ban`, { method: 'POST', body: JSON.stringify({ reason }) });
      }
      loadAdminUsers();
    });
    el.querySelector('.fine-btn').addEventListener('click', async () => {
      const amount = Number(prompt('Shtraf summasi (so\'m):') || 0);
      if (amount > 0) { await api(`/api/admin/users/${u.id}/fine`, { method: 'POST', body: JSON.stringify({ amount }) }); loadAdminUsers(); }
    });
    el.querySelector('.plus-btn').addEventListener('click', async () => {
      await api(`/api/admin/users/${u.id}/plus`, { method: 'POST', body: JSON.stringify({ enabled: !u.plus_member }) });
      loadAdminUsers();
    });
    list.appendChild(el);
  });
}

const ROLE_LABELS = { owner: '👑 Owner', senior_admin: '🌟 Katta admin', admin: '🛠 Oddiy admin', restaurant_admin: '🍽 Restoran admini' };

async function loadAdminAdmins() {
  const rows = await api('/api/admin/admins');
  const list = document.getElementById('adminAdminsList');
  list.innerHTML = '';
  rows.forEach((a) => {
    const el = document.createElement('div');
    el.className = 'admin-row';
    el.innerHTML = `
      <div class="admin-row-info">
        <div class="admin-row-title">${escapeHtml(a.email)}${a.is_founder ? ' ⭐' : ''}</div>
        <div class="admin-row-sub">${ROLE_LABELS[a.role] || a.role}${a.restaurant_id ? ' • restoran #' + a.restaurant_id : ''}</div>
      </div>
      ${a.is_founder ? '' : '<button class="mini-btn danger">O\'chirish</button>'}`;
    const btn = el.querySelector('button');
    if (btn) {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/admin/admins/${encodeURIComponent(a.email)}`, { method: 'DELETE' });
          loadAdminAdmins();
        } catch (err) {
          alert(err.message);
        }
      });
    }
    list.appendChild(el);
  });
}

async function loadAdminSettings() {
  const s = await api('/api/admin/settings');
  document.getElementById('settingsForm').innerHTML = `
    <label>Plyus oylik narxi (so'm)</label>
    <input class="input" id="set_plus_monthly_price" value="${s.plus_monthly_price}">
    <label>Plyus chegirma foizi (%)</label>
    <input class="input" id="set_plus_discount_percent" value="${s.plus_discount_percent}">
    <label>Yetkazib berish bazaviy narxi (so'm)</label>
    <input class="input" id="set_delivery_base_price" value="${s.delivery_base_price}">`;
}

async function saveSettings() {
  const body = {
    plus_monthly_price: document.getElementById('set_plus_monthly_price').value,
    plus_discount_percent: document.getElementById('set_plus_discount_percent').value,
    delivery_base_price: document.getElementById('set_delivery_base_price').value,
  };
  await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(body) });
  alert('Saqlandi');
}

async function sendBroadcast() {
  const text = document.getElementById('broadcastText').value.trim();
  const resultEl = document.getElementById('broadcastResult');
  resultEl.textContent = '';
  if (!text) { resultEl.textContent = 'Xabar matnini kiriting'; return; }

  const channels = [];
  if (document.getElementById('bcEmail').checked) channels.push('email');
  if (document.getElementById('bcTelegram').checked) channels.push('telegram');
  if (document.getElementById('bcChannel').checked) channels.push('channel');
  if (!channels.length) { resultEl.textContent = 'Kamida bitta kanal tanlang'; return; }

  const btn = document.getElementById('sendBroadcastBtn');
  btn.disabled = true;
  btn.textContent = 'Yuborilmoqda...';
  try {
    await api('/api/admin/broadcast', { method: 'POST', body: JSON.stringify({ text, channels }) });
    resultEl.textContent = '✅ Xabar yuborish boshlandi (fonda davom etadi)';
    document.getElementById('broadcastText').value = '';
  } catch (err) {
    resultEl.textContent = '❌ ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Yuborish';
  }
}

// ===================== MODALS =====================
function showModal(html) {
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal() { document.getElementById('modalOverlay').classList.add('hidden'); }

function openAddRestaurantModal() {
  showModal(`
    <h3>Restoran / Oshxona qo'shish</h3>
    <input class="input" id="m_name" placeholder="Nomi">
    <select class="input" id="m_type">
      <option value="restaurant">Restoran</option>
      <option value="oshxona">Oshxona</option>
    </select>
    <input class="input" id="m_address" placeholder="Manzil">
    <input class="input" id="m_phone" placeholder="Telefon">
    <input class="input" id="m_commission" placeholder="Komissiya % (masalan 15)">
    <button class="btn-primary" id="m_submit">Qo'shish</button>`);
  document.getElementById('m_submit').addEventListener('click', async () => {
    try {
      await api('/api/restaurants', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('m_name').value,
          type: document.getElementById('m_type').value,
          address: document.getElementById('m_address').value,
          phone: document.getElementById('m_phone').value,
          commission_percent: Number(document.getElementById('m_commission').value || 15),
        }),
      });
      closeModal();
      loadAdminRestaurants();
    } catch (err) { alert(err.message); }
  });
}

function openAddMenuItemModal(restaurant) {
  openManageRestaurantModal(restaurant);
}

// Restoranni to'liq boshqarish oynasi: ma'lumotlarini tahrirlash + taomlar ro'yxati
// (qo'shish, tahrirlash, o'chirish, mavjud/mavjud emas qilish).
function openManageRestaurantModal(restaurant) {
  showModal(`
    <h3>${escapeHtml(restaurant.name)}</h3>
    <div class="settings-group" style="margin-bottom:12px">
      <input class="input" id="mr_name" placeholder="Nomi" value="${escapeHtml(restaurant.name)}">
      <select class="input" id="mr_type">
        <option value="restaurant" ${restaurant.type === 'restaurant' ? 'selected' : ''}>Restoran</option>
        <option value="oshxona" ${restaurant.type === 'oshxona' ? 'selected' : ''}>Oshxona</option>
      </select>
      <input class="input" id="mr_address" placeholder="Manzil" value="${escapeHtml(restaurant.address || '')}">
      <input class="input" id="mr_phone" placeholder="Telefon" value="${escapeHtml(restaurant.phone || '')}">
      <input class="input" id="mr_commission" placeholder="Komissiya %" value="${restaurant.commission_percent}">
      <input class="input" id="mr_image" placeholder="Rasm URL (https://...)" value="${escapeHtml(restaurant.image_url || '')}">
      <button class="btn-primary" id="mr_save">Ma'lumotlarni saqlash</button>
      <button class="mini-btn danger" id="mr_delete" style="margin-top:8px">Restoranni o'chirish</button>
    </div>
    <h3 style="font-size:15px">🍽 Taomlar</h3>
    <div id="mi_list" class="admin-rows-mini"></div>
    <div class="settings-group" style="margin-top:10px">
      <input class="input" id="mi_name" placeholder="Taom nomi">
      <input class="input" id="mi_desc" placeholder="Tavsif">
      <input class="input" id="mi_price" placeholder="Narxi (so'm)">
      <input class="input" id="mi_category" placeholder="Kategoriya (masalan: Birinchi taom, Ichimlik)">
      <input class="input" id="mi_image" placeholder="Rasm URL (https://...)">
      <button class="btn-primary" id="mi_submit">+ Taom qo'shish</button>
    </div>
  `);

  document.getElementById('mr_save').addEventListener('click', async () => {
    try {
      await api(`/api/restaurants/${restaurant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: document.getElementById('mr_name').value,
          type: document.getElementById('mr_type').value,
          address: document.getElementById('mr_address').value,
          phone: document.getElementById('mr_phone').value,
          commission_percent: Number(document.getElementById('mr_commission').value || restaurant.commission_percent),
          image_url: document.getElementById('mr_image').value,
        }),
      });
      loadAdminRestaurants();
      closeModal();
    } catch (err) { alert(err.message); }
  });

  document.getElementById('mr_delete').addEventListener('click', async () => {
    if (!confirm('Rostdan ham bu restoranni o\'chirmoqchimisiz?')) return;
    try {
      await api(`/api/restaurants/${restaurant.id}`, { method: 'DELETE' });
      loadAdminRestaurants();
      closeModal();
    } catch (err) { alert(err.message); }
  });

  document.getElementById('mi_submit').addEventListener('click', async () => {
    try {
      await api(`/api/restaurants/${restaurant.id}/menu`, {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('mi_name').value,
          description: document.getElementById('mi_desc').value,
          price: Number(document.getElementById('mi_price').value || 0),
          category: document.getElementById('mi_category').value,
          image_url: document.getElementById('mi_image').value,
        }),
      });
      document.getElementById('mi_name').value = '';
      document.getElementById('mi_desc').value = '';
      document.getElementById('mi_price').value = '';
      document.getElementById('mi_category').value = '';
      document.getElementById('mi_image').value = '';
      loadMenuItemsInModal(restaurant);
    } catch (err) { alert(err.message); }
  });

  loadMenuItemsInModal(restaurant);
}

async function loadMenuItemsInModal(restaurant) {
  const list = document.getElementById('mi_list');
  if (!list) return;
  list.innerHTML = '<p class="muted">Yuklanmoqda...</p>';
  try {
    const items = await api(`/api/restaurants/${restaurant.id}/menu-admin`);
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<p class="muted">Hali taom yo\'q</p>';
      return;
    }
    items.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.innerHTML = `
        <div class="admin-row-info">
          <div class="admin-row-title">${escapeHtml(it.name)}${it.is_available ? '' : ' <span class="muted">(mavjud emas)</span>'}</div>
          <div class="admin-row-sub">${it.price.toLocaleString()} so'm${it.category ? ' • ' + escapeHtml(it.category) : ''}</div>
        </div>
        <button class="mini-btn" data-act="toggle">${it.is_available ? 'Yashirish' : 'Ko\'rsatish'}</button>
        <button class="mini-btn" data-act="edit">✏️</button>
        <button class="mini-btn danger" data-act="del">🗑</button>`;
      row.querySelector('[data-act="toggle"]').addEventListener('click', async () => {
        await api(`/api/restaurants/${restaurant.id}/menu/${it.id}`, { method: 'PATCH', body: JSON.stringify({ is_available: !it.is_available }) });
        loadMenuItemsInModal(restaurant);
      });
      row.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!confirm(`"${it.name}" o'chirilsinmi?`)) return;
        await api(`/api/restaurants/${restaurant.id}/menu/${it.id}`, { method: 'DELETE' });
        loadMenuItemsInModal(restaurant);
      });
      row.querySelector('[data-act="edit"]').addEventListener('click', () => openEditMenuItemModal(restaurant, it));
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = `<p class="err">${escapeHtml(err.message)}</p>`;
  }
}

function openEditMenuItemModal(restaurant, item) {
  showModal(`
    <h3>Taomni tahrirlash</h3>
    <input class="input" id="emi_name" placeholder="Taom nomi" value="${escapeHtml(item.name)}">
    <input class="input" id="emi_desc" placeholder="Tavsif" value="${escapeHtml(item.description || '')}">
    <input class="input" id="emi_price" placeholder="Narxi (so'm)" value="${item.price}">
    <input class="input" id="emi_category" placeholder="Kategoriya" value="${escapeHtml(item.category || '')}">
    <input class="input" id="emi_image" placeholder="Rasm URL" value="${escapeHtml(item.image_url || '')}">
    <button class="btn-primary" id="emi_save">Saqlash</button>`);
  document.getElementById('emi_save').addEventListener('click', async () => {
    try {
      await api(`/api/restaurants/${restaurant.id}/menu/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: document.getElementById('emi_name').value,
          description: document.getElementById('emi_desc').value,
          price: Number(document.getElementById('emi_price').value || item.price),
          category: document.getElementById('emi_category').value,
          image_url: document.getElementById('emi_image').value,
        }),
      });
      openManageRestaurantModal(restaurant);
    } catch (err) { alert(err.message); }
  });
}

function openAddAdminModal() {
  const options = state.restaurantsCache.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  const isOwner = state.adminRole === 'owner';
  const roleOptions = [
    isOwner ? '<option value="owner">👑 Owner</option>' : '',
    isOwner ? '<option value="senior_admin">🌟 Katta admin</option>' : '',
    '<option value="admin" selected>🛠 Oddiy admin</option>',
    '<option value="restaurant_admin">🍽 Restoran/Oshxona admini</option>',
  ].join('');
  showModal(`
    <h3>Yangi admin qo'shish</h3>
    <input class="input" id="a_email" placeholder="Admin emaili (yoki tg&lt;telegram_id&gt;@deligo.bot)">
    <select class="input" id="a_role">${roleOptions}</select>
    <div id="a_restaurant_wrap" class="hidden">
      <label class="muted" style="font-size:12px">Qaysi restoran / oshxona?</label>
      <select class="input" id="a_restaurant">${options}</select>
    </div>
    <button class="btn-primary" id="a_submit">Qo'shish</button>`);

  document.getElementById('a_role').addEventListener('change', (e) => {
    document.getElementById('a_restaurant_wrap').classList.toggle('hidden', e.target.value !== 'restaurant_admin');
  });

  document.getElementById('a_submit').addEventListener('click', async () => {
    const role = document.getElementById('a_role').value;
    try {
      await api('/api/admin/admins', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('a_email').value,
          role,
          restaurant_id: role === 'restaurant_admin' ? Number(document.getElementById('a_restaurant').value) : null,
        }),
      });
      closeModal();
      loadAdminAdmins();
    } catch (err) { alert(err.message); }
  });
}

// ===================== UTIL =====================
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}