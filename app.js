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
  { id: 'clothes', label: 'Vêtements', emoji: '👕', color: '#9d8cf0' },
  { id: 'food', label: 'Resto', emoji: '🍔', color: '#ff7a59' },
  { id: 'transport', label: 'Transport', emoji: '🚕', color: '#4da3ff' },
  { id: 'visit', label: 'Visites', emoji: '🗽', color: '#3fb8a9' },
  { id: 'other', label: 'Autre', emoji: '✨', color: '#7a8499' },
];
const catOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
const FEE_PRESETS = [0, 1, 2, 3];

const $ = (id) => document.getElementById(id);
const state = {
  taxes: DEFAULT_TAXES,
  fx: null,
  tipPct: DEFAULT_TAXES.tip.default,
  direction: 'usd', // 'usd' : prix en $ → €, 'eur' : budget en € → prix max en $
  category: 'shop',
  qty: 1,
  split: 1,
  settings: { fee: 0, budget: null },
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
function effRate() {
  return state.fx ? state.fx.rate * (1 + state.settings.fee / 100) : null;
}

// --- Calcul ---------------------------------------------------------------

// Un article : prix unitaire, quantité, partage (resto), catégorie et options de taxe/pourboire.
function compute({ unit, qty, split, category, opts }, taxes) {
  const exempt = category === 'clothes' && unit < taxes.clothing.threshold;
  const taxRate = opts.tax ? (exempt ? taxes.clothing.rate : taxes.salesTax.rate) : 0;
  const price = unit * qty;
  const tax = price * taxRate;
  const tip = opts.tip ? (opts.tipBasis === 'post' ? price + tax : price) * opts.tipPct : 0;
  const bill = price + tax + tip;
  return { unit, qty, split, category, opts, taxRate, exempt, price, tax, tip, bill, share: bill / split };
}

// Conversion inverse : prix unitaire maximal pour que ma part fasse `share` dollars.
function unitForShare(share, base, taxes) {
  const factor = (taxRate) => {
    const t = base.opts.tax ? taxRate : 0;
    const tipF = base.opts.tip ? base.opts.tipPct * (base.opts.tipBasis === 'post' ? 1 + t : 1) : 0;
    return 1 + t + tipF;
  };
  const bill = share * base.split;
  let unit = bill / factor(taxes.salesTax.rate) / base.qty;
  if (base.category === 'clothes') {
    const exemptUnit = bill / factor(taxes.clothing.rate) / base.qty;
    if (exemptUnit < taxes.clothing.threshold) unit = exemptUnit;
  }
  return Math.floor(unit * 100 + 1e-6) / 100;
}

function readOptions() {
  return {
    tax: $('opt-tax').checked,
    tip: $('opt-tip').checked,
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
  const amount = parsePrice($('price').value);
  let unit = amount;
  if (state.direction === 'eur') {
    const rate = effRate();
    unit = rate && amount ? unitForShare(amount / rate, base, state.taxes) : 0;
  }
  return { ...compute({ unit, ...base }, state.taxes), amount };
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
  const reverse = state.direction === 'eur';
  const fee = state.settings.fee;

  $('clothing-note').hidden = state.category !== 'clothes';
  $('tip-panel').hidden = !it.opts.tip;
  $('price-label').textContent = reverse ? 'Mon budget' : 'Prix affiché';
  $('price-prefix').textContent = reverse ? '€' : '$';
  $('stepper-label').textContent = food ? 'Personnes' : 'Quantité';
  $('step-value').textContent = food ? state.split : state.qty;
  $('step-minus').disabled = (food ? state.split : state.qty) <= 1;

  if (reverse) {
    $('hero-label').textContent = it.qty > 1 ? 'Prix étiquette max par article' : 'Prix étiquette max';
    animateValue($('total-main'), it.unit, (v) => usd.format(v));
    $('total-sub').textContent = it.amount ? `pour ${eur.format(it.amount)} tout compris` : 'Saisissez votre budget en euros';
  } else {
    $('hero-label').textContent = it.split > 1 ? 'Votre part' : 'Vous payez';
    showEur($('total-main'), it.share);
    $('total-sub').textContent = it.split > 1
      ? `Votre part : ${usd.format(it.share)} · addition ${usd.format(it.bill)}`
      : `Total : ${usd.format(it.bill)}`;
  }

  $('b-price-label').textContent = it.qty > 1 ? `Prix (${it.qty} × ${usd.format(it.unit)})` : 'Prix';
  $('b-price').textContent = usd.format(it.price);
  $('b-tax-row').hidden = !it.opts.tax;
  $('b-tax').textContent = it.exempt && it.price > 0 ? 'exonéré' : `${usd.format(it.tax)} (${pct(it.taxRate)})`;
  $('b-tip-row').hidden = !it.opts.tip;
  $('b-tip').textContent = `${usd.format(it.tip)} (${pct(it.opts.tipPct)})`;
  $('b-split-row').hidden = it.split <= 1;
  $('b-split').textContent = `÷ ${it.split} = ${usd.format(it.share)} chacun`;
  $('b-fee-row').hidden = !(fee > 0 && state.fx);
  if (state.fx) $('b-fee').textContent = `${eur.format(it.share * state.fx.rate * fee / 100)} (${pct(fee / 100)})`;

  store.set('prefs', { ...it.opts, category: state.category });
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

function setCategory(id) {
  const was = state.category;
  if (id === was) return;
  state.category = id;
  // Au resto, le pourboire est la règle ; on le retire en quittant la catégorie.
  if (id === 'food') $('opt-tip').checked = true;
  else if (was === 'food') $('opt-tip').checked = false;
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
  if (!fx) {
    $('rate-info').textContent = 'Taux indisponible — connectez-vous à Internet une première fois.';
    return;
  }
  const rate = fx.rate.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
  const date = new Date(fx.date + 'T12:00:00').toLocaleDateString('fr-FR');
  const fee = state.settings.fee ? ` · frais ${pct(state.settings.fee / 100)}` : '';
  $('rate-info').textContent = `1 $ = ${rate} € · ${date}${fee}${offline ? ' · hors ligne' : ''}`;
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
  const lines = [`🗽 ${cart.name ? `Panier « ${cart.name} »` : 'Mon panier'} — Prix NY`, ''];
  cart.items.forEach((it, i) => {
    const c = catOf(it.category);
    const qty = it.qty > 1 ? ` ×${it.qty}` : '';
    const split = it.split > 1 ? ` (ma part sur ${it.split})` : '';
    lines.push(`${i + 1}. ${c.emoji} ${it.name || `Article ${i + 1}`}${qty}${split} : ${usd.format(it.share)}${toE(it.share)}`);
  });
  const t = cartTotals(cart.items);
  lines.push('', `Total : ${usd.format(t.share)}${toE(t.share)}`);
  if (state.fx) {
    const r = state.fx.rate.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
    const fee = state.settings.fee ? `, frais bancaires ${pct(state.settings.fee / 100)}` : '';
    lines.push(`Taux : 1 $ = ${r} € (${new Date(state.fx.date + 'T12:00:00').toLocaleDateString('fr-FR')}${fee})`);
  }
  return lines.join('\n');
}

async function shareCart() {
  if (!cart.items.length) return;
  const text = cartText();
  const title = cart.name || 'Mon panier Prix NY';
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
  if (it.unit != null) return it;
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
  const rate = effRate();

  $('cart-count').textContent = n;
  $('cart-name').textContent = cart.name || 'Panier';
  $('cart-sub').textContent = n ? plural(n, 'article') : 'vide';
  showEur($('cart-eur'), t.share);
  $('cart-usd').textContent = usd.format(t.share);
  $('cart-open').classList.toggle('empty-cart', !n);

  // Budget
  const budget = state.settings.budget;
  const spent = rate ? t.share * rate : null;
  const hasBudget = budget > 0 && spent != null;
  $('gauge').hidden = !hasBudget;
  $('cv-budget').hidden = !hasBudget;
  if (hasBudget) {
    const ratio = spent / budget;
    $('gauge-fill').style.width = `${Math.min(100, ratio * 100)}%`;
    $('gauge').className = `gauge${ratio > 1 ? ' over' : ratio >= 0.8 ? ' warn' : ''}`;
    $('cv-budget').textContent = ratio > 1
      ? `Budget ${eur.format(budget)} · dépassé de ${eur.format(spent - budget)}`
      : `Budget ${eur.format(budget)} · reste ${eur.format(budget - spent)}`;
    $('cv-budget').classList.toggle('over', ratio > 1);
  }

  $('cart-title').textContent = cart.name || 'Panier';
  showEur($('cv-eur'), t.share);
  $('cv-usd').textContent = usd.format(t.share);
  const detail = [`Prix ${usd.format(t.price)}`];
  if (t.tax) detail.push(`taxes ${usd.format(t.tax)}`);
  if (t.tip) detail.push(`pourboires ${usd.format(t.tip)}`);
  if (state.settings.fee && rate) detail.push(`frais ${eur.format(t.share * state.fx.rate * state.settings.fee / 100)}`);
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
  const it = currentItem();
  if (!(it.unit > 0)) {
    if (keypadOpen()) haptic('warning');
    else $('price').focus();
    toast(state.direction === 'eur' ? 'Saisissez d’abord votre budget' : 'Saisissez d’abord un prix');
    return;
  }
  const { amount, ...item } = it;
  const id = uid();
  cart.items.push({ id, name: '', ...item });
  const n = cart.items.length;
  $('price').value = '';
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
  toast(`Article ${n} ajouté au panier`, 'Annuler', () => {
    cart.items = cart.items.filter((x) => x.id !== id);
    saveCart();
  });
}

function resetAll() {
  const before = { cart: clone(cart), price: $('price').value };
  if (!before.cart.items.length && !before.price) return;
  cart = { id: null, name: null, items: [] };
  $('price').value = '';
  saveCart();
  render();
  haptic('medium');
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

function initSettings() {
  const s = store.get('settings');
  if (s) state.settings = { ...state.settings, ...s };
  $('set-fee').value = state.settings.fee ? String(state.settings.fee).replace('.', ',') : '';
  $('set-budget').value = state.settings.budget ? String(state.settings.budget).replace('.', ',') : '';
  renderFeePresets();
  $('set-fee').addEventListener('input', () => {
    state.settings.fee = Math.min(10, parsePrice($('set-fee').value));
    renderFeePresets();
    applySettings();
  });
  $('set-budget').addEventListener('input', () => {
    const b = parsePrice($('set-budget').value);
    state.settings.budget = b > 0 ? b : null;
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
    if (e.target.closest('#keypad, #price, .stepper, .categories, .segmented, .chips, .check, #add-btn, #scan-btn, .toast, #cart-open, #settings-open')) return;
    history.back();
  });
}

// --- Écrans et notifications ------------------------------------------------

// Chaque écran ouvert ajoute une entrée d'historique : le bouton retour d'Android le referme.
const openViews = [];

function openView(id, lockScroll = true) {
  // Le pavé numérique cède sa place : on réutilise son entrée d'historique.
  const replace = openViews.at(-1)?.id === 'keypad';
  if (replace) {
    openViews.pop();
    $('keypad').hidden = true;
    document.body.classList.remove('kp-open');
    $('price').blur();
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
    if (v.id === 'keypad') {
      document.body.classList.remove('kp-open');
      $('price').blur();
    }
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

// --- Démarrage animé --------------------------------------------------------

function runSplash() {
  const s = $('splash');
  let seen = false;
  try { seen = sessionStorage.getItem('splash') === '1'; sessionStorage.setItem('splash', '1'); } catch { /* ignore */ }
  if (REDUCED_MOTION || seen) { s.remove(); return; }
  s.classList.add('play');
  const done = () => {
    if (!s.isConnected || s.classList.contains('out')) return;
    s.classList.add('out');
    setTimeout(() => s.remove(), 420);
  };
  setTimeout(done, 2100);
  s.addEventListener('click', done);
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
  document.querySelector('input[name="direction"][value="usd"]').checked = true;
  state.direction = 'usd';
  $('price').value = p.toFixed(2).replace('.', ',');
  closeScanner();
  render();
  haptic('success');
}

// --- Démarrage ------------------------------------------------------------

function init() {
  runSplash();
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
  renderTaxInfo();
  renderCategories();
  if (state.fx) renderRateInfo(false);

  $('price').addEventListener('input', render);
  $('price').addEventListener('keydown', (e) => { if (e.key === 'Enter') addToCart(); });
  document.querySelectorAll('#opt-tax, #opt-tip, input[name="tip-basis"]')
    .forEach((el) => el.addEventListener('change', () => { render(); haptic(); }));
  document.querySelectorAll('input[name="direction"]').forEach((el) => el.addEventListener('change', () => {
    state.direction = el.value;
    $('price').value = '';
    render();
    haptic();
  }));
  $('step-minus').addEventListener('click', () => step(-1));
  $('step-plus').addEventListener('click', () => step(1));
  $('refresh-btn').addEventListener('click', () => { loadRate(); loadTaxes(); });
  $('scan-btn').addEventListener('click', openScanner);
  $('scan-close').addEventListener('click', closeScanner);
  $('scan-capture').addEventListener('click', capture);
  initKeypad();

  cart = store.get('cart') || cart;
  cart.items = cart.items.map(migrateItem);
  saved = (store.get('savedCarts') || []).map((s) => ({ ...s, items: s.items.map(migrateItem) }));
  $('add-btn').addEventListener('click', (e) => addToCart(e.currentTarget));
  $('reset-btn').addEventListener('click', resetAll);
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
