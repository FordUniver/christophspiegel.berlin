(() => {
  const trigger = document.querySelector(".citation-trigger");
  const dialog = document.querySelector(".citation-dialog");
  if (!trigger || !dialog || typeof dialog.showModal !== "function") return;

  const code = dialog.querySelector(".citation-code");
  const rendered = dialog.querySelector(".citation-rendered");
  const status = dialog.querySelector(".citation-status");
  const copy = dialog.querySelector(".citation-copy");
  let statusTimeout;
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-controls", dialog.id);

  function clearStatus() {
    clearTimeout(statusTimeout);
    status.textContent = "";
    status.removeAttribute("data-error");
    copy.removeAttribute("data-copied");
    copy.setAttribute("aria-label", "Copy citation");
    copy.title = "Copy citation";
  }

  function accessDate(style) {
    const today = new Date();
    const month = new Intl.DateTimeFormat(style === "vancouver" ? "en-US" : "en-GB", {
      month: style === "vancouver" ? "short" : "long"
    }).format(today);
    return style === "vancouver"
      ? `${today.getFullYear()} ${month} ${today.getDate()}`
      : `${today.getDate()} ${month} ${today.getFullYear()}`;
  }

  function updateFormat() {
    const id = dialog.querySelector('input[name="citation-format"]:checked').value;
    const format = dialog.querySelector(`template[data-citation-format="${id}"]`);
    const display = dialog.querySelector(`template[data-citation-rendered="${id}"]`);
    const token = "__APPENDIX_ACCESS_DATE__";
    const date = accessDate(id);
    code.value = format.content.textContent.replaceAll(token, date);
    code.scrollTop = 0;
    code.setAttribute("aria-label", `${format.dataset.label} citation`);
    code.hidden = Boolean(display);
    rendered.hidden = !display;
    if (display) {
      rendered.replaceChildren(display.content.cloneNode(true));
      const textNodes = document.createTreeWalker(rendered, NodeFilter.SHOW_TEXT);
      while (textNodes.nextNode()) {
        textNodes.currentNode.textContent = textNodes.currentNode.textContent.replaceAll(token, date);
      }
      rendered.setAttribute("aria-label", `${format.dataset.label} citation`);
    }
    clearStatus();
  }

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    updateFormat();
    dialog.showModal();
    dialog.querySelector('input[name="citation-format"]:checked').focus();
  });

  dialog.addEventListener("change", (event) => {
    if (event.target.name === "citation-format") updateFormat();
  });

  copy.addEventListener("click", async () => {
    clearStatus();
    let copied = false;
    try {
      if (!rendered.hidden && navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({
          "text/plain": new Blob([code.value], { type: "text/plain" }),
          "text/html": new Blob([rendered.innerHTML], { type: "text/html" })
        })]);
      } else {
        await navigator.clipboard.writeText(code.value);
      }
      copied = true;
    } catch {
      // HTTP previews can copy the selected citation through the browser.
      if (rendered.hidden) {
        code.focus();
        code.select();
      } else {
        rendered.focus();
        const range = document.createRange();
        range.selectNodeContents(rendered);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      const writeSelection = (event) => {
        if (!event.clipboardData) return;
        event.clipboardData.setData("text/plain", code.value);
        if (!rendered.hidden) event.clipboardData.setData("text/html", rendered.innerHTML);
        event.preventDefault();
      };
      document.addEventListener("copy", writeSelection);
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      } finally {
        document.removeEventListener("copy", writeSelection);
      }
    }
    if (copied) {
      copy.focus();
      copy.setAttribute("data-copied", "");
      copy.setAttribute("aria-label", "Copied");
      copy.title = "Copied";
      status.textContent = "Copied";
      statusTimeout = setTimeout(clearStatus, 2500);
    } else {
      status.setAttribute("data-error", "");
      status.textContent = "Select the citation and copy it with your keyboard.";
    }
  });

  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });

  dialog.addEventListener("close", () => {
    clearStatus();
    trigger.focus();
  });
})();
