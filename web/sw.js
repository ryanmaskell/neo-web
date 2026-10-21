/* NEO on the web, offline. scripts/web-build.js fills in VERSION and SHELL.
   The app's own files come from the cache first, so NEO opens with no
   network; a new version is fetched whole when this file changes. Cover
   pictures (/__library/<book>/<file>) are read from the library in
   IndexedDB (capacitor-shim.js). OneDrive and Microsoft's sign-in are
   never cached. */

const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const CACHE = 'neo-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('neo-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

function libraryFile(path) {
  return new Promise((resolve) => {
    const req = indexedDB.open('neo-web', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('files');
      req.result.createObjectStore('meta');
    };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      try {
        const get = req.result.transaction('files').objectStore('files').get(path);
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => resolve(null);
      } catch { resolve(null); }
    };
  });
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', html: 'text/html; charset=utf-8', json: 'application/json' };

async function serveLibrary(url) {
  const path = url.pathname.replace(/^.*?\/__library\//, '').split('/').map(decodeURIComponent).join('/');
  const row = await libraryFile(path);
  if (!row) return new Response('', { status: 404 });
  let body = row.data;
  if (row.enc === 'base64') {
    const s = atob(row.data);
    body = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) body[i] = s.charCodeAt(i);
  }
  const ext = path.split('.').pop().toLowerCase();
  return new Response(body, { headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' } });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/__library/')) { e.respondWith(serveLibrary(url)); return; }
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      // dictionaries and the rest that isn't in the shell: kept once fetched
      if (res.ok && res.type === 'basic') {
        const c = await caches.open(CACHE);
        c.put(e.request, res.clone());
      }
      return res;
    } catch (err) {
      if (e.request.mode === 'navigate') {
        const index = await caches.match('./');
        if (index) return index;
      }
      throw err;
    }
  })());
});
