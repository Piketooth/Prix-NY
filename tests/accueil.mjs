// Pastilles métro, accueil modulable (profils, réglages, édition sur la page), suggestions du Plan, économie de batterie.
import { chromium } from 'playwright';
const out = process.argv[2];
const scheme = process.argv[3] || 'dark';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true });
await ctx.addInitScript(() => {
  if (window.top !== window) return; // pas dans les cartes intégrées
  sessionStorage.setItem('splash', '1');
  if (!localStorage.getItem('s13')) { localStorage.setItem('s13', '1'); localStorage.setItem('settings', JSON.stringify({ wallpaper: 'none' })); }
  window.__calls = [];
  window.Capacitor = { isNativePlatform: () => true, nativePromise: async (pl, m, o) => { window.__calls.push(`${pl}.${m}:${o?.url ?? ''}`); return m === 'openUrl' ? { completed: true } : m === 'canOpenUrl' ? { value: true } : {}; } };
  // Batterie simulée : réglable depuis le test
  window.__battery = { level: 0.9, charging: false, listeners: {}, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); } };
  navigator.getBattery = async () => window.__battery;
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: { current: { temperature_2m: 12.4, weather_code: 3, is_day: 1, apparent_temperature: 10, relative_humidity_2m: 70, wind_speed_10m: 18 },
  daily: { time: ['2026-10-21', '2026-10-22'], temperature_2m_min: [9, 8], temperature_2m_max: [15, 13], weather_code: [3, 61], precipitation_probability_max: [20, 80], wind_speed_10m_max: [20, 25] } } }));
await p.route('https://api.frankfurter.dev/**', (r) => r.fulfill({ json: { amount: 1, base: 'USD', date: '2026-10-16', rates: { EUR: 0.86 } } }));
await p.route('https://open.er-api.com/**', (r) => r.abort());
await p.route('https://maps.google.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>carte</p>' }));
let photon = 0;
await p.route('https://photon.komoot.io/**', (r) => { photon++; r.fulfill({ json: { features: [
  { geometry: { coordinates: [-73.989, 40.7505] }, properties: { name: "Macy's", housenumber: '151', street: 'West 34th Street', city: 'New York', district: 'Manhattan', state: 'New York' } }] } }); });
await p.goto('http://localhost:8765/');
await p.waitForFunction(() => document.getElementById('rate-info').textContent.includes('0,86'));
await p.waitForTimeout(500);
const ok = (label, cond) => console.log(cond ? 'OK  ' : 'FAIL', label);
const shown = () => p.$$eval('#home-blocks > .home-block:not([hidden])', (l) => l.map((x) => `${x.dataset.block}:${x.dataset.size}`).join(','));

// Pastilles métro
const dots = await p.$$eval('#screen-dots .metro', (l) => l.map((x) => `${x.dataset.screen}${x.classList.contains('on') ? '*' : ''}`));
ok(`pastilles: ${dots.join(' ')}`, dots.length === 8 && dots[0] === 'main*' && (await p.isVisible('#screen-dots')));
ok('couleurs des lignes', (await p.$eval('#screen-dots .metro[data-screen="main"]', (e) => getComputedStyle(e).backgroundColor)) === 'rgb(238, 53, 46)');
await p.click('#screen-dots .metro[data-screen="weather"]'); await p.waitForTimeout(500);
ok('pastille → Météo', (await p.evaluate(() => currentScreen())) === 'weather' && (await p.$eval('#screen-dots .metro.on', (e) => e.dataset.screen)) === 'weather');
await p.click('#screen-dots .metro[data-screen="main"]'); await p.waitForTimeout(600);
ok('pastille → Accueil', (await p.evaluate(() => currentScreen())) === 'main');
await p.click('#price'); await p.waitForTimeout(300);
ok('cachées sous le pavé', await p.isHidden('#screen-dots'));
await p.goBack(); await p.waitForTimeout(300);
ok('de retour après le pavé', await p.isVisible('#screen-dots'));

