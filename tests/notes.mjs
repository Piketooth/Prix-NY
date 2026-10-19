// Bandeau repliable, météo, raccourcis réseau, teinte du givré, lueurs, panier, symbole $.
import { chromium } from 'playwright';
const out = process.argv[2];
const scheme = process.argv[3] || 'light';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, timezoneId: 'Europe/Paris', hasTouch: true });
await ctx.addInitScript(() => {
  sessionStorage.setItem('splash', '1');
  if (!localStorage.getItem('s12')) { localStorage.setItem('s12', '1'); localStorage.setItem('settings', JSON.stringify({ wallpaper: 'none' })); }
  window.__calls = [];
  window.Capacitor = { isNativePlatform: () => true, nativePromise: async (pl, m, o) => { window.__calls.push(`${pl}.${m}:${o?.url ?? ''}`); return m === 'openUrl' ? { completed: true } : m === 'canOpenUrl' ? { value: false } : {}; } };
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
let geo = 0;
await p.route('https://api.open-meteo.com/**', (r) => { const ny = r.request().url().includes('40.71'); r.fulfill({ json: { current: { temperature_2m: ny ? 12.4 : 15.8, weather_code: ny ? 3 : 0, is_day: 1 } } }); });
await p.route('https://geocoding-api.open-meteo.com/**', (r) => { geo++; r.fulfill({ json: { results: [{ latitude: 48.85, longitude: 2.35 }] } }); });
await p.route('https://api.frankfurter.dev/**', r => r.fulfill({ json: { amount: 1, base: 'USD', date: '2026-10-16', rates: { EUR: 0.9 } } }));
await p.route('https://open.er-api.com/**', r => r.abort());
await p.goto('http://localhost:8765/');
await p.waitForFunction(() => document.getElementById('rate-info').textContent.includes('0,9'));
await p.waitForTimeout(500);
const ok = (label, cond) => console.log(cond ? 'OK  ' : 'FAIL', label);
const collapsed = () => p.evaluate(() => document.getElementById('masthead').classList.contains('collapsed'));

// Bandeau replié au démarrage : titre, heure de New York (+ météo) et cours
ok('replié au démarrage', await collapsed());
ok(`barre fine: ${(await p.textContent('.mast-mini')).trim()}`, /^NY \d\d:\d\d · ☁️ 12°/.test(await p.textContent('#mini-time')) && (await p.textContent('#mini-rate')) === '1 $ = 0,9 €');
const h0 = await p.evaluate(() => document.getElementById('masthead').getBoundingClientRect().height);
ok(`barre fine basse: ${Math.round(h0)} px`, h0 < 80);
await p.click('#mast-toggle'); await p.waitForTimeout(400);
ok('déplié au toucher', !(await collapsed()));
ok(`météo des deux villes: ${(await p.textContent('.mast-clocks')).replace(/\s+/g, ' ').trim()}`, (await p.textContent('#clock-ny')).endsWith('☁️ 12°') && (await p.textContent('#clock-home')).endsWith('☀️ 16°') && geo === 1);
ok('raccourcis réseau visibles (APK)', await p.isVisible('#net-panel'));
await p.click('#net-panel'); await p.waitForTimeout(200);
await p.click('#net-roaming'); await p.waitForTimeout(200);
const calls = await p.evaluate(() => window.__calls.filter((c) => c.includes('android.settings')));
ok(`panneau Internet et itinérance: ${calls.join(' | ')}`, calls[0] === 'AppLauncher.openUrl:android.settings.panel.action.INTERNET_CONNECTIVITY' && calls[1] === 'AppLauncher.openUrl:android.settings.DATA_ROAMING_SETTINGS');
const mastH = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mast-h'));
ok(`le bandeau déplié passe par-dessus (décalage inchangé ${mastH})`, parseInt(mastH, 10) < 80);
await p.mouse.click(200, 700); await p.waitForTimeout(400);
ok('replié en touchant ailleurs', await collapsed());
await p.click('#mast-toggle'); await p.waitForTimeout(300);
await p.evaluate(() => document.dispatchEvent(new Event('scroll'))); await p.waitForTimeout(300);
ok('replié en faisant défiler', await collapsed());

// Symbole $ de la couleur du texte
const [pc, tc] = await p.evaluate(() => [getComputedStyle(document.querySelector('.prefix')).color, getComputedStyle(document.getElementById('price')).color]);
ok(`symbole $: ${pc} = ${tc}`, pc === tc);

// Panier : titre entier, boutons sur la ligne du nom
await p.click('#cart-open'); await p.waitForTimeout(300);
ok('titre du panier non coupé', await p.$eval('#cart-view h2', (e) => e.scrollWidth <= e.clientWidth + 1));
ok('partager et Mes paniers sur la ligne du nom', await p.evaluate(() => ['cart-share', 'saved-open', 'cart-clear'].every((id) => document.getElementById(id).parentElement.classList.contains('cart-name-row'))));
await p.goBack(); await p.waitForTimeout(300);

// Teinte du givré et lueurs
await p.click('#menu-open'); await p.click('#menu-settings'); await p.waitForTimeout(300);
ok('teinte neutre par défaut', (await p.getAttribute('#tint-neutral', 'aria-checked')) === 'true');
await p.$eval('#tint-color', (e) => { e.value = '#2f5f9e'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
const glass = await p.evaluate(() => getComputedStyle(document.querySelector('.setting')).backgroundColor);
ok(`verre teinté: ${glass}`, glass.startsWith('rgba(47, 95, 158'));
await p.reload(); await p.waitForTimeout(600);
ok('teinte mémorisée', (await p.evaluate(() => state.settings.tint)) === '#2f5f9e');
await p.click('#menu-open'); await p.click('#menu-settings'); await p.waitForTimeout(300);
await p.click('#tint-neutral'); await p.waitForTimeout(100);
ok('retour au neutre', !(await p.evaluate(() => document.documentElement.style.getPropertyValue('--glass'))));
ok(`lueurs automatiques: ${await p.textContent('#set-glow-v')}`, (await p.textContent('#set-glow-v')) === '100 %');
await p.$eval('#set-glow', (e) => { e.value = '160'; e.dispatchEvent(new Event('input', { bubbles: true })); });
ok('lueurs renforcées', (await p.evaluate(() => document.documentElement.style.getPropertyValue('--glow'))) === '1.60');
ok(`${scheme} erreurs JS: ${errs}`, errs.length === 0);
await b.close();
