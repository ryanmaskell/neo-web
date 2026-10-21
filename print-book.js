'use strict';

// PRINT BOOK: what a paperback for KDP is made of, shared by main.js (which
// lays it out in an offscreen window and prints it) and NEO on the web
// (which lays it out in a frame and prints it through the browser): KDP's
// trims, paper and margins, the soft hyphens, and the cover template.
// Plain JavaScript that runs in Node and in a page (window.NeoPrintBook).

(function (root) {
  // KDP's trim sizes NEO offers (inches), its paper (spine thickness per page),
  // and its minimum inside margin by page count. kdp.amazon.com, Oct 2026.
  const KDP_TRIMS = { '5x8': [5, 8], '5.25x8': [5.25, 8], '5.5x8.5': [5.5, 8.5], '6x9': [6, 9] };
  const KDP_PAPER = { white: 0.002252, cream: 0.0025, groundwood: 0.00235 };
  const KDP_MAX_PAGES = { white: 828, cream: 776, groundwood: 812 };
  function kdpGutterMin(pages) {
    return pages <= 150 ? 0.375 : pages <= 300 ? 0.5 : pages <= 500 ? 0.625 : pages <= 700 ? 0.75 : 0.875;
  }
  // the inside margin NEO sets: KDP's minimum plus a quarter inch, so words
  // never run into the fold
  function kdpGutter(pages) { return kdpGutterMin(pages) + 0.25; }

  // Soft hyphens where the language allows a break, so a justified line
  // hyphenates the same on every computer (Chromium hyphenates by itself only
  // on a Mac). Never in a capitalised word (names), never fewer than three
  // letters either side, and not in a paragraph's last word.
  const HYPHEN_LANGS = { en: 'en-us', 'en-gb': 'en-gb', 'en-au': 'en-gb', fr: 'fr', es: 'es', de: 'de-1996', nl: 'nl', pl: 'pl', pt: 'pt', ro: 'ro', ru: 'ru', el: 'el-monoton', hu: 'hu', it: 'it' };
  function hyphenateWord(word, hy, nouns) {
    // a capital is a name, so the word stays whole; except in German, where
    // every noun has one
    if (!nouns && /^\p{Lu}/u.test(word)) return word;
    const h = hy(word);
    if (h === word) return word;
    let out = '';
    let at = 0; // letters so far
    const letters = word.length;
    for (const ch of h) {
      if (ch === '­') { if (at >= 3 && letters - at >= 3) out += ch; continue; }
      out += ch;
      at++;
    }
    return out;
  }
  // hyphenatorFor(lang): the language's hyphenator, or null (main.js requires
  // the patterns; the web loads them as scripts)
  function hyphenateHtml(html, lang, hyphenatorFor) {
    const hy = hyphenatorFor(lang);
    if (!hy) return html;
    const nouns = /^de\b/i.test(String(lang || ''));
    // only the paragraphs app.js marked .hy (prose), text between tags only
    return html.replace(/(<p\b[^>]*\bclass="[^"]*\bhy\b[^"]*"[^>]*>)([\s\S]*?)(<\/p>)/g, (m, open, inner, close) => {
      const parts = inner.split(/(<[^>]+>|&[#\w]+;)/);
      // the last word of the paragraph keeps its hyphens out of the last line
      let lastText = -1;
      parts.forEach((part, i) => { if (i % 2 === 0 && /\p{L}/u.test(part)) lastText = i; });
      return open + parts.map((part, i) => {
        if (i % 2 === 1) return part;
        const words = part.split(/([\p{L}\p{M}]+)/u);
        let lastWord = -1;
        if (i === lastText) words.forEach((w, k) => { if (k % 2 === 1) lastWord = k; });
        return words.map((w, k) => (k % 2 === 1 && k !== lastWord && w.length >= 6 ? hyphenateWord(w, hy, nouns) : w)).join('');
      }).join('') + close;
    });
  }

  // The cover template: the whole wrap (back, spine, front) at KDP's size for
  // this page count, with the bleed, the trim, the spine, the safe areas and
  // the barcode's place drawn in, each labelled. A designer works on top of it.
  function kdpCoverHtml({ trim, paper, pages, title, author, t }) {
    const [tw, th] = KDP_TRIMS[trim];
    const bleed = 0.125;
    const spine = pages * KDP_PAPER[paper];
    const W = bleed + tw + spine + tw + bleed;
    const H = bleed + th + bleed;
    const inch = (n) => n.toFixed(4) + 'in';
    const box = (x, y, w, h, cls, label = '') => `<div class="${cls}" style="left:${inch(x)};top:${inch(y)};width:${inch(w)};height:${inch(h)}">${label}</div>`;
    const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmt = (n) => n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    const mm = (n) => (n * 25.4).toFixed(1);
    const backX = bleed;
    const spineX = bleed + tw;
    const frontX = bleed + tw + spine;
    const safe = 0.125;
    const spineText = pages >= 79;
    const paperName = { white: t('white paper'), cream: t('cream paper'), groundwood: t('groundwood paper') }[paper];
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: ${inch(W)} ${inch(H)}; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { width: ${inch(W)}; height: ${inch(H)}; position: relative; overflow: hidden; font: 8pt/1.35 -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #1f4f8a; background: #fff; }
  div { position: absolute; box-sizing: border-box; }
  .bleed { background: #f6d5d5; }
  .trim { border: 1px solid #c0392b; background: #fff; }
  .spine { background: #eef3fa; border-left: 1px solid #1f4f8a; border-right: 1px solid #1f4f8a; }
  .safe { border: 1px dashed #1f4f8a; }
  .spinesafe { border-left: 1px dashed #1f4f8a; border-right: 1px dashed #1f4f8a; }
  .barcode { background: #fff7d6; border: 1px solid #b7950b; color: #7d6608; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0.08in; }
  .lbl { padding: 0.06in; }
  .panel { display: flex; align-items: center; justify-content: center; text-align: center; color: #9fb4cf; font-size: 20pt; letter-spacing: 0.12em; }
  .info { color: #1f4f8a; }
  .vert { writing-mode: vertical-rl; display: flex; align-items: center; justify-content: center; text-align: center; color: #1f4f8a; font-size: 7pt; }
  </style></head><body>
  ${box(0, 0, W, H, 'bleed')}
  ${box(bleed, bleed, W - 2 * bleed, H - 2 * bleed, 'trim')}
  ${box(spineX, bleed, spine, th, 'spine')}
  ${box(backX + safe, bleed + safe, tw - 2 * safe, th - 2 * safe, 'safe')}
  ${box(frontX + safe, bleed + safe, tw - 2 * safe, th - 2 * safe, 'safe')}
  ${spine > 0.125 ? box(spineX + 0.0625, bleed + safe, spine - 0.125, th - 2 * safe, 'spinesafe') : ''}
  ${box(backX, bleed, tw, th, 'panel', esc(t('BACK COVER')))}
  ${box(frontX, bleed, tw, th, 'panel', esc(t('FRONT COVER')))}
  ${box(backX + tw - 0.25 - 2, bleed + th - 0.25 - 1.2, 2, 1.2, 'barcode', esc(t('Barcode area (KDP adds it here)')) + '<br>2 × 1.2 in')}
  ${box(frontX + safe + 0.05, bleed + safe + 0.05, tw - 2 * safe - 0.1, 1.6, 'lbl info', `<b>${esc(title)}</b>${author ? ' · ' + esc(author) : ''}<br>
  ${esc(t('Full cover: {w} × {h} in ({wmm} × {hmm} mm), bleed included', { w: fmt(W), h: fmt(H), wmm: mm(W), hmm: mm(H) }))}<br>
  ${esc(t('Trim: {w} × {h} in · {pages} pages · {paper}', { w: fmt(tw), h: fmt(th), pages, paper: paperName }))}<br>
  ${esc(t('Spine: {s} in ({smm} mm)', { s: fmt(spine), smm: mm(spine) }))}${spineText ? '' : ' · ' + esc(t('under 79 pages: no text on the spine'))}<br>
  <span style="color:#c0392b">${esc(t('Pink: bleed, cut off. Red line: trim.'))}</span> ${esc(t('Dashed: keep text inside.'))}<br>
  ${esc(t('Use this page as a guide layer and hide it before you export your cover: one PDF, at least 300 DPI.'))}</div>`)}
  ${spine > 0.3 ? box(spineX, bleed, spine, th, 'vert', esc(t('SPINE'))) : ''}
  </body></html>`;
  }

  const api = { KDP_TRIMS, KDP_PAPER, KDP_MAX_PAGES, kdpGutterMin, kdpGutter, HYPHEN_LANGS, hyphenateWord, hyphenateHtml, kdpCoverHtml };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoPrintBook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
