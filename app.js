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
// Lecture d'étiquettes (OCR) : fichiers embarqués dans l'appli (hors ligne), CDN en secours.
const OCR_LOCAL = 'vendor/tesseract/';
const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

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
  { id: 'transport', label: 'Transport', emoji: '🚕', color: '#5b9cf0' },
  { id: 'other', label: 'Autre', emoji: '✨', color: '#7a8499' },
];
// Resto et Transport : pourboire possible et partage entre plusieurs personnes (une seule addition).
const isShared = (id) => id === 'food' || id === 'transport';
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
  // adaptive : couleurs selon la photo ; frost : intensité du givré (0 aucun → 100 fort)
  // clock : deuxième horloge du bandeau (ville et fuseau horaire)
  settings: { fee: 0, rate: null, sound: true, voiceLang: 'fr-FR', wallpaper: 'random', wpInterval: 'launch', adaptive: true, frost: 75, clock: { label: 'Paris', tz: 'Europe/Paris' }, frostScale: 2 },
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
  // Transport : le prix affiché (compteur du taxi, appli VTC, ticket) inclut déjà taxes et suppléments.
  const taxRate = !opts.tax || category === 'transport' ? 0 : (exempt ? exemptRate : taxes.salesTax.rate);
  const price = unit * qty;
  const tax = price * taxRate;
  const tip = opts.tip ? (opts.tipBasis === 'post' ? price + tax : price) * opts.tipPct : 0;
  const bill = price + tax + tip;
  return { unit, qty, split, category, opts, taxRate, exempt, price, tax, tip, bill, share: bill / split };
}

function readOptions() {
  return {
    tax: $('opt-tax').checked,
    tip: isShared(state.category) && $('opt-tip').checked, // pourboire : Resto et Transport uniquement
    tipPct: state.tipPct,
    tipBasis: document.querySelector('input[name="tip-basis"]:checked').value,
  };
}

function currentItem() {
  const food = isShared(state.category);
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
  const food = isShared(state.category);
  const fee = state.settings.fee;

  $('tip-card').hidden = !food;
  renderCatInfo(it);
  $('tip-panel').classList.toggle('off', !it.opts.tip);
  // Transport : pas de taxe ajoutée, la base de calcul est sans objet ; le titre passe au-dessus des taux.
  $('tip-panel').hidden = state.category === 'transport';
  $('tip-card').classList.toggle('no-basis', state.category === 'transport');
  $('tip-choices').querySelectorAll('.chip').forEach((b) => {
    const c = Number(b.dataset.pct);
    b.setAttribute('aria-checked', String(it.opts.tip ? c === it.opts.tipPct : c === 0));
  });
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
  $('b-tax').textContent = it.category === 'transport' ? 'incluse dans le prix'
    : it.exempt && it.price > 0 ? 'exonéré' : `${usd.format(it.tax)} (${pct(it.taxRate)})`;
  $('b-tip-row').hidden = !it.opts.tip;
  $('b-tip').textContent = `${usd.format(it.tip)} (${pct(it.opts.tipPct)})`;
  $('b-split-row').hidden = it.split <= 1;
  $('b-split').textContent = `÷ ${it.split} = ${usd.format(it.share)} chacun`;
  $('b-fee-row').hidden = !(fee > 0 && baseRate());
  if (baseRate()) $('b-fee').textContent = `${eur.format(it.share * baseRate() * fee / 100)} (${pct(fee / 100)})`;

  store.set('prefs', { ...it.opts, tip: $('opt-tip').checked, category: state.category });
}

