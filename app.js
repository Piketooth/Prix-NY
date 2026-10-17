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
const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const DEFAULT_TAXES = {
  updated: null,
  salesTax: { rate: 0.08875 },
  clothing: { threshold: 110, rate: 0 },
  tip: { choices: [0.15, 0.18, 0.20, 0.22, 0.25], default: 0.20 },
};

const CATEGORIES = [
  { id: 'shop', label: 'Shopping', emoji: '🛍️', color: '#ffb734' },
  { id: 'clothes', label: 'Vêtements et chaussures', emoji: '👕', color: '#9d8cf0' },
  { id: 'food', label: 'Resto', emoji: '🍔', color: '#ff7a59' },
  { id: 'grocery', label: 'Épicerie / Pharmacie', emoji: '🛒', color: '#3fb8a9' },
  { id: 'other', label: 'Autre', emoji: '✨', color: '#7a8499' },
];
const catOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES.at(-1);
const FEE_PRESETS = [0, 1, 2, 3];

const $ = (id) => document.getElementById(id);
const state = {
  taxes: DEFAULT_TAXES,
  fx: null,
  tipPct: DEFAULT_TAXES.tip.default,
  category: 'shop',
  qty: 1,
  split: 1,
  // rate : taux personnalisé (null = cours officiel) ; sound : son au démarrage ; voiceLang : saisie vocale
  // wallpaper : id d'un fond, 'random' ou 'none' ; wpInterval : 'launch' ou délai en secondes
  // adaptive : couleurs selon la photo ; frost : intensité du givré (0 léger → 100 fort)
  settings: { fee: 0, rate: null, sound: true, voiceLang: 'fr-FR', wallpaper: 'random', wpInterval: 'launch', adaptive: true, frost: 30 },
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
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function parsePrice(text) {
  const n = parseFloat(String(text).replace(/[^\d.,]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Taux effectif € par $, frais bancaires compris (null si aucun taux connu).
// Taux de base € par $ : taux personnalisé s'il est défini, sinon cours officiel.
function baseRate() {
  return state.settings.rate || state.fx?.rate || null;
}

function effRate() {
  const r = baseRate();
  return r ? r * (1 + state.settings.fee / 100) : null;
}

// --- Calcul ---------------------------------------------------------------

// Un article : prix unitaire, quantité, partage (resto), catégorie et options de taxe/pourboire.
function compute({ unit, qty, split, category, opts }, taxes) {
  const exemptClothes = category === 'clothes' && unit < taxes.clothing.threshold;
  const exempt = exemptClothes || category === 'grocery';
  const exemptRate = exemptClothes ? taxes.clothing.rate : (taxes.grocery?.rate ?? 0);
  const taxRate = opts.tax ? (exempt ? exemptRate : taxes.salesTax.rate) : 0;
  const price = unit * qty;
  const tax = price * taxRate;
  const tip = opts.tip ? (opts.tipBasis === 'post' ? price + tax : price) * opts.tipPct : 0;
  const bill = price + tax + tip;
  return { unit, qty, split, category, opts, taxRate, exempt, price, tax, tip, bill, share: bill / split };
}

function readOptions() {
  return {
    tax: $('opt-tax').checked,
    tip: state.category === 'food' && $('opt-tip').checked, // pourboire : Resto uniquement
    tipPct: state.tipPct,
    tipBasis: document.querySelector('input[name="tip-basis"]:checked').value,
  };
}

function currentItem() {
  const food = state.category === 'food';
  const base = {
    qty: food ? 1 : state.qty,
    split: food ? state.split : 1,
    category: state.category,
    opts: readOptions(),
  };
  return compute({ unit: parsePrice($('price').value), ...base }, state.taxes);
}

// --- Affichage de l'article en cours ----------------------------------------

// Fait défiler un montant vers sa nouvelle valeur.
function animateValue(el, value, fmt) {
  if (value == null) {
    cancelAnimationFrame(el._raf);
    el._value = undefined;
    el.textContent = '— €';
    return;
  }
  const from = el._value;
  el._value = value;
  cancelAnimationFrame(el._raf);
  if (REDUCED_MOTION || from == null || from === value) {
    el.textContent = fmt(value);
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 420);
    const e = 1 - (1 - k) ** 3;
    el.textContent = fmt(from + (value - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

const showEur = (el, usdAmount) => {
  const rate = effRate();
  animateValue(el, rate == null ? null : usdAmount * rate, (v) => eur.format(v));
};

function render() {
  const it = currentItem();
  const food = state.category === 'food';
  const fee = state.settings.fee;

  $('tip-card').hidden = !food;
  renderCatInfo(it);
  $('tip-panel').hidden = !it.opts.tip;
  $('stepper-label').textContent = food ? 'Personnes' : 'Quantité';
  $('step-value').textContent = food ? state.split : state.qty;
  $('step-minus').disabled = (food ? state.split : state.qty) <= 1;

  $('hero-label').textContent = it.split > 1 ? 'Votre part' : 'Vous payez';
  showEur($('total-main'), it.share);
  $('total-sub').textContent = it.split > 1
    ? `Votre part : ${usd.format(it.share)} · addition ${usd.format(it.bill)}`
    : `Total : ${usd.format(it.bill)}`;

  $('b-price-label').textContent = it.qty > 1 ? `Prix (${it.qty} × ${usd.format(it.unit)})` : 'Prix';
  $('b-price').textContent = usd.format(it.price);
  $('b-tax-row').hidden = !it.opts.tax;
  $('b-tax').textContent = it.exempt && it.price > 0 ? 'exonéré' : `${usd.format(it.tax)} (${pct(it.taxRate)})`;
  $('b-tip-row').hidden = !it.opts.tip;
  $('b-tip').textContent = `${usd.format(it.tip)} (${pct(it.opts.tipPct)})`;
  $('b-split-row').hidden = it.split <= 1;
  $('b-split').textContent = `÷ ${it.split} = ${usd.format(it.share)} chacun`;
  $('b-fee-row').hidden = !(fee > 0 && baseRate());
  if (baseRate()) $('b-fee').textContent = `${eur.format(it.share * baseRate() * fee / 100)} (${pct(fee / 100)})`;

  store.set('prefs', { ...it.opts, tip: $('opt-tip').checked, category: state.category });
}

function renderCategories() {
  const box = $('categories');
  box.replaceChildren();
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat';
    b.style.setProperty('--cat', c.color);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c.id === state.category));
    b.textContent = `${c.emoji} ${c.label}`;
    b.addEventListener('click', () => setCategory(c.id));
    box.append(b);
  }
}

// Exonérations : ligne courte sous les catégories, explication complète au toucher de ⓘ.
const CAT_INFO = {
  clothes: {
    short: (it, t) => (it.unit >= t.clothing.threshold
      ? `Taxé : article à ${t.clothing.threshold} $ ou plus`
      : `Exonéré sous ${t.clothing.threshold} $ par article`),
    title: 'Vêtements et chaussures',
    body: (t) => [
      `À New York, les vêtements et chaussures vendus moins de ${t.clothing.threshold} $ par article sont exonérés de la sales tax.`,
      `À partir de ${t.clothing.threshold} $, la taxe de ${pct(t.salesTax.rate)} s'applique sur la totalité du prix.`,
      'Le seuil s’applique à chaque article, pas au total du ticket.',
      'Ne sont pas concernés : sacs, bijoux, montres, lunettes de soleil (choisissez « Shopping »).',
    ],
  },
  grocery: {
    short: () => 'Exonéré de taxe',
    title: 'Épicerie / Pharmacie',
    body: (t) => [
      'Sont exonérés de la sales tax : les produits alimentaires vendus en épicerie ou au supermarché (fruits, pain, lait, conserves…) et les médicaments, sur ordonnance ou en vente libre.',
      `Restent taxés à ${pct(t.salesTax.rate)} : plats préparés, sandwichs, cafés à emporter, sodas, bonbons, alcool, cosmétiques et produits d'hygiène (choisissez « Shopping »).`,
    ],
  },
};

function renderCatInfo(it) {
  const info = CAT_INFO[state.category];
  $('cat-info').hidden = !info || !it.opts.tax;
  if (info) $('cat-info-text').textContent = info.short(it, state.taxes);
}

function showCatInfo() {
  const info = CAT_INFO[state.category];
  if (!info) return;
  $('info-title').textContent = info.title;
  const body = $('info-body');
  body.replaceChildren();
  for (const line of info.body(state.taxes)) {
    const p = document.createElement('p');
    p.textContent = line;
    body.append(p);
  }
  $('info-dialog').showModal();
}

function setCategory(id) {
  const was = state.category;
  if (id === was) return;
  state.category = id;
  // Au resto, le pourboire est la règle (il n'est proposé que dans cette catégorie).
  if (id === 'food') $('opt-tip').checked = true;
  renderCategories();
  render();
  haptic();
}

function step(delta) {
  if (state.category === 'food') state.split = Math.min(20, Math.max(1, state.split + delta));
  else state.qty = Math.min(99, Math.max(1, state.qty + delta));
  render();
  haptic();
}

function renderRateInfo(offline) {
  const fx = state.fx;
  const fee = state.settings.fee ? ` · frais ${pct(state.settings.fee / 100)}` : '';
  if (state.settings.rate) {
    const r = state.settings.rate.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
    $('rate-info').textContent = `1 $ = ${r} € · taux personnalisé${fee}`;
    renderRateSetting();
    return;
  }
  renderRateSetting();
  if (!fx) {
    $('rate-info').textContent = 'Taux indisponible — connectez-vous à Internet une première fois.';
    return;
  }
  const rate = fx.rate.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
  const date = new Date(fx.date + 'T12:00:00').toLocaleDateString('fr-FR');
  $('rate-info').textContent = `1 $ = ${rate} € · ${date}${fee}${offline ? ' · hors ligne' : ''}`;
}

function renderTaxInfo() {
  const t = state.taxes;
  $('tax-rate-label').textContent = pct(t.salesTax.rate);
  $('clothing-threshold').textContent = t.clothing.threshold;

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
      haptic();
    });
    box.append(b);
  }
}

function renderAll() {
  render();
  renderCart();
  renderSaved();
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
      renderAll();
      return;
    } catch { /* on essaie la source suivante */ }
  }
  state.fx = store.get('fx');
  renderRateInfo(true);
  renderAll();
}

