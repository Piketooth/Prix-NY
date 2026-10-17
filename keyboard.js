'use strict';

// Clavier maison (AZERTY) pour les champs texte marqués data-kbd, avec suggestions,
// correction automatique à l'espace et apprentissage des mots gardés.
// S'appuie sur openView, haptic et $ définis dans app.js.

const Kbd = (() => {
  const ROWS = {
    abc: [
      ['a', 'z', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['q', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm'],
      ['shift', 'w', 'x', 'c', 'v', 'b', 'n', "'", 'back'],
      ['123', ',', 'space', '.', 'ok'],
    ],
    num: [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
      ['-', '/', ':', ';', '(', ')', '&', '@', '"', '#'],
      ['%', '+', '=', '*', '!', '?', '€', '$', 'back'],
      ['abc', ',', 'space', '.', 'ok'],
    ],
  };
  const ACCENTS = {
    e: ['é', 'è', 'ê', 'ë'], a: ['à', 'â', 'æ'], c: ['ç'], u: ['ù', 'û', 'ü'],
    i: ['î', 'ï'], o: ['ô', 'œ', 'ö'], y: ['ÿ'], "'": ['’'],
  };
  const LETTERS = 'abcdefghijklmnopqrstuvwxyzàâäçéèêëîïôöùûüÿœæ';
  const LEARN_KEY = 'kbdLearned';

  let el, sugBar, keysBox, popup;
  let target = null;
  let layer = 'abc';
  let shift = 'off'; // off | once | lock
  let lastShiftTap = 0;
  let lastCorrection = null; // { before, after } : ⌫ juste après annule la correction
  let dict = null; // Map mot → rang (0 = plus fréquent)
  let byStripped = null; // Map mot sans accents → meilleur mot accentué
  let learned = new Set();

  const strip = (w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const isOpen = () => el && !el.hidden;

  async function loadDict() {
    if (dict) return;
    dict = new Map();
    byStripped = new Map();
    try {
      learned = new Set(JSON.parse(localStorage.getItem(LEARN_KEY) || '[]'));
    } catch { learned = new Set(); }
    try {
      const text = await (await fetch('dict/words.txt')).text();
      text.split('\n').forEach((w, i) => {
        if (!w) return;
        dict.set(w, i);
        const s = strip(w);
        if (!byStripped.has(s)) byStripped.set(s, w);
      });
    } catch { /* sans dictionnaire : clavier sans correction */ }
  }

  const known = (w) => dict?.has(w) || learned.has(w);
  const rank = (w) => (learned.has(w) ? -1 : dict?.get(w) ?? Infinity);

  // Meilleure correction pour un mot inconnu (accents manquants ou une faute de frappe).
  function correction(word) {
    const w = word.toLowerCase();
    if (w.length < 3 || known(w) || /\d/.test(w)) return null;
    const accented = byStripped?.get(strip(w));
    if (accented && accented !== w) return accented;
    let best = null;
    for (const c of edits1(w)) {
      if (known(c) && (best == null || rank(c) < rank(best))) best = c;
    }
    return best;
  }

  function edits1(w) {
    const out = new Set();
    for (let i = 0; i <= w.length; i++) {
      const a = w.slice(0, i), b = w.slice(i);
      if (b) out.add(a + b.slice(1)); // suppression
      if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2)); // inversion
      for (const ch of LETTERS) {
        if (b) out.add(a + ch + b.slice(1)); // remplacement
        out.add(a + ch + b); // insertion
      }
    }
    out.delete(w);
    return out;
  }

  function suggestions(word) {
    const w = word.toLowerCase();
    if (!w) return [];
    const res = [];
    const fix = correction(w);
    if (fix) res.push(fix);
    for (const l of learned) if (l.startsWith(w) && l !== w && !res.includes(l)) res.push(l);
    if (dict) {
      for (const [d] of dict) { // la Map est triée par fréquence
        if (res.length >= 3) break;
        if (d !== w && (d.startsWith(w) || strip(d).startsWith(strip(w))) && !res.includes(d)) res.push(d);
      }
    }
    return res.slice(0, 3);
  }

  const matchCase = (src, w) => (src[0] && src[0] === src[0].toUpperCase() && src[0] !== src[0].toLowerCase()
    ? w[0].toUpperCase() + w.slice(1) : w);

  // Mot en cours juste avant le curseur.
  function currentWord() {
    const pos = target.selectionStart ?? target.value.length;
    const before = target.value.slice(0, pos);
    const m = before.match(/[\p{L}'’-]+$/u);
    return { word: m ? m[0] : '', start: pos - (m ? m[0].length : 0), pos };
  }

  function insert(text) {
    const max = target.maxLength > 0 ? target.maxLength : Infinity;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    if (target.value.length - (end - start) + text.length > max) { haptic('warning'); return; }
    target.setRangeText(text, start, end, 'end');
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function replaceWord(start, pos, text) {
    target.setRangeText(text, start, pos, 'end');
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function autoShift() {
    if (shift === 'lock') return;
    const pos = target.selectionStart ?? target.value.length;
    const before = target.value.slice(0, pos);
    shift = before.trim() === '' || /[.!?]\s+$/.test(before) ? 'once' : 'off';
  }

  function press(key) {
    if (!target) return;
    lastCorrection = key === 'back' ? lastCorrection : null;
    switch (key) {
      case 'shift': {
        const now = Date.now();
        shift = shift === 'off' ? 'once' : (shift === 'once' && now - lastShiftTap < 400 ? 'lock' : 'off');
        lastShiftTap = now;
        break;
      }
      case 'back': {
        if (lastCorrection) {
          const { start, after, before } = lastCorrection;
          target.setRangeText(before, start, start + after.length, 'end');
          target.dispatchEvent(new Event('input', { bubbles: true }));
          learned.add(before.trim().toLowerCase()); // le mot refusé est appris
          saveLearned();
          lastCorrection = null;
        } else {
          const s = target.selectionStart ?? target.value.length;
          const e = target.selectionEnd ?? s;
          if (s !== e) target.setRangeText('', s, e, 'end');
          else if (s > 0) target.setRangeText('', s - 1, s, 'end');
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
        autoShift();
        break;
      }
      case 'space': {
        const { word, start, pos } = currentWord();
        const fix = word && correction(word);
        if (fix) {
          const fixed = matchCase(word, fix);
          replaceWord(start, pos, `${fixed} `);
          lastCorrection = { start, before: `${word} `, after: `${fixed} ` };
        } else {
          insert(' ');
        }
        autoShift();
        break;
      }
      case 'ok': close(); return;
      case '123': layer = 'num'; break;
      case 'abc': layer = 'abc'; break;
      default: {
        const ch = shift !== 'off' ? key.toUpperCase() : key;
        insert(ch);
        if (shift === 'once') shift = 'off';
        if ('.!?'.includes(key)) autoShift();
      }
    }
    haptic();
    render();
  }

  function pickSuggestion(s) {
    const { word, start, pos } = currentWord();
    replaceWord(start, pos, `${matchCase(word || s, s)} `);
    lastCorrection = null;
    haptic();
    autoShift();
    render();
  }

  function saveLearned() {
    try { localStorage.setItem(LEARN_KEY, JSON.stringify([...learned].slice(-500))); } catch { /* ignore */ }
  }

  // À la fermeture, les mots inconnus gardés tels quels sont appris.
  function learnFromField() {
    if (!target || !dict) return;
    for (const w of target.value.toLowerCase().match(/[\p{L}'’-]{3,}/gu) || []) {
      if (!known(w)) learned.add(w);
    }
    saveLearned();
  }

  function keyLabel(k) {
    const labels = {
      shift: shift === 'lock' ? '⇪' : '⇧', back: '⌫', space: 'espace', ok: 'OK', '123': '123', abc: 'ABC',
    };
    if (labels[k]) return labels[k];
    return shift !== 'off' && layer === 'abc' ? k.toUpperCase() : k;
  }

  function render() {
    if (!el) return;
    const { word } = target ? currentWord() : { word: '' };
    sugBar.replaceChildren();
    for (const s of suggestions(word)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kbd-sug';
      b.textContent = matchCase(word, s);
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', () => pickSuggestion(s));
      sugBar.append(b);
    }
    keysBox.replaceChildren();
    for (const row of ROWS[layer]) {
      const r = document.createElement('div');
      r.className = 'kbd-row';
      for (const k of row) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `kbd-key k-${/^[\w]+$/.test(k) && k.length > 1 ? k : 'char'}`;
        if (k === 'shift' && shift !== 'off') b.classList.add('active');
        b.textContent = keyLabel(k);
        b.dataset.key = k;
        bindKey(b, k);
        r.append(b);
      }
      keysBox.append(r);
    }
  }

  function bindKey(b, k) {
    let timer = null, popped = false, repeat = null;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // garde le focus dans le champ
      b.classList.add('pressed');
      popped = false;
      if (ACCENTS[k] && layer === 'abc') {
        timer = setTimeout(() => { popped = true; showAccents(b, k); }, 380);
      }
      if (k === 'back') {
        timer = setTimeout(() => { popped = true; repeat = setInterval(() => press('back'), 70); }, 450);
      }
    });
    const end = () => {
      b.classList.remove('pressed');
      clearTimeout(timer);
      clearInterval(repeat);
      repeat = null;
    };
    b.addEventListener('pointerup', () => { end(); if (!popped) press(k); });
    b.addEventListener('pointerleave', end);
    b.addEventListener('pointercancel', end);
  }

  function showAccents(b, k) {
    popup.replaceChildren();
    for (const a of ACCENTS[k]) {
      const p = document.createElement('button');
      p.type = 'button';
      p.className = 'kbd-key';
      p.textContent = shift !== 'off' ? a.toUpperCase() : a;
      p.addEventListener('pointerdown', (e) => e.preventDefault());
      p.addEventListener('click', () => { popup.hidden = true; press(a); });
      popup.append(p);
    }
    const r = b.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    popup.hidden = false;
    popup.style.left = `${Math.max(4, Math.min(host.width - popup.offsetWidth - 4, r.left - host.left - 8))}px`;
    popup.style.top = `${r.top - host.top - popup.offsetHeight - 6}px`;
    haptic('medium');
  }

  function build() {
    el = document.createElement('div');
    el.id = 'kbd';
    el.className = 'kbd';
    el.hidden = true;
    sugBar = document.createElement('div');
    sugBar.className = 'kbd-sugs';
    keysBox = document.createElement('div');
    keysBox.className = 'kbd-keys';
    popup = document.createElement('div');
    popup.className = 'kbd-popup';
    popup.hidden = true;
    el.append(sugBar, keysBox, popup);
    el.addEventListener('pointerdown', (e) => { if (!e.target.closest('.kbd-popup')) popup.hidden = true; });
    document.body.append(el);
  }

  // Garde le champ visible au-dessus du clavier.
  function reveal() {
    const h = el.offsetHeight;
    document.body.style.setProperty('--kp-h', `${h}px`);
    document.body.classList.add('kp-open');
    const field = target;
    if (field.closest('dialog')) return;
    setTimeout(() => {
      if (!isOpen() || target !== field) return; // fermé ou changé entre-temps
      const overlap = field.getBoundingClientRect().bottom - (innerHeight - h - 16);
      if (overlap > 0) {
        const scroller = field.closest('.cart-list') || window;
        scroller.scrollBy({ top: overlap, behavior: 'smooth' });
      }
    }, 30);
  }

  async function open(input) {
    if (!el) build();
    // Dans une fenêtre modale, le clavier doit être dans la fenêtre pour rester cliquable.
    const host = input.closest('dialog') || document.body;
    if (el.parentElement !== host) host.append(el);
    const switching = isOpen();
    if (switching && target && target !== input) learnFromField();
    target = input;
    layer = 'abc';
    lastCorrection = null;
    if (!switching) openView('kbd', false);
    autoShift();
    render();
    reveal();
    await loadDict();
    if (target === input) render();
  }

  function close() {
    if (isOpen() && openViews.at(-1)?.id === 'kbd') history.back();
  }

  // Appelé par app.js quand l'entrée d'historique du clavier est retirée.
  function hide() {
    if (!el) return;
    learnFromField();
    el.hidden = true;
    popup.hidden = true;
    document.body.classList.remove('kp-open');
    target?.blur();
    target = null;
  }

  function init() {
    document.addEventListener('focusin', (e) => {
      const t = e.target;
      if (t.matches?.('input[data-kbd]')) open(t);
    });
    // Entrée (clavier physique) valide le champ et ferme le clavier maison.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && isOpen() && e.target === target) close();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!isOpen()) return;
      if (e.target.closest('#kbd, input[data-kbd], #price')) return;
      close();
    });
  }

  return { init, open, close, hide, isOpen, element: () => el, _correction: correction, _suggestions: suggestions, _load: loadDict };
})();

Kbd.init();
