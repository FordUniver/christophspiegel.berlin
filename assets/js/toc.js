const layout = document.querySelector(".post-layout");
const content = document.querySelector(".post-content");
const rail = document.querySelector(".post-outline-rail");
const outline = document.querySelector(".article-outline");

if (layout && content && rail && outline) {
  const marker = document.createComment("article outline");
  outline.before(marker);
  const wide = window.matchMedia("(min-width: 72rem)");

  const placeOutline = () => {
    if (wide.matches) {
      rail.append(outline);
      layout.classList.add("has-outline-rail");
    } else {
      marker.after(outline);
      layout.classList.remove("has-outline-rail");
    }
  };

  placeOutline();
  wide.addEventListener("change", placeOutline);

  const links = [...outline.querySelectorAll("a[href^='#']")];
  const sections = links
    .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
    .filter(Boolean);

  if ("IntersectionObserver" in window && sections.length) {
    const byId = new Map(links.map((link) => [decodeURIComponent(link.hash.slice(1)), link]));
    const visible = new Map();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => visible.set(entry.target.id, entry.isIntersecting));
      const current = sections.find((section) => visible.get(section.id));
      links.forEach((link) => link.removeAttribute("aria-current"));
      if (current) byId.get(current.id)?.setAttribute("aria-current", "location");
    }, { rootMargin: "-12% 0px -72% 0px" });
    sections.forEach((section) => observer.observe(section));
  }
}
