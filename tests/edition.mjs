import { chromium } from 'playwright';
const out = process.argv[2];
const scheme = process.argv[3] || 'light';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
await ctx.addInitScript(() => { try { sessionStorage.setItem('splash', '1'); if (!localStorage.getItem('s6')) { localStorage.setItem('s6', '1'); localStorage.setItem('settings', JSON.stringify({ wallpaper: 'none' })); } } catch {} });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/net::|Failed to load|404/.test(m.text()) && errs.push(m.text()));
await p.route(/open-meteo\.com/, (r) => r.abort());
await p.route('https://api.frankfurter.dev/**', r => r.fulfill({ json: { amount: 1, base: 'USD', date: '2026-10-16', rates: { EUR: 0.9 } } }));
await p.route('https://open.er-api.com/**', r => r.abort());
await p.goto('http://localhost:8765/');
await p.waitForFunction(() => document.getElementById('rate-info').textContent.includes('0,9'));
const N = (t) => t.replace(/[  ]/g, ' ');
const ok = (label, cond) => console.log(cond ? 'OK  ' : 'FAIL', label);
const keys = async (s) => { for (const ch of s) await p.click(`[data-key="${ch === ',' ? '.' : ch}"]`); };
const close = async () => { if (await p.isVisible('#keypad')) { await p.goBack(); await p.waitForTimeout(150); } };
const item = (n) => `#cart-list .item-wrap:nth-child(${n})`;

// deux articles : chemise 50 $ (shopping), sandwich 20 $
await p.fill('#item-name', 'Chemise'); await p.click('#price'); await keys('50'); await p.click('#kp-add'); await p.waitForTimeout(1200);
await keys('20'); await p.click('#kp-add'); await p.waitForTimeout(1200); await close();
await p.click('#cart-open'); await p.waitForTimeout(400);
// 3. catégorie : Chemise → Vêtements (exonérée sous 110 $)
await p.click(`${item(1)} .item-num`); await p.waitForTimeout(300);
ok('fenêtre catégories', await p.isVisible('#cat-dialog'));
await p.click('#cat-choices .cat:has-text("Vêtements")'); await p.waitForTimeout(300);
let d = await p.textContent(`${item(1)} .item-detail`);
ok(`vêtements exonéré: ${d}`, d.includes('exonéré'));
// article 2 → Resto : pourboire 20 % ajouté
await p.click(`${item(2)} .item-num`); await p.click('#cat-choices .cat:has-text("Resto")'); await p.waitForTimeout(300);
d = await p.textContent(`${item(2)} .item-detail`);
ok(`resto avec pourboire: ${d}`, d.includes('pourboire $4.00'));
// annuler via la notification
await p.click('#toast-action'); await p.waitForTimeout(200);
ok('annulation catégorie', !(await p.textContent(`${item(2)} .item-detail`)).includes('pourboire'));
// 2. prix : Chemise 50 → 120 $ (redevient taxée)
await p.click(`${item(1)} .item-amt`); await p.waitForTimeout(300);
ok(`fenêtre prix: ${await p.inputValue('#ask-input')}`, (await p.inputValue('#ask-input')) === '50,00');
await p.fill('#ask-input', '120'); await p.click('#ask-dialog button[value=ok]'); await p.waitForTimeout(300);
d = await p.textContent(`${item(1)} .item-detail`);
ok(`prix 120 taxé: ${d}`, d.includes('$120.00') && d.includes('taxe $10.65'));
await p.waitForTimeout(600);
ok(`total: ${N(await p.textContent('#cv-eur'))}`, N(await p.textContent('#cv-eur')) === '137,18 €');
// 1. renommer le panier en cours puis l'enregistrer
await p.click('#cart-title'); await p.waitForTimeout(300);
await p.fill('#ask-input', 'Soho'); await p.click('#ask-dialog button[value=ok]'); await p.waitForTimeout(300);
ok(`titre: ${await p.textContent('#cart-title')} / barre: ${await p.textContent('#cart-name')}`, (await p.textContent('#cart-title')) === 'Soho' && (await p.textContent('#cart-name')) === 'Soho');
await p.click('#cart-save'); await p.waitForTimeout(300);
ok(`nom proposé à l'enregistrement: ${await p.inputValue('#name-input')}`, (await p.inputValue('#name-input')) === 'Soho');
await p.click('#name-dialog button[value=ok]'); await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/v6-cart-${scheme}.png` });
// 4. dupliquer dans Mes paniers
await p.click('#saved-open'); await p.waitForTimeout(400);
await p.click('.saved-more'); await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/v6-menu-${scheme}.png` });
await p.click('#menu-dialog button[value=duplicate]'); await p.waitForTimeout(300);
let names = await p.$$eval('.saved-main b', (l) => l.map((x) => x.textContent));
ok(`dupliqué: ${names}`, names.length === 2 && names[1] === 'Soho (copie)');
// renommer la copie
await p.click('.item-wrap:nth-child(2) .saved-more'); await p.click('#menu-dialog button[value=rename]'); await p.waitForTimeout(300);
await p.fill('#ask-input', 'Brooklyn'); await p.click('#ask-dialog button[value=ok]'); await p.waitForTimeout(300);
names = await p.$$eval('.saved-main b', (l) => l.map((x) => x.textContent));
ok(`renommé: ${names}`, names[1] === 'Brooklyn');
// 5. modifier « Brooklyn » sans l'ouvrir
await p.click('.item-wrap:nth-child(2) .saved-more'); await p.click('#menu-dialog button[value=edit]'); await p.waitForTimeout(400);
ok(`écran modification: ${await p.textContent('#ev-title')}`, (await p.isVisible('#edit-view')) && (await p.textContent('#ev-title')) === 'Brooklyn');
await p.screenshot({ path: `${out}/v6-edit-${scheme}.png` });
await p.click('#ev-list .item-wrap:nth-child(1) .item-qty button:has-text("+")'); await p.waitForTimeout(200);
let sv = await p.evaluate(() => JSON.parse(localStorage.getItem('savedCarts')));
ok(`copie modifiée (qté ${sv[1].items[0].qty}), original intact (qté ${sv[0].items[0].qty})`, sv[1].items[0].qty === 2 && sv[0].items[0].qty === 1);
ok(`panier en cours intact: ${await p.textContent('#cart-name')}`, (await p.textContent('#cart-name')) === 'Soho');
await p.click('#ev-done'); await p.waitForTimeout(300);
ok('retour à Mes paniers', (await p.isVisible('#saved-view')) && !(await p.isVisible('#edit-view')));
// ouvrir depuis l'écran de modification
await p.click('.item-wrap:nth-child(2) .saved-more'); await p.click('#menu-dialog button[value=edit]'); await p.waitForTimeout(400);
await p.click('#ev-open'); await p.waitForTimeout(600);
ok(`ouvert: ${await p.textContent('#cart-name')}, écran panier visible: ${await p.isVisible('#cart-view')}`, (await p.textContent('#cart-name')) === 'Brooklyn' && (await p.isVisible('#cart-view')) && !(await p.isVisible('#saved-view')));
await p.goBack(); await p.waitForTimeout(250);
ok('retour à l\'écran principal', !(await p.isVisible('#cart-view')));
ok(`${scheme} erreurs JS: ${errs}`, errs.length === 0);
await b.close();
