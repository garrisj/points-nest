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
  return account.category === "Bank" ? UNASSIGNED : account.accountName;
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
 * Groups rows by owner, then by category (Bank, Airline, Hotel, then any
 * other). Owners sort by name with Unassigned last; rows sort by points.
 */
function groupByOwner(rows) {
  const byOwner = {};
  rows.forEach((row) => {
    (byOwner[row.owner] = byOwner[row.owner] || []).push(row);
  });

  return Object.keys(byOwner)
    .sort((a, b) => (a === UNASSIGNED) - (b === UNASSIGNED) || a.localeCompare(b))
    .map((owner) => {
      const ownerRows = byOwner[owner];
      const found = [...new Set(ownerRows.map((row) => row.category))];
      const ordered = CATEGORY_ORDER.filter((cat) => found.includes(cat)).concat(
        found.filter((cat) => !CATEGORY_ORDER.includes(cat)),
      );
      return {
        owner,
        rows: ownerRows,
        categories: ordered.map((category) => ({
          category,
          rows: ownerRows
            .filter((row) => row.category === category)
            .sort((a, b) => b.points - a.points),
        })),
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
    groupByOwner,
    listPeople,
    setOwner,
    removeAccounts,
  };
}
