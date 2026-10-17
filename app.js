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
  try {
    const t = await fetchJson('taxes.json');
    if (typeof t?.salesTax?.rate !== 'number') throw new Error('taxes.json invalide');
    state.taxes = { ...DEFAULT_TAXES, ...t };
    store.set('taxes', state.taxes);
  } catch {
    state.taxes = store.get('taxes') || DEFAULT_TAXES;
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
      return;
    } catch { /* on essaie la source suivante */ }
  }
  state.fx = store.get('fx');
  renderRateInfo(true);
  render();
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

  render();
  loadTaxes();
  loadRate();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
