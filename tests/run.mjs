// Lance tous les tests navigateur : node tests/run.mjs (ou npm test).
// Sert l'appli sur http://localhost:8765 et échoue si une vérification affiche FAIL.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));
const out = join(here, 'out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.txt': 'text/plain', '.gz': 'application/gzip' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(8765, r));
await mkdir(out, { recursive: true });

const RUNS = [
  ['saisie.mjs', 'light'], ['saisie.mjs', 'dark'],
  ['panier.mjs', 'light'], ['panier.mjs', 'dark'],
  ['edition.mjs', 'light'], ['edition.mjs', 'dark'],
  ['ecran.mjs', 'light'], ['ecran.mjs', 'dark'],
  ['transport.mjs', 'light'], ['transport.mjs', 'dark'],
  ['ecrans.mjs', 'light'], ['ecrans.mjs', 'dark'],
  ['lot.mjs', 'light'], ['lot.mjs', 'dark'],
  ['notes.mjs', 'light'], ['notes.mjs', 'dark'],
  ['accueil.mjs', 'light'], ['accueil.mjs', 'dark'],
  ['sauvegarde.mjs'], ['ocr.mjs'],
];
let failed = 0;
for (const [file, scheme] of RUNS) {
  const name = scheme ? `${file} (${scheme})` : file;
  const { code, text } = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, file), out, ...(scheme ? [scheme] : [])], { cwd: here });
    let text = '';
    child.stdout.on('data', (d) => { text += d; });
    child.stderr.on('data', (d) => { text += d; });
    child.on('close', (code) => resolve({ code, text }));
  });
  const fails = text.split('\n').filter((l) => l.startsWith('FAIL')).length;
  const oks = text.split('\n').filter((l) => l.startsWith('OK')).length;
  const bad = code !== 0 || fails > 0 || oks === 0;
  if (bad) failed++;
  console.log(`${bad ? '✗' : '✓'} ${name} : ${oks} OK, ${fails} FAIL${code ? `, code ${code}` : ''}`);
  if (bad || process.env.VERBOSE) console.log(text.replace(/^/gm, '    '));
}
server.close();
console.log(failed ? `\n${failed} test(s) en échec` : '\nTous les tests passent');
process.exit(failed ? 1 : 0);
