/* ============================ NEO WEB ============================ */
/* The library in the browser. Pocket's bridge (pocket-bridge.js) runs */
/* unchanged on top of this: it asks Capacitor's Filesystem plugin for  */
/* files, and here every file is a row in IndexedDB, keyed by its path  */
/* inside the NEO Library ("book-…/chapters/ch-….html"). The rows are   */
/* the same plain files desktop NEO keeps, so a library .zip or         */
/* OneDrive (sync.js) carries them out whole.                           */
/*                                                                      */
/* NeoStore is the store itself, for sync.js, library-zip.js and the    */
/* service worker (which serves cover pictures from it at /__library/). */

(function (root) {
  const DB = 'neo-web';
  const FILES = 'files';
  const META = 'meta';
  const LIB = 'NEO Library';

  /* ---------- the backend: IndexedDB, or a Map in the tests ---------- */
  function idbBackend() {
    const open = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // resolves once the transaction is on disk, not when the request is queued
    const tx = async (store, mode, fn) => {
      const db = await open;
      return new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('IndexedDB write was cut short'));
        fn(t.objectStore(store));
      });
    };
    return {
      async loadAll() {
        const db = await open;
        return new Promise((resolve, reject) => {
          const out = new Map();
          const req = db.transaction(FILES).objectStore(FILES).openCursor();
          req.onsuccess = () => {
            const c = req.result;
            if (!c) return resolve(out);
            out.set(String(c.key), c.value);
            c.continue();
          };
          req.onerror = () => reject(req.error);
        });
      },
      // puts: [[path, row]], dels: [path]: one transaction, all or none
      write: (puts, dels) => tx(FILES, 'readwrite', (s) => {
        for (const k of dels || []) s.delete(k);
        for (const [k, v] of puts || []) s.put(v, k);
      }),
      metaGet: async (key) => {
        const db = await open;
        return new Promise((resolve, reject) => {
          const req = db.transaction(META).objectStore(META).get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      },
      metaSet: (key, value) => tx(META, 'readwrite', (s) => { if (value === undefined) s.delete(key); else s.put(value, key); })
    };
  }

  function memoryBackend() {
    const files = new Map();
    const meta = new Map();
    return {
      files,
      loadAll: async () => new Map(files),
      write: async (puts, dels) => {
        for (const k of dels || []) files.delete(k);
        for (const [k, v] of puts || []) files.set(k, v);
      },
      metaGet: async (k) => meta.get(k),
      metaSet: async (k, v) => { if (v === undefined) meta.delete(k); else meta.set(k, v); }
    };
  }

  /* ---------- text and base64 ---------- */
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  function bytesToBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function base64ToBytes(b64) {
    const s = atob(String(b64 || '').replace(/^data:[^,]*,/, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const rowBytes = (row) => row.enc === 'base64' ? base64ToBytes(row.data) : enc.encode(row.data);
  const rowText = (row) => row.enc === 'base64' ? dec.decode(base64ToBytes(row.data)) : row.data;
  const rowBase64 = (row) => row.enc === 'base64' ? row.data : bytesToBase64(enc.encode(row.data));
  const sizeOf = (data, e) => e === 'base64' ? Math.floor(String(data).replace(/=+$/, '').length * 3 / 4) : enc.encode(data).length;

  /* ---------- the store ---------- */
  function createStore(backend) {
    let files = new Map();   // path → { data, enc, mtime, size }
    const dirs = new Set();  // folders made empty (mkdir), as a disk would keep them
    let lastStamp = 0;
    const listeners = new Set();
    // writes go out in order, so a later save never lands under an earlier one
    let queue = Promise.resolve();
    const ready = backend.loadAll().then((m) => { files = m; });

    // two saves in the same millisecond still get two stamps
    const stamp = () => (lastStamp = Math.max(Date.now(), lastStamp + 1));
    const norm = (p) => String(p || '').split('/').filter((s) => s && s !== '.').join('/');
    const parentOf = (p) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    const under = (dir, p) => !dir || p.startsWith(dir + '/');
    const emit = (detail) => { for (const fn of listeners) { try { fn(detail); } catch (err) { console.error(err); } } };
    function isDir(p) {
      if (!p || dirs.has(p)) return true;
      for (const k of files.keys()) if (k.startsWith(p + '/')) return true;
      return false;
    }
    function commit(puts, dels, detail) {
      for (const k of dels) files.delete(k);
      for (const [k, v] of puts) files.set(k, v);
      const done = (queue = queue.then(() => backend.write(puts, dels)));
      if (detail) emit(detail);
      return done;
    }
    const row = (data, e, mtime) => ({ data: String(data), enc: e, mtime: mtime || stamp(), size: sizeOf(data, e) });

    return {
      ready,
      norm,
      isDir,
      rowBytes, rowText, rowBase64, bytesToBase64, base64ToBytes,
      get: (p) => files.get(norm(p)) || null,
      paths: () => [...files.keys()],
      // { path: row } for every file, a copy (library-zip.js, sync.js)
      all: () => new Map(files),
      onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      // quiet: a write sync.js makes from OneDrive, which needn't go back up
      put(p, data, e, opts = {}) {
        p = norm(p);
        const r = row(data, e === 'base64' ? 'base64' : 'utf8', opts.mtime);
        return commit([[p, r]], [], opts.quiet ? null : { op: 'write', path: p }).then(() => r);
      },
      remove(p, opts = {}) {
        p = norm(p);
        if (!files.has(p)) return Promise.resolve(false);
        return commit([], [p], opts.quiet ? null : { op: 'delete', path: p }).then(() => true);
      },
      mkdir(p, recursive) {
        p = norm(p);
        if (!p) return;
        if (isDir(p) && !recursive) throw new Error('Directory exists');
        if (files.has(p)) throw new Error('A file is in the way: ' + p);
        if (!recursive && parentOf(p) && !isDir(parentOf(p))) throw new Error('Parent directory missing');
        for (let q = p; q; q = parentOf(q)) dirs.add(q);
      },
      readdir(p) {
        p = norm(p);
        if (files.has(p)) throw new Error('Not a directory: ' + p);
        if (!isDir(p)) throw new Error('Directory does not exist: ' + p);
        const out = new Map();
        const pre = p ? p + '/' : '';
        for (const [k, v] of files) {
          if (!under(p, k)) continue;
          const rest = k.slice(pre.length);
          const name = rest.split('/')[0];
          if (rest.includes('/')) { if (!out.has(name)) out.set(name, { name, type: 'directory', size: 0, mtime: 0 }); }
          else out.set(name, { name, type: 'file', size: v.size, mtime: v.mtime });
        }
        for (const d of dirs) {
          if (d === p || !under(p, d)) continue;
          const name = d.slice(pre.length).split('/')[0];
          if (!out.has(name)) out.set(name, { name, type: 'directory', size: 0, mtime: 0 });
        }
        return [...out.values()];
      },
      stat(p) {
        p = norm(p);
        const f = files.get(p);
        if (f) return { type: 'file', size: f.size, mtime: f.mtime };
        if (isDir(p)) return { type: 'directory', size: 0, mtime: 0 };
        throw new Error('File does not exist: ' + p);
      },
      // a file or a whole folder (deleteBook moves a book to Deleted Books)
      rename(from, to) {
        from = norm(from); to = norm(to);
        if (files.has(from)) {
          const r = { ...files.get(from), mtime: stamp() };
          return commit([[to, r]], [from], { op: 'rename', path: to, from });
        }
        if (!isDir(from)) return Promise.reject(new Error('Nothing to rename: ' + from));
        const puts = [];
        const dels = [];
        for (const [k, v] of files) {
          if (!under(from, k)) continue;
          puts.push([to + k.slice(from.length), { ...v }]);
          dels.push(k);
        }
        for (const d of [...dirs]) if (d === from || under(from, d)) { dirs.delete(d); dirs.add(to + d.slice(from.length)); }
        return commit(puts, dels, { op: 'rename', path: to, from });
      },
      rmdir(p, recursive) {
        p = norm(p);
        const inside = [...files.keys()].filter((k) => under(p, k));
        if (inside.length && !recursive) return Promise.reject(new Error('Directory not empty'));
        for (const d of [...dirs]) if (d === p || under(p, d)) dirs.delete(d);
        return commit([], inside, { op: 'delete', path: p });
      },
      metaGet: (k) => backend.metaGet(k),
      metaSet: (k, v) => backend.metaSet(k, v),
      // everything written so far is on disk
      settled: () => queue
    };
  }

  /* ---------- Capacitor, as far as pocket-bridge.js asks ---------- */
  function createCapacitor(store) {
    // Pocket's paths: "NEO Library/<path>" in DOCUMENTS. Anything else (the
    // share sheet's cache) has no place here: web-bridge.js exports itself.
    const rel = (o) => {
      const path = String((o && o.path) || '');
      if (o && o.directory && o.directory !== 'DOCUMENTS') throw new Error('Only the library is kept in this browser');
      if (path === LIB) return '';
      if (path.startsWith(LIB + '/')) return path.slice(LIB.length + 1);
      return path;
    };
    const uri = (p) => 'neo-library://' + p;
    const Filesystem = {
      async readdir(o) { await store.ready; return { files: store.readdir(rel(o)).map((f) => ({ ...f, uri: uri(f.name) })) }; },
      async mkdir(o) { await store.ready; store.mkdir(rel(o), !!o.recursive); },
      async readFile(o) {
        await store.ready;
        const r = store.get(rel(o));
        if (!r) throw new Error('File does not exist');
        return { data: o.encoding ? rowText(r) : rowBase64(r) };
      },
      async writeFile(o) {
        await store.ready;
        const p = rel(o);
        if (!o.recursive && store.norm(p).includes('/') && !store.isDir(store.norm(p).replace(/\/[^/]*$/, ''))) throw new Error('Parent directory missing');
        await store.put(p, o.data, o.encoding ? 'utf8' : 'base64');
        return { uri: uri(p) };
      },
      async deleteFile(o) {
        await store.ready;
        if (!(await store.remove(rel(o)))) throw new Error('File does not exist');
      },
      async rmdir(o) { await store.ready; await store.rmdir(rel(o), !!o.recursive); },
      async rename(o) {
        await store.ready;
        await store.rename(rel({ path: o.from, directory: o.directory }), rel({ path: o.to, directory: o.toDirectory || o.directory }));
      },
      async stat(o) { await store.ready; const s = store.stat(rel(o)); return { ...s, uri: uri(rel(o)) }; },
      async getUri(o) { return { uri: uri(rel(o)) }; }
    };
    const plugins = {
      Filesystem,
      // the phones' own shells: nothing to do in a browser
      NeoBars: { set: async () => ({}), keyboard: async () => ({ hardware: false }) },
      Keyboard: { addListener: () => ({ remove() {} }) }
    };
    return {
      getPlatform: () => 'web',
      isNativePlatform: () => false,
      Plugins: plugins,
      registerPlugin: (name) => plugins[name] || {},
      // cover pictures: served from the store by sw.js
      convertFileSrc: (u) => String(u).startsWith('neo-library://') ? new URL('__library', root.location.href).href : u
    };
  }

  const api = { createStore, createCapacitor, idbBackend, memoryBackend, bytesToBase64, base64ToBytes };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  root.NeoWebStore = api;
  root.NeoStore = createStore(idbBackend());
  root.Capacitor = createCapacitor(root.NeoStore);
  // Safari clears a site's storage after a week unused unless the site is
  // on the Home Screen or the browser agrees to keep it
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* asked */ }
})(typeof globalThis !== 'undefined' ? globalThis : this);
