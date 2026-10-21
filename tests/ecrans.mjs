// Balayage entre écrans (ordre réglable) et page « Applis utiles » (installées ou grisées).
import { chromium } from 'playwright';
const out = process.argv[2];
const scheme = process.argv[3] || 'light';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  if (window.top !== window) return; // pas dans la carte du Plan
  sessionStorage.setItem('splash', '1');
  if (!localStorage.getItem('s10')) { localStorage.setItem('s10', '1'); localStorage.setItem('settings', JSON.stringify({ wallpaper: 'none' })); }
  // APK simulé : Maps et Uber installées, appels natifs enregistrés
  const installed = ['com.google.android.apps.maps', 'com.ubercab', 'com.whatsapp'];
  const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  window.__calls = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    nativePromise: async (plugin, method, o) => {
      window.__calls.push(`${plugin}.${method}:${o?.url ?? ''}`);
      if (method === 'canOpenUrl') return { value: installed.includes(o.url) };
      if (method === 'icons') return { icons: Object.fromEntries(o.packages.filter((p) => installed.includes(p)).map((p) => [p, ICON])) };
      if (method === 'installed') return { apps: [{ pkg: 'com.ubercab', name: 'Uber', icon: ICON }, { pkg: 'com.whatsapp', name: 'WhatsApp', icon: ICON }, { pkg: 'org.wikipedia', name: 'Wikipédia', icon: ICON }] };
      if (method === 'openUrl') return { completed: installed.includes(o.url) || o.url.startsWith('market:') };
      return {};
    },
  };
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route(/open-meteo\.com/, (r) => r.abort());
await p.route('https://api.frankfurter.dev/**', r => r.fulfill({ json: { amount: 1, base: 'USD', date: '2026-10-16', rates: { EUR: 0.9 } } }));
await p.route('https://open.er-api.com/**', r => r.abort());
await p.route('https://maps.google.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>carte</p>' }));
await p.goto('http://localhost:8765/');
await p.waitForFunction(() => document.getElementById('rate-info').textContent.includes('0,9'));
const ok = (label, cond) => console.log(cond ? 'OK  ' : 'FAIL', label);
const cdp = await ctx.newCDPSession(p);
// Sur le Plan, la carte garde ses gestes : on balaie sur le titre de la page.
const swipe = async (x1, x2, y) => {
  y ??= (await p.evaluate(() => currentScreen())) === 'maps' ? 125 : 500;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] });
  for (let i = 1; i <= 3; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * i / 3, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400);
};
const where = () => p.evaluate(() => currentScreen());

// Menu de l'écran principal
await p.click('#menu-open'); await p.waitForTimeout(150);
const items = await p.$$eval('#main-menu .menu-row', (l) => l.map((x) => x.textContent.trim()));
ok(`menu: ${items.join(', ')}`, items.join() === 'Accueil,Applis utiles,Plan,Calculatrice,Panier en cours,Mes paniers,Météo,Réglages');
await p.mouse.click(200, 600); await p.waitForTimeout(200);
ok('menu fermé en touchant ailleurs', await p.isHidden('#main-menu'));
await p.click('#menu-open'); await p.click('#menu-saved'); await p.waitForTimeout(250);
ok('menu → Mes paniers', (await p.isVisible('#saved-view')) && (await p.isHidden('#main-menu')));
await p.goBack(); await p.waitForTimeout(250);
ok('retour à l’accueil', (await p.evaluate(() => openViews.length)) === 0);
const seen = ['main'];
for (let i = 0; i < 7; i++) { await swipe(320, 60); seen.push(await where()); }
ok(`balayage vers la gauche: ${seen.join(' → ')}`, seen.join() === 'main,apps,maps,calc,cart,saved,weather,settings');
ok('points de position affichés', await p.isVisible('#screen-dots'));
await swipe(320, 60);
ok('fin de liste : reste sur Réglages', (await where()) === 'settings');
const back = [];
for (let i = 0; i < 7; i++) { await swipe(80, 340); back.push(await where()); }
ok(`balayage vers la droite: ${back.join(' → ')}`, back.join() === 'weather,saved,cart,calc,maps,apps,main');
ok('accueil visible', !(await p.evaluate(() => document.body.classList.contains('no-scroll'))));

