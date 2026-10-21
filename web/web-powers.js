/* ============================ NEO WEB ============================ */
/* The desktop's powers that live in main.js, done in the browser:      */
/* Paperback for KDP and Manuscript Format as PDFs (Paged.js lays the   */
/* pages out in a frame, as main.js does in an offscreen window, and    */
/* the browser's Print → Save as PDF writes them), painted covers (the  */
/* writer's own OpenAI key, kept in this browser), the emailed snapshot,*/
/* full screen and Check for Update. A save waits for the writer's tap: */
/* the iPad prints only when asked by a finger.                         */

(function (root) {
  const t = (s, vars) => (root.NeoI18n ? root.NeoI18n.t(s, vars) : s);
  const doc = root.document;
  const neo = root.neo;
  const PB = root.NeoPrintBook;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------- laying out pages ---------- */
  // Soft hyphens from the same TeX patterns main.js uses (print/hyphen),
  // loaded as scripts the first time a language is wanted
  const hyphenators = {};
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = doc.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load ' + src));
        doc.head.appendChild(s);
      });
    }
    return loaded[src];
  }
  const globalName = (key) => 'hyphenationPatterns' + key.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
  async function hyphenate(html, lang) {
    const code = String(lang || 'en').toLowerCase();
    const key = PB.HYPHEN_LANGS[code] || PB.HYPHEN_LANGS[code.split('-')[0]];
    if (!key) return html;
    if (!(key in hyphenators)) {
      try {
        await loadScript('print/hyphen/hyphen.js');
        await loadScript('print/hyphen/patterns/' + key + '.js');
        hyphenators[key] = root.createHyphenator(root[globalName(key)], { hyphenChar: '­', minWordLength: 6 });
      } catch (err) { console.warn('hyphen', key, err); hyphenators[key] = null; }
    }
    return PB.hyphenateHtml(html, lang, () => hyphenators[key]);
  }

  // One frame per layout, off the screen but drawing (Paged.js steps through
  // animation frames, which a hidden frame doesn't get). paged-run.js, in
  // the frame, says when it's done and how many pages it made.
  function renderPaged(html, { width, height, plain = false }) {
    return new Promise((resolve, reject) => {
      const frame = doc.createElement('iframe');
      frame.className = 'web-print-frame';
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${Math.round(width * 96)}px;height:${Math.round(height * 96)}px;border:0;`;
      const splice = (s, tag, add) => { const i = s.indexOf(tag); return i < 0 ? add + s : s.slice(0, i) + add + s.slice(i); };
      frame.srcdoc = plain ? html : splice(String(html), '</head>', '<script src="paged-run.js"></script><script src="print/paged.polyfill.js"></script>');
      doc.body.appendChild(frame);
      const started = Date.now();
      const look = () => {
        let w = null;
        try { w = frame.contentWindow; } catch { /* not yet */ }
        if (plain && w && w.document && w.document.readyState === 'complete') { resolve({ frame, pages: 1 }); return; }
        if (w && w.__neoPagedError) { frame.remove(); reject(new Error('Page layout failed: ' + String(w.__neoPagedError).split('\n')[0])); return; }
        if (w && w.__neoPages) { resolve({ frame, pages: w.__neoPages }); return; }
        if (Date.now() - started > 10 * 60 * 1000) { frame.remove(); reject(new Error('Page layout took too long')); return; }
        setTimeout(look, 150);
      };
      setTimeout(look, 200);
    });
  }

  // the frame's pages to the browser's printing: Save as PDF (on an iPad,
  // the print screen's share button saves the PDF)
  function printFrame(frame) {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (err) { throw new Error(t('This browser wouldn’t print: {error}', { error: String(err && err.message || err) })); }
  }

  // The finished files wait in a small dialog, one button each: printing
  // needs a tap of its own on an iPad, and a browser shows one print
  // screen at a time
  function saveDialog(title, line, files) {
    return new Promise((resolve) => {
      const bd = doc.createElement('div');
      bd.className = 'modal-backdrop';
      bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:460px">
        <h2>${esc(title)}</h2><p>${esc(line)}</p>
        <p class="ws-soft" style="font-size:13px;color:var(--muted)">${esc(t('Each opens the print screen: choose Save as PDF (on an iPad, the share button at the top of the print screen).'))}</p>
        <div class="web-save-list" style="display:flex;flex-direction:column;gap:10px;margin:6px 0 16px"></div>
        <div style="text-align:right"><button class="btn-quiet m-ok">${esc(t('Done'))}</button></div></div>`;
      const list = bd.querySelector('.web-save-list');
      let any = false;
      for (const f of files) {
        const b = doc.createElement('button');
        b.className = 'btn-gold';
        b.textContent = f.label;
        b.addEventListener('click', () => {
          any = true;
          try { printFrame(f.frame); b.textContent = '✓ ' + f.label; } catch (err) { if (typeof root.toast === 'function') root.toast(String(err.message || err)); }
        });
        list.appendChild(b);
      }
      bd.querySelector('.m-ok').addEventListener('click', () => {
        bd.remove();
        for (const f of files) f.frame.remove();
        resolve(any);
      });
      doc.body.appendChild(bd);
    });
  }

  let busy = false;
  const oneAtATime = async (fn) => {
    if (busy) throw new Error(t('Another export is still being set. Try again when it’s done.'));
    busy = true;
    try { return await fn(); } finally { busy = false; }
  };

  // as main.js makePaperback: the inside margin widens with the page count,
  // and a blank page goes in or out to end on a left-hand page
  neo.printPaperback = (job) => oneAtATime(async () => {
    const { html, trim, paper, pagesGuess, title, author, defaultName, language } = job;
    if (!PB.KDP_TRIMS[trim] || !PB.KDP_PAPER[paper]) throw new Error('Unknown trim size or paper');
    const [tw, th] = PB.KDP_TRIMS[trim];
    const hyphenated = await hyphenate(html, language);
    let gutter = PB.kdpGutter(Math.max(24, pagesGuess || 200));
    let result = null;
    let pad = false;
    let settled = false;
    for (let pass = 0; pass < 10 && !settled; pass++) {
      if (result) result.frame.remove();
      const page = hyphenated.replace(/__NEO_GUTTER__/g, gutter.toFixed(3) + 'in')
        .replace('</body>', pad ? '<div class="neo-pad"></div></body>' : '</body>');
      result = await renderPaged(page, { width: tw, height: th });
      if (PB.kdpGutter(result.pages) > gutter) gutter = PB.kdpGutter(result.pages);
      else if (result.pages % 2 === 1) pad = !pad;
      else settled = true;
    }
    if (!settled) { result.frame.remove(); throw new Error('The page count would not settle'); }
    const pages = result.pages;
    const cover = await renderPaged(PB.kdpCoverHtml({ trim, paper, pages, title, author, t }), { width: 0.25 + tw * 2 + pages * PB.KDP_PAPER[paper], height: th + 0.25, plain: true });
    const spine = +(pages * PB.KDP_PAPER[paper]).toFixed(3);
    const coverName = defaultName + ' - ' + t('cover template');
    const saved = await saveDialog(t('Paperback for KDP'), t('{pages} pages on {trim} in, spine {spine} in.', { pages, trim: trim.replace('x', ' × '), spine }), [
      { label: t('Save the interior PDF'), frame: result.frame, name: defaultName },
      { label: t('Save the cover template PDF'), frame: cover.frame, name: coverName }
    ]);
    if (!saved) return null;
    return { file: defaultName + '.pdf', cover: coverName + '.pdf', pages, spine, tooFew: pages < 24, tooMany: pages > PB.KDP_MAX_PAGES[paper] };
  });

  // File → Export → Manuscript Format… as a PDF (manuscript.js's page)
  neo.printManuscript = ({ html, paper, defaultName }) => oneAtATime(async () => {
    const [width, height] = paper === 'A4' ? [8.2677, 11.6929] : [8.5, 11];
    const { frame, pages } = await renderPaged(String(html || ''), { width, height });
    const saved = await saveDialog(t('Manuscript Format'), t('{pages} pages.', { pages }), [{ label: t('Save the PDF'), frame, name: defaultName }]);
    return saved ? { file: String(defaultName || 'manuscript') + '.pdf', pages } : null;
  });

  /* ---------- painted covers: the writer's own key ---------- */
  // kept in this browser only (never in the library, never synced)
  const SECRET = (name) => 'neo-secret-' + name;
  neo.hasSecret = async (name) => { try { return !!root.localStorage.getItem(SECRET(name)); } catch { return false; } };
  neo.setSecret = async (name, value) => {
    try {
      if (value) root.localStorage.setItem(SECRET(name), String(value));
      else root.localStorage.removeItem(SECRET(name));
      return true;
    } catch { return false; }
  };
  const painting = new Map();
  neo.paintCover = (bookId, text, options) => {
    if (painting.has(bookId)) return painting.get(bookId);
    const job = (async () => {
      const provider = (options && options.provider) || 'openai';
      let apiKey = null;
      try { apiKey = root.localStorage.getItem(SECRET(provider)); } catch { /* none */ }
      if (!apiKey) return { error: t('No API key for {provider} — add one under File → Cover Art…', { provider }) };
      const store = root.NeoStore;
      await store.ready;
      if (!store.get(bookId + '/book.json')) return { error: t('Book folder is missing') };
      try {
        await loadScript('art-web.js');
        const out = await root.NeoArt.paintCover({
          provider, apiKey, text: String(text || ''),
          textModel: options && options.textModel, imageModel: options && options.imageModel, quality: options && options.quality
        });
        // older paintings go; the writer's own cover-* pictures stay
        for (const p of store.paths()) if (p.startsWith(bookId + '/') && /^art-\d+\.(png|jpg|webp)$/.test(p.slice(bookId.length + 1))) await store.remove(p);
        const fname = 'art-' + Date.now() + '.' + (out.ext || 'jpg');
        await store.put(bookId + '/' + fname, out.base64, 'base64');
        await store.put(bookId + '/art.json', JSON.stringify({
          file: fname, brief: out.brief, provider, textModel: out.textModel, imageModel: out.imageModel, painted: new Date().toISOString()
        }, null, 2), 'utf8');
        return { file: fname, brief: out.brief };
      } catch (err) {
        neo.logError('paint: ' + (err && err.message || err));
        return { error: String((err && err.message) || err) };
      }
    })();
    painting.set(bookId, job);
    job.finally(() => painting.delete(bookId));
    return job;
  };

  /* ---------- Email Draft to Myself ---------- */
  // the snapshot is printed to a PDF (the writer saves it), then the mail
  // opens addressed and filled in, to attach it
  neo.emailDraft = async ({ to, subject, body, html, defaultName, method, print }) => {
    const width = print === 'screenplay' ? 8.5 : (neo.paper === 'A4' ? 8.2677 : 8.5);
    const height = print === 'screenplay' ? 11 : (neo.paper === 'A4' ? 11.6929 : 11);
    const page = print === 'screenplay' ? html : String(html).replace('</head>', '<style>@page { margin: 1in; }</style></head>');
    const { frame } = await renderPaged(page, { width, height, plain: true });
    const gmail = method === 'gmail';
    const url = gmail
      ? 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to) + '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body)
      : 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    await new Promise((resolve) => {
      const bd = doc.createElement('div');
      bd.className = 'modal-backdrop';
      bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:440px">
        <h2>${esc(t('Email Draft to Myself'))}</h2>
        <p>${esc(t('Save the snapshot as a PDF, then open the email and attach it.'))}</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
          <button class="btn-gold" data-a="pdf">${esc(t('Save the PDF'))}</button>
          <a class="btn-gold" style="text-align:center;text-decoration:none" href="${esc(url)}" target="_blank" rel="noopener" data-a="mail">${esc(gmail ? t('Open Gmail') : t('Open my mail'))}</a>
        </div>
        <div style="text-align:right"><button class="btn-quiet m-ok">${esc(t('Done'))}</button></div></div>`;
      bd.querySelector('[data-a="pdf"]').addEventListener('click', () => printFrame(frame));
      bd.querySelector('.m-ok').addEventListener('click', () => { bd.remove(); frame.remove(); resolve(); });
      doc.body.appendChild(bd);
    });
    return { ok: true, method: gmail ? 'gmail' : 'mailto', file: (defaultName || 'snapshot') + '.pdf' };
  };

  /* ---------- the window ---------- */
  const fsEl = () => doc.fullscreenElement || doc.webkitFullscreenElement;
  neo.fullscreenToggle = async () => {
    const d = doc.documentElement;
    try {
      if (fsEl()) await (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
      else await (d.requestFullscreen || d.webkitRequestFullscreen).call(d);
    } catch { /* this browser keeps its bars */ }
    return true;
  };
  neo.fullscreenEscape = async () => {
    if (!fsEl()) return false;
    try { await (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc); } catch { /* fine */ }
    return true;
  };
  neo.lookUpText = async () => false;

  // the site updates itself: a new version is fetched in the background
  // and opens next time; this asks for it now
  neo.checkForUpdate = async () => {
    const current = (root.NEO_CONFIG && root.NEO_CONFIG.version) || '';
    try {
      const reg = root.navigator.serviceWorker && await root.navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        if (reg.installing || reg.waiting) {
          setTimeout(() => { if (typeof root.toast === 'function') root.toast(t('A new NEO is ready: it opens the next time you open NEO.'), 8000); }, 800);
        }
      }
    } catch { /* offline: what's here is what there is */ }
    return { hasUpdate: false, currentVersion: current };
  };
  neo.installUpdate = async () => { root.location.reload(); return true; };
  neo.openRelease = async () => true;
})(typeof globalThis !== 'undefined' ? globalThis : this);
