const render = () => {
  const target = document.querySelector(".site-main");
  const macrosNode = document.querySelector("#math-macros");
  if (!target || !macrosNode || typeof window.renderMathInElement !== "function") return;

  window.renderMathInElement(target, {
    delimiters: [
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false }
    ],
    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    macros: JSON.parse(macrosNode.textContent),
    strict: "warn",
    throwOnError: false,
    trust: false
  });
  document.dispatchEvent(new Event('homepage:math-rendered'));
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", render, { once: true });
} else {
  render();
}
