/**
 * import.js
 * The import window on the settings page: restores all data from an
 * export file.
 * The checks and the restore live in export.js.
 */

function setupImportModal() {
  const backdrop = document.getElementById("import-modal-backdrop");
  const fileInput = document.getElementById("import-file");
  const status = document.getElementById("import-status");
  const confirmBtn = document.getElementById("import-confirm");
  let pendingRaw = null;

  const reset = () => {
    pendingRaw = null;
    fileInput.value = "";
    status.textContent = "";
    confirmBtn.hidden = true;
  };
  const setOpen = (open) => {
    reset();
    backdrop.classList.toggle("hidden", !open);
    backdrop.setAttribute("aria-hidden", String(!open));
  };

  document.getElementById("import-btn").addEventListener("click", () => setOpen(true));
  document.getElementById("import-close-btn").addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) setOpen(false);
  });

  fileInput.addEventListener("change", async () => {
    pendingRaw = null;
    confirmBtn.hidden = true;
    const file = fileInput.files[0];
    if (!file) return;

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (e) {
      status.textContent = "That file is not valid JSON.";
      return;
    }

    const check = validateExport(parsed);
    if (!check.ok) {
      status.textContent = check.error;
      return;
    }

    loadState((state) => {
      const current = Object.keys(state.accounts).length;
      const when = new Date(check.exportedAt).toLocaleString();
      status.textContent =
        `This file holds ${check.accounts} accounts, exported ${when}. ` +
        `It will replace the ${current} accounts stored now.`;
      pendingRaw = parsed.raw;
      confirmBtn.hidden = false;
    });
  });

  confirmBtn.addEventListener("click", () => {
    if (!pendingRaw) return;
    restoreExport(pendingRaw, () => {
      reset();
      status.textContent = "Import complete.";
    });
  });
}
