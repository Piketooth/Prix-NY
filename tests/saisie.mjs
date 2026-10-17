import { chromium } from 'playwright';
const out = process.argv[2];
const scheme = process.argv[3] || 'light';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
// Ancien panier avec une catégorie supprimée, pour tester la migration
await ctx.addInitScript(() => {
  try {
    sessionStorage.setItem('splash', '1');
    if (!localStorage.getItem('seeded')) {
      localStorage.setItem('seeded', '1');
      localStorage.setItem('cart', JSON.stringify({ id: null, name: null, items: [{ id: 'x1', name: 'Taxi', category: 'transport', unit: 20, qty: 1, split: 1, opts: { tax: true, tip: false, tipPct: 0.2, tipBasis: 'pre' }, taxRate: 0.08875, exempt: false, price: 20, tax: 1.775, tip: 0, bill: 21.775, share: 21.775 }] }));
    }
  } catch {}
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/net::|Failed to load/.test(m.text()) && errs.push(m.text()));
await p.route('https://api.frankfurter.dev/**', r => r.fulfill({ json: { amount: 1, base: 'USD', date: '2026-10-16', rates: { EUR: 0.9 } } }));
await p.route('https://open.er-api.com/**', r => r.abort());
await p.goto('http://localhost:8765/');
await p.waitForFunction(() => document.getElementById('rate-info').textContent.includes('0,9'));
const N = (t) => t.replace(/[  ]/g, ' ');
const main = async () => { await p.waitForTimeout(500); return N(await p.textContent('#total-main')); };
const keys = async (s) => { for (const ch of s) await p.click(`[data-key="${ch === ',' ? '.' : ch}"]`); };
const ok = (label, cond) => console.log(cond ? 'OK  ' : 'FAIL', label);
const close = async () => { if (await p.isVisible('#keypad')) { await p.goBack(); await p.waitForTimeout(150); } };

// 1, 5, 6. catégories
const labels = await p.$$eval('.cat', (els) => els.map((e) => e.textContent));
ok(`catégories: ${labels.join(' | ')}`, labels.length === 5 && labels[1].includes('Vêtements et chaussures') && labels[3].includes('Épicerie / Pharmacie') && !labels.some((l) => /Transport|Visites/.test(l)));
const vis = await p.$$eval('.cat', (els) => els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
ok('toutes visibles', vis);
// 2. bas d'écran
ok('pas de bas d\'écran', !(await p.$('footer')) && !(await p.$('#refresh-btn')));
// migration Transport → Autre
await p.click('#cart-open'); await p.waitForTimeout(400);
ok(`migration: ${await p.getAttribute('.item-num', 'title')}`, (await p.getAttribute('.item-num', 'title')) === 'Autre : changer la catégorie');
await p.click('#cart-clear'); await p.goBack(); await p.waitForTimeout(200);
// 7. info vêtements
await p.click('.cat:has-text("Vêtements")');
ok(`info vêtements: ${await p.textContent('#cat-info-text')}`, (await p.textContent('#cat-info-text')) === 'Exonéré sous 110 $ par article');
await p.click('#price'); await keys('120'); await close();
ok(`info vêtements 120 $: ${await p.textContent('#cat-info-text')}`, (await p.textContent('#cat-info-text')).startsWith('Taxé'));
await p.click('#cat-info'); await p.waitForTimeout(350);
ok(`fenêtre: ${await p.textContent('#info-title')}`, (await p.isVisible('#info-dialog')) && (await p.textContent('#info-body')).includes('chaque article'));
await p.screenshot({ path: `${out}/v4-info-${scheme}.png` });
await p.click('#info-dialog button[value=ok]');
// 6. épicerie exonérée
await p.click('.cat:has-text("Épicerie")');
let m = await main(); ok(`épicerie 120 $ → ${m} (exonéré)`, m === '108,00 €');
ok(`info épicerie: ${await p.textContent('#cat-info-text')}`, (await p.textContent('#cat-info-text')) === 'Exonéré de taxe');
await p.click('#cat-info'); await p.waitForTimeout(300);
ok('fenêtre épicerie', (await p.textContent('#info-body')).includes('médicaments'));
await p.click('#info-dialog button[value=ok]');
await p.click('.cat:has-text("Shopping")');
ok('pas d\'info en Shopping', !(await p.isVisible('#cat-info')));
// 4. panier enregistré + enregistrement automatique
await p.click('#add-btn'); await p.waitForTimeout(1200);
await p.click('#cart-open'); await p.waitForTimeout(400);
await p.click('#cart-save'); await p.fill('#name-input', 'Soho'); await p.click('#name-dialog button[value=ok]'); await p.waitForTimeout(200);
await p.goBack(); await p.waitForTimeout(200);
await p.click('#price'); await keys('30'); await p.click('#kp-add'); await p.waitForTimeout(1200); await close();
let sv = await p.evaluate(() => JSON.parse(localStorage.getItem('savedCarts')));
ok(`auto: « ${sv[0].name} » ${sv[0].items.length} articles`, sv[0].items.length === 2);
ok(`barre: ${await p.textContent('#cart-sub')}`, (await p.textContent('#cart-sub')).includes('enregistré'));
// renommage dans le panier → sauvegardé
await p.click('#cart-open'); await p.waitForTimeout(400);
await p.fill('.item-wrap:nth-child(2) .item-name', 'Mug'); await p.press('.item-wrap:nth-child(2) .item-name', 'Enter');
sv = await p.evaluate(() => JSON.parse(localStorage.getItem('savedCarts')));
ok('renommage sauvegardé', sv[0].items[1].name === 'Mug');
// nouveau panier vide puis « Ajouter à… » Soho
await p.click('#cart-clear'); await p.goBack(); await p.waitForTimeout(200);
await p.fill('#item-name', 'Casquette');
await p.click('#price'); await keys('25'); await close();
await p.click('#add-to-btn'); await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/v4-pick-${scheme}.png` });
await p.click('.pick:has-text("Soho")'); await p.waitForTimeout(300);
sv = await p.evaluate(() => JSON.parse(localStorage.getItem('savedCarts')));
ok(`ajouter à: ${await p.textContent('#toast-msg')} → ${sv[0].items.length} articles`, sv[0].items.length === 3 && sv[0].items[2].name === 'Casquette');
ok('panier en cours inchangé', (await p.textContent('#cart-count')) === '0');
await p.click('#toast-action'); await p.waitForTimeout(100);
sv = await p.evaluate(() => JSON.parse(localStorage.getItem('savedCarts')));
ok('annulation ajouter à', sv[0].items.length === 2);
// 9. taux personnalisé
await p.click('#settings-open'); await p.waitForTimeout(400);
ok(`placeholder taux: ${await p.getAttribute('#set-rate', 'placeholder')}`, (await p.getAttribute('#set-rate', 'placeholder')) === '0,9');
await p.fill('#set-rate', '0,95');
await p.screenshot({ path: `${out}/v4-settings-${scheme}.png`, fullPage: false });
ok(`en-tête: ${await p.textContent('#rate-info')}`, (await p.textContent('#rate-info')).includes('perso'));
await p.goBack(); await p.waitForTimeout(200);
await p.click('#price'); await keys('100'); await close();
m = await main(); ok(`100 $ à 0,95 → ${m}`, m === '103,43 €');
await p.click('#settings-open'); await p.waitForTimeout(300);
await p.click('#rate-reset');
ok(`retour officiel: ${await p.textContent('#rate-info')}`, !(await p.textContent('#rate-info')).includes('personnalisé'));
// 3 + 8. réglages son et langue
ok('son activé par défaut', await p.isChecked('#opt-sound'));
await p.click('label:has(#opt-sound)'); await p.click('label:has-text("English")');
const st = await p.evaluate(() => JSON.parse(localStorage.getItem('settings')));
ok(`réglages: son=${st.sound} langue=${st.voiceLang}`, st.sound === false && st.voiceLang === 'en-US');
await p.goBack(); await p.waitForTimeout(200);
m = await main(); ok(`retour au taux 0,9 → ${m}`, m === '97,99 €');
// 8. analyse vocale
const parsed = await p.evaluate(() => ['34,99 vêtements', 'resto 85', '12 dollars 50 épicerie', '$12.50 grocery', 'souvenir 1,299.00', 'clothes 49'].map((t) => { const r = parseVoice(t); return `${t} → ${r.price} ${r.category}`; }));
console.log('     ', parsed);
ok('analyse vocale', parsed.join('|') === '34,99 vêtements → 34.99 clothes|resto 85 → 85 food|12 dollars 50 épicerie → 12.5 grocery|$12.50 grocery → 12.5 grocery|souvenir 1,299.00 → 1299 shop|clothes 49 → 49 clothes');
await p.evaluate(() => applyVoice(['vingt', '45,50 resto']));
await p.waitForTimeout(400);
ok(`applyVoice: prix ${await p.inputValue('#price')} / ${await p.textContent('.cat[aria-checked="true"]')}`, (await p.inputValue('#price')) === '45,50' && (await p.textContent('.cat[aria-checked="true"]')).includes('Resto'));
await p.screenshot({ path: `${out}/v4-main-${scheme}.png` });
ok('fichier son servi', (await p.evaluate(async () => (await fetch('sounds/baseball.mp3')).status)) === 200);
ok(`${scheme} erreurs JS: ${errs}`, errs.length === 0);
await b.close();
