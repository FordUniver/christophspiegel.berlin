// Run before styles load to avoid flashing the wrong saved theme.
(() => {
  const key = 'homepage-theme';
  const valid = value => ['light', 'dark'].includes(value) ? value : 'auto';
  const read = () => {
    try { return valid(localStorage.getItem(key)); }
    catch { return 'auto'; }
  };
  const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'), meta => ({
    meta, content: meta.content, media: meta.media,
  }));
  let preference = read();

  function apply() {
    if (preference === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = preference;
    for (const { meta, content, media } of metas) {
      meta.content = preference === 'auto' ? content : preference === 'dark' ? '#161c20' : '#fbfbf9';
      meta.media = preference === 'auto' ? media : '';
    }
    for (const input of document.querySelectorAll('.theme-switch input')) {
      input.checked = input.value === preference;
    }
  }

  apply();
  document.addEventListener('DOMContentLoaded', () => {
    const control = document.querySelector('.theme-switch');
    if (!control) return;
    apply();
    control.hidden = false;
    control.addEventListener('change', event => {
      if (!event.target.matches('input[name="theme"]')) return;
      preference = valid(event.target.value);
      try {
        if (preference === 'auto') localStorage.removeItem(key);
        else localStorage.setItem(key, preference);
      } catch { /* A blocked store must not prevent switching this page. */ }
      apply();
    });
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      preference = read();
      apply();
    }
  });
})();
