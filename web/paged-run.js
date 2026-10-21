// Runs inside the frame web-powers.js lays a book out in, before Paged.js
// (print/paged.polyfill.js): the frame's page can't carry inline scripts.
// The same steps main.js renderPaged puts in its offscreen window: page 1 is
// the page that holds .pg1, and the frame says how many pages it made.
window.PagedConfig = { auto: false };
window.addEventListener('load', () => {
  window.PagedPolyfill.preview().then(() => {
    const pp = [...document.querySelectorAll('.pagedjs_page')];
    const s = pp.findIndex((p) => p.querySelector('.pg1:not([data-split-from])'));
    if (s >= 0) pp.forEach((p, i) => { p.style.counterReset = 'page ' + (i >= s ? i - s + 1 : 0); p.style.counterIncrement = 'none'; });
    window.__neoPages = pp.length;
  }, (e) => { window.__neoPagedError = String((e && e.stack) || e); });
});
