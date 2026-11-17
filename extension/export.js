/**
 * export.js
 * Backup of all tracked data as one JSON file, and restore from it.
 * The file is the contract with any outside reader. Relies on storage.js,
 * model.js and owners.js.
 */

const EXPORT_VERSION = 2;

/**
 * Builds the export from a full storage snapshot and the site configs.
 *
 * - `accounts`: one record per account, with its resolved `owner` (null when
 *   unassigned) and its `balanceGroup`.
 * - `holdings`: one record per holding, linked by `accountKey`.
 * - `events`: every recorded balance change, linked by `holdingId`.
 * - `raw`: storage as-is, the only part a restore reads.
 *
 * `balanceGroup` is the pool ID from owners.js, worked out from the current
 * owners: accounts that share it share one balance, so a reader must count
 * that balance once. It is null for an account that is not pooled.
 */
function buildExport(data, exportedAt, configs, valuations) {
  const pooledProviders = getPooledProviders(configs);
  const accounts = Object.values(data.accounts || {}).map((account) => {
    const owner = resolveOwner(account);
    return {
      ...account,
      owner: owner === UNASSIGNED ? null : owner,
      balanceGroup: getPoolId(account, owner, pooledProviders),
    };
  });
  const holdings = Object.values(data.holdings || {});
  const events = holdings.flatMap((holding) =>
    parseHistoryEntries(data[getEventsKey(holding.holdingId)]).map((entry) => ({
      holdingId: holding.holdingId,
      at: new Date(entry.timestamp).toISOString(),
      kind: "changed",
      amount: entry.points,
    })),
  );

  return {
    format: "points-nest-export",
    version: EXPORT_VERSION,
    exportedAt,
    accounts,
    holdings,
    events,
    // The value of a point in cents, per program, as in force at export
    ...(valuations && { valuations }),
    raw: data,
  };
}

/**
 * Reads all storage and downloads it as points-nest-YYYY-MM-DD.json.
 */
async function downloadExport(configs) {
  const valuations = await loadValuations();
  store.get(null, (data) => {
    const now = new Date();
    const json = JSON.stringify(buildExport(data, now.toISOString(), configs, valuations), null, 2);
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
  if (file.version < EXPORT_VERSION) {
    return fail(`That export uses the old version ${file.version} format, which this version cannot restore.`);
  }
  const isMap = (value) => value && typeof value === "object" && !Array.isArray(value);
  const raw = file.raw;
  if (!isMap(raw) || raw.schemaVersion !== SCHEMA_VERSION || !isMap(raw.accounts) || !isMap(raw.holdings)) {
    return fail("That export holds no stored data to restore.");
  }
  const accounts = Object.values(raw.accounts);
  if (!accounts.every((a) => a && a.accountKey && a.provider && a.accountId !== undefined)) {
    return fail("That export holds an account record that is not complete.");
  }
  const holdings = Object.values(raw.holdings);
  if (!holdings.every((h) => h && raw.accounts[h.accountKey] && typeof h.amount === "number")) {
    return fail("That export holds a holding record that is not complete.");
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
