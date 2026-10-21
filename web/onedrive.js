/* ============================ NEO WEB ============================ */
/* OneDrive: Microsoft sign-in and the few Graph calls sync.js makes.   */
/* No library, no server: the browser signs in itself (OAuth with PKCE, */
/* the way Microsoft asks single-page apps to), and NEO only ever sees  */
/* its own folder, OneDrive → Apps → NEO (Files.ReadWrite.AppFolder).   */
/* The site's app id comes from config.js (NEO_ONEDRIVE_CLIENT_ID when  */
/* the site was built; web/README.md says where to get one, free).      */

(function (root) {
  const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const SCOPE = 'openid profile offline_access Files.ReadWrite.AppFolder';
  const KEY = 'neo-onedrive';            // localStorage: the tokens and who signed in
  const PENDING = 'neo-onedrive-pending'; // localStorage: a sign-in on its way back
  const SMALL = 4 * 1024 * 1024;         // Graph takes a plain PUT up to 4 MB
  const CHUNK = 320 * 1024 * 10;         // upload sessions want multiples of 320 KiB

  const clientId = () => (root.NEO_CONFIG && root.NEO_CONFIG.onedriveClientId) || '';
  const redirectUri = () => root.location.origin + root.location.pathname;
  const load = (k) => { try { return JSON.parse(root.localStorage.getItem(k) || 'null'); } catch { return null; } };
  const save = (k, v) => { try { if (v == null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  class NeedsSignIn extends Error {}
  class HttpError extends Error {
    constructor(status, text) { super('OneDrive answered ' + status + (text ? ': ' + text : '')); this.status = status; }
  }

  /* ---------- sign-in ---------- */
  const b64url = (bytes) => btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
  async function challenge(verifier) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return b64url(new Uint8Array(hash));
  }
  function idClaims(idToken) {
    try {
      const part = atob(String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(part, (c) => c.charCodeAt(0))));
    } catch { return {}; }
  }

  let tokens = load(KEY);          // { access, expires, refresh, name, username }
  let needsSignIn = !!(tokens && !tokens.refresh);
  const listeners = new Set();
  const changed = () => { for (const fn of listeners) { try { fn(); } catch (err) { console.error(err); } } };

  // silent: a quiet trip to Microsoft and straight back (prompt=none), when
  // the sign-in has run out; nobody sees a page unless it fails
  async function signIn(silent) {
    if (!clientId()) throw new Error('OneDrive is not set up on this site');
    const verifier = random(48);
    const state = random(16);
    save(PENDING, { state, verifier, silent: !!silent, at: Date.now() });
    const q = new URLSearchParams({
      client_id: clientId(),
      response_type: 'code',
      redirect_uri: redirectUri(),
      response_mode: 'query',
      scope: SCOPE,
      state,
      code_challenge: await challenge(verifier),
      code_challenge_method: 'S256'
    });
    if (silent) q.set('prompt', 'none');
    else q.set('prompt', 'select_account');
    if (tokens && tokens.username) q.set('login_hint', tokens.username);
    root.location.assign(AUTH + '/authorize?' + q);
  }

  async function tokenRequest(params) {
    const res = await fetch(AUTH + '/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId(), scope: SCOPE, ...params })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error_description || body.error || ('sign-in failed (' + res.status + ')'));
      err.code = body.error;
      throw err;
    }
    const claims = idClaims(body.id_token);
    tokens = {
      access: body.access_token,
      expires: Date.now() + (Number(body.expires_in) || 3600) * 1000,
      refresh: body.refresh_token || (tokens && tokens.refresh) || null,
      name: claims.name || (tokens && tokens.name) || '',
      username: claims.preferred_username || (tokens && tokens.username) || ''
    };
    save(KEY, tokens);
    needsSignIn = false;
    changed();
    return tokens.access;
  }

  // back from Microsoft: ?code=…&state=… (or ?error=…) on our own page
  const ready = (async () => {
    const q = new URLSearchParams(root.location.search);
    const pending = load(PENDING);
    if (!pending || !q.get('state') || q.get('state') !== pending.state) return;
    save(PENDING, null);
    root.history.replaceState(null, '', root.location.pathname + root.location.hash);
    if (q.get('error')) {
      // a quiet attempt that needs the writer: say so on the shelf, no more
      if (pending.silent) { needsSignIn = true; changed(); return; }
      throw new Error(q.get('error_description') || q.get('error'));
    }
    await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: pending.verifier });
  })().catch((err) => { console.error('OneDrive sign-in:', err); root.NeoOneDriveError = String(err && err.message || err); });

  async function token() {
    await ready;
    if (!tokens) throw new NeedsSignIn('Not signed in to OneDrive');
    if (tokens.access && tokens.expires > Date.now() + 60000) return tokens.access;
    if (!tokens.refresh) { needsSignIn = true; changed(); throw new NeedsSignIn('OneDrive needs you to sign in again'); }
    try {
      return await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh });
    } catch (err) {
      if (err.code === 'invalid_grant' || err.code === 'interaction_required') {
        tokens.refresh = null;
        tokens.access = null;
        save(KEY, tokens);
        needsSignIn = true;
        changed();
        throw new NeedsSignIn('OneDrive needs you to sign in again');
      }
      throw err;
    }
  }

  function signOut() {
    tokens = null;
    needsSignIn = false;
    save(KEY, null);
    changed();
  }

  /* ---------- Graph ---------- */
  async function graph(url, opts = {}) {
    const full = /^https:/.test(url) ? url : GRAPH + url;
    for (let attempt = 0; ; attempt++) {
      const headers = { ...(opts.headers || {}) };
      if (!opts.anonymous) headers.Authorization = 'Bearer ' + await token();
      const res = await fetch(full, { method: opts.method || 'GET', headers, body: opts.body });
      if (res.status === 401 && !opts.anonymous && attempt === 0 && tokens) { tokens.access = null; continue; }
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 4) {
        const wait = Number(res.headers.get('Retry-After')) || 2 ** attempt;
        await sleep(Math.min(wait, 60) * 1000);
        continue;
      }
      if (!res.ok && !opts.ok) throw new HttpError(res.status, (await res.text().catch(() => '')).slice(0, 300));
      return res;
    }
  }
  const json = async (url, opts) => (await graph(url, opts)).json();
  const encPath = (p) => String(p).split('/').map(encodeURIComponent).join('/');

  // What sync.js asks of a remote (scripts/web-sync.test.js has a fake one)
  const remote = {
    // the library's folder: OneDrive → Apps → NEO, made on first use
    async libraryRoot() {
      const r = await json('/me/drive/special/approot');
      const parent = (r.parentReference && r.parentReference.path) || '';
      return { id: r.id, path: parent + '/' + r.name };
    },
    // { items, link, full }: what changed since `link`, or everything (full)
    async changes(link) {
      let url = link || '/me/drive/special/approot/delta';
      const items = [];
      for (;;) {
        let res;
        try {
          res = await json(url);
        } catch (err) {
          // 410: the link has gone stale; start over with the whole listing
          if (link && err.status === 410) return remote.changes(null);
          // work and school OneDrive may not track changes in a folder: list it
          if (!link && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429) return remote.walk();
          throw err;
        }
        items.push(...(res.value || []));
        if (res['@odata.nextLink']) { url = res['@odata.nextLink']; continue; }
        return { items, link: res['@odata.deltaLink'] || null, full: !link };
      }
    },
    async walk() {
      const rootItem = await json('/me/drive/special/approot');
      const items = [rootItem];
      const folders = [rootItem.id];
      while (folders.length) {
        let url = '/me/drive/items/' + folders.shift() + '/children?$top=200';
        while (url) {
          const res = await json(url);
          for (const it of res.value || []) {
            items.push(it);
            if (it.folder) folders.push(it.id);
          }
          url = res['@odata.nextLink'] || null;
        }
      }
      return { items, link: null, full: true };
    },
    async download(item) {
      const direct = item['@microsoft.graph.downloadUrl'];
      const res = direct ? await graph(direct, { anonymous: true }) : await graph('/me/drive/items/' + item.id + '/content');
      return new Uint8Array(await res.arrayBuffer());
    },
    // ifMatch: the eTag this device last saw, so a change made elsewhere in
    // between is never written over (412); no eTag: a new file, which must
    // not land on one another device just made (409)
    async upload(path, bytes, ifMatch) {
      const headers = ifMatch ? { 'If-Match': ifMatch } : {};
      const behavior = ifMatch ? 'replace' : 'fail';
      const at = '/me/drive/special/approot:/' + encPath(path) + ':';
      if (bytes.length <= SMALL) {
        const res = await graph(at + '/content?@microsoft.graph.conflictBehavior=' + behavior, {
          method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: bytes, ok: true
        });
        if (res.status === 409 || res.status === 412) return { conflict: true };
        if (!res.ok) throw new HttpError(res.status, (await res.text().catch(() => '')).slice(0, 300));
        return res.json();
      }
      const ses = await graph(at + '/createUploadSession', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': behavior } }), ok: true
      });
      if (ses.status === 409 || ses.status === 412) return { conflict: true };
      if (!ses.ok) throw new HttpError(ses.status);
      const { uploadUrl } = await ses.json();
      let last = null;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const part = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
        last = await graph(uploadUrl, {
          method: 'PUT', anonymous: true, body: part,
          headers: { 'Content-Range': `bytes ${i}-${i + part.length - 1}/${bytes.length}` }
        });
      }
      return last.json();
    },
    // to the OneDrive recycle bin, where it stays for 30 days
    async remove(id, ifMatch) {
      const res = await graph('/me/drive/items/' + id, { method: 'DELETE', headers: ifMatch ? { 'If-Match': ifMatch } : {}, ok: true });
      if (res.status === 412) return { conflict: true };
      if (res.status === 404 || res.ok) return {};
      throw new HttpError(res.status);
    }
  };

  root.NeoOneDrive = {
    configured: () => !!clientId(),
    ready,
    signIn: () => signIn(false),
    signInQuietly: () => signIn(true),
    signOut,
    signedIn: () => !!tokens,
    needsSignIn: () => needsSignIn,
    account: () => (tokens ? (tokens.name || tokens.username || '') : ''),
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    token,
    remote,
    NeedsSignIn
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
