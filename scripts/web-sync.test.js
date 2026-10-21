'use strict';

// NEO on the web: the library in the browser (web/capacitor-shim.js) and
// its sync with OneDrive (web/sync.js), against a OneDrive played in
// memory. The rules under test: nothing is written over unseen, a file
// changed in both places keeps both, a device's own spares stay home.

const assert = require('node:assert/strict');
const path = require('node:path');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const { createStore, createCapacitor, memoryBackend } = require(path.join(root, 'web', 'capacitor-shim.js'));
const { createSync, mergeLibrary } = require(path.join(root, 'web', 'sync.js'));

const text = (s) => new TextEncoder().encode(s);
const untext = (b) => new TextDecoder().decode(b);

// OneDrive, as far as sync.js sees it: an app folder, a change log, eTags
function fakeOneDrive() {
  const items = new Map();
  const log = [];
  let n = 0;
  const rootId = 'root';
  items.set(rootId, { id: rootId, name: 'NEO', folder: {} });
  const touch = (it) => { log.push(it.id); return it; };
  const childOf = (pid, name) => [...items.values()].find((i) => !i.deleted && i.parentReference && i.parentReference.id === pid && i.name === name);
  function folderAt(parts) {
    let pid = rootId;
    for (const name of parts) {
      let f = childOf(pid, name);
      if (!f) { f = touch({ id: 'f' + (++n), name, folder: {}, parentReference: { id: pid } }); items.set(f.id, f); }
      pid = f.id;
    }
    return pid;
  }
  function write(p, bytes, existing) {
    const parts = p.split('/');
    const name = parts.pop();
    const pid = folderAt(parts);
    const it = existing || { id: 'i' + (++n), name, file: {}, parentReference: { id: pid } };
    const v = ++n;
    Object.assign(it, { eTag: 'e' + v, cTag: 'c' + v, content: bytes, lastModifiedDateTime: new Date(Date.now() + 1000).toISOString(), size: bytes.length });
    items.set(it.id, it);
    touch(it);
    return it;
  }
  const find = (p) => {
    const parts = p.split('/');
    let pid = rootId;
    for (const name of parts.slice(0, -1)) { const f = childOf(pid, name); if (!f) return null; pid = f.id; }
    return childOf(pid, parts[parts.length - 1]) || null;
  };
  const view = (it) => ({ ...it, content: undefined });
  return {
    items,
    find,
    // another device writes or deletes
    put: (p, s) => write(p, text(s), find(p)),
    del: (p) => { const it = find(p); it.deleted = {}; touch(it); },
    text: (p) => { const it = find(p); return it ? untext(it.content) : null; },
    files: () => [...items.values()].filter((i) => i.file && !i.deleted),
    remote: {
      async libraryRoot() { return { id: rootId, path: '/drive/root:/Apps/NEO' }; },
      async changes(link) {
        if (!link) {
          const live = [...items.values()].filter((i) => !i.deleted);
          // parents before children, as OneDrive lists them
          const depth = (i) => { let d = 0; for (let x = i; x.parentReference; x = items.get(x.parentReference.id)) d++; return d; };
          live.sort((a, b) => depth(a) - depth(b));
          return { items: live.map(view), link: 'seq:' + log.length, full: true };
        }
        const from = Number(link.split(':')[1]);
        const ids = [...new Set(log.slice(from))];
        return { items: ids.map((id) => view(items.get(id))), link: 'seq:' + log.length, full: false };
      },
      async download(item) { return items.get(item.id).content; },
      async upload(p, bytes, ifMatch) {
        const it = find(p);
        if (it && !ifMatch) return { conflict: true };
        if (it && it.eTag !== ifMatch) return { conflict: true };
        if (!it && ifMatch) return { conflict: true };
        return view(write(p, bytes, it));
      },
      async remove(id, ifMatch) {
        const it = items.get(id);
        if (!it || it.deleted) return {};
        if (ifMatch && it.eTag !== ifMatch) return { conflict: true };
        it.deleted = {};
        touch(it);
        return {};
      }
    }
  };
}

async function setup() {
  const store = createStore(memoryBackend());
  await store.ready;
  const od = fakeOneDrive();
  const sync = createSync({ store, remote: od.remote, parallel: 2 });
  return { store, od, sync };
}

