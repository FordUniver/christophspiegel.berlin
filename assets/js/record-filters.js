const CONFIG = {
  publications: { prefix: "pub" },
  talks: { prefix: "talk" },
};

function normalized(value) {
  return (value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

function matches(record, state) {
  return !state.q || normalized(record.dataset.search).includes(normalized(state.q));
}

function initialize(root) {
  const config = CONFIG[root.dataset.recordFilter];
  const form = root.querySelector(".record-search");
  if (!config || !form) return;
  const records = Array.from(root.querySelectorAll("[data-record-list] [data-record]"));
  const groups = Array.from(root.querySelectorAll("[data-record-group]"));
  const field = key => form.elements.namedItem(config.prefix + "-" + key);
  const keys = ["q", "page", "size"];
  const defaults = { q: "", size: root.dataset.defaultLimit, page: "1" };
  let state = { ...defaults };

  function loadQuery() {
    const params = new URLSearchParams(window.location.search);
    state = { ...defaults };
    for (const key of keys) {
      const value = params.get(config.prefix + "-" + key);
      if (value === null) continue;
      // The page selector is rebuilt from the matching records in render().
      if (key !== "page" && field(key) instanceof HTMLSelectElement
          && !Array.from(field(key).options).some(option => option.value === value)) continue;
      state[key] = value;
    }
  }

  function writeQuery(push = false, preserveRecordHash = false) {
    const url = new URL(window.location.href);
    // Once the reader changes a list, an old record anchor must not undo that
    // change on reload or browser history navigation.
    if (!preserveRecordHash && records.some(record => url.hash === "#" + record.id)) url.hash = root.id;
    for (const key of keys) {
      const name = config.prefix + "-" + key;
      if (!state[key] || state[key] === defaults[key]) url.searchParams.delete(name);
      else url.searchParams.set(name, state[key]);
    }
    if (url.href !== window.location.href) {
      window.history[push ? "pushState" : "replaceState"]({}, "", url);
    }
  }

  function render() {
    const matching = records.filter(record => matches(record, state));
    const selector = field("page");
    const size = state.size === "all" ? Math.max(1, matching.length) : Number(state.size);
    const pages = Math.max(1, Math.ceil(matching.length / size));
    const requested = /^\d+$/.test(state.page) ? Number(state.page) : 1;
    const pageIndex = Math.max(0, Math.min(pages - 1, requested - 1));
    state.page = String(pageIndex + 1);
    const options = Array.from({ length: pages }, (_, i) => [String(i + 1), "Page " + (i + 1) + " of " + pages]);
    const start = pageIndex * size;
    const visible = matching.slice(start, start + size);
    let status = visible.length ? "Showing " + (start + 1) + "–" + (start + visible.length) + " of " + matching.length : "Showing 0 of 0";
    status += matching.length === records.length ? " entries" : " matches (" + records.length + " total)";
    selector.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    selector.disabled = options.length <= 1;
    for (const key of keys) field(key).value = state[key];
    const shown = new Set(visible);
    for (const record of records) record.hidden = !shown.has(record);
    for (const group of groups) group.hidden = !group.querySelector("[data-record]:not([hidden])");
    root.querySelector("[data-result-count]").textContent = status;
    root.querySelector("[data-empty-result]").hidden = visible.length !== 0;
    for (const button of root.querySelectorAll("[data-page-step]")) {
      button.disabled = Number(button.dataset.pageStep) < 0 ? pageIndex === 0 : pageIndex >= options.length - 1;
    }
    root.classList.add("filters-ready");
  }

  function showListStart() {
    const heading = root.querySelector("h2");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    root.scrollIntoView({ block: "start", behavior: "instant" });
  }

  function revealHashTarget() {
    let id;
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target || !root.contains(target) || !target.matches("[data-record]")) return;
    if (!matches(target, state)) state.q = "";
    const matching = records.filter(record => matches(record, state));
    state.page = state.size === "all" ? "1" : String(Math.floor(matching.indexOf(target) / Number(state.size)) + 1);
    render();
    writeQuery(false, true);
    requestAnimationFrame(() => target.scrollIntoView({ block: "center", behavior: "instant" }));
  }

  loadQuery();
  render();
  revealHashTarget();
  window.addEventListener("hashchange", revealHashTarget);
  window.addEventListener("popstate", () => { loadQuery(); render(); revealHashTarget(); });

  // Associated controls outside the search form bubble through the section.
  root.addEventListener("input", event => {
    if (event.target !== field("q")) return;
    state.q = event.target.value;
    state.page = defaults.page;
    render();
    writeQuery();
  });
  root.addEventListener("change", event => {
    const key = keys.find(key => event.target === field(key));
    if (!key || key === "q") return;
    state[key] = event.target.value;
    if (key !== "page") state.page = defaults.page;
    render();
    writeQuery(key === "page");
    if (key === "page" || key === "size") showListStart();
  });
  root.addEventListener("click", event => {
    const button = event.target.closest("[data-page-step]");
    if (!button || button.disabled) return;
    const selector = field("page");
    state.page = selector.options[selector.selectedIndex + Number(button.dataset.pageStep)].value;
    render();
    writeQuery(true);
    showListStart();
  });
  form.addEventListener("submit", event => event.preventDefault());
}

for (const root of document.querySelectorAll("[data-record-filter]")) initialize(root);
