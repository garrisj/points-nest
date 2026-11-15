/**
 * export.js
 * Backup of all tracked data as one JSON file. Relies on `store` and
 * `parseHistoryEntries` from storage.js and on owners.js.
 */

const EXPORT_VERSION = 1;

/**
 * Builds the export from a full storage snapshot.
 * `accounts` holds one readable record per account with its owner and its
 * decoded balance history. `raw` holds storage as-is, for a later restore.
 */
function buildExport(data, exportedAt) {
  const owners = data[OWNERS_KEY] || {};
  const accounts = Object.entries(data.latestBalances || {}).map(([key, account]) => ({
    key,
    owner: resolveOwner(account, owners),
    ...account,
    history: parseHistoryEntries(data[key]).map((entry) => ({
      timestamp: new Date(entry.timestamp).toISOString(),
      points: entry.points,
    })),
  }));

  return { format: "points-nest-export", version: EXPORT_VERSION, exportedAt, accounts, raw: data };
}

/**
 * Reads all storage and downloads it as points-nest-YYYY-MM-DD.json.
 */
function downloadExport() {
  store.get(null, (data) => {
    const now = new Date();
    const json = JSON.stringify(buildExport(data, now.toISOString()), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));

    const link = document.createElement("a");
    link.href = url;
    link.download = `points-nest-${now.toLocaleDateString("en-CA")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

/**
 * Checks that a parsed file is a Points Nest export this version can restore.
 * Returns { ok, error } or { ok, accounts, exportedAt }.
 */
function validateExport(file) {
  const fail = (error) => ({ ok: false, error });
  if (!file || typeof file !== "object" || file.format !== "points-nest-export") {
    return fail("That file is not a Points Nest export.");
  }
  if (typeof file.version !== "number" || file.version > EXPORT_VERSION) {
    return fail("That export comes from a newer version of the extension.");
  }
  const balances = file.raw && file.raw.latestBalances;
  if (!balances || typeof balances !== "object" || Array.isArray(balances)) {
    return fail("That export holds no stored data to restore.");
  }
  const accounts = Object.values(balances);
  const valid = (a) => a && a.provider && a.accountId !== undefined && typeof a.points === "number";
  if (!accounts.every(valid)) {
    return fail("That export holds an account record that is not complete.");
  }
  return { ok: true, accounts: accounts.length, exportedAt: file.exportedAt };
}

/**
 * Replaces everything in storage with the `raw` section of an export.
 */
function restoreExport(raw, callback) {
  store.clear(() => {
    store.set(raw, callback);
  });
}

// Export for Node.js / testing environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = { EXPORT_VERSION, buildExport, downloadExport, validateExport, restoreExport };
}