describe('the library in the browser (capacitor-shim.js)', () => {
  test('behaves like the folder pocket-bridge.js expects', async () => {
    const store = createStore(memoryBackend());
    const FS = createCapacitor(store).Plugins.Filesystem;
    const at = (p) => ({ path: p ? 'NEO Library/' + p : 'NEO Library', directory: 'DOCUMENTS' });
    await FS.mkdir({ ...at('book-a/chapters'), recursive: true });
    assert.deepEqual((await FS.readdir(at('book-a'))).files.map((f) => [f.name, f.type]), [['chapters', 'directory']]);
    await FS.writeFile({ ...at('book-a/chapters/ch-1.html'), data: '<p>Hello</p>', encoding: 'utf8', recursive: true });
    const [f] = (await FS.readdir(at('book-a/chapters'))).files;
    assert.equal(f.name, 'ch-1.html');
    assert.equal(f.size, 12);
    assert.ok(f.mtime > 0);
    assert.equal((await FS.readFile({ ...at('book-a/chapters/ch-1.html'), encoding: 'utf8' })).data, '<p>Hello</p>');
    // without an encoding, base64 (as Capacitor gives a picture)
    assert.equal(Buffer.from((await FS.readFile(at('book-a/chapters/ch-1.html'))).data, 'base64').toString(), '<p>Hello</p>');
    // a later save gets a later stamp, even within the millisecond
    await FS.writeFile({ ...at('book-a/chapters/ch-1.html'), data: '<p>Hello</p>', encoding: 'utf8' });
    assert.ok((await FS.stat(at('book-a/chapters/ch-1.html'))).mtime > f.mtime);
    // a book moved to Deleted Books takes its files along
    await FS.mkdir({ ...at('Deleted Books'), recursive: true });
    await FS.rename({ from: 'NEO Library/book-a', to: 'NEO Library/Deleted Books/book-a', directory: 'DOCUMENTS', toDirectory: 'DOCUMENTS' });
    await assert.rejects(FS.stat(at('book-a')));
    assert.equal((await FS.readFile({ ...at('Deleted Books/book-a/chapters/ch-1.html'), encoding: 'utf8' })).data, '<p>Hello</p>');
    await FS.rmdir({ ...at('Deleted Books/book-a'), recursive: true });
    assert.deepEqual(store.paths(), []);
    await assert.rejects(FS.deleteFile(at('nothing.html')));
    await assert.rejects(FS.readdir(at('no-such-folder')));
  });

  test('a write reaches the backend in order', async () => {
    const backend = memoryBackend();
    const store = createStore(backend);
    await store.ready;
    store.put('a.json', '1', 'utf8');
    store.put('a.json', '2', 'utf8');
    await store.settled();
    assert.equal(backend.files.get('a.json').data, '2');
    // and survives a reload
    const again = createStore(backend);
    await again.ready;
    assert.equal(again.rowText(again.get('a.json')), '2');
  });
});