// --- Retours haptiques et partage (natifs dans l'APK) ------------------------

function haptic(kind = 'light') {
  try {
    if (IS_NATIVE) {
      const cap = window.Capacitor;
      const call = kind === 'success' || kind === 'warning'
        ? cap.nativePromise('Haptics', 'notification', { type: kind.toUpperCase() })
        : cap.nativePromise('Haptics', 'impact', { style: kind === 'medium' ? 'MEDIUM' : 'LIGHT' });
      call?.catch?.(() => {});
    } else {
      navigator.vibrate?.(kind === 'success' ? [12, 60, 12] : kind === 'medium' ? 18 : 8);
    }
  } catch { /* pas de vibreur */ }
}

function cartText() {
  const rate = effRate();
  const toE = (v) => (rate ? ` → ${eur.format(v * rate)}` : '');
  const lines = [`🗽 ${cart.name ? `Panier « ${cart.name} »` : 'Mon panier'} — Vrai Prix NY`, ''];
  cart.items.forEach((it, i) => {
    const c = catOf(it.category);
    const qty = it.qty > 1 ? ` ×${it.qty}` : '';
    const split = it.split > 1 ? ` (ma part sur ${it.split})` : '';
    lines.push(`${i + 1}. ${c.emoji} ${it.name || `Article ${i + 1}`}${qty}${split} : ${usd.format(it.share)}${toE(it.share)}`);
  });
  const t = cartTotals(cart.items);
  lines.push('', `Total : ${usd.format(t.share)}${toE(t.share)}`);
  if (baseRate()) {
    const r = baseRate().toLocaleString('fr-FR', { maximumFractionDigits: 4 });
    const when = state.settings.rate ? 'taux personnalisé' : new Date(state.fx.date + 'T12:00:00').toLocaleDateString('fr-FR');
    const fee = state.settings.fee ? `, frais bancaires ${pct(state.settings.fee / 100)}` : '';
    lines.push(`Taux : 1 $ = ${r} € (${when}${fee})`);
  }
  return lines.join('\n');
}

