/**
 * model.js
 * The data model: accounts and holdings.
 *
 * An account is a membership or card. A holding is one thing of value inside
 * an account. Every account has one balance holding, and later holding types
 * (certificate, credit, funds, status) sit beside it.
 *
 * Stored keys: `schemaVersion`, `accounts` (by account key), `holdings` (by
 * holding ID), and one `events:<holdingId>` history list per holding.
 * Relies on `store` from storage.js.
 */

const SCHEMA_VERSION = 2;
const HOLDING_TYPES = ["balance", "certificate", "credit", "funds", "status"];
const WRITE_THROTTLE_MS = 60000;
// Extra values a site config may declare for a balance (see fields.js)
const BALANCE_FIELDS = ["expiresOn", "expiringAmount"];

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_");
}

/**
 * Account identity: provider + account ID. It leaves out the status tier, so
 * a tier change keeps the account, its owner and its history.
 */
function getAccountKey(account) {
  return slug(`${account.provider}_${account.accountId}`);
}

function getBalanceHoldingId(accountKey) {
  return `${accountKey}:balance`;
}

function getEventsKey(holdingId) {
  return `events:${holdingId}`;
}

/**
 * The scraped program name means two things. For a bank card it is the
 * points currency. For an airline or hotel it is the member's status tier,
 * and the currency is the program itself.
 */
function splitProgramName(category, provider, programName) {
  return category === "Bank"
    ? { currency: programName, tier: null }
    : { currency: provider, tier: programName };
}

/**
 * Picks the balance fields a capture declared ("balance.expiresOn" and so
 * on). A field the capture did not declare is left out, and so left alone.
 */
function getBalanceFields(capture) {
  const fields = {};
  BALANCE_FIELDS.forEach((name) => {
    const value = (capture.fields || {})[`balance.${name}`];
    if (value !== undefined) fields[name] = value;
  });
  return fields;
}

/**
 * Applies one capture from content.js to the state, in place.
 *
 * A changed balance rewrites the account and its balance holding. An
 * unchanged balance refreshes the name, tier and last-seen time, at most
 * once per WRITE_THROTTLE_MS unless the name, tier or a declared field differs.
 *
 * Returns { accountKey, holdingId, write, balanceChanged }. `write` tells the
 * caller whether the state changed and needs saving.
 */
function applyCapture(state, capture, now) {
  const accountKey = getAccountKey(capture);
  const holdingId = getBalanceHoldingId(accountKey);
  const { currency, tier } = splitProgramName(capture.category, capture.provider, capture.programName);
  const account = state.accounts[accountKey];
  const holding = state.holdings[holdingId];
  const seenAt = capture.lastUpdated;

  const fields = getBalanceFields(capture);

  const isNew = !account || !holding;
  const balanceChanged = isNew || holding.amount !== capture.points;
  const result = { accountKey, holdingId, write: true, balanceChanged };

  if (!balanceChanged) {
    const detailsChanged =
      account.accountName !== capture.accountName ||
      account.tier !== tier ||
      account.currency !== currency ||
      Object.keys(fields).some((name) => holding[name] !== fields[name]);
    const elapsed = now - new Date(holding.lastSeenAt).getTime();
    if (!detailsChanged && elapsed <= WRITE_THROTTLE_MS) {
      result.write = false;
      return result;
    }
  }

  state.accounts[accountKey] = {
    owner: null,
    kind: null,
    scrapedUrl: capture.scrapedUrl,
    ...account,
    accountKey,
    provider: capture.provider,
    category: capture.category,
    accountId: capture.accountId,
    accountName: capture.accountName,
    currency,
    tier,
    lastSeenAt: seenAt,
  };

  if (balanceChanged) {
    state.accounts[accountKey].scrapedUrl = capture.scrapedUrl;
    state.holdings[holdingId] = {
      total: null,
      expiresOn: null,
      expiringAmount: null,
      period: null,
      source: "captured",
      state: "active",
      firstSeenAt: seenAt,
      ...holding,
      holdingId,
      accountKey,
      type: "balance",
      label: currency,
      amount: capture.points,
      unit: "points",
      lastChange: holding ? capture.points - holding.amount : null,
      lastChangedAt: seenAt,
      lastSeenAt: seenAt,
      ...fields,
    };
  } else {
    Object.assign(holding, fields, { label: currency, lastSeenAt: seenAt });
  }

  return result;
}

/**
 * Flattens the state into one display row per account, built from the
 * account and its balance holding. `programName` is the line shown beside
 * the provider: the currency for a bank card, the tier for the rest.
 */
function toRows(state) {
  return Object.values(state.accounts)
    .map((account) => {
      const holding = state.holdings[getBalanceHoldingId(account.accountKey)];
      if (!holding) return null;
      return {
        ...account,
        holdingId: holding.holdingId,
        programName: account.tier == null ? account.currency : account.tier,
        points: holding.amount,
        lastUpdated: holding.lastSeenAt,
        lastChanged: holding.lastChangedAt,
        change: holding.lastChange,
        expiresOn: holding.expiresOn,
        expiringAmount: holding.expiringAmount,
      };
    })
    .filter(Boolean);
}

/**
 * Reads the accounts and holdings from storage.
 */
function loadState(callback) {
  store.get(["accounts", "holdings"], (result) => {
    callback({ accounts: result.accounts || {}, holdings: result.holdings || {} });
  });
}

/**
 * Writes the accounts and holdings to storage.
 */
function saveState(state, callback) {
  store.set(
    { schemaVersion: SCHEMA_VERSION, accounts: state.accounts, holdings: state.holdings },
    callback,
  );
}

// Export for Node.js / testing environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SCHEMA_VERSION,
    HOLDING_TYPES,
    WRITE_THROTTLE_MS,
    slug,
    getAccountKey,
    getBalanceHoldingId,
    getEventsKey,
    splitProgramName,
    applyCapture,
    toRows,
    loadState,
    saveState,
  };
}
