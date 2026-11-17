/**
 * owners.js
 * Household layer for Points Nest: who owns each account, pooling of cards
 * that share one balance, and removal of dead entries. Kept apart from the
 * capture engine. Works on the display rows from model.js `toRows`, and
 * stores each owner on its account. Relies on storage.js and model.js.
 */

const UNASSIGNED = "Unassigned";
const CATEGORY_ORDER = ["Bank", "Airline", "Hotel"];

/**
 * Returns the owner set on the account. Airline and hotel accounts fall back
 * to the member name on the account; bank cards stay unassigned until set.
 */
function resolveOwner(account) {
  if (account.owner) return account.owner;
  if (account.category === "Bank") return UNASSIGNED;
  // Title-case the fallback so "JANE" and "Jane" are one person
  return account.accountName.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Names of the providers whose cards share one balance per owner (config
 * flag `pooled`).
 */
function getPooledProviders(configs) {
  return new Set(configs.filter((c) => c.pooled).map((c) => c.siteName));
}

/**
 * The one pooling rule, used by the popup and by export. Returns the pool
 * ID for an account of a pooled program with an assigned owner: provider +
 * currency + owner. Returns null for any other account.
 */
function getPoolId(account, owner, pooledProviders) {
  if (!pooledProviders.has(account.provider) || owner === UNASSIGNED) return null;
  return slug(`${account.provider}_${account.currency}_${owner}`);
}

/**
 * Resolves each row's owner and merges rows with the same pool ID into one,
 * where the newest capture supplies the balance. Each row lists its
 * `members`.
 */
function poolAccounts(accounts, configs) {
  const pooledProviders = getPooledProviders(configs);
  const rows = [];
  const pools = {};

  accounts.forEach((account) => {
    const owner = resolveOwner(account);
    const row = { ...account, owner, members: [account] };
    const poolKey = getPoolId(account, owner, pooledProviders);
    if (!poolKey) {
      rows.push(row);
      return;
    }
    const pool = pools[poolKey];
    if (!pool) {
      pools[poolKey] = row;
      rows.push(row);
      return;
    }
    pool.members.push(account);
    if (new Date(account.lastUpdated) > new Date(pool.lastUpdated)) {
      Object.assign(pool, account);
    }
  });

  return rows;
}

/**
 * Groups rows by category (Bank, Airline, Hotel, then any other), with the
 * rows of each category sorted by points.
 */
function groupByCategory(rows) {
  const found = [...new Set(rows.map((row) => row.category))];
  const ordered = CATEGORY_ORDER.filter((cat) => found.includes(cat)).concat(
    found.filter((cat) => !CATEGORY_ORDER.includes(cat)),
  );
  return ordered.map((category) => ({
    category,
    rows: rows.filter((row) => row.category === category).sort((a, b) => b.points - a.points),
  }));
}

/**
 * Groups rows by owner, then by category. Owners sort by name with
 * Unassigned last.
 */
function groupByOwner(rows) {
  const byOwner = {};
  rows.forEach((row) => {
    (byOwner[row.owner] = byOwner[row.owner] || []).push(row);
  });

  return Object.keys(byOwner)
    .sort((a, b) => (a === UNASSIGNED) - (b === UNASSIGNED) || a.localeCompare(b))
    .map((owner) => ({
      owner,
      rows: byOwner[owner],
      categories: groupByCategory(byOwner[owner]),
    }));
}

/**
 * Program identity across people. A bank program is its provider and
 * currency. An airline or hotel program is its provider alone, since the
 * program name there is each member's status tier.
 */
function getProgramKey(row) {
  return row.category === "Bank" ? `${row.provider}|${row.currency}` : row.provider;
}

/**
 * Combines rows of the same program into one household row. A program held
 * by one row passes through unchanged. A combined row sums the points, lists
 * each owner's share in `parts`, and takes the oldest update time, since a
 * total is only as fresh as its stalest part.
 */
function combineByProgram(rows) {
  const byProgram = {};
  rows.forEach((row) => {
    const key = getProgramKey(row);
    (byProgram[key] = byProgram[key] || []).push(row);
  });

  return Object.values(byProgram).map((group) => {
    if (group.length === 1) return group[0];

    const shares = {};
    group.forEach((row) => {
      shares[row.owner] = (shares[row.owner] || 0) + row.points;
    });
    const oldest = group.reduce((a, b) =>
      new Date(a.lastUpdated) <= new Date(b.lastUpdated) ? a : b,
    );
    const first = group[0];
    return {
      ...first,
      combined: true,
      title: first.category === "Bank" ? `${first.provider} ${first.currency}` : first.provider,
      parts: Object.entries(shares)
        .map(([owner, points]) => ({ owner, points }))
        .sort((a, b) => b.points - a.points),
      points: group.reduce((sum, row) => sum + row.points, 0),
      lastUpdated: oldest.lastUpdated,
      lastChanged: null,
      change: 0,
      members: group.flatMap((row) => row.members),
    };
  });
}

/**
 * Lists every person who owns at least one row.
 */
function listPeople(rows) {
  return [...new Set(rows.map((row) => row.owner))].filter((o) => o !== UNASSIGNED).sort();
}

/**
 * Sets the owner of the given accounts. An empty name clears it.
 */
function setOwner(accounts, name, callback) {
  loadState((state) => {
    accounts.forEach((account) => {
      if (state.accounts[account.accountKey]) {
        state.accounts[account.accountKey].owner = name || null;
      }
    });
    saveState(state, callback);
  });
}

/**
 * Deletes the given accounts with their holdings and history. A live
 * account returns on its next capture.
 */
function removeAccounts(accounts, callback) {
  loadState((state) => {
    const accountKeys = new Set(accounts.map((account) => account.accountKey));
    const holdingIds = Object.values(state.holdings)
      .filter((holding) => accountKeys.has(holding.accountKey))
      .map((holding) => holding.holdingId);
    accountKeys.forEach((key) => delete state.accounts[key]);
    holdingIds.forEach((id) => delete state.holdings[id]);
    saveState(state, () => {
      store.remove(holdingIds.map(getEventsKey), callback);
    });
  });
}

// Export for Node.js / testing environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    UNASSIGNED,
    resolveOwner,
    getPooledProviders,
    getPoolId,
    poolAccounts,
    groupByCategory,
    groupByOwner,
    getProgramKey,
    combineByProgram,
    listPeople,
    setOwner,
    removeAccounts,
  };
}
