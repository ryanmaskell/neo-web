/* ============================ NEO WEB ============================ */
/* The desktop's menu bar, behind ⋯. The menus are the desktop's own    */
/* (menu-template.js, which main.js hands to Electron): File, Edit,     */
/* Format, View and Help, each a level of a sheet, with the same ticks  */
/* and the same keys beside them. A choice sends the window the message */
/* the menu bar would. ⋯ sits in the editor's bar and on the shelf.     */

(function (root) {
  const t = (s, vars) => (root.NeoI18n ? root.NeoI18n.t(s, vars) : s);
  const doc = root.document;
  const neo = root.neo;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const IS_MAC = /mac|iphone|ipad/i.test(root.navigator.platform) || (root.navigator.maxTouchPoints > 1 && /Macintosh/.test(root.navigator.userAgent));

  /* ---------- the ticks, as the window reports them ---------- */
  // the same calls preload.js carries to main.js on the desktop
  const st = {
    script: { on: false, element: null, underline: false, contd: true },
    view: { focus: 'off', pageTheme: 'night', uiBright: false, bodyFont: '', dropCap: 'literary', align: null },
    pages: { paged: false, twoUp: false },
    pageWidth: 'regular', typewriter: false, nbspMarks: false, flush: false, poetry: false,
    vim: false, uiZoom: 1, uiLanguage: 'en', writingStyle: 'pantser', more: false, bookOpen: false,
    spellLanguage: 'en-US'
  };
  let scriptLine = null; // the script line a long-press is on (Page Break Here)
  const SCRIPT_ELEMENTS = ['heading', 'action', 'character', 'paren', 'dialogue', 'transition', 'shot'];
  Object.assign(neo, {
    poetryState: (on) => { st.poetry = !!on; },
    flushState: (on) => { st.flush = !!on; },
    typewriterState: (on) => { st.typewriter = !!on; },
    nbspMarksState: (on) => { st.nbspMarks = !!on; },
    vimState: (on) => { st.vim = !!on; },
    moreState: (on) => { st.more = !!on; },
    writingStyleState: (s) => { st.writingStyle = s === 'plotter' ? 'plotter' : 'pantser'; },
    pageWidthState: (v) => { st.pageWidth = ['regular', 'wide', 'wider'].includes(v) ? v : 'regular'; },
    pagesState: (s) => { s = s || {}; st.pages = { paged: !!s.paged, twoUp: !!s.twoUp }; },
    uiZoomState: (z) => { z = Number(z); st.uiZoom = Number.isFinite(z) ? Math.round(Math.min(3, Math.max(0.9, z)) * 10) / 10 : 1; },
    viewState: (s) => {
      s = s || {};
      st.view = {
        focus: s.focus || 'off', pageTheme: s.pageTheme || 'night', uiBright: !!s.uiBright,
        bodyFont: typeof s.bodyFont === 'string' ? s.bodyFont : '',
        dropCap: typeof s.dropCap === 'string' ? s.dropCap : 'literary',
        align: ['left', 'center', 'right', 'justify'].includes(s.align) ? s.align : null
      };
    },
    scriptState: (s) => {
      s = s || {};
      st.script = { on: !!s.on, element: SCRIPT_ELEMENTS.includes(s.element) ? s.element : null, underline: !!s.underline, contd: s.contd !== false };
      st.bookOpen = !!s.book;
    },
    reloadForLanguage: async () => { root.location.reload(); return true; },
    scriptContext: (s) => { scriptLine = s && typeof s === 'object' ? { pageBreak: !!s.pageBreak } : null; return true; }
  });

  const send = (msg) => { if (root.pocketMenu) root.pocketMenu(msg); };
  const lib = () => (typeof root.library !== 'undefined' && root.library) || {};

  function languages() {
    return (root.NEO_LANGUAGES || [{ code: 'en', name: 'English' }]);
  }
  function spellLanguages() {
    const codes = (root.pocketSpellLanguages && root.pocketSpellLanguages()) || {};
    const out = {};
    for (const [code, label] of Object.entries(codes)) out[code] = { label };
    return out;
  }

  const actions = {
    // the library lives in this browser: its folder is OneDrive or a .zip
    libraryFolder: () => { if (root.NeoWebSheet) root.NeoWebSheet.open(); },
    fullScreen: () => {
      const d = doc.documentElement;
      const on = doc.fullscreenElement || doc.webkitFullscreenElement;
      try {
        if (on) (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
        else (d.requestFullscreen || d.webkitRequestFullscreen).call(d);
      } catch { /* this browser keeps its own bars */ }
    },
    setLanguage: (code) => {
      try { root.localStorage.setItem('neo-language', code); } catch { /* fine */ }
      st.uiLanguage = code;
      send({ type: 'uiLanguage', value: code });
    }
  };

  function template() {
    st.uiLanguage = (neo.i18n && neo.i18n.locale) || 'en';
    st.spellLanguage = (root.pocketSpellLanguage && root.pocketSpellLanguage()) || lib().spellLanguage || 'en-US';
    const items = root.NeoMenu.menuTemplate({
      t, isMac: IS_MAC, isWin: false, send,
      pageKey: (accelerator, run) => ({ accelerator, registerAccelerator: false, click: run }),
      st, spellLanguages: spellLanguages(), languages: languages(), library: lib, actions
    });
    return root.NeoMenu.simpleTemplate(items, st.more).filter((m) => m.role !== 'windowMenu' && m.role !== 'appMenu');
  }

  /* ---------- the Edit menu's standard items ---------- */
  // the menu takes the tap; the writer's selection is put back before
  // the item acts on it
  let saved = null;
  const keep = () => {
    const sel = root.getSelection();
    saved = sel && sel.rangeCount ? { range: sel.getRangeAt(0).cloneRange(), el: doc.activeElement } : null;
  };
  const restore = () => {
    if (!saved) return;
    try {
      if (saved.el && saved.el.focus) saved.el.focus({ preventScroll: true });
      const sel = root.getSelection();
      sel.removeAllRanges();
      sel.addRange(saved.range);
    } catch { /* the page moved on */ }
  };
  const ROLES = {
    undo: () => doc.execCommand('undo'),
    redo: () => doc.execCommand('redo'),
    cut: () => doc.execCommand('cut'),
    copy: () => doc.execCommand('copy'),
    selectAll: () => doc.execCommand('selectAll'),
    paste: async () => {
      const text = await root.navigator.clipboard.readText();
      if (text) doc.execCommand('insertText', false, text);
    },
    pasteAndMatchStyle: () => ROLES.paste()
  };
  const shownRole = (it) => !it.role || ROLES[it.role];

  /* ---------- the sheet ---------- */
  function keyLabel(acc) {
    if (!acc) return '';
    const mac = IS_MAC;
    return String(acc).split(/\+|-(?=Plus$|Minus$)/).map((k) => {
      if (k === 'CmdOrCtrl') return mac ? '⌘' : 'Ctrl+';
      if (k === 'Shift') return mac ? '⇧' : 'Shift+';
      if (k === 'Alt') return mac ? '⌥' : 'Alt+';
      if (k === 'Plus') return '+';
      if (k === 'Minus') return '−';
      return k;
    }).join('');
  }

  let wrap = null;
  let stack = []; // labels of the open submenus, from the top
  function close() { if (wrap) { wrap.remove(); wrap = null; } stack = []; }

  function itemsAt() {
    let items = template();
    for (const label of stack) {
      const it = items.find((x) => x.label === label && Array.isArray(x.submenu));
      if (!it) { stack = []; return template(); }
      items = it.submenu;
    }
    return items;
  }

  function render() {
    if (!wrap) return;
    const items = itemsAt().filter((it) => it.visible !== false && shownRole(it));
    const sheet = wrap.querySelector('.wm-sheet');
    const title = stack.length ? stack[stack.length - 1].replace(/&&/g, '&') : t('Menu');
    let html = `<div class="wm-head">${stack.length ? `<button class="wm-back" data-back="1" aria-label="${esc(t('Back'))}">‹</button>` : '<span></span>'}<span class="wm-title">${esc(title)}</span><button class="wm-close" data-close="1" aria-label="${esc(t('Close'))}">✕</button></div><div class="wm-list" role="menu">`;
    let lastSep = true;
    items.forEach((it, i) => {
      if (it.type === 'separator') { if (!lastSep) html += '<div class="wm-sep"></div>'; lastSep = true; return; }
      lastSep = false;
      const sub = Array.isArray(it.submenu);
      const on = (it.type === 'checkbox' || it.type === 'radio') && it.checked;
      const off = it.enabled === false;
      html += `<button class="wm-item${off ? ' wm-off' : ''}" role="menuitem" data-i="${i}"${off ? ' disabled' : ''}>` +
        `<span class="wm-tick">${on ? '✓' : ''}</span><span class="wm-label">${esc(String(it.label || '').replace(/&&/g, '&'))}</span>` +
        `<span class="wm-key">${sub ? '›' : esc(keyLabel(it.accelerator))}</span></button>`;
    });
    html += '</div>';
    sheet.innerHTML = html;
    sheet.querySelectorAll('.wm-item').forEach((b) => {
      b.addEventListener('click', () => choose(items[Number(b.dataset.i)]));
    });
    const first = sheet.querySelector('.wm-item:not([disabled])');
    if (first && !('ontouchstart' in root)) first.focus({ preventScroll: true });
  }

  async function choose(it) {
    if (!it || it.enabled === false) return;
    if (Array.isArray(it.submenu)) { stack.push(it.label); render(); return; }
    close();
    try {
      if (it.role) { restore(); await ROLES[it.role](); return; }
      if (it.click) {
        restore();
        // Electron flips a checkbox before its click runs; so does this
        const checked = it.type === 'checkbox' ? !it.checked : it.type === 'radio' ? true : it.checked;
        it.click({ ...it, checked });
      }
    } catch (err) {
      if (typeof root.toast === 'function') root.toast(String(err && err.message || err));
    }
  }

  function open(e) {
    if (e) { e.preventDefault(); e.stopImmediatePropagation(); }
    if (wrap) { close(); return; }
    wrap = doc.createElement('div');
    wrap.id = 'web-menu';
    wrap.innerHTML = '<div class="wm-sheet" role="dialog" aria-modal="true"></div>';
    wrap.addEventListener('click', (ev) => {
      if (ev.target === wrap || ev.target.closest('[data-close]')) close();
      else if (ev.target.closest('[data-back]')) { stack.pop(); render(); }
    });
    wrap.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.stopPropagation(); if (stack.length) { stack.pop(); render(); } else close(); }
      if (ev.key === 'ArrowLeft' && stack.length) { ev.stopPropagation(); stack.pop(); render(); }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const list = [...wrap.querySelectorAll('.wm-item:not([disabled])')];
        const at = list.indexOf(doc.activeElement);
        const next = list[(at + (ev.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
        if (next) next.focus();
      }
    });
    doc.body.appendChild(wrap);
    render();
  }

  /* ---------- the menus' keys ---------- */
  // Electron answers a menu item's key before the page sees it; here the
  // page goes first, and a key it didn't take is matched to the menus.
  // (Keys the page answers itself are marked registerAccelerator: false.)
  function matches(acc, e) {
    const parts = String(acc).split(/\+|-(?=Plus$|Minus$)/);
    const key = parts.pop();
    const want = { cmd: parts.includes('CmdOrCtrl'), shift: parts.includes('Shift'), alt: parts.includes('Alt') };
    const cmd = IS_MAC ? e.metaKey : e.ctrlKey;
    if (cmd !== want.cmd || e.altKey !== want.alt) return false;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'Plus') return k === '+' || k === '=';
    if (key === 'Minus') return k === '-' || k === '_';
    if (e.shiftKey !== want.shift) return false;
    return k === key.toLowerCase() || (e.code === 'Key' + key.toUpperCase());
  }
  function findKey(items, e) {
    for (const it of items) {
      if (it.visible === false || it.enabled === false) continue;
      if (Array.isArray(it.submenu)) { const hit = findKey(it.submenu, e); if (hit) return hit; continue; }
      if (it.accelerator && it.registerAccelerator !== false && it.click && matches(it.accelerator, e)) return it;
    }
    return null;
  }
  // ⌘, is Goals, as on the desktop (Pocket's page opens its sheet with it)
  root.addEventListener('keydown', (e) => {
    if (!(IS_MAC ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey || e.key !== ',') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!wrap && !doc.querySelector('.modal-backdrop:not([hidden])')) send({ type: 'stats' });
  }, true);
  root.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || wrap || !(e.metaKey || e.ctrlKey)) return;
    if (doc.querySelector('.modal-backdrop:not([hidden])')) return;
    let it = null;
    try { it = findKey(template(), e); } catch { return; }
    if (!it) return;
    e.preventDefault();
    const checked = it.type === 'checkbox' ? !it.checked : it.type === 'radio' ? true : it.checked;
    it.click({ ...it, checked });
  });

  // a long-press on a script's line, from app.js: Page Break Here, as the
  // desktop's right-click offers it
  doc.addEventListener('contextmenu', (e) => {
    if (!scriptLine || !e.target.closest || !e.target.closest('.chapter-body')) return;
    const line = scriptLine;
    scriptLine = null;
    if (typeof root.popMenu !== 'function') return;
    e.preventDefault();
    root.popMenu(e.clientX, e.clientY, [{ label: line.pageBreak ? t('Remove Page Break') : t('Page Break Here'), value: 'pb' }]).then((v) => { if (v === 'pb') send({ type: 'scriptPageBreak' }); });
  });

  doc.addEventListener('DOMContentLoaded', () => {
    // ⋯ in the editor's bar: the menus, in place of Pocket's short sheet
    // (heard on the way down, before Pocket's own sheet hears it)
    const more = doc.getElementById('pocket-more');
    if (more) {
      more.title = t('Menu');
      more.setAttribute('aria-label', t('Menu'));
    }
    doc.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('#pocket-more, #web-menu-btn')) keep(); }, true);
    doc.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#pocket-more')) open(e); }, true);
    // and on the shelf, at the end of its header
    const right = doc.querySelector('#shelf-header .shelf-header-right');
    if (right) {
      const b = doc.createElement('button');
      b.id = 'web-menu-btn';
      b.innerHTML = '&#8943;';
      b.title = t('Menu');
      b.setAttribute('aria-label', t('Menu'));
      b.addEventListener('click', open);
      right.appendChild(b);
    }
  });

  root.NeoWebMenu = { open, close, state: st };
})(typeof globalThis !== 'undefined' ? globalThis : this);
