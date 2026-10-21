/* ============================ NEO WEB ============================ */
/* SYNC: the library in this browser (NeoStore) and the same files in   */
/* OneDrive → Apps → NEO, kept alike the way Syncthing or iCloud keeps  */
/* a desktop library: whole files, copied when they change. NEO's own   */
/* rules for a chapter changed on two devices (refreshFromDisk in       */
/* app.js: adopt it, or keep it as the other device's twin) run on the  */
/* files sync brings down, exactly as they do on a Mac.                 */
/*                                                                      */
/* A file changed in both places before either was copied keeps both:   */
/* the newer one keeps its name and the other is saved beside it as     */
/* "<name>.sync-conflict-<when>-<where>". A file deleted here goes to   */
/* OneDrive's recycle bin. Nothing is written over unseen: uploads      */
/* carry the eTag this device last saw.                                 */

(function (root) {
  const t = (s, vars) => (root.NeoI18n ? root.NeoI18n.t(s, vars) : s);
  // copies a device keeps for itself, and the desktop's own backups
  const SKIP = /(^|\/)(\.pocket-touch|\.DS_Store|neo-errors\.log|desktop\.ini)$|\.(tmp|bak)$|^(Backups|Exports)(\/|$)/;
  const TEXT = /\.(html|json|txt|md|log|fountain|fdx|csv|xml)$/i;
  const isText = (p) => TEXT.test(String(p).replace(/\.sync-conflict-[^/]*$/, ''));
  const join = (a, b) => (a ? a + '/' + b : b);
  const under = (dir, p) => p === dir || p.startsWith(dir + '/');
  const sameBytes = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  // library.json met on two devices: one side's shelves and settings, with
  // every book the other side has on a shelf still on one. A book left off
  // the shelves would only be found again with Reshelve, which simple NEO
  // (and so the web) doesn't show.
  function mergeLibrary(baseText, otherText) {
    let base, other;
    try { base = JSON.parse(baseText); other = JSON.parse(otherText); } catch { return null; }
    if (!base || !other || !Array.isArray(base.shelves) || !Array.isArray(other.shelves)) return null;
    const shelved = new Set(base.shelves.flatMap((s) => s.bookIds || []));
    for (const s of other.shelves) {
      const missing = (s.bookIds || []).filter((id) => !shelved.has(id));
      if (!missing.length) continue;
      let into = base.shelves.find((b) => b.id === s.id);
      if (!into) { into = { ...s, bookIds: [] }; base.shelves.push(into); }
      into.bookIds = [...(into.bookIds || []), ...missing];
      for (const id of missing) shelved.add(id);
    }
    if (other.firstRunDone) base.firstRunDone = true;
    return JSON.stringify(base, null, 2);
  }

  const stampOf = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

  async function pool(tasks, n) {
    let i = 0;
    const errors = [];
    const worker = async () => {
      while (i < tasks.length) {
        const task = tasks[i++];
        try { await task(); } catch (err) { errors.push(err); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
    if (errors.length) throw errors[0];
  }

  // store: NeoStore (capacitor-shim.js); remote: NeoOneDrive.remote or a fake
  function createSync({ store, remote, now = () => Date.now(), parallel = 4 }) {
    let running = null;
    let again = false;
    const blank = () => ({ root: null, link: null, files: {}, ids: {} });

    async function loadState() { return (await store.metaGet('sync')) || blank(); }
    const saveState = (st) => store.metaSet('sync', st);

    async function once() {
      await store.ready;
      const st = await loadState();
      const report = { pulled: 0, pushed: 0, removed: 0, conflicts: [] };
      if (!st.root) {
        const r = await remote.libraryRoot();
        st.root = r;
        st.ids = { [r.id]: '' };
      }

      /* ---------- pull: OneDrive → here ---------- */
      const { items, link, full } = await remote.changes(st.link);
      const seen = new Set();
      const downloads = [];
      let moved = false;
      const gone = (p) => {
        const rec = st.files[p];
        delete st.files[p];
        const local = store.get(p);
        // changed here since it was last copied: it stays, and goes back up
        if (local && rec && local.mtime === rec.mtime) downloads.push(async () => { await store.remove(p, { quiet: true }); report.removed++; });
      };
      for (const item of items) {
        if (item.id === st.root.id) continue;
        if (item.deleted) {
          const p = st.ids[item.id];
          delete st.ids[item.id];
          if (p == null) continue;
          for (const f of Object.keys(st.files)) if (under(p, f)) gone(f);
          continue;
        }
        const pid = item.parentReference && item.parentReference.id;
        const parent = pid != null ? st.ids[pid] : undefined;
        if (parent == null) continue; // outside the library
        const p = join(parent, item.name);
        const was = st.ids[item.id];
        if (was != null && was !== p) {
          // renamed or moved in OneDrive: what was there has gone; a folder's
          // files are found again by listing everything next time
          if (item.folder) { for (const f of Object.keys(st.files)) if (under(was, f)) gone(f); moved = true; }
          else if (st.files[was] && st.files[was].id === item.id) gone(was);
        }
        st.ids[item.id] = p;
        if (item.folder || !item.file || SKIP.test(p)) continue;
        seen.add(p);
        downloads.push(() => pullFile(st, p, item, report));
      }
      if (full) for (const p of Object.keys(st.files)) if (!seen.has(p)) gone(p);
      await pool(downloads, parallel);
      st.link = moved ? null : link;
      await saveState(st);

      /* ---------- push: here → OneDrive ---------- */
      const local = store.all();
      const uploads = [];
      for (const [p, row] of local) {
        if (SKIP.test(p)) continue;
        const rec = st.files[p];
        if (rec && rec.mtime === row.mtime) continue;
        uploads.push(async () => {
          const item = await remote.upload(p, store.rowBytes(row), rec ? rec.eTag : null);
          // changed in OneDrive meanwhile: the next pull meets it and keeps both
          if (item.conflict) return;
          // (a save made while this was on its way goes up next time)
          st.files[p] = { mtime: row.mtime, eTag: item.eTag, cTag: item.cTag, id: item.id };
          st.ids[item.id] = p;
          if (item.parentReference && item.parentReference.id) st.ids[item.parentReference.id] = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
          report.pushed++;
        });
      }
      for (const p of Object.keys(st.files)) {
        if (local.has(p)) continue;
        const rec = st.files[p];
        uploads.push(async () => {
          const r = await remote.remove(rec.id, rec.eTag);
          delete st.files[p];
          // changed in OneDrive after this device last saw it: those words
          // come back down on a full listing
          if (r.conflict) st.link = null;
          else delete st.ids[rec.id];
          report.removed++;
        });
      }
      try { await pool(uploads, parallel); } finally { await saveState(st); }
      return report;
    }

    async function pullFile(st, p, item, report) {
      const rec = st.files[p];
      if (rec && ((item.cTag && item.cTag === rec.cTag) || item.eTag === rec.eTag)) {
        rec.eTag = item.eTag; // (only its details changed)
        return;
      }
      const bytes = await remote.download(item);
      const local = store.get(p);
      const write = (b, path, quiet) => isText(path)
        ? store.put(path, new TextDecoder().decode(b), 'utf8', { quiet })
        : store.put(path, store.bytesToBase64(b), 'base64', { quiet });
      const record = (mtime) => { st.files[p] = { mtime, eTag: item.eTag, cTag: item.cTag, id: item.id }; };
      const changedHere = local && (!rec || local.mtime !== rec.mtime);
      if (!changedHere) {
        record((await write(bytes, p, true)).mtime);
        report.pulled++;
        return;
      }
      const mine = store.rowBytes(local);
      if (sameBytes(mine, bytes)) { record(local.mtime); return; }
      // both changed. Never met before (this device's first sync): OneDrive's
      // copy is the library; else the newer keeps the name
      const theirs = Date.parse(item.lastModifiedDateTime) || 0;
      const remoteWins = !rec || theirs >= local.mtime;
      const when = stampOf(now());
      if (p === 'library.json') {
        const dec = new TextDecoder();
        const merged = remoteWins ? mergeLibrary(dec.decode(bytes), dec.decode(mine)) : mergeLibrary(dec.decode(mine), dec.decode(bytes));
        if (merged !== null) {
          // the merge is new here, and goes up over OneDrive's copy
          await store.put(p, merged, 'utf8');
          st.files[p] = { mtime: -1, eTag: item.eTag, cTag: item.cTag, id: item.id };
          report.pulled++;
          return;
        }
      }
      if (remoteWins) {
        const keep = `${p}.sync-conflict-${when}-web`;
        await write(mine, keep, false); // goes up to OneDrive too
        record((await write(bytes, p, true)).mtime);
        report.conflicts.push({ path: p, kept: keep });
        report.pulled++;
      } else {
        const keep = `${p}.sync-conflict-${when}-onedrive`;
        await write(bytes, keep, false);
        // this device's copy goes up over the one just kept aside
        st.files[p] = { mtime: -1, eTag: item.eTag, cTag: item.cTag, id: item.id };
        report.conflicts.push({ path: p, kept: keep });
      }
    }

    // one at a time; a call while one runs asks for another round after it
    function run() {
      if (running) { again = true; return running; }
      running = (async () => {
        const total = { pulled: 0, pushed: 0, removed: 0, conflicts: [] };
        try {
          do {
            again = false;
            const r = await once();
            total.pulled += r.pulled; total.pushed += r.pushed; total.removed += r.removed;
            total.conflicts.push(...r.conflicts);
          } while (again);
          return total;
        } finally { running = null; }
      })();
      return running;
    }

    return {
      run,
      busy: () => !!running,
      // signing out, or another account: the next sign-in starts afresh
      reset: () => store.metaSet('sync', undefined)
    };
  }

  const api = { createSync, mergeLibrary, SKIP, isText };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.NeoSyncEngine = api;

  /* ---------- in the browser: when to sync, and what to say ---------- */
  if (!root.NeoStore || !root.NeoOneDrive) return;
  const OD = root.NeoOneDrive;
  const sync = createSync({ store: root.NeoStore, remote: OD.remote });
  const status = { state: 'off', last: 0, error: '', conflicts: [] };
  const listeners = new Set();
  const tell = () => { for (const fn of listeners) { try { fn(status); } catch (err) { console.error(err); } } };
  const editing = () => { const ed = root.document.getElementById('editor-view'); return !!(ed && !ed.hidden); };

  // what a pull brought down shows on the page (or the shelf) at once,
  // through app.js's own careful re-read
  const nudgeApp = () => { try { if (typeof root.refreshFromDisk === 'function') root.refreshFromDisk(); } catch { /* next look */ } };

  // a conflict is said on the shelf, never while the writer is writing
  function sayConflicts() {
    if (!status.conflicts.length || editing() || typeof root.toast !== 'function') return;
    const n = status.conflicts.length;
    status.conflicts = [];
    root.toast(n === 1
      ? t('A file changed on two devices before they synced. Both copies are kept in OneDrive → Apps → NEO.')
      : t('{count} files changed on two devices before they synced. Both copies of each are kept in OneDrive → Apps → NEO.', { count: n }), 8000);
  }

  async function syncNow() {
    if (!OD.configured() || !OD.signedIn()) { status.state = 'off'; tell(); return; }
    if (root.navigator.onLine === false) { status.state = 'offline'; tell(); return; }
    status.state = 'syncing';
    tell();
    try {
      const r = await sync.run();
      status.state = 'idle';
      status.last = Date.now();
      status.error = '';
      status.conflicts.push(...r.conflicts);
      if (r.pulled || r.removed) nudgeApp();
    } catch (err) {
      if (err instanceof OD.NeedsSignIn) status.state = 'signin';
      else if (root.navigator.onLine === false || err instanceof TypeError) status.state = 'offline';
      else {
        status.state = 'error';
        status.error = String(err && err.message || err);
        try { root.neo && root.neo.logError && console.error('sync:', status.error); } catch { /* fine */ }
      }
    }
    tell();
    sayConflicts();
  }

  let timer = null;
  const soon = (ms) => { clearTimeout(timer); timer = setTimeout(syncNow, ms); };
  root.NeoStore.onChange(() => { if (OD.signedIn()) soon(5000); });
  root.addEventListener('online', () => soon(500));
  root.addEventListener('focus', () => soon(1000));
  root.document.addEventListener('visibilitychange', () => {
    if (root.document.visibilityState === 'hidden') syncNow(); // the iPad may put the tab away for good
    else soon(500);
  });
  setInterval(() => { if (root.document.visibilityState === 'visible') syncNow(); }, 60000);
  OD.onChange(() => { if (OD.needsSignIn()) { status.state = 'signin'; tell(); } });
  // back on the shelf: say what waited
  root.document.addEventListener('DOMContentLoaded', () => {
    const ed = root.document.getElementById('editor-view');
    if (ed) new MutationObserver(sayConflicts).observe(ed, { attributes: true, attributeFilter: ['hidden'] });
  });

  OD.ready.then(async () => {
    if (!OD.signedIn()) return;
    // a sign-in that has run out (Microsoft gives a web page a day) is
    // renewed with a quiet trip to Microsoft, only at launch, on the shelf
    try { await OD.token(); } catch (err) {
      if (err instanceof OD.NeedsSignIn && !editing()) {
        const last = Number(root.localStorage.getItem('neo-onedrive-quiet') || 0);
        if (Date.now() - last > 10 * 60 * 1000) {
          try { root.localStorage.setItem('neo-onedrive-quiet', String(Date.now())); } catch { /* fine */ }
          OD.signInQuietly();
          return;
        }
      }
    }
    soon(300);
  });

  root.NeoSync = {
    status: () => status,
    onStatus: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    syncNow,
    async signOut() {
      await sync.reset();
      OD.signOut();
      status.state = 'off';
      status.last = 0;
      tell();
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