async function shareCart() {
  if (!cart.items.length) return;
  const text = cartText();
  const title = cart.name || 'Mon panier Vrai Prix NY';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Panier copié dans le presse-papiers');
    } catch {
      toast('Partage impossible sur cet appareil');
    }
  };
  try {
    if (IS_NATIVE) await window.Capacitor.nativePromise('Share', 'share', { title, text, dialogTitle: 'Partager le panier' });
    else if (navigator.share) await navigator.share({ title, text });
    else await copy();
  } catch (e) {
    if (!/abort|cancel/i.test(`${e?.name} ${e?.message}`)) await copy();
  }
}

// --- Panier ---------------------------------------------------------------

// cart : panier en cours ; id/name renseignés s'il provient d'un panier enregistré.
let cart = { id: null, name: null, items: [] };
let saved = [];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clone = (v) => JSON.parse(JSON.stringify(v));

// Articles des versions précédentes (sans quantité ni catégorie).
function migrateItem(it) {
  if (it.unit != null) {
    return CATEGORIES.some((c) => c.id === it.category) ? it : { ...it, category: 'other' }; // Transport, Visites…
  }
  return {
    id: it.id, name: it.name || '', category: 'shop', unit: it.price, qty: 1, split: 1,
    opts: { tax: it.opts?.tax ?? true, tip: !!it.opts?.tip, tipPct: it.opts?.tipPct ?? 0.2, tipBasis: it.opts?.tipBasis || 'pre' },
    taxRate: it.taxRate ?? 0, exempt: false, price: it.price, tax: it.tax, tip: it.tip, bill: it.total, share: it.total,
  };
}

function cartTotals(items) {
  return items.reduce(
    (t, it) => ({
      price: t.price + it.price / it.split,
      tax: t.tax + it.tax / it.split,
      tip: t.tip + it.tip / it.split,
      share: t.share + it.share,
    }),
    { price: 0, tax: 0, tip: 0, share: 0 },
  );
}

// Un panier enregistré ouvert est sauvegardé automatiquement à chaque modification.
function persistCart() {
  if (cart.id) {
    const entry = saved.find((s) => s.id === cart.id);
    if (entry) {
      entry.items = clone(cart.items);
      entry.name = cart.name;
      entry.savedAt = new Date().toISOString();
      store.set('savedCarts', saved);
      renderSaved();
    } else {
      cart.id = null; // panier enregistré supprimé entre-temps
    }
  }
  store.set('cart', cart);
}

function saveCart() {
  persistCart();
  renderCart();
}

function saveSaved() {
  store.set('savedCarts', saved);
  renderSaved();
}

function renderCart() {
  const n = cart.items.length;
  const t = cartTotals(cart.items);
  const rate = effRate();

  $('cart-count').textContent = n;
  $('cart-name').textContent = cart.name || 'Panier';
  $('cart-sub').textContent = (n ? plural(n, 'article') : 'vide') + (cart.id ? ' · enregistré' : '');
  showEur($('cart-eur'), t.share);
  $('cart-usd').textContent = usd.format(t.share);
  $('cart-open').classList.toggle('empty-cart', !n);

  $('cart-title').textContent = cart.name || 'Panier';
  showEur($('cv-eur'), t.share);
  $('cv-usd').textContent = usd.format(t.share);
  const detail = [`Prix ${usd.format(t.price)}`];
  if (t.tax) detail.push(`taxes ${usd.format(t.tax)}`);
  if (t.tip) detail.push(`pourboires ${usd.format(t.tip)}`);
  if (state.settings.fee && rate) detail.push(`frais ${eur.format(t.share * baseRate() * state.settings.fee / 100)}`);
  $('cv-detail').textContent = n ? detail.join(' · ') : '';
  $('cart-empty').hidden = n > 0;
  $('cart-clear').disabled = !n;
  $('cart-save').disabled = !n;
  $('cart-share').disabled = !n;

  // Totaux par catégorie
  const sums = new Map();
  for (const it of cart.items) sums.set(it.category, (sums.get(it.category) || 0) + it.share);
  const summary = $('cat-summary');
  summary.replaceChildren();
  if (sums.size > 1) {
    for (const c of CATEGORIES) {
      if (!sums.has(c.id)) continue;
      const s = document.createElement('span');
      s.className = 'cat-sum';
      s.style.setProperty('--cat', c.color);
      s.textContent = `${c.emoji} ${c.label} ${rate ? eur.format(sums.get(c.id) * rate) : usd.format(sums.get(c.id))}`;
      summary.append(s);
    }
  }

  const list = $('cart-list');
  list.replaceChildren();
  cart.items.forEach((it, i) => list.append(cartItemRow(it, i)));
}