// Écrans empilés (Panier puis Mes paniers) : un balayage n'en garde qu'un, le retour mène à l'accueil
await p.click('#cart-open'); await p.waitForTimeout(250); await p.click('#saved-open'); await p.waitForTimeout(250);
await swipe(320, 60);
ok(`depuis Mes paniers: ${await where()}`, (await where()) === 'weather' && (await p.evaluate(() => openViews.length)) === 1);
await p.goBack(); await p.waitForTimeout(400);
ok(`retour: ${await where()}`, (await where()) === 'main');

// Pas de changement d'écran en glissant un article du panier (suppression)
// Applis utiles : grisées si absentes, ouverture ou Play Store
await p.click('#menu-open'); await p.click('#menu-apps'); await p.waitForTimeout(500);
const tiles = await p.$$eval('.app-tile', (l) => l.map((x) => `${x.querySelector('.app-name').textContent}${x.classList.contains('missing') ? '-' : '+'}`));
ok(`applis (non installées à la fin): ${tiles.join(' ')}`, tiles.length === 12 && tiles[0] === 'Google Maps+' && tiles[1] === 'Uber+' && tiles[2] === 'Map Marker-' && tiles.slice(2).every((t) => t.endsWith('-')) && !tiles.some((t) => t.startsWith('Revolut')));
ok('pas de ⓘ en haut de page', !(await p.$('#apps-info')));
ok('un ⓘ par appli', (await p.$$('.app-tile .app-info')).length === 12);
await p.click('.app-tile:has-text("Uber") .app-info'); await p.waitForTimeout(200);
ok(`ⓘ Uber: ${await p.textContent('#info-body')}`, (await p.textContent('#info-title')) === 'Uber' && (await p.textContent('#info-body')).startsWith('VTC (voiture avec chauffeur)'));
ok('le ⓘ n’ouvre pas l’appli', !(await p.evaluate(() => window.__calls.some((c) => c.includes('openUrl')))));
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
ok('icône officielle si installée', (await p.$$('.app-tile:not(.missing) .app-icon.official img')).length === 2);
ok('icône générique grisée sinon', (await p.textContent('.app-tile.missing .app-icon.generic')) === 'M' && (await p.textContent('.app-tile.missing .app-get')) === 'Non installée');
ok(`note: ${await p.textContent('#apps-note')}`, (await p.textContent('#apps-note')).startsWith('Grisée, application non installée'));
await p.click('.app-tile:has-text("Uber")'); await p.waitForTimeout(200);
await p.click('.app-tile:has-text("Citymapper")'); await p.waitForTimeout(200);
const calls = await p.evaluate(() => window.__calls.filter((c) => c.includes('openUrl')));
ok(`lancements: ${calls.join(' | ')}`, calls[0] === 'AppLauncher.openUrl:com.ubercab' && calls[1] === 'AppLauncher.openUrl:market://details?id=com.citymapper.app.release');
await p.goBack(); await p.waitForTimeout(300);

