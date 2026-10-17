'use strict';

// Sources du taux USD → EUR, essayées dans l'ordre. Aucune clé d'API requise.
const RATE_SOURCES = [
  {
    url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR',
    parse: (d) => ({ rate: d.rates.EUR, date: d.date, source: 'BCE (Frankfurter)' }),
  },
  {
    url: 'https://open.er-api.com/v6/latest/USD',
    parse: (d) => ({
      rate: d.rates.EUR,
      date: new Date(d.time_last_update_unix * 1000).toISOString().slice(0, 10),
      source: 'ExchangeRate-API',
    }),
  },
];
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

// Dans l'APK (Capacitor), les fichiers sont embarqués : on lit les taxes sur le site
// publié pour profiter des mises à jour, avec le fichier embarqué en secours.
const IS_NATIVE = !!window.Capacitor?.isNativePlatform?.();
const TAXES_URLS = IS_NATIVE
  ? ['https://piketooth.github.io/Prix-NY/taxes.json', 'taxes.json']
  : ['taxes.json'];

const DEFAULT_TAXES = {
  updated: null,
  salesTax: { rate: 0.08875 },
  clothing: { threshold: 110, rate: 0 },
  tip: { choices: [0.15, 0.18, 0.20, 0.22, 0.25], default: 0.20 },
};

const $ = (id) => document.getElementById(id);
const state = {
  taxes: DEFAULT_TAXES,
  fx: null,
  tipPct: DEFAULT_TAXES.tip.default,
};

const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
  },
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const pct = (r) => (r * 100).toLocaleString('fr-FR', { maximumFractionDigits: 3 }) + ' %';

function parsePrice(text) {
  const n = parseFloat(String(text).replace(/[^\d.,]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// --- Calcul ---------------------------------------------------------------

function compute(price, opts, taxes) {
  let taxRate = 0;
  if (opts.tax) {
    const exempt = opts.clothing && price < taxes.clothing.threshold;
    taxRate = exempt ? taxes.clothing.rate : taxes.salesTax.rate;
  }
  const tax = price * taxRate;
  const tipBase = opts.tipBasis === 'post' ? price + tax : price;
  const tip = opts.tip ? tipBase * opts.tipPct : 0;
  return { price, taxRate, tax, tip, total: price + tax + tip };
}

function readOptions() {
  return {
    tax: $('opt-tax').checked,
    clothing: $('opt-clothing').checked,
    tip: $('opt-tip').checked,
    tipPct: state.tipPct,
    tipBasis: document.querySelector('input[name="tip-basis"]:checked').value,
  };
}

function render() {
  const opts = readOptions();
  const r = compute(parsePrice($('price').value), opts, state.taxes);

  $('clothing-row').classList.toggle('disabled', !opts.tax);
  $('opt-clothing').disabled = !opts.tax;
  $('tip-panel').hidden = !opts.tip;

  $('b-price').textContent = usd.format(r.price);
  $('b-tax').textContent = `${usd.format(r.tax)} (${pct(r.taxRate)})`;
  $('b-tax-row').hidden = !opts.tax;
  $('b-tip').textContent = `${usd.format(r.tip)} (${pct(opts.tipPct)})`;
  $('b-tip-row').hidden = !opts.tip;
  $('total-usd').textContent = `Total : ${usd.format(r.total)}`;
  $('total-eur').textContent = state.fx ? eur.format(r.total * state.fx.rate) : '— €';

  store.set('prefs', { ...opts, clothing: false });
}

function renderRateInfo(offline) {
  const fx = state.fx;
  if (!fx) {
    $('rate-info').textContent = 'Taux indisponible — connectez-vous à Internet une première fois.';
    return;
  }
  const rate = fx.rate.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
  const date = new Date(fx.date + 'T12:00:00').toLocaleDateString('fr-FR');
  $('rate-info').textContent = `1 $ = ${rate} € · ${date} · ${fx.source}${offline ? ' · hors ligne' : ''}`;
}

function renderTaxInfo() {
  const t = state.taxes;
  $('tax-rate-label').textContent = pct(t.salesTax.rate);
  $('clothing-threshold').textContent = t.clothing.threshold;
  $('tax-info').textContent = t.updated
    ? `Taxes à jour au ${new Date(t.updated + 'T12:00:00').toLocaleDateString('fr-FR')}`
    : 'Taxes : valeurs par défaut';

  const box = $('tip-choices');
  box.replaceChildren();
  if (!t.tip.choices.includes(state.tipPct)) state.tipPct = t.tip.default;
  for (const c of t.tip.choices) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c === state.tipPct));
    b.textContent = pct(c);
    b.addEventListener('click', () => {
      state.tipPct = c;
      box.querySelectorAll('.chip').forEach((el) => el.setAttribute('aria-checked', String(el === b)));
      render();
    });
    box.append(b);
  }
}

