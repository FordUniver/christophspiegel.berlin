// Keep native disclosure without JavaScript. When enhanced, a single toggle
// follows the whole list in both states, in reading and keyboard order.
let disclosureIndex = 0;
for (const details of document.querySelectorAll("details.archive-details")) {
  const summary = details.querySelector(":scope > summary");
  if (!summary) continue;
  details.id ||= "archive-" + (++disclosureIndex);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "archive-toggle";
  toggle.setAttribute("aria-controls", details.id);
  const expandedLabel = details.dataset.collapseLabel || "Show less";
  const leadingList = details.previousElementSibling;
  const continuation = leadingList?.matches(".organization-list")
    ? details.querySelector(":scope > .organization-list") : null;
  const leadingEntries = continuation ? Array.from(leadingList.children) : [];
  function update() {
    // One grid when expanded: preserve row filling and shading across the
    // disclosure boundary. Restore the initial entries before hiding the rest.
    const targetList = details.open ? continuation : leadingList;
    if (leadingEntries.length && leadingEntries[0].parentElement !== targetList) {
      targetList.prepend(...leadingEntries);
    }
    toggle.replaceChildren(...(details.open
      ? [document.createTextNode(expandedLabel)]
      : Array.from(summary.childNodes, node => node.cloneNode(true))));
    toggle.setAttribute("aria-expanded", String(details.open));
  }
  details.after(toggle);
  summary.hidden = true;
  details.classList.add("archive-enhanced");
  details.addEventListener("toggle", update);
  update();

  toggle.addEventListener("click", () => {
    details.open = !details.open;
    update();
    const top = toggle.getBoundingClientRect().top;
    if (!details.open && (top < 80 || top > innerHeight - 60)) toggle.scrollIntoView({ block: "center", behavior: "instant" });
  });
}
