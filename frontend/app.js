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
  setTimeout(() => showScreen('screen-lang'), 1900);

  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.lang = btn.dataset.lang;
      applyI18n();
      showScreen('screen-email');
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
    b.textContent = state.adminRole === 'super_admin' ? '🛡 Bosh admin' : '🛡 Admin';
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

  const isSuper = state.adminRole === 'super_admin';
  document.querySelectorAll('.admin-super-only').forEach((el) => el.classList.toggle('hidden', !isSuper));
}

async function loadAdminStats() {
  const s = await api('/api/admin/stats');
  document.getElementById('statGrid').innerHTML = `
    <div class="stat-card"><div class="stat-num">${s.usersCount}</div><div class="stat-label">Foydalanuvchilar</div></div>
    <div class="stat-card"><div class="stat-num">${s.restaurantsCount}</div><div class="stat-label">Restoranlar</div></div>
    <div class="stat-card"><div class="stat-num">${s.ordersCount}</div><div class="stat-label">Buyurtmalar</div></div>
    <div class="stat-card"><div class="stat-num">${s.revenue.toLocaleString()}</div><div class="stat-label">Aylanma (so'm)</div></div>`;
  const isSuper = state.adminRole === 'super_admin';
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
      <button class="mini-btn accent">+ Taom</button>`;
    el.querySelector('button').addEventListener('click', () => openAddMenuItemModal(r));
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

async function loadAdminAdmins() {
  const rows = await api('/api/admin/admins');
  const list = document.getElementById('adminAdminsList');
  list.innerHTML = '';
  rows.forEach((a) => {
    const el = document.createElement('div');
    el.className = 'admin-row';
    el.innerHTML = `
      <div class="admin-row-info">
        <div class="admin-row-title">${escapeHtml(a.email)}</div>
        <div class="admin-row-sub">${a.role}${a.restaurant_id ? ' • restoran #' + a.restaurant_id : ''}</div>
      </div>
      <button class="mini-btn danger">O'chirish</button>`;
    el.querySelector('button').addEventListener('click', async () => {
      if (a.role === 'super_admin') return alert('Bosh adminni o\'chirib bo\'lmaydi');
      await api(`/api/admin/admins/${encodeURIComponent(a.email)}`, { method: 'DELETE' });
      loadAdminAdmins();
    });
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
  showModal(`
    <h3>${escapeHtml(restaurant.name)} — Taom qo'shish</h3>
    <input class="input" id="mi_name" placeholder="Taom nomi">
    <input class="input" id="mi_desc" placeholder="Tavsif">
    <input class="input" id="mi_price" placeholder="Narxi (so'm)">
    <button class="btn-primary" id="mi_submit">Qo'shish</button>`);
  document.getElementById('mi_submit').addEventListener('click', async () => {
    try {
      await api(`/api/restaurants/${restaurant.id}/menu`, {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('mi_name').value,
          description: document.getElementById('mi_desc').value,
          price: Number(document.getElementById('mi_price').value || 0),
        }),
      });
      closeModal();
    } catch (err) { alert(err.message); }
  });
}

function openAddAdminModal() {
  const options = state.restaurantsCache.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  showModal(`
    <h3>Yangi admin qo'shish</h3>
    <input class="input" id="a_email" placeholder="Admin emaili">
    <select class="input" id="a_role">
      <option value="admin">Umumiy admin (hammasini boshqaradi)</option>
      <option value="restaurant_admin">Restoran/Oshxona admini</option>
      <option value="super_admin">Bosh admin</option>
    </select>
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