// Détail du calcul (prix, taxe, pourboire, frais) replié sous le total ; le choix est mémorisé.
function setDetail(open) {
  $('breakdown').hidden = !open;
  $('detail-btn').setAttribute('aria-expanded', String(open));
  store.set('detailOpen', open);
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
  transport: {
    short: () => 'Taxes incluses · métro sans pourboire',
    title: 'Transport',
    body: () => [
      'Aucune taxe n’est ajoutée : le prix affiché est le prix final.',
      'Métro et bus : 3 $ le trajet en payant sans contact (OMNY), sans pourboire. Au-delà d’environ 35 $ dans la semaine, les trajets sont gratuits.',
      'Taxi jaune : le compteur inclut déjà les suppléments (MTA, embouteillage au sud de la 60ᵉ rue…). Pourboire d’usage : 15 à 20 %, proposé sur l’écran de paiement.',
      'Uber, Lyft : le prix de l’appli comprend la sales tax, le Black Car Fund et les suppléments. Pourboire facultatif de 15 à 20 %, donné dans l’appli.',
      'Ferry, Citi Bike : prix fixe, sans pourboire.',
      'Le pourboire de 20 % est proposé par défaut, comme pour un taxi : choisissez « Aucun » pour le métro, le bus ou le ferry. Réglez « Personnes » pour partager la course.',
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
  // Resto et taxi : le pourboire est la règle (« Aucun » à choisir pour le métro).
  if (isShared(id)) $('opt-tip').checked = true;
  renderCategories();
  render();
  haptic();
}

function step(delta) {
  if (isShared(state.category)) state.split = Math.min(20, Math.max(1, state.split + delta));
  else state.qty = Math.min(99, Math.max(1, state.qty + delta));
  render();
  haptic();
}

// Titre du bandeau : la plus grande taille (40 px max) qui tient sur une ligne entre le logo et le bouton Réglages.
function fitTitle() {
  const el = document.querySelector('.mast-title');
  if (!el) return;
  el.style.fontSize = '40px';
  const ratio = el.clientWidth / el.scrollWidth;
  if (ratio < 1) el.style.fontSize = `${Math.floor(40 * ratio * 0.97 * 10) / 10}px`;
}

// Date du jour pour la ligne d'édition du bandeau, façon une de journal.
function renderEditionDate() {
  $('mast-date').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// --- Horloges du bandeau : New York et une ville au choix ---------------------

const NY_TZ = 'America/New_York';
// Noms français et villes sans fuseau propre ; les autres villes sont cherchées dans les fuseaux du navigateur.
const CITY_ALIASES = [
  ['Paris', 'Europe/Paris'], ['Lyon', 'Europe/Paris'], ['Marseille', 'Europe/Paris'], ['Toulouse', 'Europe/Paris'],
  ['Nice', 'Europe/Paris'], ['Nantes', 'Europe/Paris'], ['Bordeaux', 'Europe/Paris'], ['Lille', 'Europe/Paris'],
  ['Strasbourg', 'Europe/Paris'], ['Montpellier', 'Europe/Paris'], ['Rennes', 'Europe/Paris'], ['Grenoble', 'Europe/Paris'],
  ['Ajaccio', 'Europe/Paris'], ['Londres', 'Europe/London'], ['Bruxelles', 'Europe/Brussels'], ['Genève', 'Europe/Zurich'],
  ['Lausanne', 'Europe/Zurich'], ['Zurich', 'Europe/Zurich'], ['Luxembourg', 'Europe/Luxembourg'], ['Monaco', 'Europe/Monaco'],
  ['Berlin', 'Europe/Berlin'], ['Munich', 'Europe/Berlin'], ['Rome', 'Europe/Rome'], ['Milan', 'Europe/Rome'],
  ['Madrid', 'Europe/Madrid'], ['Barcelone', 'Europe/Madrid'], ['Lisbonne', 'Europe/Lisbon'], ['Amsterdam', 'Europe/Amsterdam'],
  ['Vienne', 'Europe/Vienna'], ['Varsovie', 'Europe/Warsaw'], ['Prague', 'Europe/Prague'], ['Athènes', 'Europe/Athens'],
  ['Moscou', 'Europe/Moscow'], ['Istanbul', 'Europe/Istanbul'], ['Dublin', 'Europe/Dublin'], ['Copenhague', 'Europe/Copenhagen'],
  ['Montréal', 'America/Toronto'], ['Québec', 'America/Toronto'], ['Toronto', 'America/Toronto'], ['Washington', 'America/New_York'],
  ['Boston', 'America/New_York'], ['Miami', 'America/New_York'], ['Chicago', 'America/Chicago'], ['Los Angeles', 'America/Los_Angeles'],
  ['San Francisco', 'America/Los_Angeles'], ['Las Vegas', 'America/Los_Angeles'], ['Mexico', 'America/Mexico_City'],
  ['Rio de Janeiro', 'America/Sao_Paulo'], ['São Paulo', 'America/Sao_Paulo'], ['Buenos Aires', 'America/Argentina/Buenos_Aires'],
  ['Alger', 'Africa/Algiers'], ['Casablanca', 'Africa/Casablanca'], ['Tunis', 'Africa/Tunis'], ['Dakar', 'Africa/Dakar'],
  ['Abidjan', 'Africa/Abidjan'], ['Le Caire', 'Africa/Cairo'], ['Dubaï', 'Asia/Dubai'], ['Pékin', 'Asia/Shanghai'],
  ['Shanghai', 'Asia/Shanghai'], ['Hong Kong', 'Asia/Hong_Kong'], ['Tokyo', 'Asia/Tokyo'], ['Séoul', 'Asia/Seoul'],
  ['Singapour', 'Asia/Singapore'], ['Bangkok', 'Asia/Bangkok'], ['New Delhi', 'Asia/Kolkata'], ['Bombay', 'Asia/Kolkata'],
  ['Sydney', 'Australia/Sydney'], ['Melbourne', 'Australia/Melbourne'], ['La Réunion', 'Indian/Reunion'],
  ['Saint-Denis (Réunion)', 'Indian/Reunion'], ['Mayotte', 'Indian/Mayotte'], ['Martinique', 'America/Martinique'],
  ['Fort-de-France', 'America/Martinique'], ['Guadeloupe', 'America/Guadeloupe'], ['Pointe-à-Pitre', 'America/Guadeloupe'],
  ['Cayenne', 'America/Cayenne'], ['Tahiti', 'Pacific/Tahiti'], ['Papeete', 'Pacific/Tahiti'], ['Nouméa', 'Pacific/Noumea'],
];
const normCity = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_'’]/g, ' ').replace(/\s+/g, ' ').trim();
let cityIndex = null;

function cities() {
  if (cityIndex) return cityIndex;
  const seen = new Set();
  cityIndex = [];
  const add = (label, tz) => {
    const key = normCity(label);
    if (seen.has(key)) return;
    seen.add(key);
    cityIndex.push({ label, tz, key });
  };
  for (const [label, tz] of CITY_ALIASES) add(label, tz);
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* navigateur ancien : alias seuls */ }
  for (const tz of zones) {
    const city = tz.split('/').pop();
    if (/^(GMT|UTC|Etc)/.test(city)) continue;
    add(city.replace(/_/g, ' '), tz);
  }
  return cityIndex;
}

function findCities(text, max = 5) {
  const q = normCity(text);
  if (q.length < 2) return [];
  const all = cities();
  const starts = all.filter((c) => c.key.startsWith(q));
  const inside = all.filter((c) => !c.key.startsWith(q) && c.key.includes(q));
  return [...starts, ...inside].slice(0, max);
}

// Décalage en minutes d'un fuseau par rapport à UTC, à l'instant d.
function tzOffset(tz, d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(d / 60000) * 60000) / 60000);
}

