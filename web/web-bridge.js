/* ============================ NEO WEB ============================ */
/* What a browser does differently from Pocket's phones, laid over the  */
/* window.neo that pocket-bridge.js made: manuscripts come in through   */
/* the file picker or a drop, exports go out through the share sheet or */
/* a download, PDFs through the browser's own printing. And the shelf's */
/* one extra button: Sync & Files (OneDrive, and the library as a .zip  */
/* for iCloud Drive). Nothing here shows while the writer is writing.   */

(function (root) {
  const t = (s, vars) => (root.NeoI18n ? root.NeoI18n.t(s, vars) : s);
  const neo = root.neo;
  const doc = root.document;
  const cfg = root.NEO_CONFIG || {};
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const showError = (msg) => { if (typeof root.toast === 'function') root.toast(msg, 8000); else console.error(msg); };

  /* ---------- files the writer hands over ---------- */
  // app.js asks for a file's path (desktop: where it is on disk) and passes
  // paths back; here a path is a token for the File itself, ending in the
  // file's own name so app.js's checks on the extension hold
  const picked = new Map();
  let seq = 0;
  neo.pathForFile = (file) => {
    if (!file) return null;
    const token = 'web-file:' + (++seq) + '/' + file.name;
    picked.set(token, file);
    return token;
  };
  const fileOf = (token) => picked.get(token) || null;
  const extOf = (name) => (String(name).match(/\.[^./]+$/) || [''])[0].toLowerCase();

  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const input = doc.createElement('input');
      input.type = 'file';
      input.multiple = !!multiple;
      // the iPad's Files app greys out what it can't match to a type, and it
      // knows no type for .md or .fountain: on touch, every file is offered
      // and the ones NEO can't read are said so after
      if (accept && !(root.matchMedia && root.matchMedia('(hover: none)').matches)) input.accept = accept;
      input.style.display = 'none';
      let done = false;
      const finish = (files) => { if (done) return; done = true; input.remove(); resolve(files); };
      input.addEventListener('change', () => finish([...(input.files || [])]));
      input.addEventListener('cancel', () => finish([]));
      doc.body.appendChild(input);
      input.click();
    });
  }

  async function importOne(file) {
    const ext = extOf(file.name);
    const name = file.name.replace(/\.[^.]+$/, '');
    if (!/^\.(docx|txt|md|fountain|fdx)$/.test(ext)) return { name: file.name, error: t('NEO reads .docx, .txt and .md files') };
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return await root.NeoImport.parseManuscript({ name, ext, bytes }, root.JSZip);
    } catch (err) {
      return { name: file.name, error: String(err && err.message || err) };
    }
  }

  neo.importFiles = async (paths) => {
    const out = [];
    for (const p of paths || []) {
      const f = fileOf(p);
      if (f && /\.(docx|txt|md|fountain|fdx)$/i.test(f.name)) out.push(await importOne(f));
    }
    return out;
  };
  neo.importPick = async (opts) => {
    const scripts = !(opts && opts.chapters) && typeof moreOn === 'function' && moreOn();
    const files = await pickFiles(scripts ? '.docx,.txt,.md,.fountain,.fdx' : '.docx,.txt,.md', true);
    const out = [];
    for (const f of files) out.push(await importOne(f));
    return out;
  };

  /* ---------- covers: a picture dropped on a book, or picked ---------- */
  const COVER = /\.(png|jpe?g|webp)$/i;
  neo.pickCover = async () => {
    const [f] = await pickFiles('image/png,image/jpeg,image/webp', false);
    return f && COVER.test(f.name) ? neo.pathForFile(f) : null;
  };
  neo.setCover = async (bookId, token) => {
    const f = fileOf(token);
    if (!f || !COVER.test(f.name)) return null;
    const store = root.NeoStore;
    await store.ready;
    if (!store.get(bookId + '/book.json')) return null;
    const ext = extOf(f.name).slice(1).replace('jpeg', 'jpg');
    const fname = 'cover-' + Date.now() + '.' + ext;
    await store.put(bookId + '/' + fname, store.bytesToBase64(new Uint8Array(await f.arrayBuffer())), 'base64');
    // (a picture, not words: the old one goes, as on the desktop)
    for (const p of store.paths()) {
      if (p.startsWith(bookId + '/') && /^cover-\d+\./.test(p.slice(bookId.length + 1)) && p !== bookId + '/' + fname) await store.remove(p);
    }
    return fname;
  };
  neo.removeCover = async (bookId) => {
    const store = root.NeoStore;
    await store.ready;
    for (const p of store.paths()) if (p.startsWith(bookId + '/') && /^cover-\d+\./.test(p.slice(bookId.length + 1))) await store.remove(p);
    return true;
  };

  /* ---------- exports ---------- */
  const MIME = {
    txt: 'text/plain;charset=utf-8', md: 'text/markdown;charset=utf-8', html: 'text/html;charset=utf-8',
    fountain: 'text/plain;charset=utf-8', fdx: 'application/xml;charset=utf-8',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', epub: 'application/epub+zip',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp'
  };

  // the browser's own printing makes the PDF (Save as PDF, or the iPad's
  // share sheet from its print screen), from a frame off the page
  function printHtml(html) {
    return new Promise((resolve) => {
      const frame = doc.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
      frame.onload = () => {
        setTimeout(() => {
          try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (err) { showError(t('Export failed: {error}', { error: String(err && err.message || err) })); }
          // print() returns once the print screen is closed (or at once, on some)
          setTimeout(() => { frame.remove(); resolve(); }, 1000);
        }, 300);
      };
      frame.srcdoc = html;
      doc.body.appendChild(frame);
    });
  }

  neo.exportSave = async ({ format, defaultName, content, zipEntries, print, base64 }) => {
    try {
      const name = (defaultName || 'book') + '.' + format;
      if (format === 'pdf') {
        const html = print === 'screenplay' ? content : String(content).replace('</head>', '<style>@page { margin: 1in; }</style></head>');
        await printHtml(html);
        return name;
      }
      let blob;
      if (zipEntries) {
        const zip = new root.JSZip();
        // same shape main.js zips on the desktop: [{path, content, base64?, store?}]
        for (const e of zipEntries) zip.file(e.path, e.content, { base64: !!e.base64, compression: e.store ? 'STORE' : 'DEFLATE' });
        blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: MIME[format] || 'application/zip' });
      } else {
        // (a picture comes as base64: Save cover as image…)
        blob = new Blob([base64 ? root.NeoStore.base64ToBytes(content) : content], { type: MIME[format] || 'application/octet-stream' });
      }
      return (await root.NeoLibraryZip.saveBlob(blob, name)) ? name : null;
    } catch (err) {
      showError(t('Export failed: {error}', { error: String(err && err.message || err) }));
      return null;
    }
  };

  neo.appVersion = async () => 'NEO Web ' + (cfg.version || '');
  neo.platform = 'web';

  /* ---------- the iPad's keyboard ---------- */
  // its height becomes --kb (pocket.css lifts Pocket's bar and panes over it)
  const vv = root.visualViewport;
  if (vv) {
    const setKb = () => doc.documentElement.style.setProperty('--kb', Math.max(0, root.innerHeight - vv.height - vv.offsetTop) + 'px');
    vv.addEventListener('resize', setKb);
    vv.addEventListener('scroll', setKb);
  }
  // Safari would otherwise autocorrect, capitalise and underline its way
  // through a manuscript. The page is the writer's alone.
  const EDITABLE = '[contenteditable], textarea';
  const quiet = (el) => {
    if (!el || !el.setAttribute) return;
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
  };
  doc.addEventListener('focusin', (e) => { if (e.target && e.target.matches && e.target.matches(EDITABLE)) quiet(e.target); }, true);
  doc.addEventListener('DOMContentLoaded', () => doc.querySelectorAll(EDITABLE).forEach(quiet));

  /* ---------- offline: the service worker ---------- */
  if ('serviceWorker' in root.navigator && root.location.protocol !== 'file:') {
    root.addEventListener('load', () => { root.navigator.serviceWorker.register('sw.js').catch((err) => console.warn('offline copy:', err)); });
  }

  /* ---------- Sync & Files, on the shelf ---------- */
  const OD = root.NeoOneDrive;
  const sync = root.NeoSync;
  const standalone = () => (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) || root.navigator.standalone === true;
  const appleTouch = () => /iPad|iPhone|iPod/.test(root.navigator.userAgent) || (root.navigator.platform === 'MacIntel' && root.navigator.maxTouchPoints > 1);

  function ago(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return t('just now');
    const m = Math.round(s / 60);
    if (m < 60) return t('{count} min ago', { count: m });
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function chipText(st) {
    if (!OD.configured() || !OD.signedIn()) return '';
    if (st.state === 'syncing') return '…';
    if (st.state === 'signin' || st.state === 'error') return '!';
    if (st.state === 'offline') return '–';
    return '✓';
  }

  let btn = null;
  function updateChip() {
    if (!btn) return;
    const st = sync.status();
    const mark = chipText(st);
    btn.querySelector('.ws-mark').textContent = mark ? ' ' + mark : '';
    btn.classList.toggle('ws-alert', st.state === 'signin' || st.state === 'error');
  }

  function statusLine() {
    const st = sync.status();
    if (OD.needsSignIn() || st.state === 'signin') return t('OneDrive needs you to sign in again.');
    if (st.state === 'syncing') return t('Syncing…');
    if (st.state === 'offline') return t('Offline. Your writing is saved on this device and syncs when you’re back online.');
    if (st.state === 'error') return t('Sync stopped: {error}', { error: st.error });
    if (st.last) return t('Synced {when}.', { when: ago(st.last) });
    return t('Waiting to sync.');
  }

  let sheet = null;
  function closeSheet() { if (sheet) { sheet.remove(); sheet = null; } }

  function renderSheet() {
    if (!sheet) return;
    const signed = OD.signedIn();
    const who = OD.account();
    let cloud;
    if (!OD.configured()) {
      cloud = `<p class="ws-soft">${esc(t('OneDrive sync isn’t set up on this site yet.'))}</p>`;
    } else if (!signed) {
      cloud = `<p>${esc(t('Sign in with a free Microsoft account and your books are kept as plain files in OneDrive → Apps → NEO, on every device you sign in on. Desktop NEO can open the same folder (File → Library Folder…).'))}</p>
        <div class="ws-actions"><button class="btn-gold" data-act="signin">${esc(t('Sign in with OneDrive'))}</button></div>`;
    } else {
      const again = OD.needsSignIn() || sync.status().state === 'signin';
      cloud = `<p>${who ? esc(t('Signed in as {name}.', { name: who })) + ' ' : ''}${esc(statusLine())}</p>
        <div class="ws-actions">
          ${again ? `<button class="btn-gold" data-act="signin">${esc(t('Sign in again'))}</button>` : `<button class="btn-gold" data-act="sync">${esc(t('Sync now'))}</button>`}
          <button class="btn-quiet" data-act="signout">${esc(t('Sign out'))}</button>
        </div>`;
    }
    const installHint = appleTouch() && !standalone()
      ? `<p class="ws-soft">${esc(t('Tip: add NEO to your Home Screen (Share → Add to Home Screen). It opens like an app, works offline, and Safari keeps your books.'))}</p>`
      : '';
    sheet.querySelector('.modal').innerHTML = `
      <h2>${esc(t('Sync & Files'))}</h2>
      <h3 class="ws-h">OneDrive</h3>
      ${cloud}
      <h3 class="ws-h">${esc(t('iCloud Drive and Files'))}</h3>
      <p>${esc(t('Save the whole library as one .zip (in iCloud Drive, say) and open it on another device. Desktop NEO’s daily backups open here too.'))}</p>
      <div class="ws-actions">
        <button class="btn-gold" data-act="save">${esc(t('Save library to Files'))}</button>
        <button class="btn-quiet" data-act="open">${esc(t('Open library from Files'))}</button>
      </div>
      ${installHint}
      <div class="ws-actions ws-done"><button class="btn-quiet m-ok" data-act="close">${esc(t('Done'))}</button></div>`;
  }

  async function act(what, el) {
    try {
      if (what === 'close') return closeSheet();
      if (what === 'signin') {
        if (typeof root.flushAllSaves === 'function') root.flushAllSaves();
        await root.NeoStore.settled();
        return OD.signIn();
      }
      if (what === 'sync') { el.disabled = true; await sync.syncNow(); return renderSheet(); }
      if (what === 'signout') { await sync.signOut(); return renderSheet(); }
      if (what === 'save') { el.disabled = true; await root.NeoLibraryZip.saveLibrary(); el.disabled = false; return; }
      if (what === 'open') {
        const [f] = await pickFiles('.zip,application/zip', false);
        if (!f) return;
        const r = await root.NeoLibraryZip.openLibrary(f);
        closeSheet();
        if (!r.added && !r.updated && !r.kept) { showError(t('Everything in that library is already here.')); return; }
        // the shelf reads the library afresh
        try { root.sessionStorage.setItem('neo-web-opened', JSON.stringify(r)); } catch { /* fine */ }
        root.location.reload();
      }
    } catch (err) {
      if (el) el.disabled = false;
      showError(String(err && err.message || err));
    }
  }

  function openSheet() {
    if (sheet || doc.querySelector('.modal-backdrop:not([hidden])')) return;
    sheet = doc.createElement('div');
    sheet.className = 'modal-backdrop';
    sheet.id = 'web-sync-sheet';
    sheet.innerHTML = '<div class="modal" role="dialog" aria-modal="true"></div>';
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-act]');
      if (b) act(b.dataset.act, b);
    });
    sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); } });
    doc.body.appendChild(sheet);
    renderSheet();
    const first = sheet.querySelector('button');
    if (first) first.focus();
  }

  doc.addEventListener('DOMContentLoaded', () => {
    // the shelf's Import button, which Pocket hides: here the file picker works
    const imp = doc.getElementById('import-btn');
    if (imp) imp.hidden = false;
    const right = doc.querySelector('#shelf-header .shelf-header-right');
    if (right) {
      btn = doc.createElement('button');
      btn.id = 'web-sync-btn';
      btn.innerHTML = '<span aria-hidden="true">☁</span> <span class="ws-label"></span><span class="ws-mark"></span>';
      btn.querySelector('.ws-label').textContent = t('Sync');
      btn.title = t('Sync & Files');
      btn.addEventListener('click', openSheet);
      right.insertBefore(btn, right.firstChild);
      updateChip();
    }
    if (root.NeoOneDriveError) showError(t('OneDrive sign-in didn’t finish: {error}', { error: root.NeoOneDriveError }));
    let opened = null;
    try { opened = JSON.parse(root.sessionStorage.getItem('neo-web-opened') || 'null'); root.sessionStorage.removeItem('neo-web-opened'); } catch { /* fine */ }
    if (opened) {
      setTimeout(() => showError(opened.kept
        ? t('Library opened. {count} files differed from the ones here; both copies of each are kept.', { count: opened.kept })
        : t('Library opened.')), 800);
    }
  });
  root.NeoWebSheet = { open: openSheet };
  sync.onStatus(() => { updateChip(); renderSheet(); });
  OD.onChange(() => { updateChip(); renderSheet(); });
})(typeof globalThis !== 'undefined' ? globalThis : this);