// --- Données distantes ----------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  return res.json();
}

async function loadTaxes() {
  state.taxes = store.get('taxes') || DEFAULT_TAXES;
  for (const url of TAXES_URLS) {
    try {
      const t = await fetchJson(url);
      if (typeof t?.salesTax?.rate !== 'number') throw new Error('taxes.json invalide');
      state.taxes = { ...DEFAULT_TAXES, ...t };
      store.set('taxes', state.taxes);
      break;
    } catch { /* on essaie la source suivante */ }
  }
  renderTaxInfo();
  render();
}

async function loadRate() {
  for (const src of RATE_SOURCES) {
    try {
      const fx = src.parse(await fetchJson(src.url));
      if (!(fx.rate > 0)) throw new Error('taux invalide');
      state.fx = fx;
      store.set('fx', fx);
      renderRateInfo(false);
      render();
      renderCart();
      renderSaved();
      return;
    } catch { /* on essaie la source suivante */ }
  }
  state.fx = store.get('fx');
  renderRateInfo(true);
  render();
  renderCart();
  renderSaved();
}

// --- Scan caméra (OCR) ----------------------------------------------------

let stream = null;
let ocrWorker = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Impossible de charger le module OCR'));
    document.head.append(s);
  });
}

async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) await loadScript(TESSERACT_URL);
  ocrWorker = await Tesseract.createWorker('eng');
  await ocrWorker.setParameters({ tessedit_char_whitelist: '0123456789$.,' });
  return ocrWorker;
}

// Extrait les montants plausibles d'un texte OCR, les plus probables en premier.
function extractPrices(text) {
  const found = [];
  const re = /(\$\s*)?(\d{1,5}(?:,\d{3})*(?:[.,]\d{2})?)/g;
  let m;
  while ((m = re.exec(text))) {
    let raw = m[2];
    raw = /[.,]\d{2}$/.test(raw)
      ? raw.slice(0, -3).replace(/,/g, '') + '.' + raw.slice(-2)
      : raw.replace(/,/g, '');
    const value = parseFloat(raw);
    if (!(value > 0)) continue;
    const score = (m[1] ? 2 : 0) + (/[.,]\d{2}$/.test(m[2]) ? 1 : 0);
    if (!found.some((f) => f.value === value)) found.push({ value, score });
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 5).map((f) => f.value);
}

async function openScanner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('La caméra n’est pas disponible sur cet appareil ou ce navigateur.');
    return;
  }
  $('scan-results').replaceChildren();
  $('scan-status').textContent = 'Cadrez le prix dans le rectangle, puis appuyez sur Capturer.';
  $('scanner').hidden = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
      audio: false,
    });
    $('video').srcObject = stream;
    await $('video').play();
  } catch {
    $('scan-status').textContent = 'Accès à la caméra refusé. Autorisez-le dans les réglages du navigateur.';
  }
  getOcrWorker().catch(() => {}); // préchargement pendant le cadrage
}

function closeScanner() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $('scanner').hidden = true;
}

