// Balayage entre écrans (ordre réglable) et page « Applis utiles » (installées ou grisées).
import { chromium } from 'playwright';
const out = process.argv[2];
const scheme = process.argv[3] || 'light';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
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
await p.route('https://api.frankfurter.dev/**', r => r.fulfill({ json: { amount: 1, base: 'USD', date: '2026-10-16', rates: { EUR: 0.9 } } }));
await p.route('https://open.er-api.com/**', r => r.abort());
await p.goto('http://localhost:8765/');
await p.waitForFunction(() => document.getElementById('rate-info').textContent.includes('0,9'));
const ok = (label, cond) => console.log(cond ? 'OK  ' : 'FAIL', label);
const cdp = await ctx.newCDPSession(p);
const swipe = async (x1, x2, y = 500) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] });
  for (let i = 1; i <= 3; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * i / 3, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400);
};
const where = () => p.evaluate(() => currentScreen());

// Menu de l'écran principal
await p.click('#menu-open'); await p.waitForTimeout(150);
const items = await p.$$eval('#main-menu .menu-row', (l) => l.map((x) => x.textContent.trim()));
ok(`menu: ${items.join(', ')}`, items.join() === 'Panier,Mes paniers,Applis utiles,Réglages');
await p.mouse.click(200, 600); await p.waitForTimeout(200);
ok('menu fermé en touchant ailleurs', await p.isHidden('#main-menu'));
await p.click('#menu-open'); await p.click('#menu-saved'); await p.waitForTimeout(250);
ok('menu → Mes paniers', (await p.isVisible('#saved-view')) && (await p.isHidden('#main-menu')));
await p.goBack(); await p.waitForTimeout(250);
ok('retour à l’accueil', (await p.evaluate(() => openViews.length)) === 0);
const seen = ['main'];
for (let i = 0; i < 4; i++) { await swipe(320, 60); seen.push(await where()); }
ok(`balayage vers la gauche: ${seen.join(' → ')}`, seen.join() === 'main,cart,saved,apps,settings');
ok('points de position affichés', await p.isVisible('#screen-dots'));
await swipe(320, 60);
ok('fin de liste : reste sur Réglages', (await where()) === 'settings');
const back = [];
for (let i = 0; i < 4; i++) { await swipe(80, 340); back.push(await where()); }
ok(`balayage vers la droite: ${back.join(' → ')}`, back.join() === 'apps,saved,cart,main');
ok('accueil visible', !(await p.evaluate(() => document.body.classList.contains('no-scroll'))));

// Écrans empilés (Panier puis Mes paniers) : un balayage n'en garde qu'un, le retour mène à l'accueil
await p.click('#cart-open'); await p.waitForTimeout(250); await p.click('#saved-open'); await p.waitForTimeout(250);
await swipe(320, 60);
ok(`depuis Mes paniers: ${await where()}`, (await where()) === 'apps' && (await p.evaluate(() => openViews.length)) === 1);
await p.goBack(); await p.waitForTimeout(400);
ok(`retour: ${await where()}`, (await where()) === 'main');

// Pas de changement d'écran en glissant un article du panier (suppression)
// Applis utiles : grisées si absentes, ouverture ou Play Store
await p.click('#menu-open'); await p.click('#apps-open'); await p.waitForTimeout(500);
const tiles = await p.$$eval('.app-tile', (l) => l.map((x) => `${x.querySelector('.app-name').textContent}${x.classList.contains('missing') ? '-' : '+'}`));
ok(`applis: ${tiles.join(' ')}`, tiles.length === 11 && tiles[0] === 'Google Maps+' && tiles[3] === 'Uber+' && tiles[1] === 'Citymapper-' && !tiles.includes('Revolut+') && !tiles.includes('Revolut-'));
ok('icône officielle si installée', (await p.$$('.app-tile:not(.missing) .app-icon.official img')).length === 2);
ok('icône générique grisée sinon', (await p.textContent('.app-tile.missing .app-icon.generic')) === 'C' && (await p.textContent('.app-tile.missing .app-get')) === 'Non installée');
ok(`note: ${await p.textContent('#apps-note')}`, (await p.textContent('#apps-note')).startsWith('Grisée, application non installée'));
await p.click('.app-tile:has-text("Uber")'); await p.waitForTimeout(200);
await p.click('.app-tile:has-text("Citymapper")'); await p.waitForTimeout(200);
const calls = await p.evaluate(() => window.__calls.filter((c) => c.includes('openUrl')));
ok(`lancements: ${calls.join(' | ')}`, calls[0] === 'AppLauncher.openUrl:com.ubercab' && calls[1] === 'AppLauncher.openUrl:market://details?id=com.citymapper.app.release');
await p.goBack(); await p.waitForTimeout(300);

