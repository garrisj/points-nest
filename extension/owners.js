/**
 * owners.js
 * Household layer for Points Nest: who owns each account, pooling of cards
 * that share one balance, and removal of dead entries. Kept apart from the
 * capture engine. Relies on `store` and `getAccountKey` from storage.js.
 */

const OWNERS_KEY = "owners";
const UNASSIGNED = "Unassigned";
const CATEGORY_ORDER = ["Bank", "Airline", "Hotel"];

/**
 * Owner key: provider + account ID. It leaves out the program name so a
 * status tier change keeps the owner.
 */
function getOwnerRef(account) {
  return `${account.provider}_${account.accountId}`.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/**
 * Returns the stored owner. Airline and hotel accounts fall back to the
 * member name on the account; bank cards stay unassigned until set.
 */
function resolveOwner(account, owners) {
  const stored = owners[getOwnerRef(account)];
  if (stored) return stored;
  if (account.category === "Bank") return UNASSIGNED;
  // Title-case the fallback so "JANE" and "Jane" are one person
  return account.accountName.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Turns stored accounts into display rows. Cards of a pooled program
 * (config flag `pooled`) with the same owner merge into one row, and the
 * newest capture supplies the balance. Each row lists its `members`.
 */
function poolAccounts(accounts, owners, configs) {
  const pooledProviders = new Set(configs.filter((c) => c.pooled).map((c) => c.siteName));
  const rows = [];
  const pools = {};

  accounts.forEach((account) => {
    const owner = resolveOwner(account, owners);
    const row = { ...account, owner, members: [account] };
    if (!pooledProviders.has(account.provider) || owner === UNASSIGNED) {
      rows.push(row);
      return;
    }
    const poolKey = `${account.provider}|${account.programName}|${owner}`;
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
  return row.category === "Bank" ? `${row.provider}|${row.programName}` : row.provider;
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
      title: first.category === "Bank" ? `${first.provider} — ${first.programName}` : first.provider,
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
  store.get([OWNERS_KEY], (result) => {
    const owners = result[OWNERS_KEY] || {};
    accounts.forEach((account) => {
      if (name) {
        owners[getOwnerRef(account)] = name;
      } else {
        delete owners[getOwnerRef(account)];
      }
    });
    store.set({ [OWNERS_KEY]: owners }, callback);
  });
}

/**
 * Deletes the given accounts with their history and owner. A live account
 * returns on its next capture.
 */
function removeAccounts(accounts, callback) {
  store.get(["latestBalances", OWNERS_KEY], (result) => {
    const latestBalances = result.latestBalances || {};
    const owners = result[OWNERS_KEY] || {};
    const keys = accounts.map(getAccountKey);
    keys.forEach((key) => delete latestBalances[key]);
    accounts.forEach((account) => delete owners[getOwnerRef(account)]);
    store.set({ latestBalances, [OWNERS_KEY]: owners }, () => {
      store.remove(keys, callback);
    });
  });
}

// Export for Node.js / testing environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    OWNERS_KEY,
    UNASSIGNED,
    getOwnerRef,
    resolveOwner,
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