function renderClocks() {
  const now = new Date();
  const time = (tz) => now.toLocaleTimeString('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const { label, tz } = state.settings.clock;
  $('clock-ny').textContent = `New York ${time(NY_TZ)}`;
  if (tz === NY_TZ) { $('clock-home').textContent = ''; return; }
  const diff = (tzOffset(tz, now) - tzOffset(NY_TZ, now)) / 60;
  const sign = diff >= 0 ? '+' : '−';
  const h = Math.abs(diff).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  $('clock-home').textContent = `${label} ${time(tz)} · ${diff ? `${sign}${h} h` : 'même heure'}`;
}

function startClocks() {
  renderClocks();
  // Recalée sur le début de chaque minute.
  setTimeout(() => { renderClocks(); setInterval(renderClocks, 60000); }, 60000 - (Date.now() % 60000) + 50);
}

function setClockCity(c) {
  state.settings.clock = { label: c.label, tz: c.tz };
  store.set('settings', state.settings);
  $('set-city').value = c.label;
  $('city-suggest').replaceChildren();
  $('city-note').textContent = `Heure de ${c.label} affichée sous le titre, à côté de celle de New York.`;
  renderClocks();
}

// Ville dictée : la première transcription qui correspond à une ville connue.
async function cityByVoice() {
  const matches = await listen({ btn: $('city-voice'), prompt: 'Dites une ville', lang: 'fr-FR' });
  if (!matches) return;
  for (const m of matches) {
    const q = normCity(m);
    const c = cities().find((x) => x.key === q) || findCities(m, 1)[0];
    if (c) { setClockCity(c); haptic('success'); return; }
  }
  haptic('warning');
  $('city-note').textContent = matches.length ? `« ${matches[0]} » introuvable : essayez une grande ville du même fuseau horaire.` : 'Pas compris, réessayez.';
}

// Ville de l'endroit où l'on se trouve : fuseau du téléphone (réglé par le réseau), nom de la ville
// par géolocalisation (BigDataCloud, sans clé), ou à défaut celui du fuseau.
async function cityByLocation() {
  const btn = $('city-locate');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fromTz = cities().find((c) => c.tz === tz && CITY_ALIASES.some(([, z]) => z === tz)) || cities().find((c) => c.tz === tz);
  btn.classList.add('busy');
  $('city-note').textContent = 'Localisation…';
  try {
    const pos = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('indisponible')); return; }
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 15000, maximumAge: 3600000 });
    });
    const { latitude, longitude } = pos.coords;
    const geo = await fetchJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=fr`);
    const name = geo.city || geo.locality;
    if (!name) throw new Error('ville inconnue');
    const known = cities().find((c) => c.key === normCity(name));
    setClockCity({ label: name, tz: known?.tz || tz });
    haptic('success');
  } catch (e) {
    if (e?.code === 1) { // PERMISSION_DENIED
      $('city-note').textContent = 'Localisation refusée : autorisez-la pour l’appli dans les réglages du téléphone, ou tapez la ville.';
      haptic('warning');
    } else if (fromTz) {
      setClockCity(fromTz); // hors ligne ou sans GPS : la ville du fuseau du téléphone
    } else {
      $('city-note').textContent = 'Position introuvable : tapez la ville.';
    }
  } finally {
    btn.classList.remove('busy');
  }
}

function initClockSetting() {
  $('city-voice').addEventListener('click', cityByVoice);
  $('city-locate').addEventListener('click', cityByLocation);
  const input = $('set-city');
  const box = $('city-suggest');
  input.value = state.settings.clock.label;
  // Aide avec les mêmes icônes que les boutons micro et position.
  const icon = (id) => {
    const i = $(id).querySelector('svg').cloneNode(true);
    i.classList.add('inline-icon');
    return i;
  };
  $('city-note').replaceChildren(
    'Tapez une ville (Paris, Montréal, Genève, Tokyo…), dites-la avec ', icon('city-voice'),
    ' ou touchez ', icon('city-locate'), ' pour celle où vous êtes : son heure s’affiche sous le titre, à côté de celle de New York.',
  );
  // Champ vidé au toucher (ville actuelle en indication) pour taper directement la nouvelle.
  input.addEventListener('focus', () => { input.placeholder = state.settings.clock.label; input.value = ''; });
  input.addEventListener('input', () => {
    box.replaceChildren();
    for (const c of findCities(input.value)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = c.label;
      b.addEventListener('click', () => { setClockCity(c); haptic(); });
      box.append(b);
    }
  });
  // Validation en quittant le champ (après un éventuel toucher sur une suggestion).
  input.addEventListener('blur', () => setTimeout(() => {
    if (input.value === state.settings.clock.label) { box.replaceChildren(); return; }
    const q = normCity(input.value);
    if (!q) { input.value = state.settings.clock.label; return; } // rien tapé : on garde la ville
    const exact = cities().find((c) => c.key === q) || findCities(input.value, 1)[0];
    if (exact) setClockCity(exact);
    else $('city-note').textContent = `« ${input.value} » introuvable : essayez une grande ville du même fuseau horaire.`;
  }, 250));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
}

// Taux affiché dans la ligne d'édition du bandeau (court) ; le détail complet en infobulle.
function renderRateInfo(offline) {
  const fx = state.fx;
  const el = $('rate-info');
  renderRateChecked();
  // Court dans le bandeau (« +2 % »), en toutes lettres dans l'infobulle.
  const feeShort = state.settings.fee ? ` · +${pct(state.settings.fee / 100)}` : '';
  const fee = state.settings.fee ? ` · frais bancaires ${pct(state.settings.fee / 100)}` : '';
  renderRateSetting();
  if (state.settings.rate) {
    const r = state.settings.rate.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
    el.textContent = `1 $ = ${r} € · perso${feeShort}`;
    el.title = `Taux personnalisé : 1 $ = ${r} €${fee}`;
    return;
  }
  if (!fx) {
    el.textContent = 'Taux indisponible';
    el.title = 'Connectez-vous à Internet une première fois pour obtenir le taux de change.';
    return;
  }
  const rate = fx.rate.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
  const d = new Date(fx.date + 'T12:00:00');
  el.textContent = `1 $ = ${rate} € · ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}${feeShort}${offline ? ' · hors ligne' : ''}`;
  el.title = `Taux de référence ${fx.source} du ${d.toLocaleDateString('fr-FR')}${fee}${offline ? ' (hors ligne)' : ''}`;
}

function renderTaxInfo() {
  const t = state.taxes;
  $('tax-rate-label').textContent = pct(t.salesTax.rate);
  $('clothing-threshold').textContent = t.clothing.threshold;

  const box = $('tip-choices');
  box.replaceChildren();
  if (!t.tip.choices.includes(state.tipPct)) state.tipPct = t.tip.default;
  // « Aucun » (0) remplace l'ancienne case à cocher du pourboire.
  for (const c of [0, ...t.tip.choices]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.pct = c;
    b.setAttribute('role', 'radio');
    b.textContent = c ? pct(c) : 'Aucun';
    b.addEventListener('click', () => {
      $('opt-tip').checked = c > 0;
      if (c) state.tipPct = c;
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

// Renvoie 'new' (cours plus récent), 'same' (déjà le dernier publié) ou 'offline'.
async function loadRate() {
  const before = state.fx?.date;
  for (const src of RATE_SOURCES) {
    try {
      const fx = { ...src.parse(await fetchJson(src.url)), checkedAt: Date.now() };
      if (!(fx.rate > 0)) throw new Error('taux invalide');
      state.fx = fx;
      store.set('fx', fx);
      renderRateInfo(false);
      renderAll();
      return before && fx.date <= before ? 'same' : 'new';
    } catch { /* on essaie la source suivante */ }
  }
  state.fx = store.get('fx');
  renderRateInfo(true);
  renderAll();
  return 'offline';
}

const RATE_REFRESH_MS = 30 * 60 * 1000;

// Bouton « Mettre à jour le cours » des Réglages.
async function refreshRate() {
  const btn = $('rate-refresh');
  btn.disabled = true;
  btn.textContent = 'Mise à jour…';
  const result = await loadRate();
  btn.disabled = false;
  btn.textContent = '↻ Mettre à jour le cours';
  const d = state.fx ? new Date(state.fx.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '';
  if (result === 'new') { haptic('success'); toast(`Cours mis à jour : celui du ${d}`); }
  else if (result === 'same') { haptic(); toast(`Déjà le dernier cours publié (${d})`); }
  else { haptic('warning'); toast(d ? `Pas de connexion : cours du ${d} conservé` : 'Pas de connexion'); }
}

// Date du cours et heure de la dernière vérification, sous le bouton.
function renderRateChecked() {
  const fx = state.fx;
  const el = $('rate-checked');
  if (!fx) { el.textContent = 'Aucun cours enregistré.'; return; }
  const day = new Date(fx.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const checked = fx.checkedAt ? new Date(fx.checkedAt) : null;
  const when = checked
    ? ` Vérifié ${checked.toDateString() === new Date().toDateString() ? 'aujourd’hui' : `le ${checked.toLocaleDateString('fr-FR')}`} à ${checked.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`
    : '';
  el.textContent = `Cours du ${day} (${fx.source}).${when} La BCE publie un cours les jours ouvrés vers 16 h (heure de Paris) : le week-end, c’est celui du vendredi.`;
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

function cartText(c = cart) {
  const rate = effRate();
  const toE = (v) => (rate ? ` → ${eur.format(v * rate)}` : '');
  const lines = [`🗽 ${c.name ? `Panier « ${c.name} »` : 'Mon panier'} — Vrai Prix New York`, ''];
  c.items.forEach((it, i) => {
    const c = catOf(it.category);
    const qty = it.qty > 1 ? ` ×${it.qty}` : '';
    const split = it.split > 1 ? ` (ma part sur ${it.split})` : '';
    lines.push(`${i + 1}. ${c.emoji} ${it.name || `Article ${i + 1}`}${qty}${split} : ${usd.format(it.share)}${toE(it.share)}`);
  });
  const t = cartTotals(c.items);
  lines.push('', `Total : ${usd.format(t.share)}${toE(t.share)}`);
  if (baseRate()) {
    const r = baseRate().toLocaleString('fr-FR', { maximumFractionDigits: 4 });
    const when = state.settings.rate ? 'taux personnalisé' : new Date(state.fx.date + 'T12:00:00').toLocaleDateString('fr-FR');
    const fee = state.settings.fee ? `, frais bancaires ${pct(state.settings.fee / 100)}` : '';
    lines.push(`Taux : 1 $ = ${r} € (${when}${fee})`);
  }
  return lines.join('\n');
}

async function shareCart(c = cart) {
  if (!c.items.length) return;
  const text = cartText(c);
  const title = c.name || 'Mon panier Vrai Prix New York';
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
    return CATEGORIES.some((c) => c.id === it.category) ? it : { ...it, category: 'other' }; // Visites…
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

// Panier modifié sans l'ouvrir (entrée de « Mes paniers »), affiché dans #edit-view.
let editing = null;
const VIEW_IDS = {
  cart: { title: 'cart-title', summary: 'cat-summary', list: 'cart-list', empty: 'cart-empty', eur: 'cv-eur', usd: 'cv-usd', detail: 'cv-detail' },
  edit: { title: 'ev-title', summary: 'ev-summary', list: 'ev-list', empty: 'ev-empty', eur: 'ev-eur', usd: 'ev-usd', detail: 'ev-detail' },
};
const viewCart = (kind) => (kind === 'edit' ? editing : cart);

// Sauvegarde du panier affiché ; un panier enregistré modifié reste synchronisé avec le panier en cours.
function saveView(kind) {
  if (kind !== 'edit') { saveCart(); return; }
  editing.savedAt = new Date().toISOString();
  if (cart.id === editing.id) {
    cart.items = clone(editing.items);
    cart.name = editing.name;
    store.set('cart', cart);
  }
  saveSaved();
  renderCart();
}

function renderCart() {
  const n = cart.items.length;
  const t = cartTotals(cart.items);

  $('cart-count').textContent = n;
  $('cart-name').textContent = cart.name || 'Panier';
  $('cart-sub').textContent = (n ? plural(n, 'article') : 'vide') + (cart.id ? ' · enregistré' : '');
  showEur($('cart-eur'), t.share);
  $('cart-usd').textContent = usd.format(t.share);
  $('cart-open').classList.toggle('empty-cart', !n);
  $('cart-clear').disabled = !n;
  $('cart-save').disabled = !n;
  $('cart-share').disabled = !n;

  renderCartView('cart');
  if (editing) renderCartView('edit');
}

function renderCartView(kind) {
  const c = viewCart(kind);
  if (!c) return;
  const ids = VIEW_IDS[kind];
  const n = c.items.length;
  const t = cartTotals(c.items);
  const rate = effRate();

  $(ids.title).textContent = c.name || 'Panier';
  showEur($(ids.eur), t.share);
  $(ids.usd).textContent = usd.format(t.share);
  const detail = [`Prix ${usd.format(t.price)}`];
  if (t.tax) detail.push(`taxes ${usd.format(t.tax)}`);
  if (t.tip) detail.push(`pourboires ${usd.format(t.tip)}`);
  if (state.settings.fee && rate) detail.push(`frais ${eur.format(t.share * baseRate() * state.settings.fee / 100)}`);
  $(ids.detail).textContent = n ? detail.join(' · ') : '';
  $(ids.empty).hidden = n > 0;
  if (kind === 'edit') $('ev-share').disabled = !n;

  // Totaux par catégorie
  const sums = new Map();
  for (const it of c.items) sums.set(it.category, (sums.get(it.category) || 0) + it.share);
  const summary = $(ids.summary);
  summary.replaceChildren();
  if (sums.size > 1) {
    for (const cat of CATEGORIES) {
      if (!sums.has(cat.id)) continue;
      const s = document.createElement('span');
      s.className = 'cat-sum';
      s.style.setProperty('--cat', cat.color);
      s.textContent = `${cat.emoji} ${cat.label} ${rate ? eur.format(sums.get(cat.id) * rate) : usd.format(sums.get(cat.id))}`;
      summary.append(s);
    }
  }

  const list = $(ids.list);
  list.replaceChildren();
  c.items.forEach((it, i) => list.append(cartItemRow(it, i, kind)));
}

function cartItemRow(it, i, kind = 'cart') {
  const c = catOf(it.category);
  const rate = effRate();
  const li = document.createElement('li');
  li.className = 'item-wrap';
  const card = document.createElement('div');
  card.className = 'item';

  // Pastille : touchée, elle permet de changer la catégorie.
  const num = document.createElement('button');
  num.type = 'button';
  num.className = 'item-num';
  num.style.setProperty('--cat', c.color);
  num.textContent = i + 1;
  num.title = `${c.label} : changer la catégorie`;
  num.setAttribute('aria-label', `Article ${i + 1}, ${c.label} : changer la catégorie`);
  num.addEventListener('click', () => chooseCategory(it, kind));

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
    if (kind === 'edit') saveView('edit'); else persistCart();
  });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
  const detail = document.createElement('span');
  detail.className = 'item-detail';
  const parts = [`${c.emoji} ${usd.format(it.price)}`];
  if (it.tax) parts.push(`taxe ${usd.format(it.tax)}`);
  else if (it.category === 'transport') parts.push('taxes incluses');
  else if (it.opts.tax) parts.push('exonéré');
  if (it.tip) parts.push(`pourboire ${usd.format(it.tip)}`);
  if (it.split > 1) parts.push(`÷ ${it.split}`);
  detail.textContent = parts.join(' + ').replace(' + ÷', ' ÷');
  main.append(name, detail);

  if (!isShared(it.category)) {
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
      saveView(kind);
      haptic();
    };
    minus.addEventListener('click', () => change(-1));
    plus.addEventListener('click', () => change(1));
    qty.append(minus, val, plus);
    main.append(qty);
  }

  // Montant : touché, il permet de modifier le prix.
  const amt = document.createElement('button');
  amt.type = 'button';
  amt.className = 'item-amt';
  amt.setAttribute('aria-label', `Modifier le prix de l'article ${i + 1}`);
  const e = document.createElement('b');
  e.textContent = rate ? eur.format(it.share * rate) : '— €';
  const u = document.createElement('span');
  u.textContent = usd.format(it.share);
  amt.append(e, u);
  amt.addEventListener('click', () => editPrice(it, kind));

  card.append(num, main, amt);
  li.append(card);
  enableSwipe(li, card, () => {
    const before = clone(viewCart(kind).items);
    viewCart(kind).items.splice(i, 1);
    saveView(kind);
    haptic('medium');
    toast(`${it.name || `Article ${i + 1}`} supprimé`, 'Annuler', () => {
      if (!viewCart(kind)) return;
      viewCart(kind).items = before;
      saveView(kind);
    });
  });
  return li;
}

