/**
 * import.js
 * Page script for import.html: restores all data from an export file.
 * The checks and the restore live in export.js.
 */

document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("import-file");
  const status = document.getElementById("import-status");
  const confirmBtn = document.getElementById("import-confirm");
  let pendingRaw = null;

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

    store.get(["latestBalances"], (result) => {
      const current = Object.keys(result.latestBalances || {}).length;
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
      pendingRaw = null;
      confirmBtn.hidden = true;
      status.textContent = "Import complete. Open the popup to see your data.";
    });
  });
});