// Réglages : ordre des écrans et choix des applis
await p.click('#menu-open'); await p.click('#menu-settings'); await p.waitForTimeout(300);
await p.click('#screen-order li:nth-child(5) button:has-text("▲")'); await p.waitForTimeout(150);
const order = await p.$$eval('#screen-order .name', (l) => l.map((x) => x.textContent));
ok(`ordre: ${order.join(', ')}`, order.join() === 'Accueil,Applis utiles,Plan,Panier en cours,Calculatrice,Mes paniers,Météo,Réglages');
// (le 4e, Mes paniers, est monté d'un cran)
await p.click('#apps-choice li:has-text("Citymapper") input'); await p.click('#apps-choice li:has-text("NYC Ferry") .name'); await p.waitForTimeout(150);
await p.click('#apps-choice li:has-text("Uber") button:has-text("▲")'); await p.waitForTimeout(100);
const sel = await p.$$eval('#apps-choice li.on .name', (l) => l.map((x) => x.textContent));
ok(`ordre des applis: ${sel.join(', ')}`, sel[0] === 'Google Maps' && sel[1] === 'Map Marker' && sel[2] === 'Uber' && sel[3] === 'MTA' && sel.at(-1) === 'NYC Ferry' && !sel.includes('Citymapper'));
await p.click('#apps-choice li:has-text("Uber") button:has-text("▲")'); await p.waitForTimeout(100);
await p.click('#apps-choice li:has-text("Uber") button:has-text("▲")'); await p.waitForTimeout(100);
// Ajouter une appli du téléphone (liste sans celles déjà proposées)
await p.click('#app-add'); await p.waitForTimeout(300);
const pick = await p.$$eval('.app-pick', (l) => l.map((x) => x.textContent));
ok(`applis du téléphone: ${pick.join(', ')}`, pick.join() === 'WhatsApp,Wikipédia');
await p.click('.app-pick:has-text("WhatsApp")'); await p.waitForTimeout(150);
await p.click('#app-pick-dialog button[value=ok]'); await p.waitForTimeout(150);
ok('appli ajoutée dans les réglages', await p.isVisible('#my-apps li.on:has-text("WhatsApp") button:has-text("×")'));
// Givré animé
await p.check('#opt-frost-anim'); await p.waitForTimeout(100);
ok('réglages du givré animé', (await p.isVisible('#frost-anim-box')) && (await p.isVisible('#set-opacity')));
ok(`givré animé: ${await p.textContent('#fa-note')}`, (await p.textContent('#fa-note')).startsWith('Le givré reste à 100 % du flou et de l’opacité réglés. Toutes les 20 s, il passe à 0 % en 2 s'));
await p.waitForTimeout(450);
const a0 = Number(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--glass-a')));
await p.waitForTimeout(2300);
const a1 = Number(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--glass-a')));
await p.waitForTimeout(2300);
const a2 = Number(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--glass-a')));
ok(`givré qui descend puis revient: ${a0.toFixed(2)} → ${a1.toFixed(2)} → ${a2.toFixed(2)}`, Math.abs(a0 - 0.64) < 0.02 && a1 < 0.03 && Math.abs(a2 - 0.64) < 0.02);
await p.reload(); await p.waitForTimeout(800);
ok('ordre mémorisé', (await p.evaluate(() => state.settings.screens.join())) === 'main,apps,maps,cart,calc,saved,weather,settings');
await swipe(320, 60);
ok(`nouvel ordre appliqué: ${await where()}`, (await where()) === 'apps');
const names = await p.$$eval('.app-name', (l) => l.map((x) => x.textContent));
ok(`choix et ordre des applis: ${names.join(', ')}`, names.slice(0, 2).join() === 'Uber,Google Maps' && !names.includes('Citymapper') && names.includes('NYC Ferry') && names.at(-1) === 'WhatsApp' && (await p.$$eval('#apps-grid .apps-group', (l) => l.map((x) => x.textContent))).join() === 'Applis suggérées,Mes applis');
// Masquer les applis non installées
await p.evaluate(() => { state.settings.hideMissing = true; renderApps(); }); await p.waitForTimeout(200);
const visible = await p.$$eval('.app-name', (l) => l.map((x) => x.textContent));
ok(`non installées masquées: ${visible.join(', ')}`, visible.join() === 'Uber,Google Maps,WhatsApp');
await p.evaluate(() => { state.settings.hideMissing = false; renderApps(); }); await p.waitForTimeout(200);
ok('givré animé mémorisé', await p.evaluate(() => state.settings.frostAnim.on));
await p.screenshot({ path: `${out}/ecrans-${scheme}.png` });
await swipe(320, 60); await swipe(320, 60); await swipe(320, 60); await swipe(320, 60); await swipe(320, 60); await swipe(320, 60);
await p.click('#settings-info'); await p.waitForTimeout(200);
ok(`aide Réglages: ${await p.textContent('#info-title')}`, (await p.textContent('#info-title')) === 'Réglages' && (await p.textContent('#info-body')).includes('BigDataCloud'));
ok(`${scheme} erreurs JS: ${errs}`, errs.length === 0);
await b.close();