// --- Modifications d'articles et de paniers --------------------------------------

// Fenêtre de saisie générique ; renvoie la valeur saisie, ou null si annulé.
function askValue({ title, label, value = '', ok = 'Valider', numeric = false }) {
  const dlg = $('ask-dialog');
  const input = $('ask-input');
  $('ask-title').textContent = title;
  $('ask-label').textContent = label;
  $('ask-ok').textContent = ok;
  input.value = value;
  input.inputMode = numeric ? 'decimal' : 'none';
  input.maxLength = numeric ? 10 : 40;
  if (numeric) input.removeAttribute('data-kbd'); else input.dataset.kbd = '';
  dlg.returnValue = '';
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const v = input.value.trim();
      resolve(dlg.returnValue === 'ok' && v ? v : null);
    }, { once: true });
    dlg.showModal();
    input.select();
  });
}

async function editPrice(it, kind) {
  const v = await askValue({
    title: 'Modifier le prix',
    label: it.qty > 1 ? 'Prix affiché en $, par article' : (it.category === 'food' ? 'Montant de l’addition en $ (hors taxe)' : 'Prix affiché en $'),
    value: it.unit.toFixed(2).replace('.', ','),
    numeric: true,
  });
  const price = v == null ? 0 : parsePrice(v);
  if (!(price > 0) || price === it.unit) return;
  const before = clone(it);
  Object.assign(it, compute({ ...it, unit: price }, state.taxes));
  saveView(kind);
  haptic('success');
  toast(`Prix modifié : ${usd.format(price)}`, 'Annuler', () => { Object.assign(it, before); saveView(kind); });
}

