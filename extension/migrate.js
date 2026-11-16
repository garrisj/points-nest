/**
 * migrate.js
 * One-time move from the version 1 storage shape (`latestBalances`, `owners`
 * and one history list per old account key) to the accounts and holdings
 * model in model.js. Delete this file once every install has run it.
 * Relies on storage.js and model.js.
 */

/**
 * Works out the migration for a full storage snapshot. Pure.
 * Returns null when there is nothing to do, else { set, remove }: the keys
 * to write and the old keys to delete.
 */
function migrateV1(data) {
  const oldBalances = data.latestBalances;
  if (!oldBalances || typeof oldBalances !== "object") return null;

  const oldKeys = ["latestBalances", "owners", ...Object.keys(oldBalances)];
  // Already on version 2: only clear old keys left behind by an interrupted run
  if (data.schemaVersion === SCHEMA_VERSION) return { set: {}, remove: oldKeys };

  const owners = data.owners || {};
  const accounts = {};
  const holdings = {};
  const histories = {};

  // Oldest first, so the newest entry of an account wins its fields
  const entries = Object.entries(oldBalances).sort(
    ([, a], [, b]) => new Date(a.lastUpdated) - new Date(b.lastUpdated),
  );

  entries.forEach(([oldKey, old]) => {
    const accountKey = getAccountKey(old);
    const holdingId = getBalanceHoldingId(accountKey);
    const { currency, tier } = splitProgramName(old.category, old.provider, old.programName);

    // Two old entries share a key when a tier change split one account
    histories[holdingId] = (histories[holdingId] || []).concat(parseHistoryEntries(data[oldKey]));

    accounts[accountKey] = {
      accountKey,
      provider: old.provider,
      category: old.category,
      accountId: old.accountId,
      accountName: old.accountName,
      currency,
      tier,
      kind: null,
      owner: owners[accountKey] || null,
      scrapedUrl: old.scrapedUrl,
      lastSeenAt: old.lastUpdated,
    };
    holdings[holdingId] = {
      holdingId,
      accountKey,
      type: "balance",
      label: currency,
      amount: old.points,
      unit: "points",
      total: null,
      expiresOn: null,
      expiringAmount: null,
      period: null,
      source: "captured",
      state: "active",
      lastChange: old.change === undefined ? null : old.change,
      firstSeenAt: old.lastChanged || old.lastUpdated,
      lastChangedAt: old.lastChanged || old.lastUpdated,
      lastSeenAt: old.lastUpdated,
    };
  });

  const set = { schemaVersion: SCHEMA_VERSION, accounts, holdings };
  Object.entries(histories).forEach(([holdingId, points]) => {
    // Join by date and drop repeats of the same balance
    const joined = points
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((point, i, all) => i === 0 || point.points !== all[i - 1].points)
      .slice(-MAX_HISTORY_ENTRIES);
    if (joined.length === 0) return;
    holdings[holdingId].firstSeenAt = new Date(joined[0].timestamp).toISOString();
    set[getEventsKey(holdingId)] = joined.map((p) => encodeHistoryEntry(p.timestamp, p.points));
  });

  return { set, remove: oldKeys };
}

/**
 * Runs the migration if storage still holds version 1 data, then calls back.
 * Safe to call from the background worker and the popup at once: both work
 * out the same result from the same data.
 */
function ensureMigrated(callback) {
  store.get(null, (data) => {
    const plan = migrateV1(data);
    if (!plan) return callback();
    store.set(plan.set, () => {
      store.remove(plan.remove, () => {
        console.log(`[Points Nest] Migrated storage to version ${SCHEMA_VERSION}.`);
        callback();
      });
    });
  });
}

// Export for Node.js / testing environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = { migrateV1, ensureMigrated };
}