function cartItemRow(it, i) {
  const c = catOf(it.category);
  const rate = effRate();
  const li = document.createElement('li');
  li.className = 'item-wrap';
  const card = document.createElement('div');
  card.className = 'item';

  const num = document.createElement('span');
  num.className = 'item-num';
  num.style.setProperty('--cat', c.color);
  num.textContent = i + 1;
  num.title = c.label;

  const main = document.createElement('div');
  main.className = 'item-main';
  const name = document.createElement('input');
  name.className = 'item-name';
  name.inputMode = 'none'; // clavier maison
  name.dataset.kbd = '';
  name.type = 'text';
  name.maxLength = 40;
  name.value = it.name;
  name.placeholder = `Article ${i + 1}`;
  name.setAttribute('aria-label', `Nom de l'article ${i + 1}`);
  name.addEventListener('change', () => {
    it.name = name.value.trim();
    persistCart();
  });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
  const detail = document.createElement('span');
  detail.className = 'item-detail';
  const parts = [`${c.emoji} ${usd.format(it.price)}`];
  if (it.tax) parts.push(`taxe ${usd.format(it.tax)}`);
  else if (it.opts.tax) parts.push('exonéré');
  if (it.tip) parts.push(`pourboire ${usd.format(it.tip)}`);
  if (it.split > 1) parts.push(`÷ ${it.split}`);
  detail.textContent = parts.join(' + ').replace(' + ÷', ' ÷');
  main.append(name, detail);

  if (it.category !== 'food') {
    const qty = document.createElement('div');
    qty.className = 'item-qty';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.textContent = '−';
    minus.disabled = it.qty <= 1;
    minus.setAttribute('aria-label', `Diminuer la quantité de l'article ${i + 1}`);
    const val = document.createElement('span');
    val.textContent = `× ${it.qty}`;
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.textContent = '+';
    plus.setAttribute('aria-label', `Augmenter la quantité de l'article ${i + 1}`);
    const change = (d) => {
      Object.assign(it, compute({ ...it, qty: Math.min(99, Math.max(1, it.qty + d)) }, state.taxes));
      saveCart();
      haptic();
    };
    minus.addEventListener('click', () => change(-1));
    plus.addEventListener('click', () => change(1));
    qty.append(minus, val, plus);
    main.append(qty);
  }

  const amt = document.createElement('div');
  amt.className = 'item-amt';
  const e = document.createElement('b');
  e.textContent = rate ? eur.format(it.share * rate) : '— €';
  const u = document.createElement('span');
  u.textContent = usd.format(it.share);
  amt.append(e, u);

  card.append(num, main, amt);
  li.append(card);
  enableSwipe(li, card, () => {
    const before = clone(cart);
    cart.items.splice(i, 1);
    saveCart();
    haptic('medium');
    toast(`${it.name || `Article ${i + 1}`} supprimé`, 'Annuler', () => { cart = before; saveCart(); });
  });
  return li;
}

// Glisser un article vers la gauche pour le supprimer.
function enableSwipe(li, card, onDelete) {
  let x0 = null, y0 = 0, dx = 0, mode = null, pid = null;
  li.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; mode = null; pid = e.pointerId;
  });
  li.addEventListener('pointermove', (e) => {
    if (x0 == null || e.pointerId !== pid) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (mode == null) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) {
        mode = 'swipe';
        li.setPointerCapture(pid);
        document.activeElement?.blur();
        li.classList.add('swiping');
      } else if (Math.abs(my) > 10) {
        mode = 'scroll';
      }
    }
    if (mode !== 'swipe') return;
    dx = Math.min(0, mx);
    card.style.transform = `translateX(${dx}px)`;
    li.style.setProperty('--reveal', Math.min(1, -dx / 110).toFixed(2));
  });
  const end = () => {
    if (mode === 'swipe') {
      li.classList.remove('swiping');
      if (dx < -li.offsetWidth * 0.35) {
        card.style.transform = 'translateX(-110%)';
        li.classList.add('removing');
        setTimeout(onDelete, 200);
      } else {
        card.style.transform = '';
        li.style.setProperty('--reveal', 0);
      }
    }
    x0 = null;
    mode = null;
  };
  li.addEventListener('pointerup', end);
  li.addEventListener('pointercancel', end);
}