// Nouvelle catégorie : taxe, pourboire et partage recalculés.
function recategorize(it, id) {
  const opts = { ...it.opts };
  let { unit, qty, split } = it;
  if (isShared(id) && !isShared(it.category)) {
    unit *= qty; // une seule addition (resto) ou course (transport)
    qty = 1;
    opts.tip = true;
    opts.tipPct = state.taxes.tip.default;
    opts.tipBasis = 'pre';
  }
  if (!isShared(id)) {
    opts.tip = false;
    split = 1;
  }
  Object.assign(it, compute({ unit, qty, split, category: id, opts }, state.taxes));
}

function chooseCategory(it, kind) {
  const dlg = $('cat-dialog');
  const box = $('cat-choices');
  box.replaceChildren();
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat';
    b.style.setProperty('--cat', c.color);
    b.setAttribute('aria-checked', String(c.id === it.category));
    b.textContent = `${c.emoji} ${c.label}`;
    b.addEventListener('click', () => {
      dlg.close();
      if (c.id === it.category) return;
      const before = clone(it);
      recategorize(it, c.id);
      saveView(kind);
      haptic('success');
      toast(`${it.name || 'Article'} → ${c.label}`, 'Annuler', () => { Object.assign(it, before); saveView(kind); });
    });
    box.append(b);
  }
  dlg.showModal();
}

async function renameCart(kind) {
  const c = viewCart(kind);
  const v = await askValue({ title: 'Renommer le panier', label: 'Nom du panier', value: c.name || '' });
  if (v == null || v === c.name) return;
  c.name = v;
  if (kind === 'edit') saveView('edit');
  else saveCart();
  haptic('success');
  toast(`Panier renommé « ${v} »`);
}

function renameSaved(s) {
  askValue({ title: 'Renommer le panier', label: 'Nom du panier', value: s.name }).then((v) => {
    if (v == null || v === s.name) return;
    s.name = v;
    if (cart.id === s.id) { cart.name = v; store.set('cart', cart); }
    saveSaved();
    renderCart();
    haptic('success');
    toast(`Panier renommé « ${v} »`);
  });
}

function duplicateSaved(s) {
  const copy = {
    id: uid(),
    name: `${s.name} (copie)`,
    savedAt: new Date().toISOString(),
    items: s.items.map((it) => ({ ...clone(it), id: uid() })),
  };
  saved.splice(saved.indexOf(s) + 1, 0, copy);
  saveSaved();
  haptic('success');
  toast(`« ${copy.name} » créé`, 'Annuler', () => { saved = saved.filter((x) => x.id !== copy.id); saveSaved(); });
}

function deleteSaved(s) {
  const before = clone(saved);
  saved = saved.filter((x) => x.id !== s.id);
  if (cart.id === s.id) { cart.id = null; saveCart(); }
  saveSaved();
  haptic('medium');
  toast(`« ${s.name} » supprimé`, 'Annuler', () => { saved = before; saveSaved(); });
}

function editSaved(s) {
  editing = s;
  renderCartView('edit');
  openView('edit-view');
}

function savedMenu(s) {
  const dlg = $('menu-dialog');
  $('menu-title').textContent = s.name;
  dlg.returnValue = '';
  dlg.addEventListener('close', () => {
    const actions = {
      open: () => loadSaved(s),
      edit: () => editSaved(s),
      rename: () => renameSaved(s),
      duplicate: () => duplicateSaved(s),
      delete: () => deleteSaved(s),
    };
    actions[dlg.returnValue]?.();
  }, { once: true });
  dlg.showModal();
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
    open.addEventListener('contextmenu', (e) => { e.preventDefault(); haptic('medium'); savedMenu(s); }); // appui long
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'saved-more';
    more.textContent = '⋯';
    more.setAttribute('aria-label', `Actions pour le panier ${s.name}`);
    more.addEventListener('click', () => savedMenu(s));
    card.append(open, more);
    li.append(card);
    enableSwipe(li, card, () => deleteSaved(s));
    list.append(li);
  }
}

function loadSaved(s, back = true) {
  const before = clone(cart);
  cart = { id: s.id, name: s.name, items: clone(s.items) };
  saveCart();
  if (back) history.back(); // retour au panier
  toast(`Panier « ${s.name} » ouvert`, before.items.length ? 'Annuler' : null, () => { cart = before; saveCart(); });
}

// --- Sauvegarde : export et import des paniers ------------------------------------

const BACKUP_APP = 'vrai-prix-ny';

function backupData() {
  return { app: BACKUP_APP, version: 1, exportedAt: new Date().toISOString(), current: cart, saved };
}

