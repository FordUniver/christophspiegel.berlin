// Join title/authors or venue/links only when the real layout saves a line AND height.
// Keep the same semantic nodes and typography in both layouts.
const candidates = [
  ...Array.from(document.querySelectorAll('.publication-heading'))
    .filter(element => element.querySelector('.publication-author-text'))
    .map(element => ({ element, key: 'headingLayout', fragments:
      '.publication-title-text, .publication-author-text, .publication-author-separator' })),
  ...Array.from(document.querySelectorAll('.publication-metadata'))
    .filter(element => element.querySelector('.publication-links-text'))
    .map(element => ({ element, key: 'metadataLayout', fragments:
      '.publication-venue-text, .publication-links-text' })),
];

function measure({ element, fragments: selector }) {
  const bounds = element.getBoundingClientRect();
  // These inline wrappers expose their own line fragments. Do not count all
  // descendant rectangles: KaTeX has many overlapping and raised glyph boxes.
  const fragments = Array.from(element.querySelectorAll(selector))
    .flatMap(span => Array.from(span.getClientRects()))
    .filter(rect => rect.width > 0 && rect.height > 0)
    .sort((a, b) => a.top - b.top);
  const lines = [];
  for (const rect of fragments) {
    // Text fonts have different ascents but overlap on a shared
    // baseline. A tiny overlap between adjacent line boxes is not a match.
    const line = lines.find(line => Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top)
      > Math.min(line.bottom - line.top, rect.height) / 2);
    if (line) {
      line.top = Math.min(line.top, rect.top);
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else lines.push({ top: rect.top, bottom: rect.bottom });
  }
  return {
    lines: lines.length,
    height: bounds.height,
    fits: fragments.every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1),
  };
}

let frame;
let fontsReady = false;
let printing = false;

function fit() {
  const visible = candidates.filter(({ element }) => element.getBoundingClientRect().width > 0);
  // Batch each candidate's writes and reads. All three phases finish in one
  // frame; no measurement clones, hidden links, or intermediate painted state.
  for (const { element, key } of visible) element.dataset[key] = 'separate';
  const separate = visible.map(measure);
  for (const { element, key } of visible) element.dataset[key] = 'joined';
  const joined = visible.map(measure);
  visible.forEach(({ element, key }, index) => {
    const before = separate[index], after = joined[index];
    element.dataset[key] = after.fits && after.lines > 0
      && after.lines < before.lines && after.height < before.height - 1 ? 'joined' : 'separate';
  });
}

function scheduleFit() {
  if (!fontsReady || printing) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(fit);
}

if (candidates.length) {
  const widths = new WeakMap();
  let rootFont = getComputedStyle(document.documentElement).fontSize;
  const observer = new ResizeObserver(entries => {
    for (const entry of entries) {
      if (entry.target === document.documentElement) {
        const size = getComputedStyle(entry.target).fontSize;
        if (size !== rootFont) { rootFont = size; scheduleFit(); }
      } else {
        const width = entry.contentRect.width;
        // Ignore our own height changes. A hidden/revealed entry changes width
        // through zero, so pagination and filtering also get a fresh fit.
        if (widths.get(entry.target) !== width) {
          widths.set(entry.target, width);
          scheduleFit();
        }
      }
    }
  });
  for (const { element } of candidates) observer.observe(element);
  observer.observe(document.documentElement);
  document.fonts.ready.then(() => { fontsReady = true; scheduleFit(); });
  document.fonts.addEventListener('loadingdone', scheduleFit);
  document.addEventListener('homepage:math-rendered', scheduleFit);
  window.addEventListener('resize', scheduleFit);
  window.addEventListener('pageshow', scheduleFit);
  window.addEventListener('beforeprint', () => {
    printing = true;
    cancelAnimationFrame(frame);
    for (const { element, key } of candidates) element.dataset[key] = 'separate';
  });
  window.addEventListener('afterprint', () => { printing = false; scheduleFit(); });
}