describe('sync with OneDrive (sync.js)', () => {
  test('sends the library up, leaving a device\'s own spares at home', async () => {
    const { store, od, sync } = await setup();
    await store.put('library.json', '{"shelves":[]}', 'utf8');
    await store.put('book-a/chapters/ch-1.html', '<p>One</p>', 'utf8');
    await store.put('book-a/book.json.bak', '{}', 'utf8');
    await store.put('book-a/chapters/ch-1.html.tmp', 'half', 'utf8');
    await store.put('neo-errors.log', 'oops', 'utf8');
    const r = await sync.run();
    assert.equal(r.pushed, 2);
    assert.equal(od.text('book-a/chapters/ch-1.html'), '<p>One</p>');
    assert.deepEqual(od.files().map((f) => f.name).sort(), ['ch-1.html', 'library.json']);
    // its own upload, seen again on the next pull, is no change
    const again = await sync.run();
    assert.deepEqual([again.pulled, again.pushed, again.removed], [0, 0, 0]);
  });

  test('brings down what another device wrote, quietly, with a new stamp', async () => {
    const { store, od, sync } = await setup();
    await store.put('book-a/chapters/ch-1.html', '<p>One</p>', 'utf8');
    await sync.run();
    const before = store.get('book-a/chapters/ch-1.html').mtime;
    od.put('book-a/chapters/ch-1.html', '<p>One, and more from the Mac</p>');
    od.put('book-b/book.json', '{"id":"book-b"}');
    let heard = 0;
    store.onChange(() => heard++);
    const r = await sync.run();
    assert.equal(r.pulled, 2);
    assert.equal(store.rowText(store.get('book-a/chapters/ch-1.html')), '<p>One, and more from the Mac</p>');
    assert.ok(store.get('book-a/chapters/ch-1.html').mtime > before, 'app.js sees the file changed');
    assert.equal(store.rowText(store.get('book-b/book.json')), '{"id":"book-b"}');
    assert.equal(heard, 0, 'a pull is not a local change to send back');
    assert.deepEqual((await sync.run()).pushed, 0);
  });

  test('a file changed in both places keeps both texts', async () => {
    const { store, od, sync } = await setup();
    await store.put('book-a/chapters/ch-1.html', '<p>Start</p>', 'utf8');
    await sync.run();
    await store.put('book-a/chapters/ch-1.html', '<p>Written on the iPad</p>', 'utf8');
    od.put('book-a/chapters/ch-1.html', '<p>Written on the Mac</p>');
    const r = await sync.run();
    assert.equal(r.conflicts.length, 1);
    const kept = r.conflicts[0].kept;
    assert.match(kept, /^book-a\/chapters\/ch-1\.html\.sync-conflict-\d{8}T\d{6}Z-(web|onedrive)$/);
    const both = [store.rowText(store.get('book-a/chapters/ch-1.html')), store.rowText(store.get(kept))].sort();
    assert.deepEqual(both, ['<p>Written on the Mac</p>', '<p>Written on the iPad</p>']);
    // and OneDrive ends up holding both as well
    await sync.run();
    assert.deepEqual([od.text('book-a/chapters/ch-1.html'), od.text(kept)].sort(), both);
    // the copy kept aside isn't a chapter app.js would list
    assert.ok(!kept.endsWith('.html'));
  });

  test('deletes travel both ways, and a delete never takes a later edit', async () => {
    const { store, od, sync } = await setup();
    await store.put('book-a/chapters/ch-1.html', '<p>One</p>', 'utf8');
    await store.put('book-a/chapters/ch-2.html', '<p>Two</p>', 'utf8');
    await store.put('book-a/chapters/ch-3.html', '<p>Three</p>', 'utf8');
    await sync.run();
    await store.remove('book-a/chapters/ch-1.html');
    od.del('book-a/chapters/ch-2.html');
    od.del('book-a/chapters/ch-3.html');
    await store.put('book-a/chapters/ch-3.html', '<p>Three, still being written</p>', 'utf8');
    await sync.run();
    assert.equal(od.find('book-a/chapters/ch-1.html'), null);
    assert.equal(store.get('book-a/chapters/ch-2.html'), null);
    assert.equal(store.rowText(store.get('book-a/chapters/ch-3.html')), '<p>Three, still being written</p>');
    assert.equal(od.text('book-a/chapters/ch-3.html'), '<p>Three, still being written</p>');
  });

  test('a first sign-in keeps this device\'s books on a shelf', async () => {
    const { store, od, sync } = await setup();
    od.put('library.json', JSON.stringify({ firstRunDone: true, authorName: 'Ada', shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: ['book-mac'] }] }));
    od.put('book-mac/book.json', '{"id":"book-mac"}');
    await store.put('library.json', JSON.stringify({ firstRunDone: true, authorName: '', shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: ['book-ipad'] }] }), 'utf8');
    await store.put('book-ipad/book.json', '{"id":"book-ipad"}', 'utf8');
    await sync.run();
    const lib = JSON.parse(store.rowText(store.get('library.json')));
    assert.equal(lib.authorName, 'Ada');
    assert.deepEqual(lib.shelves[0].bookIds, ['book-mac', 'book-ipad']);
    assert.deepEqual(JSON.parse(od.text('library.json')).shelves[0].bookIds, ['book-mac', 'book-ipad']);
    assert.ok(store.get('book-mac/book.json'));
    assert.ok(od.find('book-ipad/book.json'));
  });

  test('pictures go up and come down byte for byte', async () => {
    const { store, od, sync } = await setup();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 1, 2, 3]);
    await store.put('book-a/cover-1.png', store.bytesToBase64(png), 'base64');
    await sync.run();
    assert.deepEqual([...od.find('book-a/cover-1.png').content], [...png]);
    const other = createStore(memoryBackend());
    await other.ready;
    await createSync({ store: other, remote: od.remote }).run();
    assert.deepEqual([...other.rowBytes(other.get('book-a/cover-1.png'))], [...png]);
    assert.equal(other.get('book-a/cover-1.png').enc, 'base64');
  });

  test('two browsers on one OneDrive meet in the middle', async () => {
    const od = fakeOneDrive();
    const a = createStore(memoryBackend());
    const b = createStore(memoryBackend());
    await a.ready; await b.ready;
    const sa = createSync({ store: a, remote: od.remote });
    const sb = createSync({ store: b, remote: od.remote });
    await a.put('book-a/chapters/ch-1.html', '<p>from A</p>', 'utf8');
    await sa.run();
    await sb.run();
    assert.equal(b.rowText(b.get('book-a/chapters/ch-1.html')), '<p>from A</p>');
    await b.put('book-a/chapters/ch-1.html', '<p>from A, then B</p>', 'utf8');
    await sb.run();
    await sa.run();
    assert.equal(a.rowText(a.get('book-a/chapters/ch-1.html')), '<p>from A, then B</p>');
    assert.equal(a.paths().filter((p) => p.includes('sync-conflict')).length, 0);
  });
});

test('mergeLibrary keeps one side whole and every shelved book of the other', () => {
  const base = JSON.stringify({ x: 1, shelves: [{ id: 's1', bookIds: ['a'] }] });
  const other = JSON.stringify({ x: 2, firstRunDone: true, shelves: [{ id: 's1', bookIds: ['a', 'b'] }, { id: 's2', name: 'Drafts', bookIds: ['c'] }] });
  const m = JSON.parse(mergeLibrary(base, other));
  assert.equal(m.x, 1);
  assert.equal(m.firstRunDone, true);
  assert.deepEqual(m.shelves.map((s) => [s.id, s.bookIds]), [['s1', ['a', 'b']], ['s2', ['c']]]);
  assert.equal(mergeLibrary('not json', other), null);
});