async function exportCarts() {
  const data = backupData();
  const n = saved.length + (cart.items.length && !cart.id ? 1 : 0);
  if (!n) { toast('Aucun panier à exporter'); return; }
  const text = JSON.stringify(data);
  const file = `vrai-prix-ny-${data.exportedAt.slice(0, 10)}.json`;
  try {
    if (IS_NATIVE) {
      // Menu de partage d'Android : Drive, e-mail, messagerie…
      await window.Capacitor.nativePromise('Share', 'share', { title: file, text, dialogTitle: 'Sauvegarder les paniers' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = file;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(`Sauvegarde « ${file} » téléchargée`);
    }
    haptic('success');
  } catch (e) {
    if (/abort|cancel/i.test(`${e?.name} ${e?.message}`)) return;
    try { await navigator.clipboard.writeText(text); toast('Sauvegarde copiée dans le presse-papiers'); } catch { toast('Export impossible'); }
  }
}

// Ajoute les paniers d'une sauvegarde sans écraser l'existant ; renvoie le nombre de paniers ajoutés.
function importBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Ce texte n’est pas une sauvegarde valide'); }
  if (data?.app !== BACKUP_APP || !Array.isArray(data.saved)) throw new Error('Ce fichier n’est pas une sauvegarde Vrai Prix New York');
  const incoming = data.saved.map((s) => ({ ...s, items: (s.items || []).map(migrateItem) }));
  if (data.current?.items?.length && !data.current.id) {
    incoming.push({ id: uid(), name: data.current.name || `Panier importé du ${new Date(data.exportedAt).toLocaleDateString('fr-FR')}`, savedAt: data.exportedAt, items: data.current.items.map(migrateItem) });
  }
  const before = clone(saved);
  let added = 0;
  for (const s of incoming) {
    if (!s?.name || !Array.isArray(s.items)) continue;
    const items = JSON.stringify(s.items);
    if (saved.some((x) => (x.id === s.id || x.name === s.name) && JSON.stringify(x.items) === items)) continue; // déjà présent
    const same = saved.find((x) => x.id === s.id);
    saved.push(same ? { ...clone(s), id: uid(), name: `${s.name} (importé)` } : clone(s));
    added++;
  }
  saveSaved();
  haptic(added ? 'success' : 'light');
  toast(added ? `${plural(added, 'panier')} importé${added > 1 ? 's' : ''}` : 'Rien de nouveau à importer', added ? 'Annuler' : null, () => { saved = before; saveSaved(); });
  return added;
}

function openImport() {
  const dlg = $('import-dialog');
  $('import-text').value = '';
  dlg.returnValue = '';
  dlg.addEventListener('close', () => {
    const text = $('import-text').value.trim();
    if (dlg.returnValue !== 'ok' || !text) return;
    try { importBackup(text); } catch (e) { haptic('warning'); toast(e.message); }
  }, { once: true });
  dlg.showModal();
}

function initBackup() {
  $('export-btn').addEventListener('click', exportCarts);
  $('import-btn').addEventListener('click', openImport);
  $('import-pick').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async () => {
    const f = $('import-file').files[0];
    $('import-file').value = '';
    if (!f) return;
    $('import-dialog').close();
    try { importBackup(await f.text()); } catch (e) { haptic('warning'); toast(e.message); }
  });
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
    if (s.wallpaper === 'random' || s.wallpaper === 'none' || WALLPAPERS.some((w) => w.id === s.wallpaper) || /^custom-/.test(s.wallpaper || '')) state.settings.wallpaper = s.wallpaper;
    if (WP_INTERVALS.some((o) => o.v === s.wpInterval)) state.settings.wpInterval = s.wpInterval;
    if (s.adaptive === false) state.settings.adaptive = false;
    if (Number.isFinite(s.frost)) {
      // Ancienne échelle (0 = déjà 55 % d'opacité) : même rendu sur la nouvelle, qui part de 0.
      const f = s.frostScale === 2 ? s.frost : Math.round((55 + 0.3 * s.frost) / 0.85);
      state.settings.frost = Math.min(100, Math.max(0, f));
    }
    if (s.clock?.tz && s.clock?.label) {
      try { new Intl.DateTimeFormat('fr-FR', { timeZone: s.clock.tz }); state.settings.clock = { label: s.clock.label, tz: s.clock.tz }; } catch { /* fuseau inconnu */ }
    }
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
    if (v.id === 'edit-view') editing = null;
    if (v.id === 'crop-view') cropFinish(null);
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
// Photos personnelles : image en IndexedDB, vignette et tonalité dans localStorage.
const CUSTOM_MAX = 5;
let customWps = []; // [{ id, label, tone, thumb }]
const customUrls = new Map(); // id → URL de l'image (objet Blob)
const allWallpapers = () => [...WALLPAPERS, ...customWps];
const wpFile = (id) => customUrls.get(id) || `wallpapers/${id}.webp`;
const wpThumb = (id) => customWps.find((c) => c.id === id)?.thumb || `wallpapers/${id}-thumb.webp`;

const wpDb = {
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('vrai-prix-ny', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('wallpapers');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async run(mode, fn) {
    const db = await wpDb.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('wallpapers', mode);
      const req = fn(tx.objectStore('wallpapers'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  },
  get: (id) => wpDb.run('readonly', (st) => st.get(id)),
  put: (id, blob) => wpDb.run('readwrite', (st) => st.put(blob, id)),
  del: (id) => wpDb.run('readwrite', (st) => st.delete(id)),
};

async function loadCustomWallpapers() {
  customWps = store.get('customWallpapers') || [];
  for (const c of customWps) {
    try {
      const blob = await wpDb.get(c.id);
      if (blob) customUrls.set(c.id, URL.createObjectURL(blob));
    } catch { /* stockage indisponible */ }
  }
  customWps = customWps.filter((c) => customUrls.has(c.id));
}

const canvasBlob = (c, q) => new Promise((r) => c.toBlob(r, 'image/webp', q));

// Original gardé (2560 px maximum) pour pouvoir recadrer la photo plus tard.
async function photoSource(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return canvasBlob(c, 0.86);
}

// Découpe la zone choisie au format de l'écran, la compresse et mesure sa luminosité.
async function processPhoto(src, { sx, sy, sw, sh }) {
  const bmp = await createImageBitmap(src);
  const ratio = innerHeight / innerWidth;
  const draw = (w) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = Math.round(w * ratio);
    c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  };
  const blob = await canvasBlob(draw(1080), 0.78);
  const thumb = draw(180).toDataURL('image/webp', 0.7);
  const small = draw(18);
  const px = small.getContext('2d').getImageData(0, 0, small.width, small.height).data;
  let lum = 0;
  for (let i = 0; i < px.length; i += 4) lum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  lum /= px.length / 4;
  bmp.close?.();
  return { blob, thumb, tone: lum < 140 ? 'dark' : 'light' };
}

// --- Recadrage : la photo couvre tout l'écran, on la déplace et on zoome ----------

const crop = { iw: 0, ih: 0, s: 1, min: 1, tx: 0, ty: 0, pts: new Map(), done: null };

function cropClamp() {
  const W = innerWidth, H = innerHeight;
  crop.s = Math.min(crop.min * 4, Math.max(crop.min, crop.s));
  crop.tx = Math.min(0, Math.max(W - crop.iw * crop.s, crop.tx));
  crop.ty = Math.min(0, Math.max(H - crop.ih * crop.s, crop.ty));
  $('crop-img').style.transform = `translate(${crop.tx}px, ${crop.ty}px) scale(${crop.s})`;
  $('crop-zoom').value = Math.round((crop.s / crop.min) * 100);
}

// Zoom autour d'un point de l'écran (centre du pincement, curseur…).
function cropZoom(s, cx = innerWidth / 2, cy = innerHeight / 2) {
  const k = Math.min(crop.min * 4, Math.max(crop.min, s)) / crop.s;
  crop.tx = cx - (cx - crop.tx) * k;
  crop.ty = cy - (cy - crop.ty) * k;
  crop.s *= k;
  cropClamp();
}

function cropReset() {
  crop.s = crop.min;
  crop.tx = (innerWidth - crop.iw * crop.s) / 2;
  crop.ty = (innerHeight - crop.ih * crop.s) / 2;
  cropClamp();
}

function cropFinish(rect) {
  const done = crop.done;
  crop.done = null;
  done?.(rect);
}

// Ouvre l'écran de recadrage ; renvoie la zone choisie (pixels de la source) ou null si annulé.
async function openCrop(src) {
  const img = $('crop-img');
  const url = URL.createObjectURL(src);
  img.src = url;
  try { await img.decode(); } catch { URL.revokeObjectURL(url); return null; }
  crop.iw = img.naturalWidth; crop.ih = img.naturalHeight;
  img.style.width = `${crop.iw}px`; img.style.height = `${crop.ih}px`;
  crop.min = Math.max(innerWidth / crop.iw, innerHeight / crop.ih);
  crop.pts.clear();
  cropReset();
  openView('crop-view');
  const rect = await new Promise((resolve) => { crop.done = resolve; });
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rect;
}

function initCrop() {
  const stage = $('crop-stage');
  let last = null; // dernier état des doigts : { x, y, d } (centre et écart)
  const gesture = () => {
    const p = [...crop.pts.values()];
    if (p.length === 1) return { x: p[0].x, y: p[0].y, d: 0 };
    return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
  };
  stage.addEventListener('pointerdown', (e) => {
    try { stage.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    crop.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = gesture();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!crop.pts.has(e.pointerId)) return;
    crop.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture();
    if (last && g.d && last.d) cropZoom(crop.s * (g.d / last.d), g.x, g.y);
    if (last) { crop.tx += g.x - last.x; crop.ty += g.y - last.y; cropClamp(); }
    last = g;
  });
  const up = (e) => { crop.pts.delete(e.pointerId); last = crop.pts.size ? gesture() : null; };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', (e) => { e.preventDefault(); cropZoom(crop.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY); }, { passive: false });
  stage.addEventListener('dblclick', cropReset);
  $('crop-zoom').addEventListener('input', () => cropZoom(crop.min * Number($('crop-zoom').value) / 100));
  $('crop-reset').addEventListener('click', () => { cropReset(); haptic(); });
  $('crop-cancel').addEventListener('click', () => history.back());
  $('crop-ok').addEventListener('click', () => {
    cropFinish({ sx: -crop.tx / crop.s, sy: -crop.ty / crop.s, sw: innerWidth / crop.s, sh: innerHeight / crop.s });
    history.back();
  });
}

async function addCustomWallpaper(file) {
  if (customWps.length >= CUSTOM_MAX) { toast(`${CUSTOM_MAX} photos maximum : supprimez-en une d'abord`); return; }
  try {
    const src = await photoSource(file);
    const rect = await openCrop(src);
    if (!rect) return;
    toast('Préparation de la photo…');
    const { blob, thumb, tone } = await processPhoto(src, rect);
    const id = `custom-${uid()}`;
    await wpDb.put(`${id}-src`, src);
    await wpDb.put(id, blob);
    customUrls.set(id, URL.createObjectURL(blob));
    customWps.push({ id, label: `Ma photo ${customWps.length + 1}`, tone, thumb });
    store.set('customWallpapers', customWps);
    state.settings.wallpaper = id;
    store.set('settings', state.settings);
    applyWallpaper();
    haptic('success');
    toast('Photo ajoutée aux fonds d’écran');
  } catch {
    haptic('warning');
    toast('Impossible d’utiliser cette photo');
  }
}

// Recadre une photo déjà ajoutée (à partir de l'original, ou de l'image pour les photos plus anciennes).
async function recropCustomWallpaper(id) {
  const c = customWps.find((x) => x.id === id);
  if (!c) return;
  try {
    const src = (await wpDb.get(`${id}-src`)) || (await wpDb.get(id));
    if (!src) throw new Error('photo introuvable');
    const rect = await openCrop(src);
    if (!rect) return;
    const { blob, thumb, tone } = await processPhoto(src, rect);
    await wpDb.put(id, blob);
    const old = customUrls.get(id);
    customUrls.set(id, URL.createObjectURL(blob));
    Object.assign(c, { thumb, tone });
    store.set('customWallpapers', customWps);
    if (wpCurrent === id) wpCurrent = null; // force l'affichage de la nouvelle image
    applyWallpaper();
    if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
    haptic('success');
    toast('Photo recadrée');
  } catch {
    haptic('warning');
    toast('Impossible de recadrer cette photo');
  }
}

async function removeCustomWallpaper(id) {
  customWps = customWps.filter((c) => c.id !== id);
  store.set('customWallpapers', customWps);
  try { await wpDb.del(id); await wpDb.del(`${id}-src`); } catch { /* ignore */ }
  const url = customUrls.get(id);
  customUrls.delete(id);
  if (state.settings.wallpaper === id) { state.settings.wallpaper = 'random'; store.set('settings', state.settings); }
  if (wpCurrent === id) wpCurrent = null;
  applyWallpaper();
  if (url) setTimeout(() => URL.revokeObjectURL(url), 2000);
  haptic('medium');
  toast('Photo retirée');
}
let wpCurrent = null;
let wpLayer = 'a';
let wpTimer = null;

// Thème imposé par la photo affichée (option « Couleurs adaptées à la photo »).
function applyTheme() {
  const wp = document.body.classList.contains('has-wp') && allWallpapers().find((w) => w.id === wpCurrent);
  const tone = state.settings.adaptive && wp ? wp.tone : null;
  document.documentElement.classList.toggle('theme-dark', tone === 'dark');
  document.documentElement.classList.toggle('theme-light', tone === 'light');
}

// Givré : de 0 (cartes transparentes, sans flou) à 100 (opacité 85 %, flou 28 px).
function applyFrost() {
  const f = state.settings.frost / 100;
  document.documentElement.style.setProperty('--glass-a', (0.85 * f).toFixed(2));
  document.documentElement.style.setProperty('--blur', `${Math.round(28 * f)}px`);
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
  const others = allWallpapers().filter((w) => w.id !== wpCurrent);
  return others[Math.floor(Math.random() * others.length)].id;
}

function applyWallpaper() {
  clearInterval(wpTimer);
  const { wallpaper, wpInterval } = state.settings;
  if (wallpaper === 'none') showWallpaper(null);
  else if (wallpaper === 'random') {
    if (!wpCurrent || !allWallpapers().some((w) => w.id === wpCurrent)) showWallpaper(randomWallpaper());
    if (wpInterval !== 'launch') wpTimer = setInterval(() => showWallpaper(randomWallpaper()), wpInterval * 1000);
  } else if (allWallpapers().some((w) => w.id === wallpaper)) showWallpaper(wallpaper);
  else showWallpaper(randomWallpaper());
  renderWallpaperSettings();
}

function renderWallpaperSettings() {
  const g = $('wp-gallery');
  g.replaceChildren();
  const tiles = [
    { id: 'random', label: 'Aléatoire', icon: '🎲' },
    ...allWallpapers(),
    ...(customWps.length < CUSTOM_MAX ? [{ id: 'add', label: 'Ma photo', icon: '➕' }] : []),
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
    if (t.id.startsWith('custom-')) {
      const del = document.createElement('span');
      del.className = 'wp-del';
      del.textContent = '×';
      del.setAttribute('role', 'button');
      del.setAttribute('aria-label', `Retirer ${t.label}`);
      del.addEventListener('click', (e) => { e.stopPropagation(); removeCustomWallpaper(t.id); });
      const cut = document.createElement('span');
      cut.className = 'wp-crop';
      cut.append($('crop-icon-tpl').firstElementChild.cloneNode(true));
      cut.setAttribute('role', 'button');
      cut.setAttribute('aria-label', `Recadrer ${t.label}`);
      cut.addEventListener('click', (e) => { e.stopPropagation(); recropCustomWallpaper(t.id); });
      b.append(cut, del);
    }
    b.addEventListener('click', () => {
      if (t.id === 'add') { $('wp-file').click(); return; }
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
  const abs = (path) => new URL(path, location.href).href; // le worker est chargé depuis un blob
  try {
    if (!window.Tesseract) await loadScript(`${OCR_LOCAL}tesseract.min.js`);
    ocrWorker = await Tesseract.createWorker('eng', 1, {
      workerPath: abs(`${OCR_LOCAL}worker.min.js`),
      corePath: abs(`${OCR_LOCAL}core/tesseract-core-simd-lstm.wasm.js`),
      langPath: abs(`${OCR_LOCAL}lang`),
      cacheMethod: 'none', // données déjà locales
    });
  } catch {
    // téléphone sans SIMD ou fichiers manquants : version en ligne
    if (!window.Tesseract) await loadScript(TESSERACT_CDN);
    ocrWorker = await Tesseract.createWorker('eng');
  }
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
    $('scan-status').textContent = `Erreur de lecture : ${e.message || e}. Réessayez.`;
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
  { id: 'transport', words: ['taxi', 'uber', 'lyft', 'métro', 'metro', 'subway', 'bus', 'ferry', 'transport', 'course', 'cab'] },
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

// Écoute une phrase (micro natif dans l'APK, Web Speech sinon) ; renvoie les transcriptions possibles,
// ou null si l'écoute n'a pas pu se faire (message déjà affiché).
async function listen({ btn, prompt, lang = state.settings.voiceLang }) {
  try {
    if (IS_NATIVE) {
      const cap = window.Capacitor;
      const perm = await cap.nativePromise('SpeechRecognition', 'requestPermissions', { permissions: ['speechRecognition'] });
      if (perm?.speechRecognition && perm.speechRecognition !== 'granted') {
        toast('Autorisez le micro pour la saisie vocale');
        return null;
      }
      btn.classList.add('listening');
      const res = await cap.nativePromise('SpeechRecognition', 'start', { language: lang, maxResults: 5, popup: true, partialResults: false, prompt });
      return res?.matches || [];
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast('Saisie vocale indisponible sur ce navigateur');
      return null;
    }
    return await new Promise((resolve) => {
      const rec = new SR();
      rec.lang = lang;
      rec.maxAlternatives = 5;
      rec.interimResults = false;
      btn.classList.add('listening');
      toast(`${prompt}…`);
      let matches = null;
      rec.onresult = (e) => { matches = Array.from(e.results[0]).map((a) => a.transcript); };
      rec.onerror = (e) => { if (e.error !== 'aborted') toast(e.error === 'not-allowed' ? 'Autorisez le micro pour la saisie vocale' : 'Pas compris, réessayez'); };
      rec.onend = () => resolve(matches);
      rec.start();
    });
  } catch (e) {
    if (!/cancel|^0$/i.test(String(e?.message ?? e))) toast('Pas compris, réessayez');
    return null;
  } finally {
    btn.classList.remove('listening');
  }
}

async function startVoice() {
  if (keypadOpen()) history.back();
  const fr = state.settings.voiceLang === 'fr-FR';
  const matches = await listen({ btn: $('voice-btn'), prompt: fr ? 'Dites le prix et la catégorie' : 'Say the price and category' });
  if (matches) applyVoice(matches);
}

// --- Démarrage ------------------------------------------------------------

function init() {
  const firstLaunch = runSplash();
  renderEditionDate();
  fitTitle();
  document.fonts?.ready.then(fitTitle);
  window.addEventListener('resize', fitTitle);
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
  initClockSetting();
  initCrop();
  const cropIcon = $('crop-icon-tpl').firstElementChild.cloneNode(true);
  cropIcon.classList.add('inline-icon');
  $('wp-note').replaceChildren('« Ma photo » : choisissez jusqu’à 5 photos de votre téléphone, puis cadrez-les ; elles restent sur l’appareil. Touchez ', cropIcon, ' sur une photo pour la recadrer.');
  startClocks();
  loadCustomWallpapers().finally(applyWallpaper);
  $('wp-file').addEventListener('change', () => {
    const f = $('wp-file').files[0];
    $('wp-file').value = '';
    if (f) addCustomWallpaper(f);
  });
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
  $('rate-refresh').addEventListener('click', refreshRate);
  // L'appli peut rester ouverte en arrière-plan plusieurs jours : nouveau cours au retour.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - (state.fx?.checkedAt || 0) > RATE_REFRESH_MS) loadRate();
  });
  setDetail(store.get('detailOpen') === true);
  $('detail-btn').addEventListener('click', () => { setDetail($('breakdown').hidden); haptic(); });
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
  $('cart-share').addEventListener('click', () => shareCart(cart));
  $('cart-title').addEventListener('click', () => renameCart('cart'));
  initBackup();
  $('ev-title').addEventListener('click', () => renameCart('edit'));
  $('ev-share').addEventListener('click', () => editing && shareCart(editing));
  $('ev-open').addEventListener('click', () => {
    const s = editing;
    history.back();
    // une fois l'écran fermé, on revient au panier si « Mes paniers » est encore ouvert
    setTimeout(() => s && loadSaved(s, openViews.at(-1)?.id === 'saved-view'), 120);
  });
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => history.back()));

  renderAll();
  loadTaxes();
  loadRate();

  if ('serviceWorker' in navigator && !IS_NATIVE) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
