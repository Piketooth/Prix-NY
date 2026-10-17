// Scan d'étiquette : l'OCR doit fonctionner sans aucune connexion (fichiers dans vendor/tesseract).
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext();
await ctx.addInitScript(() => { sessionStorage.setItem('splash', '1'); });
const p = await ctx.newPage();
const ok = (label, cond) => console.log(cond ? 'OK  ' : 'FAIL', label);
const ext = []; await p.route(/^https:\/\//, (r) => { ext.push(r.request().url()); r.abort(); }); // hors ligne
await p.goto('http://localhost:8765/');
const res = await p.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 600; c.height = 160;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 160);
  g.fillStyle = '#111'; g.font = 'bold 90px Arial'; g.fillText('$12.99', 60, 115);
  const w = await getOcrWorker();
  const { data } = await w.recognize(c);
  return { text: data.text.trim(), prices: extractPrices(data.text) };
});
ok(`lecture hors ligne: ${res.text} → ${res.prices}`, res.prices.includes(12.99));
ok(`aucune requête externe pour l'OCR: ${ext.filter((u) => /tesseract|jsdelivr/.test(u))}`, !ext.some((u) => /tesseract|jsdelivr/.test(u)));
await b.close();
