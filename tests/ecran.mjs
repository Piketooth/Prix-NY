// Écran principal allégé : détail replié, pourboire « Aucun », bandeau avec frais bancaires.
import { chromium } from 'playwright';
const out = process.argv[2];
const scheme = process.argv[3] || 'light';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
await ctx.addInitScript(() => { sessionStorage.setItem('splash', '1'); if (!localStorage.getItem('s8')) { localStorage.setItem('s8', '1'); localStorage.setItem('settings', JSON.stringify({ wallpaper: 'none', fee: 2 })); } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route('https://api.frankfurter.dev/**', r => r.fulfill({ json: { amount: 1, base: 'USD', date: '2026-10-16', rates: { EUR: 0.9 } } }));
await p.route('https://open.er-api.com/**', r => r.abort());
await p.goto('http://localhost:8765/');
await p.waitForFunction(() => document.getElementById('rate-info').textContent.includes('0,9'));
const ok = (label, cond) => console.log(cond ? 'OK  ' : 'FAIL', label);
const keys = async (s) => { for (const ch of s) await p.click(`[data-key="${ch === ',' ? '.' : ch}"]`); };
const close = async () => { if (await p.isVisible('#keypad')) { await p.goBack(); await p.waitForTimeout(150); } };

const rate = await p.textContent('#rate-info');
ok(`bandeau court: ${rate}`, rate.includes('+2 %') && !rate.includes('frais'));
ok('infobulle complète', (await p.getAttribute('#rate-info', 'title')).includes('frais bancaires 2 %'));
const fits = await p.$eval('#rate-info', (el) => el.scrollWidth <= el.clientWidth + 1);
ok('bandeau non coupé', fits);

await p.click('#price'); await keys('100'); await close();
ok('détail replié', await p.isHidden('#breakdown'));
await p.click('#detail-btn');
ok(`détail déplié: ${await p.textContent('#b-tax')}`, (await p.isVisible('#breakdown')) && (await p.getAttribute('#detail-btn', 'aria-expanded')) === 'true');
await p.reload(); await p.waitForTimeout(800);
ok('choix mémorisé', await p.isVisible('#breakdown'));
await p.click('#detail-btn');
ok('replié de nouveau', await p.isHidden('#breakdown'));

ok('barre panier sur une ligne', await p.$eval('#cart-open', (el) => el.getBoundingClientRect().height < 50));
ok('ajout visible sans défiler', await p.$eval('#add-btn', (el) => el.getBoundingClientRect().bottom <= innerHeight));

await p.click('#categories .cat:has-text("Resto")'); await p.waitForTimeout(300);
await p.click('#price'); await p.click('[data-key=back]'); await keys('100'); await close();
const chips = await p.$$eval('#tip-choices .chip', (l) => l.map((x) => x.textContent));
ok(`taux: ${chips}`, chips[0] === 'Aucun' && chips.length === 6);
ok('20 % par défaut', (await p.getAttribute('#tip-choices .chip:has-text("20")', 'aria-checked')) === 'true');
ok('taux sur une ligne', await p.$$eval('#tip-choices .chip', (l) => new Set(l.map((x) => Math.round(x.getBoundingClientRect().top))).size === 1));
await p.click('#tip-choices .chip:has-text("Aucun")'); await p.waitForTimeout(200);
ok(`sans pourboire: ${await p.textContent('#total-sub')}`, (await p.textContent('#total-sub')).includes('$108.88') && (await p.getAttribute('#tip-panel', 'class')).includes('off'));
await p.click('#tip-choices .chip:has-text("18")'); await p.waitForTimeout(200);
ok(`18 %: ${await p.textContent('#b-tip')}`, (await p.textContent('#b-tip')).startsWith('$18.00'));
await p.screenshot({ path: `${out}/ecran-${scheme}.png` });
ok(`${scheme} erreurs JS: ${errs}`, errs.length === 0);
await b.close();