// Réglages : ordre des écrans et choix des applis
await p.click('#menu-open'); await p.click('#settings-open'); await p.waitForTimeout(300);
await p.click('#screen-order li:nth-child(4) button:has-text("▲")'); await p.waitForTimeout(150);
const order = await p.$$eval('#screen-order .name', (l) => l.map((x) => x.textContent));
ok(`ordre: ${order.join(', ')}`, order.join() === 'Accueil,Panier,Applis utiles,Mes paniers,Réglages');
await p.click('#apps-choice .chip:has-text("Citymapper")'); await p.click('#apps-choice .chip:has-text("NYC Ferry")'); await p.waitForTimeout(150);
// Ajouter une appli du téléphone (liste sans celles déjà proposées)
await p.click('#app-add'); await p.waitForTimeout(300);
const pick = await p.$$eval('.app-pick', (l) => l.map((x) => x.textContent));
ok(`applis du téléphone: ${pick.join(', ')}`, pick.join() === 'WhatsApp,Wikipédia');
await p.click('.app-pick:has-text("WhatsApp")'); await p.waitForTimeout(150);
await p.click('#app-pick-dialog button[value=ok]'); await p.waitForTimeout(150);
ok('appli ajoutée dans les réglages', await p.isVisible('#apps-choice .custom-app:has-text("WhatsApp")'));
// Givré animé
await p.check('#opt-frost-anim'); await p.waitForTimeout(100);
ok('réglages du givré animé', (await p.isVisible('#frost-anim-box')) && (await p.isHidden('#frost-fixed')));
ok(`givré animé: ${await p.textContent('#fa-note')}`, (await p.textContent('#fa-note')).startsWith('Toutes les 20 s, le givré passe de 30 à 90 en 4 s'));
await p.waitForTimeout(1600);
const a1 = Number(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--glass-a')));
await p.waitForTimeout(3600);
const a2 = Number(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--glass-a')));
ok(`givré qui monte: ${a1.toFixed(2)} → ${a2.toFixed(2)}`, a1 > 0.26 && a2 > a1 && a2 <= 0.77);
await p.reload(); await p.waitForTimeout(800);
ok('ordre mémorisé', (await p.evaluate(() => state.settings.screens.join())) === 'main,cart,apps,saved,settings');
await swipe(320, 60); await swipe(320, 60);
ok(`nouvel ordre appliqué: ${await where()}`, (await where()) === 'apps');
const names = await p.$$eval('.app-name', (l) => l.map((x) => x.textContent));
ok(`choix des applis: ${names.join(', ')}`, !names.includes('Citymapper') && names.includes('NYC Ferry') && names.at(-1) === 'WhatsApp');
ok('givré animé mémorisé', await p.evaluate(() => state.settings.frostAnim.on));
await p.screenshot({ path: `${out}/ecrans-${scheme}.png` });
await p.click('#apps-info'); await p.waitForTimeout(200);
ok(`aide Applis: ${await p.textContent('#info-title')}`, (await p.isVisible('#info-dialog')) && (await p.textContent('#info-body')).includes('Play Store'));
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
await swipe(320, 60); await swipe(320, 60);
await p.click('#settings-info'); await p.waitForTimeout(200);
ok(`aide Réglages: ${await p.textContent('#info-title')}`, (await p.textContent('#info-title')) === 'Réglages' && (await p.textContent('#info-body')).includes('Deuxième horloge'));
ok(`${scheme} erreurs JS: ${errs}`, errs.length === 0);
await b.close();
