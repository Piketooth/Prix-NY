// Bandeau fixe, calculatrice, hôtel, saisie du prix, bulles ⓘ, touche retour, givré en %.
import { chromium } from 'playwright';
const out = process.argv[2];
const scheme = process.argv[3] || 'light';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
await ctx.addInitScript(() => { sessionStorage.setItem('splash', '1'); if (!localStorage.getItem('s11')) { localStorage.setItem('s11', '1'); localStorage.setItem('settings', JSON.stringify({ wallpaper: 'none' })); } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route('https://api.frankfurter.dev/**', r => r.fulfill({ json: { amount: 1, base: 'USD', date: '2026-10-16', rates: { EUR: 0.9 } } }));
await p.route('https://open.er-api.com/**', r => r.abort());
await p.goto('http://localhost:8765/');
await p.waitForFunction(() => document.getElementById('rate-info').textContent.includes('0,9'));
const ok = (label, cond) => console.log(cond ? 'OK  ' : 'FAIL', label);
const keys = async (s) => { for (const ch of s) await p.click(`[data-key="${ch === ',' ? '.' : ch}"]`); };
const close = async () => { if (await p.isVisible('#keypad')) { await p.goBack(); await p.waitForTimeout(200); } };

// Nom et bandeau
ok(`titre: ${await p.title()} / ${await p.textContent('.mast-title')}`, (await p.title()) === 'New York' && (await p.textContent('.mast-title')) === 'New York');
ok('sous-titre de lancement', (await (await p.request.get('http://localhost:8765/index.html')).text()).includes('<span class="splash-sub">Octobre 2026</span>'));
ok('lignes du bandeau en police métro', (await p.$eval('#rate-info', (e) => getComputedStyle(e).fontFamily)).includes('Archivo Narrow'));
await p.click('#menu-open'); await p.click('#menu-settings'); await p.waitForTimeout(300);
const head = await p.evaluate(() => { const h = document.querySelector('header.masthead').getBoundingClientRect(); const t = document.getElementById('settings-title').getBoundingClientRect(); return { pos: getComputedStyle(document.querySelector('header.masthead')).position, hb: h.bottom, tt: t.top }; });
ok(`bandeau fixe au-dessus du titre de page: ${JSON.stringify(head)}`, head.pos === 'fixed' && head.tt >= head.hb);
ok('menu disponible sur la page', await p.isVisible('#menu-open'));
const groups = await p.$$eval('.settings-group', (l) => l.map((x) => x.textContent));
ok(`rubriques: ${groups.join(', ')}`, groups.join() === 'Argent,Heure,Saisie,Navigation,Apparence');
ok(`givré en %: ${await p.textContent('#set-frost-v')}`, /^\d+ %$/.test(await p.textContent('#set-frost-v')));
// Bulles ⓘ : croix en haut à gauche, toucher en dehors
await p.click('#settings-info'); await p.waitForTimeout(250);
ok('pas de bouton Compris', !(await p.$('#info-dialog .btn')));
const x = await p.$eval('#info-dialog .info-close', (e) => { const r = e.getBoundingClientRect(); const d = e.closest('dialog').getBoundingClientRect(); return r.left - d.left < 40 && r.top - d.top < 40; });
ok('croix en haut à gauche', x);
await p.click('#info-dialog .info-close'); await p.waitForTimeout(200);
ok('fermée par la croix', !(await p.isVisible('#info-dialog')));
await p.click('#settings-info'); await p.waitForTimeout(250);
await p.mouse.click(20, 830); await p.waitForTimeout(200);
ok('fermée en touchant à côté', !(await p.isVisible('#info-dialog')));
// Touche retour : fenêtre avec clavier → seul le clavier se ferme
await p.click('#menu-open'); await p.click('#menu-cart'); await p.waitForTimeout(300);
await p.click('#cart-title'); await p.waitForTimeout(300);
ok('fenêtre et clavier ouverts', (await p.isVisible('#ask-dialog')) && (await p.evaluate(() => Kbd.isOpen())));
await p.evaluate(() => onBackButton()); await p.waitForTimeout(300);
ok('retour : clavier fermé, fenêtre toujours là', !(await p.evaluate(() => Kbd.isOpen())) && (await p.isVisible('#ask-dialog')));
await p.evaluate(() => onBackButton()); await p.waitForTimeout(300);
ok('retour : fenêtre fermée, page panier toujours là', !(await p.isVisible('#ask-dialog')) && (await p.isVisible('#cart-view')));
ok('page panier : titre et nom', (await p.textContent('#cart-view h2')) === 'Panier en cours' && (await p.textContent('#cart-title')) === 'Sans nom');
ok('réinitialiser sur la ligne du nom', await p.evaluate(() => document.getElementById('cart-clear').parentElement.classList.contains('cart-name-row')));
await p.evaluate(() => onBackButton()); await p.waitForTimeout(300);
ok('retour : accueil', (await p.evaluate(() => openViews.length)) === 0);

// Saisie du prix : seuls $ et € affichés
await p.click('#price'); await keys('49,99'); await p.waitForTimeout(400);
const pm = await p.evaluate(() => ({ cls: document.body.classList.contains('price-mode'), main: getComputedStyle(document.querySelector('main')).opacity, usd: document.getElementById('pf-usd').textContent, eur: document.getElementById('pf-eur').textContent }));
ok(`mode saisie: ${JSON.stringify(pm)}`, pm.cls && pm.main === '0' && pm.usd === '$49,99' && pm.eur.replace(/\s/g, ' ') === '48,98 €');
await p.evaluate(() => onBackButton()); await p.waitForTimeout(400);
ok('retour : pavé fermé, accueil réaffiché', !(await p.isVisible('#keypad')) && (await p.evaluate(() => getComputedStyle(document.querySelector('main')).opacity)) === '1');

// Hôtel : 200 $ la nuit, 3 nuits → 600 + 14,75 % + 3 × 3,50 = 699,00 $
await p.click('#categories .cat:has-text("Hôtel")');
await p.click('#price'); for (let i = 0; i < 6; i++) await p.click('[data-key=back]'); await keys('200'); await close();
await p.click('#step-plus'); await p.click('#step-plus'); await p.waitForTimeout(300);
ok(`hôtel: ${await p.textContent('#stepper-label')} ${await p.textContent('#step-value')} → ${await p.textContent('#total-sub')}`, (await p.textContent('#stepper-label')) === 'Nuits' && (await p.textContent('#total-sub')).includes('$699.00'));
ok(`texte court hôtel: ${await p.textContent('#cat-info-text')}`, (await p.textContent('#cat-info-text')) === '+ 14,75 % et 3,50 $ par nuit');
await p.click('#cat-info'); await p.waitForTimeout(200);
ok('explication hôtel', (await p.textContent('#info-body')).includes('Javits Center'));
await p.keyboard.press('Escape');

// Calculatrice (menu et balayage)
await p.click('#menu-open'); await p.click('#menu-calc'); await p.waitForTimeout(300);
for (const k of ['1', '2', ',', '5', '×', '3', '+', '1', '0', '%']) await p.click(`#calc-keys button:text-is("${k}")`);
ok(`calcul: ${await p.textContent('#calc-result')}`, (await p.textContent('#calc-result')) === '41,25');
await p.click('#calc-keys button:text-is("=")');
await p.keyboard.type('/5'); await p.keyboard.press('Enter');
ok(`clavier physique: ${await p.textContent('#calc-result')}`, (await p.textContent('#calc-result')) === '8,25');
await p.click('#calc-keys button:text-is("C")');
ok('effacer', (await p.textContent('#calc-result')) === '0');
await p.screenshot({ path: `${out}/lot-${scheme}.png` });
ok(`${scheme} erreurs JS: ${errs}`, errs.length === 0);
await b.close();
