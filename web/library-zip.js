/* ============================ NEO WEB ============================ */
/* The whole library as one .zip, for the Files app: saved to iCloud    */
/* Drive (or anywhere) from this iPad, opened on another device. Its    */
/* folders are desktop NEO's own, so a desktop library's daily backup   */
/* (Backups/neo-backup-….zip) opens here too, and this zip unzips into  */
/* a desktop NEO Library folder. Opening one never throws words away:   */
/* a file that differs from the one here keeps both, as sync.js does.   */

(function (root) {
  const t = (s, vars) => (root.NeoI18n ? root.NeoI18n.t(s, vars) : s);
  const store = () => root.NeoStore;
  const { SKIP, isText, mergeLibrary } = root.NeoSyncEngine;

  // A file handed to the writer: the share sheet on an iPad (Save to Files,
  // AirDrop, Mail), a download elsewhere or when the share sheet won't come
  async function saveBlob(blob, name) {
    const nav = root.navigator;
    const touch = root.matchMedia && root.matchMedia('(hover: none)').matches;
    if (touch && nav.canShare && nav.share) {
      try {
        const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ files: [file] });
          return true;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return false;
        // NotAllowedError: the tap that asked was too long ago; download it
      }
    }
    const a = root.document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.rel = 'noopener';
    root.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return true;
  }

  async function saveLibrary() {
    await store().ready;
    if (typeof root.flushAllSaves === 'function') { try { await root.flushAllSaves(); } catch { /* saved as it stands */ } }
    await store().settled();
    const zip = new root.JSZip();
    for (const [p, row] of store().all()) {
      if (SKIP.test(p)) continue;
      zip.file(p, store().rowBytes(row), { date: new Date(row.mtime) });
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/zip' });
    const day = new Date().toISOString().slice(0, 10);
    return saveBlob(blob, `NEO Library ${day}.zip`);
  }

  // → { added, updated, kept } (kept: files that differed and are now both here)
  async function openLibrary(file) {
    const zip = await root.JSZip.loadAsync(file);
    let names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(n));
    // a "NEO Library" folder zipped whole: its insides are the library
    if (!names.includes('library.json')) {
      const top = names.find((n) => /^[^/]+\/library\.json$/.test(n));
      if (top) {
        const pre = top.slice(0, top.indexOf('/') + 1);
        names = names.filter((n) => n.startsWith(pre));
        names = names.map((n) => [n, n.slice(pre.length)]);
      } else names = names.map((n) => [n, n]);
    } else names = names.map((n) => [n, n]);
    if (!names.some(([, p]) => p === 'library.json' || /^book-[^/]+\/book\.json$/.test(p))) {
      throw new Error(t('That .zip doesn’t hold a NEO library'));
    }
    await store().ready;
    const out = { added: 0, updated: 0, kept: 0 };
    const when = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const dec = new TextDecoder();
    const write = (p, bytes) => isText(p)
      ? store().put(p, dec.decode(bytes), 'utf8')
      : store().put(p, store().bytesToBase64(bytes), 'base64');
    for (const [entry, p] of names) {
      if (SKIP.test(p) || p === '_left-out-of-this-backup.txt' || p.split('/').some((s) => s === '..')) continue;
      const bytes = await zip.files[entry].async('uint8array');
      const here = store().get(p);
      if (!here) { await write(p, bytes); out.added++; continue; }
      const mine = store().rowBytes(here);
      if (mine.length === bytes.length && mine.every((b, i) => b === bytes[i])) continue;
      if (p === 'library.json') {
        const merged = mergeLibrary(dec.decode(mine), dec.decode(bytes));
        if (merged !== null) { await store().put(p, merged, 'utf8'); out.updated++; continue; }
      }
      // the newer keeps the name; the other is kept beside it
      const theirs = zip.files[entry].date ? zip.files[entry].date.getTime() : 0;
      if (theirs > here.mtime) {
        await write(`${p}.sync-conflict-${when}-web`, mine);
        await write(p, bytes);
        out.updated++;
      } else {
        await write(`${p}.sync-conflict-${when}-zip`, bytes);
      }
      out.kept++;
    }
    await store().settled();
    return out;
  }

  root.NeoLibraryZip = { saveBlob, saveLibrary, openLibrary };
})(typeof globalThis !== 'undefined' ? globalThis : this);
