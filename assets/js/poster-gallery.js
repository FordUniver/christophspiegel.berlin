for (const trigger of document.querySelectorAll("[data-poster-dialog]")) {
  const dialog = document.getElementById(trigger.dataset.posterDialog);

  if (!(dialog instanceof HTMLDialogElement)) continue;

  trigger.addEventListener("click", () => {
    dialog.showModal();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener("close", () => {
    trigger.focus();
  });
}
