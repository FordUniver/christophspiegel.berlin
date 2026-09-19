// Fit the real text, including loaded fonts and the reader's text size. Keep
// native disclosure as the usable fallback before this enhancement runs.
(() => {
  const header = document.querySelector('.site-header-inner');
  if (!header) return;
  const nav = header.querySelector('.site-nav');
  const details = nav.querySelector('details');
  const summary = details.querySelector('summary');
  const list = details.querySelector('.site-nav-list');
  const links = Array.from(list.querySelectorAll('a'));
  const activeLink = list.querySelector('[aria-current="page"]') || links[0];

  function fit() {
    const keepOpen = header.dataset.navMode === 'menu' && details.open;
    const focused = document.activeElement;
    // Measure the same nodes off-flow, at minimum spacing. No duplicate links
    // or estimated character widths, and no intermediate state is painted.
    header.classList.add('nav-measuring');
    details.open = true;
    const width = header.clientWidth;
    const rem = parseFloat(getComputedStyle(header).fontSize);
    const separation = parseFloat(getComputedStyle(header).columnGap);
    const minimumGap = parseFloat(getComputedStyle(list).columnGap);
    const labelsWidth = links.reduce((sum, link) => sum + link.getBoundingClientRect().width, 0);
    const gaps = Math.max(1, links.length - 1);
    const minimumList = labelsWidth + minimumGap * gaps;
    const brandWidth = kind => Math.max(44, header.querySelector('.wordmark-' + kind).getBoundingClientRect().width);
    let mode = 'menu';
    let gap = minimumGap;
    for (const kind of ['full', 'compact']) {
      const available = width - brandWidth(kind) - separation;
      if (available >= minimumList + 1) {
        mode = kind;
        gap = Math.min(2.25 * rem, (available - labelsWidth - 1) / gaps);
        break;
      }
    }
    header.dataset.navMode = mode;
    header.style.setProperty('--nav-gap', gap + 'px');
    details.open = mode !== 'menu' || keepOpen;
    summary.setAttribute('aria-expanded', String(details.open));
    header.classList.remove('nav-measuring');

    // Measurement can temporarily hide the focused control. Restore it, or
    // move to its visible counterpart if the layout itself changed.
    if (header.contains(focused)) {
      let target = focused;
      if (mode !== 'menu' && focused === summary) target = activeLink;
      if (mode === 'menu' && !details.open && list.contains(focused)) target = summary;
      if (document.activeElement !== target) target.focus({ preventScroll: true });
    }
  }

  function close(returnFocus = false) {
    if (header.dataset.navMode !== 'menu') return;
    details.open = false;
    if (returnFocus) summary.focus({ preventScroll: true });
  }

  details.addEventListener('toggle', () => summary.setAttribute('aria-expanded', String(details.open)));
  nav.addEventListener('keydown', event => {
    if (header.dataset.navMode !== 'menu') return;
    if (event.key === 'Escape' && details.open) {
      event.preventDefault();
      close(true);
    } else if (event.target === summary && event.key === 'ArrowDown') {
      event.preventDefault();
      details.open = true;
      activeLink.focus();
    }
  });
  list.addEventListener('click', event => { if (event.target.closest('a')) close(); });
  document.addEventListener('pointerdown', event => { if (!nav.contains(event.target)) close(); });
  nav.addEventListener('focusout', event => {
    if (nav.contains(event.relatedTarget)) return;
    // Wait until the native focus transfer completes, not its microtask
    // checkpoint (where activeElement may briefly be the body).
    requestAnimationFrame(() => { if (!nav.contains(document.activeElement)) close(); });
  });

  let frame;
  function scheduleFit() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  }
  fit();
  // Header width, text scaling, and delayed fonts can each change the fit.
  const observer = new ResizeObserver(scheduleFit);
  observer.observe(header);
  observer.observe(header.querySelector('.wordmark-compact'));
  for (const link of links) observer.observe(link);
  document.fonts.ready.then(scheduleFit);
  document.fonts.addEventListener('loadingdone', scheduleFit);
  window.addEventListener('resize', scheduleFit);
  window.addEventListener('pageshow', scheduleFit);
})();
