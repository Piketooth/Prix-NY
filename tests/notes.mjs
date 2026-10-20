// Bandeau repliable, météo, Shazam, raccourcis réseau, plan, villes, teinte du givré, lueurs, panier, symbole $.
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
await p.route('https://api.open-meteo.com/**', (r) => {
  const ny = r.request().url().includes('40.71');
  const days = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
  const hourly = { time: [], temperature_2m: [], weather_code: [], precipitation_probability: [] };
  for (const d of days.slice(0, 2)) for (let h = 0; h < 24; h++) { hourly.time.push(`${d}T${String(h).padStart(2, '0')}:00`); hourly.temperature_2m.push(5 + h / 2); hourly.weather_code.push(h < 12 ? 0 : h < 18 ? 3 : 61); hourly.precipitation_probability.push(h < 18 ? 10 : 70); }
  r.fulfill({ json: { hourly, current: { temperature_2m: ny ? 12.4 : 15.8, apparent_temperature: 10, relative_humidity_2m: 70, weather_code: ny ? 3 : 0, is_day: 1, wind_speed_10m: 18 },
    daily: { time: days, weather_code: [3, 61, 80, 1, 0, 2, 95], temperature_2m_max: [15, 13, 12, 16, 18, 17, 14], temperature_2m_min: [9, 8, 7, 9, 11, 10, 8], precipitation_probability_max: [20, 80, 60, 10, 0, 5, 70], wind_speed_10m_max: [20, 25, 30, 15, 10, 12, 35] } } });
});
await p.route('https://geocoding-api.open-meteo.com/**', (r) => { geo++; r.fulfill({ json: { results: [{ name: 'Vannes', latitude: 47.66, longitude: -2.76, timezone: 'Europe/Paris', admin1: 'Bretagne', admin2: 'Morbihan', country_code: 'FR', country: 'France' }] } }); });
await p.route('https://maps.google.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>carte</p>' }));
await p.route('https://api.frankfurter.dev/**', r => r.fulfill({ json: { amount: 1, base: 'USD', date: '2026-10-16', rates: { EUR: 0.9 } } }));
await p.route('https://open.er-api.com/**', r => r.abort());
await p.goto('http://localhost:8765/');
await p.waitForFunction(() => document.getElementById('rate-info').textContent.includes('0,9'));
await p.waitForTimeout(500);
const ok = (label, cond) => console.log(cond ? 'OK  ' : 'FAIL', label);
const collapsed = () => p.evaluate(() => document.getElementById('masthead').classList.contains('collapsed'));