// Découpe la zone du cadre (mêmes proportions que .frame dans style.css).
function captureFrame() {
  const video = $('video');
  const canvas = $('canvas');
  const vw = video.videoWidth, vh = video.videoHeight;
  const cw = video.clientWidth, ch = video.clientHeight;
  // object-fit: cover → échelle et décalage de la vidéo affichée
  const scale = Math.max(cw / vw, ch / vh);
  const offX = (vw * scale - cw) / 2, offY = (vh * scale - ch) / 2;
  const sx = (cw * 0.10 + offX) / scale, sy = (ch * 0.35 + offY) / scale;
  const sw = (cw * 0.80) / scale, sh = (ch * 0.18) / scale;
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.filter = 'grayscale(1) contrast(1.6)';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function capture() {
  if (!stream) return;
  const btn = $('scan-capture');
  btn.disabled = true;
  $('scan-results').replaceChildren();
  $('scan-status').textContent = 'Lecture en cours…';
  try {
    const canvas = captureFrame();
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(canvas);
    const prices = extractPrices(data.text);
    if (!prices.length) {
      $('scan-status').textContent = 'Aucun prix détecté. Rapprochez-vous et réessayez.';
      return;
    }
    if (prices.length === 1) {
      usePrice(prices[0]);
      return;
    }
    $('scan-status').textContent = 'Touchez le bon prix :';
    for (const p of prices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = usd.format(p);
      b.addEventListener('click', () => usePrice(p));
      $('scan-results').append(b);
    }
  } catch (e) {
    $('scan-status').textContent = `Erreur : ${e.message || e}. Une connexion est nécessaire au premier scan.`;
  } finally {
    btn.disabled = false;
  }
}

function usePrice(p) {
  $('price').value = p.toFixed(2);
  closeScanner();
  render();
}

// --- Panier ---------------------------------------------------------------

// cart : panier en cours ; id/name renseignés s'il provient d'un panier enregistré.
let cart = { id: null, name: null, items: [] };
let saved = [];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clone = (v) => JSON.parse(JSON.stringify(v));
const toEur = (amount) => (state.fx ? eur.format(amount * state.fx.rate) : '— €');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function cartTotals(items) {
  return items.reduce(
    (t, it) => ({ price: t.price + it.price, tax: t.tax + it.tax, tip: t.tip + it.tip, total: t.total + it.total }),
    { price: 0, tax: 0, tip: 0, total: 0 },
  );
}

function saveCart() {
  store.set('cart', cart);
  renderCart();
}

function saveSaved() {
  store.set('savedCarts', saved);
  renderSaved();
}

function renderCart() {
  const n = cart.items.length;
  const t = cartTotals(cart.items);

  $('cart-count').textContent = n;
  $('cart-name').textContent = cart.name || 'Panier';
  $('cart-sub').textContent = n ? plural(n, 'article') : 'vide';
  $('cart-eur').textContent = toEur(t.total);
  $('cart-usd').textContent = usd.format(t.total);
  $('cart-open').classList.toggle('empty-cart', !n);

  $('cart-title').textContent = cart.name || 'Panier';
  $('cv-eur').textContent = toEur(t.total);
  $('cv-usd').textContent = usd.format(t.total);
  const detail = [`Prix ${usd.format(t.price)}`];
  if (t.tax) detail.push(`taxes ${usd.format(t.tax)}`);
  if (t.tip) detail.push(`pourboires ${usd.format(t.tip)}`);
  $('cv-detail').textContent = n ? detail.join(' · ') : '';
  $('cart-empty').hidden = n > 0;
  $('cart-clear').disabled = !n;
  $('cart-save').disabled = !n;

  const list = $('cart-list');
  list.replaceChildren();
  cart.items.forEach((it, i) => list.append(cartItemRow(it, i)));
}

function cartItemRow(it, i) {
  const li = document.createElement('li');
  li.className = 'item';

  const num = document.createElement('span');
  num.className = 'item-num';
  num.textContent = i + 1;

  const main = document.createElement('div');
  main.className = 'item-main';
  const name = document.createElement('input');
  name.className = 'item-name';
  name.type = 'text';
  name.maxLength = 40;
  name.value = it.name;
  name.placeholder = `Article ${i + 1}`;
  name.setAttribute('aria-label', `Nom de l'article ${i + 1}`);
  name.addEventListener('change', () => {
    it.name = name.value.trim();
    store.set('cart', cart);
  });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
  const detail = document.createElement('span');
  detail.className = 'item-detail';
  const parts = [usd.format(it.price)];
  if (it.tax) parts.push(`taxe ${usd.format(it.tax)}`);
  else if (it.opts.tax) parts.push('exonéré');
  if (it.tip) parts.push(`pourboire ${usd.format(it.tip)}`);
  detail.textContent = parts.join(' + ');
  main.append(name, detail);

  const amt = document.createElement('div');
  amt.className = 'item-amt';
  const e = document.createElement('b');
  e.textContent = toEur(it.total);
  const u = document.createElement('span');
  u.textContent = usd.format(it.total);
  amt.append(e, u);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'item-del';
  del.setAttribute('aria-label', `Supprimer l'article ${i + 1}`);
  del.textContent = '×';
  del.addEventListener('click', () => {
    const before = clone(cart);
    cart.items.splice(i, 1);
    saveCart();
    toast(`${it.name || `Article ${i + 1}`} supprimé`, 'Annuler', () => { cart = before; saveCart(); });
  });

  li.append(num, main, amt, del);
  return li;
}

function addToCart() {
  const price = parsePrice($('price').value);
  if (!(price > 0)) {
    $('price').focus();
    toast('Saisissez d’abord un prix');
    return;
  }
  const opts = readOptions();
  const r = compute(price, opts, state.taxes);
  cart.items.push({ id: uid(), name: '', price, opts, taxRate: r.taxRate, tax: r.tax, tip: r.tip, total: r.total });
  saveCart();
  $('price').value = '';
  render();

  const bar = $('cart-open');
  bar.classList.remove('bump');
  void bar.offsetWidth; // relance l'animation
  bar.classList.add('bump');
  const n = cart.items.length;
  toast(`Article ${n} ajouté au panier`, 'Annuler', () => { cart.items.pop(); saveCart(); });
}

function resetAll() {
  const before = { cart: clone(cart), price: $('price').value };
  if (!before.cart.items.length && !before.price) return;
  cart = { id: null, name: null, items: [] };
  $('price').value = '';
  saveCart();
  render();
  toast('Prix et panier réinitialisés', 'Annuler', () => {
    cart = before.cart;
    $('price').value = before.price;
    saveCart();
    render();
  });
}

function clearCart() {
  const before = clone(cart);
  cart = { id: null, name: null, items: [] };
  saveCart();
  toast('Panier vidé', 'Annuler', () => { cart = before; saveCart(); });
}

function askCartName() {
  const dlg = $('name-dialog');
  const input = $('name-input');
  input.value = cart.name || `Panier du ${new Date().toLocaleDateString('fr-FR')}`;
  dlg.returnValue = '';
  dlg.showModal();
  input.select();
  dlg.addEventListener('close', () => {
    const name = input.value.trim();
    if (dlg.returnValue !== 'ok' || !name) return;
    const entry = { id: cart.id || uid(), name, savedAt: new Date().toISOString(), items: clone(cart.items) };
    const idx = saved.findIndex((s) => s.id === entry.id);
    if (idx >= 0) saved[idx] = entry; else saved.unshift(entry);
    cart.id = entry.id;
    cart.name = name;
    saveSaved();
    saveCart();
    toast(`Panier « ${name} » enregistré`);
  }, { once: true });
}

function renderSaved() {
  $('saved-count').textContent = saved.length || '';
  $('saved-empty').hidden = saved.length > 0;
  const list = $('saved-list');
  list.replaceChildren();
  for (const s of saved) {
    const li = document.createElement('li');
    li.className = 'saved';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'saved-main';
    const title = document.createElement('b');
    title.textContent = s.name;
    const meta = document.createElement('span');
    const date = new Date(s.savedAt).toLocaleDateString('fr-FR');
    meta.textContent = `${plural(s.items.length, 'article')} · ${date}`;
    const total = document.createElement('span');
    total.className = 'saved-total';
    total.textContent = toEur(cartTotals(s.items).total);
    open.append(title, meta, total);
    open.addEventListener('click', () => loadSaved(s));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'item-del';
    del.setAttribute('aria-label', `Supprimer le panier ${s.name}`);
    del.textContent = '×';
    del.addEventListener('click', () => {
      const before = clone(saved);
      saved = saved.filter((x) => x.id !== s.id);
      if (cart.id === s.id) { cart.id = null; saveCart(); }
      saveSaved();
      toast(`« ${s.name} » supprimé`, 'Annuler', () => { saved = before; saveSaved(); });
    });
    li.append(open, del);
    list.append(li);
  }
}

function loadSaved(s) {
  const before = clone(cart);
  cart = { id: s.id, name: s.name, items: clone(s.items) };
  saveCart();
  history.back(); // retour au panier
  toast(`Panier « ${s.name} » ouvert`, before.items.length ? 'Annuler' : null, () => { cart = before; saveCart(); });
}

// --- Écrans et notifications ------------------------------------------------

// Chaque écran ouvert ajoute une entrée d'historique : le bouton retour d'Android le referme.
const openViews = [];

function openView(id) {
  $(id).hidden = false;
  openViews.push(id);
  history.pushState({ view: id }, '');
  document.body.classList.add('no-scroll');
  document.body.dataset.view = id;
}

window.addEventListener('popstate', () => {
  const id = openViews.pop();
  if (id) $(id).hidden = true;
  if (!openViews.length) document.body.classList.remove('no-scroll');
  document.body.dataset.view = openViews.at(-1) || '';
});

let toastTimer = null;
function toast(msg, actionLabel, action) {
  const el = $('toast');
  const btn = $('toast-action');
  $('toast-msg').textContent = msg;
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || '';
  btn.onclick = () => { el.hidden = true; action?.(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, actionLabel ? 5000 : 2500);
}

// --- Démarrage ------------------------------------------------------------

function init() {
  const prefs = store.get('prefs');
  if (prefs) {
    $('opt-tax').checked = prefs.tax ?? true;
    $('opt-tip').checked = !!prefs.tip;
    if (prefs.tipPct) state.tipPct = prefs.tipPct;
    const basis = document.querySelector(`input[name="tip-basis"][value="${prefs.tipBasis}"]`);
    if (basis) basis.checked = true;
  }
  state.fx = store.get('fx');
  state.taxes = store.get('taxes') || DEFAULT_TAXES;
  renderTaxInfo();
  if (state.fx) renderRateInfo(false);

  $('price').addEventListener('input', render);
  document.querySelectorAll('input[type="checkbox"], input[name="tip-basis"]')
    .forEach((el) => el.addEventListener('change', render));
  $('refresh-btn').addEventListener('click', () => { loadRate(); loadTaxes(); });
  $('scan-btn').addEventListener('click', openScanner);
  $('scan-close').addEventListener('click', closeScanner);
  $('scan-capture').addEventListener('click', capture);

  cart = store.get('cart') || cart;
  saved = store.get('savedCarts') || [];
  $('add-btn').addEventListener('click', addToCart);
  $('price').addEventListener('keydown', (e) => { if (e.key === 'Enter') addToCart(); });
  $('reset-btn').addEventListener('click', resetAll);
  $('cart-open').addEventListener('click', () => openView('cart-view'));
  $('saved-open').addEventListener('click', () => openView('saved-view'));
  $('cart-clear').addEventListener('click', clearCart);
  $('cart-save').addEventListener('click', askCartName);
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => history.back()));
  renderCart();
  renderSaved();

  render();
  loadTaxes();
  loadRate();

  if ('serviceWorker' in navigator && !IS_NATIVE) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