// Pastille qui vole du bouton vers l'icône du panier.
function flyToCart(fromEl) {
  if (REDUCED_MOTION) return Promise.resolve();
  const a = fromEl.getBoundingClientRect();
  const b = $('cart-icon').getBoundingClientRect();
  const dot = document.createElement('span');
  dot.className = 'fly';
  dot.textContent = catOf(state.category).emoji;
  dot.style.left = `${a.left + a.width / 2}px`;
  dot.style.top = `${a.top + a.height / 2}px`;
  document.body.append(dot);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anim = dot.animate([
    { transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 },
    { transform: `translate(calc(-50% + ${dx * 0.3}px), calc(-50% + ${dy * 0.45 - 70}px)) scale(1.35)`, opacity: 1, offset: 0.4 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.35)`, opacity: 0.6 },
  ], { duration: 620, easing: 'cubic-bezier(.45, 0, .25, 1)' });
  return anim.finished.then(() => dot.remove(), () => dot.remove());
}

function addToCart(fromEl = $('add-btn')) {
  const item = currentItem();
  if (!(item.unit > 0)) {
    if (keypadOpen()) haptic('warning');
    else $('price').focus();
    toast('Saisissez d’abord un prix');
    return;
  }
  const id = uid();
  const name = $('item-name').value.trim(); // vide : « Article N » affiché automatiquement
  cart.items.push({ id, name, ...item });
  const n = cart.items.length;
  $('price').value = '';
  $('item-name').value = '';
  state.qty = 1;
  state.split = 1;
  render();

  flyToCart(fromEl).then(() => {
    saveCart();
    const bar = $('cart-open');
    bar.classList.remove('bump');
    void bar.offsetWidth; // relance l'animation
    bar.classList.add('bump');
    haptic('success');
  });
  toast(`${name || `Article ${n}`} ajouté au panier`, 'Annuler', () => {
    cart.items = cart.items.filter((x) => x.id !== id);
    saveCart();
  });
}

// Ajoute l'article en cours directement dans un panier enregistré.
function addToSaved() {
  const item = currentItem();
  if (!(item.unit > 0)) {
    $('price').focus();
    toast('Saisissez d’abord un prix');
    return;
  }
  if (!saved.length) {
    toast('Aucun panier enregistré : enregistrez d’abord un panier');
    return;
  }
  if (keypadOpen()) history.back();
  const list = $('pick-list');
  list.replaceChildren();
  const dlg = $('pick-dialog');
  for (const s of saved) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick';
    const title = document.createElement('b');
    title.textContent = s.name;
    const meta = document.createElement('span');
    meta.textContent = plural(s.items.length, 'article') + (s.id === cart.id ? ' · ouvert' : '');
    b.append(title, meta);
    b.addEventListener('click', () => {
      dlg.close();
      // Le panier ouvert : ajout classique (il est sauvegardé automatiquement).
      if (s.id === cart.id) { addToCart($('add-to-btn')); return; }
      const id = uid();
      const name = $('item-name').value.trim();
      s.items.push({ id, name, ...item });
      s.savedAt = new Date().toISOString();
      saveSaved();
      $('price').value = '';
      $('item-name').value = '';
      state.qty = 1;
      state.split = 1;
      render();
      haptic('success');
      toast(`${name || `Article ${s.items.length}`} ajouté à « ${s.name} »`, 'Annuler', () => {
        s.items = s.items.filter((x) => x.id !== id);
        saveSaved();
      });
    });
    li.append(b);
    list.append(li);
  }
  dlg.showModal();
}

function clearCart() {
  const before = clone(cart);
  cart = { id: null, name: null, items: [] };
  saveCart();
  haptic('medium');
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
    haptic('success');
    toast(`Panier « ${name} » enregistré`);
  }, { once: true });
}

function renderSaved() {
  const rate = effRate();
  $('saved-count').textContent = saved.length || '';
  $('saved-empty').hidden = saved.length > 0;
  const list = $('saved-list');
  list.replaceChildren();
  for (const s of saved) {
    const li = document.createElement('li');
    li.className = 'item-wrap';
    const card = document.createElement('div');
    card.className = 'saved';
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
    const share = cartTotals(s.items).share;
    total.textContent = rate ? eur.format(share * rate) : usd.format(share);
    open.append(title, meta, total);
    open.addEventListener('click', () => loadSaved(s));
    card.append(open);
    li.append(card);
    enableSwipe(li, card, () => {
      const before = clone(saved);
      saved = saved.filter((x) => x.id !== s.id);
      if (cart.id === s.id) { cart.id = null; saveCart(); }
      saveSaved();
      haptic('medium');
      toast(`« ${s.name} » supprimé`, 'Annuler', () => { saved = before; saveSaved(); });
    });
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

// --- Réglages -------------------------------------------------------------

function applySettings() {
  store.set('settings', state.settings);
  renderRateInfo(!navigator.onLine);
  renderAll();
}

function renderFeePresets() {
  const box = $('fee-presets');
  box.replaceChildren();
  for (const f of FEE_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-pressed', String(f === state.settings.fee));
    b.textContent = `${f} %`;
    b.addEventListener('click', () => {
      state.settings.fee = f;
      $('set-fee').value = f ? String(f).replace('.', ',') : '';
      renderFeePresets();
      applySettings();
      haptic();
    });
    box.append(b);
  }
}

function renderRateSetting() {
  const official = state.fx?.rate;
  $('set-rate').placeholder = official ? official.toLocaleString('fr-FR', { maximumFractionDigits: 4 }) : '0,92';
  $('rate-reset').disabled = !state.settings.rate;
  $('rate-note').textContent = state.settings.rate
    ? `Taux personnalisé utilisé${official ? ` (cours officiel : ${official.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} €)` : ''}.`
    : 'Cours officiel de la BCE, mis à jour automatiquement. Saisissez un autre taux pour le remplacer, par exemple celui de votre banque.';
}

function initSettings() {
  const s = store.get('settings');
  if (s) {
    state.settings.fee = s.fee || 0;
    state.settings.rate = s.rate > 0 ? s.rate : null;
    state.settings.sound = s.sound !== false;
    if (s.voiceLang === 'en-US') state.settings.voiceLang = 'en-US';
    if (s.wallpaper === 'random' || s.wallpaper === 'none' || WALLPAPERS.some((w) => w.id === s.wallpaper)) state.settings.wallpaper = s.wallpaper;
    if (WP_INTERVALS.some((o) => o.v === s.wpInterval)) state.settings.wpInterval = s.wpInterval;
    if (s.adaptive === false) state.settings.adaptive = false;
    if (Number.isFinite(s.frost)) state.settings.frost = Math.min(100, Math.max(0, s.frost));
  }
  $('set-rate').value = state.settings.rate ? String(state.settings.rate).replace('.', ',') : '';
  $('set-rate').addEventListener('input', () => {
    const r = parsePrice($('set-rate').value);
    state.settings.rate = r > 0 ? r : null;
    applySettings();
  });
  $('rate-reset').addEventListener('click', () => {
    state.settings.rate = null;
    $('set-rate').value = '';
    applySettings();
    haptic();
    toast('Cours officiel rétabli');
  });
  $('opt-adaptive').checked = state.settings.adaptive;
  $('opt-adaptive').addEventListener('change', () => {
    state.settings.adaptive = $('opt-adaptive').checked;
    store.set('settings', state.settings);
    applyTheme();
    haptic();
  });
  $('set-frost').value = state.settings.frost;
  $('set-frost').addEventListener('input', () => {
    state.settings.frost = Number($('set-frost').value);
    applyFrost();
  });
  $('set-frost').addEventListener('change', () => { store.set('settings', state.settings); haptic(); });
  applyFrost();
  $('opt-sound').checked = state.settings.sound;
  $('opt-sound').addEventListener('change', () => { state.settings.sound = $('opt-sound').checked; applySettings(); haptic(); });
  document.querySelector(`input[name="voice-lang"][value="${state.settings.voiceLang}"]`).checked = true;
  document.querySelectorAll('input[name="voice-lang"]').forEach((el) => el.addEventListener('change', () => {
    state.settings.voiceLang = el.value;
    applySettings();
    haptic();
  }));
  $('set-fee').value = state.settings.fee ? String(state.settings.fee).replace('.', ',') : '';
  renderFeePresets();
  $('set-fee').addEventListener('input', () => {
    state.settings.fee = Math.min(10, parsePrice($('set-fee').value));
    renderFeePresets();
    applySettings();
  });
}

// --- Pavé numérique -------------------------------------------------------

const keypadOpen = () => !$('keypad').hidden;

function openKeypad() {
  if (keypadOpen()) return;
  openView('keypad', false);
  const h = $('keypad').offsetHeight;
  document.body.style.setProperty('--kp-h', `${h}px`);
  document.body.classList.add('kp-open');
  // Fait remonter la page pour garder le total visible au-dessus du pavé.
  setTimeout(() => {
    const overlap = $('total-sub').getBoundingClientRect().bottom - (innerHeight - h - 16);
    if (overlap > 0) window.scrollBy({ top: overlap, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  }, 30);
}

function pressKey(key) {
  const input = $('price');
  let v = input.value.replace(',', '.');
  if (key === 'back') v = v.slice(0, -1);
  else if (key === '.') { if (!v.includes('.')) v = (v || '0') + '.'; }
  else {
    const [int, dec] = v.split('.');
    if (dec != null && dec.length >= 2) return haptic('warning');
    if (dec == null && int.length >= 7) return haptic('warning');
    v = v === '0' ? key : v + key;
  }
  input.value = v.replace('.', ',');
  render();
  haptic();
}

function initKeypad() {
  const price = $('price');
  price.addEventListener('focus', openKeypad);
  price.addEventListener('click', openKeypad);
  let holdTimer = null;
  $('keypad').querySelectorAll('[data-key]').forEach((k) => {
    k.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // garde le focus sur le champ
      k.classList.add('pressed');
      if (k.dataset.key === 'back') {
        holdTimer = setTimeout(() => { price.value = ''; render(); haptic('medium'); holdTimer = 'done'; }, 550);
      }
    });
    const release = () => {
      k.classList.remove('pressed');
      if (k.dataset.key === 'back') {
        const held = holdTimer === 'done';
        clearTimeout(holdTimer);
        holdTimer = null;
        if (held) return;
      }
    };
    k.addEventListener('pointerup', release);
    k.addEventListener('pointerleave', () => { k.classList.remove('pressed'); if (holdTimer !== 'done') clearTimeout(holdTimer); });
    k.addEventListener('click', () => {
      if (k.dataset.key === 'back' && holdTimer === null && price.value === '') return;
      pressKey(k.dataset.key);
    });
  });
  $('kp-ok').addEventListener('click', () => history.back());
  $('kp-add').addEventListener('click', (e) => addToCart(e.currentTarget));
  // Toucher ailleurs ferme le pavé.
  document.addEventListener('pointerdown', (e) => {
    if (!keypadOpen()) return;
    if (e.target.closest('#keypad, #price, input[data-kbd], #kbd, .stepper, .categories, .segmented, .chips, .check, #add-btn, #scan-btn, .toast, #cart-open, #settings-open')) return;
    history.back();
  });
}

// --- Écrans et notifications ------------------------------------------------

// Chaque écran ouvert ajoute une entrée d'historique : le bouton retour d'Android le referme.
const openViews = [];

// Pavé numérique et clavier : fermés quand leur entrée d'historique disparaît.
const OVERLAYS = {
  keypad: () => {
    $('keypad').hidden = true;
    document.body.classList.remove('kp-open');
    $('price').blur();
  },
  kbd: () => { if (typeof Kbd !== 'undefined') Kbd.hide(); },
};

function openView(id, lockScroll = true) {
  // Un pavé ou clavier ouvert cède sa place : on réutilise son entrée d'historique.
  const top = openViews.at(-1)?.id;
  const replace = top in OVERLAYS && top !== id;
  if (replace) {
    openViews.pop();
    OVERLAYS[top]();
  }
  $(id).hidden = false;
  openViews.push({ id, lockScroll });
  if (replace) history.replaceState({ view: id }, '');
  else history.pushState({ view: id }, '');
  if (lockScroll) document.body.classList.add('no-scroll');
  document.body.dataset.view = id;
}

window.addEventListener('popstate', () => {
  const v = openViews.pop();
  if (v) {
    $(v.id).hidden = true;
    OVERLAYS[v.id]?.();
  }
  if (!openViews.some((x) => x.lockScroll)) document.body.classList.remove('no-scroll');
  document.body.dataset.view = openViews.at(-1)?.id || '';
});

let toastTimer = null;
function toast(msg, actionLabel, action) {
  const el = $('toast');
  const btn = $('toast-action');
  $('toast-msg').textContent = msg;
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || '';
  btn.onclick = () => { el.hidden = true; action?.(); haptic(); };
  el.hidden = true;
  void el.offsetWidth; // relance l'animation d'apparition
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, actionLabel ? 5000 : 2500);
}

// --- Fonds d'écran ------------------------------------------------------------

const WALLPAPERS = [
  { id: 'central-park', label: 'Central Park', tone: 'dark' },
  { id: 'taxis', label: 'Taxis', tone: 'dark' },
  { id: 'brooklyn-bridge', label: 'Brooklyn Bridge', tone: 'dark' },
  { id: 'empire-state', label: 'Empire State', tone: 'dark' },
  { id: 'liberty', label: 'Statue de la Liberté', tone: 'dark' },
  { id: 'radio-city', label: 'Radio City', tone: 'dark' },
  { id: 'times-square', label: 'Times Square', tone: 'dark' },
  { id: 'brooklyn-promenade', label: 'Promenade de Brooklyn', tone: 'dark' },
];
const WP_INTERVALS = [
  { v: 'launch', label: 'À l’ouverture' },
  { v: 30, label: '30 s' },
  { v: 60, label: '1 min' },
  { v: 300, label: '5 min' },
  { v: 900, label: '15 min' },
];
const wpFile = (id) => `wallpapers/${id}.webp`;
const wpThumb = (id) => `wallpapers/${id}-thumb.webp`;
let wpCurrent = null;
let wpLayer = 'a';
let wpTimer = null;

// Thème imposé par la photo affichée (option « Couleurs adaptées à la photo »).
function applyTheme() {
  const wp = document.body.classList.contains('has-wp') && WALLPAPERS.find((w) => w.id === wpCurrent);
  const tone = state.settings.adaptive && wp ? wp.tone : null;
  document.documentElement.classList.toggle('theme-dark', tone === 'dark');
  document.documentElement.classList.toggle('theme-light', tone === 'light');
}

// Givré : opacité des cartes (55 % à 85 %) et flou (6 à 28 px).
function applyFrost() {
  const f = state.settings.frost / 100;
  document.documentElement.style.setProperty('--glass-a', (0.55 + 0.3 * f).toFixed(2));
  document.documentElement.style.setProperty('--blur', `${Math.round(6 + 22 * f)}px`);
}

function showWallpaper(id) {
  if (id === wpCurrent) return;
  wpCurrent = id;
  if (!id) {
    $('wp-a').classList.remove('on');
    $('wp-b').classList.remove('on');
    document.body.classList.remove('has-wp');
    applyTheme();
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (wpCurrent !== id) return;
    const next = wpLayer === 'a' ? 'b' : 'a';
    $(`wp-${next}`).style.backgroundImage = `url("${wpFile(id)}")`;
    $(`wp-${next}`).classList.add('on');
    $(`wp-${wpLayer}`).classList.remove('on');
    wpLayer = next;
    document.body.classList.add('has-wp');
    applyTheme();
  };
  img.onerror = () => { if (wpCurrent === id) { wpCurrent = null; document.body.classList.remove('has-wp'); applyTheme(); } };
  img.src = wpFile(id);
}

function randomWallpaper() {
  const others = WALLPAPERS.filter((w) => w.id !== wpCurrent);
  return others[Math.floor(Math.random() * others.length)].id;
}

function applyWallpaper() {
  clearInterval(wpTimer);
  const { wallpaper, wpInterval } = state.settings;
  if (wallpaper === 'none') showWallpaper(null);
  else if (wallpaper === 'random') {
    if (!wpCurrent || !WALLPAPERS.some((w) => w.id === wpCurrent)) showWallpaper(randomWallpaper());
    if (wpInterval !== 'launch') wpTimer = setInterval(() => showWallpaper(randomWallpaper()), wpInterval * 1000);
  } else showWallpaper(wallpaper);
  renderWallpaperSettings();
}

function renderWallpaperSettings() {
  const g = $('wp-gallery');
  g.replaceChildren();
  const tiles = [
    { id: 'random', label: 'Aléatoire', icon: '🎲' },
    ...WALLPAPERS,
    { id: 'none', label: 'Aucun', icon: '∅' },
  ];
  for (const t of tiles) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wp-tile';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(state.settings.wallpaper === t.id));
    if (t.icon) {
      b.classList.add('wp-special');
      const i = document.createElement('span');
      i.className = 'wp-icon';
      i.textContent = t.icon;
      b.append(i);
    } else {
      b.style.backgroundImage = `url("${wpThumb(t.id)}")`;
    }
    const l = document.createElement('span');
    l.className = 'wp-label';
    l.textContent = t.label;
    b.append(l);
    b.addEventListener('click', () => {
      state.settings.wallpaper = t.id;
      if (t.id === 'random') wpCurrent = null; // nouveau tirage
      store.set('settings', state.settings);
      applyWallpaper();
      haptic();
    });
    g.append(b);
  }
  $('wp-interval-box').hidden = state.settings.wallpaper !== 'random';
  const box = $('wp-interval');
  box.replaceChildren();
  for (const o of WP_INTERVALS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(state.settings.wpInterval === o.v));
    b.textContent = o.label;
    b.addEventListener('click', () => {
      state.settings.wpInterval = o.v;
      store.set('settings', state.settings);
      applyWallpaper();
      haptic();
    });
    box.append(b);
  }
}

// --- Démarrage animé --------------------------------------------------------

// Renvoie true au premier affichage depuis le lancement de l'appli.
function runSplash() {
  const s = $('splash');
  let seen = false;
  try { seen = sessionStorage.getItem('splash') === '1'; sessionStorage.setItem('splash', '1'); } catch { /* ignore */ }
  if (REDUCED_MOTION || seen) { s.remove(); return !seen; }
  s.classList.add('play');
  const done = () => {
    if (!s.isConnected || s.classList.contains('out')) return;
    s.classList.add('out');
    setTimeout(() => s.remove(), 420);
  };
  setTimeout(done, 2100);
  s.addEventListener('click', done);
  return true;
}

function playStartupSound() {
  try {
    const a = new Audio('sounds/baseball.mp3');
    a.volume = 0.9;
    a.play().catch(() => { /* lecture automatique bloquée (navigateur) */ });
  } catch { /* pas d'audio */ }
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
    toast('La caméra n’est pas disponible sur cet appareil');
    return;
  }
  if (keypadOpen()) history.back();
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
    $('scan-status').textContent = 'Accès à la caméra refusé. Autorisez-le dans les réglages du téléphone.';
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
  $('price').value = p.toFixed(2).replace('.', ',');
  closeScanner();
  render();
  haptic('success');
}

// --- Saisie vocale ----------------------------------------------------------

const VOICE_CATEGORIES = [
  { id: 'clothes', words: ['vêtement', 'vetement', 'habit', 'chaussure', 'basket', 'jean', 'pull', 'veste', 'clothes', 'clothing', 'shoe', 'sneaker', 'apparel', 'shirt'] },
  { id: 'food', words: ['resto', 'restaurant', 'repas', 'dîner', 'diner', 'déjeuner', 'dejeuner', 'brunch', 'bar', 'café', 'meal', 'dinner', 'lunch', 'breakfast'] },
  { id: 'grocery', words: ['épicerie', 'epicerie', 'supermarché', 'supermarche', 'pharmacie', 'médicament', 'medicament', 'courses', 'grocery', 'groceries', 'supermarket', 'pharmacy', 'drugstore', 'medicine'] },
  { id: 'shop', words: ['shopping', 'souvenir', 'boutique', 'magasin', 'cadeau', 'store', 'shop', 'gift'] },
  { id: 'other', words: ['autre', 'other', 'divers', 'misc'] },
];

// Extrait prix et catégorie d'une phrase : « 34,99 vêtements », « 12 dollars 50 resto », « $12.50 grocery ».
function parseVoice(text) {
  const t = text.toLowerCase().replace(/\u00a0/g, ' ');
  let category = null;
  for (const c of VOICE_CATEGORIES) {
    if (c.words.some((w) => t.includes(w))) { category = c.id; break; }
  }
  let price = null;
  const split = t.match(/(\d+)\s*(?:\$|dollars?|bucks?)\s*(?:et\s+|and\s+)?(\d{1,2})(?!\d)/);
  if (split) {
    price = parseFloat(`${split[1]}.${split[2].padStart(2, '0')}`);
  } else {
    const m = t.replace(/(\d),(\d{3})(?!\d)/g, '$1$2').match(/\d+(?:[.,]\d{1,2})?/);
    if (m) price = parseFloat(m[0].replace(',', '.'));
  }
  return { price: price > 0 ? price : null, category };
}

function applyVoice(matches) {
  for (const text of matches || []) {
    const r = parseVoice(text);
    if (r.price == null && !r.category) continue;
    if (r.category && r.category !== state.category) setCategory(r.category);
    if (r.price != null) $('price').value = r.price.toFixed(2).replace('.', ',');
    render();
    haptic('success');
    const parts = [];
    if (r.price != null) parts.push(usd.format(r.price));
    if (r.category) parts.push(catOf(r.category).label);
    toast(`Compris : ${parts.join(' · ')}`);
    return;
  }
  haptic('warning');
  toast(`Pas compris${matches?.[0] ? ` : « ${matches[0]} »` : ''}. Réessayez.`);
}

async function startVoice() {
  if (keypadOpen()) history.back();
  const lang = state.settings.voiceLang;
  const btn = $('voice-btn');
  try {
    if (IS_NATIVE) {
      const cap = window.Capacitor;
      const perm = await cap.nativePromise('SpeechRecognition', 'requestPermissions', { permissions: ['speechRecognition'] });
      if (perm?.speechRecognition && perm.speechRecognition !== 'granted') {
        toast('Autorisez le micro pour la saisie vocale');
        return;
      }
      btn.classList.add('listening');
      const res = await cap.nativePromise('SpeechRecognition', 'start', {
        language: lang, maxResults: 5, popup: true, partialResults: false,
        prompt: lang === 'fr-FR' ? 'Dites le prix et la catégorie' : 'Say the price and category',
      });
      applyVoice(res?.matches);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast('Saisie vocale indisponible sur ce navigateur');
      return;
    }
    const rec = new SR();
    rec.lang = lang;
    rec.maxAlternatives = 5;
    rec.interimResults = false;
    btn.classList.add('listening');
    toast(lang === 'fr-FR' ? 'Parlez : prix et catégorie…' : 'Speak: price and category…');
    rec.onresult = (e) => applyVoice(Array.from(e.results[0]).map((a) => a.transcript));
    rec.onerror = (e) => { if (e.error !== 'aborted') toast(e.error === 'not-allowed' ? 'Autorisez le micro pour la saisie vocale' : 'Pas compris, réessayez'); };
    rec.onend = () => btn.classList.remove('listening');
    rec.start();
    return;
  } catch (e) {
    if (!/cancel|^0$/i.test(String(e?.message ?? e))) toast('Pas compris, réessayez');
  } finally {
    if (IS_NATIVE) btn.classList.remove('listening');
  }
}

// --- Démarrage ------------------------------------------------------------

function init() {
  const firstLaunch = runSplash();
  const prefs = store.get('prefs');
  if (prefs) {
    $('opt-tax').checked = prefs.tax ?? true;
    $('opt-tip').checked = !!prefs.tip;
    if (prefs.tipPct) state.tipPct = prefs.tipPct;
    if (CATEGORIES.some((c) => c.id === prefs.category)) state.category = prefs.category;
    const basis = document.querySelector(`input[name="tip-basis"][value="${prefs.tipBasis}"]`);
    if (basis) basis.checked = true;
  }
  state.fx = store.get('fx');
  state.taxes = store.get('taxes') || DEFAULT_TAXES;
  initSettings();
  applyWallpaper();
  if (firstLaunch && state.settings.sound) playStartupSound();
  renderTaxInfo();
  renderCategories();
  if (state.fx) renderRateInfo(false);

  $('price').addEventListener('input', render);
  $('price').addEventListener('keydown', (e) => { if (e.key === 'Enter') addToCart(); });
  document.querySelectorAll('#opt-tax, #opt-tip, input[name="tip-basis"]')
    .forEach((el) => el.addEventListener('change', () => { render(); haptic(); }));
  $('item-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('item-name').blur(); });
  $('step-minus').addEventListener('click', () => step(-1));
  $('step-plus').addEventListener('click', () => step(1));
  $('scan-btn').addEventListener('click', openScanner);
  $('voice-btn').addEventListener('click', startVoice);
  $('cat-info').addEventListener('click', showCatInfo);
  $('add-to-btn').addEventListener('click', addToSaved);
  $('scan-close').addEventListener('click', closeScanner);
  $('scan-capture').addEventListener('click', capture);
  initKeypad();

  cart = store.get('cart') || cart;
  cart.items = cart.items.map(migrateItem);
  saved = (store.get('savedCarts') || []).map((s) => ({ ...s, items: s.items.map(migrateItem) }));
  $('add-btn').addEventListener('click', (e) => addToCart(e.currentTarget));
  $('cart-open').addEventListener('click', () => openView('cart-view'));
  $('saved-open').addEventListener('click', () => openView('saved-view'));
  $('settings-open').addEventListener('click', () => openView('settings-view'));
  $('cart-clear').addEventListener('click', clearCart);
  $('cart-save').addEventListener('click', askCartName);
  $('cart-share').addEventListener('click', shareCart);
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => history.back()));

  renderAll();
  loadTaxes();
  loadRate();

  if ('serviceWorker' in navigator && !IS_NATIVE) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