// Bandeau replié au démarrage : titre, heure de New York (+ météo) et cours
ok('replié au démarrage', await collapsed());
ok(`barre fine: ${(await p.textContent('.mast-mini')).trim()}`, /^NY \d\d:\d\d$/.test(await p.textContent('#mini-time')) && (await p.textContent('#mini-weather')) === '☁️ 12° · 9°/15°' && (await p.textContent('#mini-rate')) === '1 $ = 0,9 €');
const h0 = await p.evaluate(() => document.getElementById('masthead').getBoundingClientRect().height);
ok(`barre fine basse: ${Math.round(h0)} px`, h0 < 80);
ok('flèche sous le bandeau', await p.evaluate(() => { const h = document.getElementById('masthead').getBoundingClientRect(); const a = document.getElementById('mast-pull').getBoundingClientRect(); return a.top >= h.bottom - 2 && Math.abs((a.left + a.right) / 2 - 195) < 2; }));
await p.click('#mast-pull'); await p.waitForTimeout(400);
ok('déplié par la flèche', !(await collapsed()));
await p.click('#mast-pull'); await p.waitForTimeout(400);
ok('replié par la flèche', await collapsed());
await p.click('#mast-toggle'); await p.waitForTimeout(400);
ok('déplié au toucher', !(await collapsed()));
ok(`météo de New York seulement: ${(await p.textContent('.mast-clocks')).replace(/\s+/g, ' ').trim()}`, (await p.textContent('#clock-ny')).endsWith('☁️ 12°') && !(await p.textContent('#clock-home')).includes('°') && geo === 0);
ok('Shazam visibles (APK)', (await p.isVisible('#shazam-now')) && (await p.isVisible('#shazam-auto')));
await p.click('#shazam-now'); await p.waitForTimeout(200);
await p.click('#shazam-auto'); await p.waitForTimeout(200);
const sz = await p.evaluate(() => window.__calls.filter((c) => c.includes('shazam')));
ok(`Shazam: ${sz.join(' | ')}`, sz[0] === 'AppLauncher.openUrl:com.shazam.android.intent.actions.START_TAGGING' && sz[1] === 'AppLauncher.openUrl:com.shazam.android');
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
// Page Météo depuis l'icône du bandeau
await p.goBack(); await p.waitForTimeout(300);
ok('icône météo dans la barre', (await p.textContent('#mini-weather')) === '☁️ 12° · 9°/15°');
await p.click('#mini-weather'); await p.waitForTimeout(600);
ok('page Météo ouverte, bandeau replié', (await p.evaluate(() => currentScreen())) === 'weather' && (await collapsed()));
ok(`aujourd'hui en grand: ${await p.textContent('.wx-temp')} ${await p.textContent('.wx-desc')}`, (await p.textContent('.wx-temp')) === '12°' && (await p.textContent('.wx-desc')) === 'Couvert');
const days = await p.$$eval('#wx-week li', (l) => l.map((x) => x.querySelector('.d').textContent));
ok(`semaine après demain: ${days.join(', ')}`, days.length === 5 && /^mer/.test(days[0]));
const cards = await p.$$eval('.wx-day', (l) => l.map((x) => x.querySelector('h3').textContent + ':' + [...x.querySelectorAll('.wx-part .n')].map((n) => n.textContent).join('/')));
ok(`aujourd'hui et demain: ${cards.join(' ; ')}`, cards.join() === 'Aujourd’hui:Matin/Après-midi/Soirée,Demain:Matin/Après-midi/Soirée');
const part = await p.$eval('.wx-day .wx-part:nth-child(3)', (e) => e.textContent);
ok(`soirée: ${part}`, part.includes('🌧️') && part.includes('14–17°') && part.includes('70 %'));
const sun = await p.$$eval('.wx-day:first-child .wx-sun dd', (l) => l.map((x) => x.textContent));
ok(`soleil du 19 oct.: ${sun.join(' | ')}`, sun[0] === '07:11' && sun[1] === '18:09' && /^06:4\d–06:5\d · 18:2\d–18:3\d$/.test(sun[2]) && /^06:5\d–07:\d\d · 17:\d\d–18:2\d$/.test(sun[3]));
ok('pas de choix de ville', !(await p.$('#wx-city')));
// Réseau en haut de la page Applis
await p.evaluate(() => menuGo('apps')); await p.waitForTimeout(500);
ok('réseau en haut des Applis', await p.evaluate(() => { const n = document.getElementById('net-tools'); return !n.hidden && n.nextElementSibling.id === 'apps-grid'; }));
await p.click('#net-wifi'); await p.click('#net-data'); await p.click('#net-roaming'); await p.waitForTimeout(200);
const calls = await p.evaluate(() => window.__calls.filter((c) => c.includes('android.settings')));
ok(`Wi-Fi, données, itinérance: ${calls.join(' | ')}`, calls.join() === ['WIFI', 'INTERNET_CONNECTIVITY'].map((x) => `AppLauncher.openUrl:android.settings.panel.action.${x}`).join() + ',AppLauncher.openUrl:android.settings.DATA_ROAMING_SETTINGS');
// Plan : carte Google intégrée, recherche, itinéraire
await p.evaluate(() => menuGo('maps')); await p.waitForTimeout(600);
ok(`carte de New York: ${await p.getAttribute('#maps-frame', 'src')}`, (await p.getAttribute('#maps-frame', 'src')).startsWith('https://maps.google.com/maps?q=Times%20Square') );
await p.$eval('#maps-q', (e) => { e.value = 'Macy\'s'; }); await p.click('#maps-go'); await p.waitForTimeout(200);
ok('recherche à New York', (await p.getAttribute('#maps-frame', 'src')).includes(encodeURIComponent("Macy's, New York")));
await p.click('#maps-route'); await p.waitForTimeout(200);
ok('itinéraire vers Google Maps', await p.evaluate(() => window.__calls.some((c) => c.startsWith('AppLauncher.openUrl:https://www.google.com/maps/dir/?api=1&destination=Macy'))));
// Villes : Vannes dans la liste hors ligne, toute ville via Open-Meteo
await p.evaluate(() => menuGo('settings')); await p.waitForTimeout(500);
ok('Vannes hors ligne', await p.evaluate(() => findCities('vann').some((c) => c.label === 'Vannes' && c.tz === 'Europe/Paris')));
await p.evaluate(() => { const i = document.getElementById('set-city'); i.value = 'Séné'; i.dispatchEvent(new Event('input')); }); await p.waitForTimeout(800);
const chips = await p.$$eval('#city-suggest .chip', (l) => l.map((x) => x.textContent));
ok(`recherche en ligne: ${chips.join(', ')}`, chips.includes('Vannes · Morbihan') && geo === 1);
await p.click('#city-suggest .chip:has-text("Morbihan")'); await p.waitForTimeout(200);
ok('ville choisie avec ses coordonnées', await p.evaluate(() => state.settings.clock.label === 'Vannes' && state.settings.clock.lat === 47.66));
// Source météo
let models = '';
await p.route('https://api.open-meteo.com/**', (r) => { models = new URL(r.request().url()).searchParams.get('models') || ''; r.fallback(); });
ok('source automatique par défaut', (await p.getAttribute('#wx-source .chip:has-text("Automatique")', 'aria-checked')) === 'true');
await p.click('#wx-source .chip:has-text("Météo-France")'); await p.waitForTimeout(400);
ok(`source Météo-France: ${models}`, models === 'meteofrance_seamless' && (await p.textContent('#wx-source-note')).includes('ARPEGE'));
await p.evaluate(() => menuGo('weather')); await p.waitForTimeout(500);
ok(`source citée: ${await p.textContent('#wx-note')}`, (await p.textContent('#wx-note')).includes('Source : Météo-France') && models === 'meteofrance_seamless');
ok(`${scheme} erreurs JS: ${errs}`, errs.length === 0);
await b.close();
