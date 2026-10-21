/* ============================ NEO WEB ============================ */
/* Formatting on a touch screen: select words and a small bar comes up  */
/* under them, with Bold, Italic, Underline and Footnote. Each button   */
/* is the key it stands for (⌘B, ⌘I, ⌘U, ⌘⇧N), sent to the page, so the */
/* page styles the words exactly as it does for a keyboard. The bar     */
/* waits until the selection is still and the finger is off the glass, */
/* sits below the words (the iPad's own Copy menu sits above), and goes */
/* the moment the writer types, taps away or lets the selection go.     */
/* A keyboard's selection (Shift and the arrows) has its keys already.  */

(function (root) {
  const t = (s, vars) => (root.NeoI18n ? root.NeoI18n.t(s, vars) : s);
  const doc = root.document;
  const IS_MAC = /mac|iphone|ipad/i.test(root.navigator.platform) || (root.navigator.maxTouchPoints > 1 && /Macintosh/.test(root.navigator.userAgent));
  const WHERE = '.chapter-body, #aux-editor';

  const BUTTONS = [
    { id: 'bold', label: () => t('Bold'), face: '<b>B</b>', code: 'KeyB', key: 'b', state: 'bold' },
    { id: 'italic', label: () => t('Italic'), face: '<i>I</i>', code: 'KeyI', key: 'i', state: 'italic' },
    { id: 'underline', label: () => t('Underline'), face: '<u>U</u>', code: 'KeyU', key: 'u', state: 'underline' },
    // a note at the end of the selection, in the manuscript only (Show More Features)
    { id: 'footnote', label: () => t('Footnote'), face: '<span class="wf-fn">¹</span>', code: 'KeyN', key: 'N', shift: true, chapterOnly: true }
  ];

  let bar = null;
  let touching = false;
  let byTouch = false; // the selection was made with a finger (or a pencil)
  let timer = null;
  let saved = null;

  const editableOf = (node) => {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el && el.closest ? el.closest(WHERE) : null;
  };
  function selectionHere() {
    const sel = root.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const host = editableOf(sel.anchorNode);
    if (!host || host !== editableOf(sel.focusNode) || !host.isContentEditable) return null;
    return { sel, range: sel.getRangeAt(0), host };
  }

  function make() {
    bar = doc.createElement('div');
    bar.id = 'web-format';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', t('Format'));
    for (const b of BUTTONS) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.dataset.id = b.id;
      btn.innerHTML = b.face;
      btn.title = b.label();
      btn.setAttribute('aria-label', b.label());
      // the tap must not take the selection away from the words
      btn.addEventListener('pointerdown', (e) => e.preventDefault());
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => { e.preventDefault(); act(b); });
      bar.appendChild(btn);
    }
    bar.hidden = true;
    doc.body.appendChild(bar);
  }

  function hide() {
    clearTimeout(timer);
    if (bar) bar.hidden = true;
  }

  function show() {
    const here = selectionHere();
    if (!here || !byTouch || touching || doc.querySelector('.modal-backdrop:not([hidden]), #web-menu')) { hide(); return; }
    if (!bar) make();
    saved = { range: here.range.cloneRange(), host: here.host };
    const inChapter = here.host.classList.contains('chapter-body');
    // (app.js's own names: a const is no property of window)
    const footnotes = inChapter && typeof moreOn === 'function' && moreOn() &&
      !(typeof isScript === 'function' && isScript());
    for (const btn of bar.querySelectorAll('button')) {
      const b = BUTTONS.find((x) => x.id === btn.dataset.id);
      btn.hidden = b.chapterOnly && !footnotes;
      let on = false;
      try { on = !!b.state && doc.queryCommandState(b.state); } catch { /* unknown here */ }
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    bar.hidden = false;
    place(here.range);
  }

  // below the words, unless the keyboard or the screen's foot is in the way
  function place(range) {
    const rects = [...range.getClientRects()].filter((r) => r.width || r.height);
    const box = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    const first = rects.length ? rects[0] : box;
    const kb = parseFloat(getComputedStyle(doc.documentElement).getPropertyValue('--kb')) || 0;
    const vv = root.visualViewport;
    const top0 = vv ? vv.offsetTop : 0;
    const height = (vv ? vv.height : root.innerHeight) - (vv ? 0 : kb);
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    let y = box.bottom + 14;
    // the iPad's selection handle hangs under the last line: clear it
    if (y + h > top0 + height - 70) y = first.top - h - 56; // above, past the Copy menu
    y = Math.max(top0 + 8, Math.min(y, top0 + height - h - 8));
    let x = (box.left + box.right) / 2 - w / 2;
    x = Math.max(8, Math.min(x, root.innerWidth - w - 8));
    bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function restore() {
    if (!saved) return;
    try {
      if (doc.activeElement !== saved.host) saved.host.focus({ preventScroll: true });
      const sel = root.getSelection();
      sel.removeAllRanges();
      sel.addRange(saved.range);
    } catch { /* the page moved on */ }
  }

  // the button is its key: the page's own handling, or the browser's where
  // the page leaves the key alone (the notes page)
  function act(b) {
    restore();
    const target = b.chapterOnly ? doc : (saved && saved.host) || doc.activeElement || doc;
    const ev = new KeyboardEvent('keydown', {
      key: b.key, code: b.code, shiftKey: !!b.shift, metaKey: IS_MAC, ctrlKey: !IS_MAC,
      bubbles: true, cancelable: true
    });
    target.dispatchEvent(ev);
    if (!ev.defaultPrevented && b.state) doc.execCommand(b.state);
    if (b.chapterOnly) { hide(); return; }
    // the selection stays: the bar shows what it is now
    setTimeout(show, 0);
  }

  const soon = () => { clearTimeout(timer); timer = setTimeout(show, 350); };

  doc.addEventListener('pointerdown', (e) => {
    if (bar && bar.contains(e.target)) return;
    byTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    touching = byTouch;
    hide();
  }, true);
  const lift = (e) => {
    if (bar && bar.contains(e.target)) return;
    touching = false;
    if (byTouch) soon();
  };
  doc.addEventListener('pointerup', lift, true);
  doc.addEventListener('pointercancel', lift, true);
  // iOS ends a long-press selection without a pointerup the page hears
  doc.addEventListener('touchend', () => { touching = false; if (byTouch) soon(); }, true);
  doc.addEventListener('selectionchange', () => {
    if (!byTouch) return;
    if (!selectionHere()) { hide(); return; }
    if (bar && !bar.hidden) hide();
    soon();
  });
  // typing, or a key of any kind: the words are the writer's again
  doc.addEventListener('keydown', (e) => { if (e.isTrusted) { byTouch = false; hide(); } }, true);
  doc.addEventListener('input', (e) => { if (e.isTrusted) hide(); }, true);
  root.addEventListener('scroll', () => { if (bar && !bar.hidden) { const h = selectionHere(); if (h) place(h.range); else hide(); } }, true);
  root.addEventListener('resize', hide);
})(typeof globalThis !== 'undefined' ? globalThis : this);