// Accueil : profil Shopping par défaut
ok(`Shopping par défaut: ${await shown()}`, (await shown()) === 'price:full,cart:compact,rate:compact');
ok(`bloc cours: ${await p.textContent('.home-block[data-block="rate"] .hb-body')}`, (await p.textContent('.home-block[data-block="rate"] .hb-body')).includes('1 $ = 0,86 €'));
// Réglages › Accueil
await p.evaluate(() => menuGo('settings')); await p.waitForTimeout(500);
await p.click('#home-profile .chip:has-text("Balade")'); await p.waitForTimeout(200);
ok(`profil Balade: ${await shown()}`, (await shown()) === 'weather:full,sun:compact,map:compact,price:compact');
await p.click('#home-list li:has-text("Horloges") input'); await p.waitForTimeout(200);
ok('modification → profil Perso', (await p.evaluate(() => state.settings.home.profile)) === 'perso' && (await shown()).includes('clocks:full'));
await p.click('#home-list li:has-text("Saisie du prix") .hb-size'); await p.waitForTimeout(150);
await p.click('#home-list li:has-text("Saisie du prix") button:has-text("▲")'); await p.waitForTimeout(150);
ok(`taille et ordre: ${await shown()}`, (await shown()) === 'weather:full,sun:compact,price:full,map:compact,clocks:full');
await p.evaluate(() => menuGo('main')); await p.waitForTimeout(600);
ok(`soleil: ${await p.textContent('.home-block[data-block="sun"] .hb-body')}`, /Heure dorée\d\d:\d\d–\d\d:\d\d.*Coucher\d\d:\d\d/.test(await p.textContent('.home-block[data-block="sun"] .hb-body')));
ok(`météo: ${await p.textContent('.home-block[data-block="weather"] .hb-body')}`, (await p.textContent('.home-block[data-block="weather"] .hb-body')).includes('12°'));
ok('mini-plan', (await p.getAttribute('.home-block[data-block="map"] iframe', 'src')).includes('maps.google.com'));
// Édition sur la page : bouton, ×, ajout, glisser, Terminé
await p.click('#home-edit-btn'); await p.waitForTimeout(300);
ok('mode édition', (await p.evaluate(() => document.body.classList.contains('home-edit'))) && (await p.isVisible('#home-edit-bar')) && (await p.$$('.hb-tools')).length === 5 && (await p.isHidden('#screen-dots')));
await p.click('.home-block[data-block="map"] .hb-x'); await p.waitForTimeout(200);
ok(`bloc retiré: ${await shown()}`, !(await shown()).includes('map'));
await p.click('#home-add-list .chip:has-text("Calculatrice")'); await p.waitForTimeout(200);
ok(`bloc ajouté: ${await shown()}`, (await shown()).endsWith('calc:full'));
// Glisser la calculatrice au-dessus des horloges
await p.$eval('.home-block[data-block="clocks"]', (e) => e.scrollIntoView({ block: 'start' })); await p.waitForTimeout(200);
const gb = await (await p.$('.home-block[data-block="calc"] .hb-grip')).boundingBox();
const target = await (await p.$('.home-block[data-block="clocks"]')).boundingBox();
await p.mouse.move(gb.x + 10, gb.y + 10); await p.mouse.down();
await p.mouse.move(gb.x + 10, target.y + 5, { steps: 10 });
await p.mouse.up(); await p.waitForTimeout(300);
ok(`glissé au-dessus des horloges: ${await shown()}`, (await shown()) === 'weather:full,sun:compact,price:full,calc:full,clocks:full');
await p.click('#home-done'); await p.waitForTimeout(300);
ok('fin de l’édition', !(await p.evaluate(() => document.body.classList.contains('home-edit'))) && (await p.$$('.hb-tools')).length === 0 && (await p.isVisible('#screen-dots')));
// Calculatrice de l'accueil, même calcul que la page
await p.click('.hb-calc-keys button:has-text("7")'); await p.click('.hb-calc-keys button:has-text("×")'); await p.click('.hb-calc-keys button:has-text("6")'); await p.click('.hb-calc-keys button:has-text("=")');
ok(`calculatrice: ${await p.textContent('#hcalc-result')}`, (await p.textContent('#hcalc-result')) === '42' && (await p.textContent('#calc-result')) === '42');
// Appui long → édition ; tout retirer → accueil vide
await p.reload(); await p.waitForTimeout(800);
ok('composition mémorisée', (await shown()) === 'weather:full,sun:compact,price:full,calc:full,clocks:full');
await p.$eval('.home-block[data-block="weather"]', (e) => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
const lab = await (await p.$('.home-block[data-block="weather"] .hb-head .label')).boundingBox();
await p.mouse.move(lab.x + 5, lab.y + 5); await p.mouse.down(); await p.waitForTimeout(800); await p.mouse.up(); await p.waitForTimeout(200);
ok('appui long → édition', await p.evaluate(() => document.body.classList.contains('home-edit')));
while ((await p.$$('.hb-x')).length) { await p.click('.hb-x >> nth=0'); await p.waitForTimeout(100); }
await p.click('#home-done'); await p.waitForTimeout(300);
ok('accueil vide : message', (await p.isVisible('#home-empty')) && (await p.isHidden('#home-edit-btn')));
await p.click('#home-empty-add'); await p.waitForTimeout(300);
await p.click('#home-add-list .chip:has-text("Saisie du prix")'); await p.click('#home-done'); await p.waitForTimeout(300);
ok(`saisie remise: ${await shown()}`, (await shown()) === 'price:full');

// Suggestions du Plan
await p.evaluate(() => menuGo('maps')); await p.waitForTimeout(600);
await p.evaluate(() => { const i = document.getElementById('maps-q'); i.value = 'macys'; i.dispatchEvent(new Event('input')); }); await p.waitForTimeout(700);
const sug = await p.$$eval('#maps-suggest li', (l) => l.map((x) => x.textContent));
ok(`suggestions: ${sug.join(' | ')}`, sug.length === 1 && sug[0].includes("Macy's") && sug[0].includes('151 West 34th Street'));
await p.click('#maps-suggest li'); await p.waitForTimeout(300);
ok(`lieu choisi: ${await p.getAttribute('#maps-frame', 'src')}`, (await p.getAttribute('#maps-frame', 'src')).includes(encodeURIComponent("Macy's, 151 West 34th Street, New York")) && (await p.isHidden('#maps-suggest')));
await p.evaluate(() => { state.settings.mapSuggest = false; const i = document.getElementById('maps-q'); i.value = 'empire'; i.dispatchEvent(new Event('input')); }); await p.waitForTimeout(700);
ok('suggestions désactivées', photon === 1 && (await p.isHidden('#maps-suggest')));

// Économie de batterie
ok('automatique, batterie pleine : inactive', !(await p.evaluate(() => document.documentElement.classList.contains('eco'))));
await p.evaluate(() => { const bt = window.__battery; bt.level = 0.15; bt.listeners.levelchange.forEach((f) => f()); }); await p.waitForTimeout(200);
const eco = await p.evaluate(() => [document.documentElement.classList.contains('eco'), getComputedStyle(document.documentElement).getPropertyValue('--blur').trim(), !document.getElementById('eco-badge').hidden]);
ok(`automatique sous 20 %: ${eco}`, eco[0] && eco[1] === '0px' && eco[2]);
const n0 = await p.evaluate(() => window.__calls.length); await p.evaluate(() => haptic());
ok('pas de vibrations', (await p.evaluate(() => window.__calls.length)) === n0);
await p.evaluate(() => { const bt = window.__battery; bt.charging = true; bt.listeners.chargingchange.forEach((f) => f()); }); await p.waitForTimeout(200);
ok('en charge : inactive', !(await p.evaluate(() => document.documentElement.classList.contains('eco'))));
await p.evaluate(() => menuGo('settings')); await p.waitForTimeout(500);
await p.click('#eco-mode .chip:has-text("Toujours")'); await p.waitForTimeout(200);
ok(`toujours: ${await p.textContent('#eco-note')}`, (await p.evaluate(() => document.documentElement.classList.contains('eco'))) && (await p.textContent('#eco-note')).startsWith('Active'));
await p.click('#eco-mode .chip:has-text("Désactivée")'); await p.waitForTimeout(200);
ok('désactivée', !(await p.evaluate(() => document.documentElement.classList.contains('eco'))) && (await p.evaluate(() => state.settings.battery)) === 'off');
await p.screenshot({ path: `${out}/accueil-${scheme}.png` });
ok(`${scheme} erreurs JS: ${errs}`, errs.length === 0);
await b.close();
