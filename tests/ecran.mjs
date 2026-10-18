// Écran principal allégé : détail replié, pourboire « Aucun », bandeau avec frais bancaires.
import { chromium } from 'playwright';
const out = process.argv[2];
const scheme = process.argv[3] || 'light';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, timezoneId: 'Europe/Paris' });
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
// Réglages : mise à jour manuelle du cours, titres en gothique
await p.click('#settings-open'); await p.waitForTimeout(400);
ok(`titre gothique: ${await p.$eval('#settings-title', (e) => getComputedStyle(e).fontFamily)}`, (await p.$eval('#settings-title', (e) => getComputedStyle(e).fontFamily)).includes('Manufacturing Consent'));
ok(`date du cours: ${await p.textContent('#rate-checked')}`, (await p.textContent('#rate-checked')).includes('vendredi 16 octobre'));
await p.click('#rate-refresh'); await p.waitForTimeout(400);
ok(`mise à jour: ${(await p.textContent('#toast')).trim()}`, (await p.textContent('#toast')).includes('Déjà le dernier cours publié (16/10)'));
// Deuxième horloge : Paris par défaut, puis Montréal saisie au clavier maison (sans correction)
ok(`horloges: ${await p.textContent('.mast-clocks')}`, (await p.textContent('#clock-ny')).includes('New York') && /^Paris \d\d:\d\d · \+[56] h$/.test(await p.textContent('#clock-home')));
ok('plus de « New York » seul dans la ligne d\'édition', !(await p.textContent('.mast-edition')).includes('New York'));
await p.click('#set-city'); await p.waitForTimeout(200);
const key = async (k) => { await p.locator(`#kbd [data-key="${k}"]`).first().dispatchEvent('pointerdown'); await p.locator(`#kbd [data-key="${k}"]`).first().dispatchEvent('pointerup'); };
for (const k of 'mon') await key(k);
ok('pas de suggestions du dictionnaire', (await p.$$('.kbd-sug')).length === 0);
await p.click('#city-suggest .chip:has-text("Montréal")'); await p.waitForTimeout(400);
ok(`Montréal: ${await p.textContent('#clock-home')}`, (await p.textContent('#clock-home')).endsWith('même heure'));
await p.reload(); await p.waitForTimeout(800);
ok('ville mémorisée', (await p.textContent('#clock-home')).startsWith('Montréal'));
ok(`pas d'icône devant New York: ${await p.textContent('#clock-ny')}`, /^New York \d\d:\d\d$/.test(await p.textContent('#clock-ny')));
// Ville dictée (reconnaissance vocale simulée)
await p.evaluate(() => {
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() { setTimeout(() => { this.onresult?.({ results: [[{ transcript: 'Genève' }]] }); this.onend?.(); }, 50); }
  };
});
await p.click('#settings-open'); await p.waitForTimeout(300);
await p.click('#city-voice'); await p.waitForTimeout(500);
ok(`dictée: ${await p.textContent('#clock-home')}`, (await p.textContent('#clock-home')).startsWith('Genève') && (await p.inputValue('#set-city')) === 'Genève');
// Géolocalisation : Lyon (position et nom de ville simulés)
await ctx.grantPermissions(['geolocation']);
await ctx.setGeolocation({ latitude: 45.76, longitude: 4.84 });
await p.route('https://api.bigdatacloud.net/**', (r) => r.fulfill({ json: { city: 'Lyon', locality: 'Lyon', countryName: 'France' } }));
await p.click('#city-locate'); await p.waitForTimeout(800);
ok(`position: ${await p.textContent('#clock-home')}`, /^Lyon \d\d:\d\d · \+[56] h$/.test(await p.textContent('#clock-home')));
ok(`${scheme} erreurs JS: ${errs}`, errs.length === 0);
await b.close();
