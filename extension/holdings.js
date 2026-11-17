/**
 * holdings.js
 * Holdings beyond the balance: certificates, credits, funds and status.
 * A page lists them as rows (see `lists` in fields.js). Each row becomes one
 * holding. A holding its page stops listing is marked gone and kept for a
 * while, so a reader can tell "used or expired" from "never existed".
 * Relies on model.js.
 */

const LIST_TYPES = ["certificate", "credit", "funds", "status"];
const DEFAULT_UNITS = { certificate: "count", credit: "USD", funds: "USD", status: "count" };
// Gone holdings are kept for about 13 months, then dropped
const GONE_KEEP_MS = 396 * 24 * 60 * 60 * 1000;

/**
 * Stable ID for a listed holding: the page's own identifier when it has
 * one, else the label and expiry date.
 */
function getListHoldingId(accountKey, type, item) {
  const tail = item.id ? slug(item.id) : `${slug(item.label)}:${item.expiresOn || ""}`;
  return `${accountKey}:${type}:${tail}`;
}

/**
 * Applies the lists of one capture to the state, in place. `lists` maps a
 * holding type to the rows its page showed: { funds: [{ label, amount,
 * unit, total, expiresOn, id }] }. Only the types present are touched: a
 * listed type with no rows marks that type's holdings gone; a type left out
 * is left alone. Returns true when anything changed.
 */
function applyLists(state, accountKey, lists, seenAt) {
  let changed = false;

  Object.entries(lists || {}).forEach(([type, items]) => {
    if (!LIST_TYPES.includes(type)) return;
    const seen = new Set();

    items.forEach((item) => {
      // Rows that cannot be told apart get a counter: id, id:2, id:3
      const baseId = getListHoldingId(accountKey, type, item);
      let holdingId = baseId;
      for (let n = 2; seen.has(holdingId); n++) holdingId = `${baseId}:${n}`;
      seen.add(holdingId);

      const old = state.holdings[holdingId];
      const next = {
        label: item.label,
        amount: item.amount,
        unit: item.unit || DEFAULT_UNITS[type],
        total: item.total == null ? null : item.total,
        // Left out by the capture means not shown this time: keep the stored date
        expiresOn: item.expiresOn === undefined ? (old ? old.expiresOn : null) : item.expiresOn,
      };
      const same = old && old.state === "active" && Object.keys(next).every((key) => old[key] === next[key]);
      if (same) {
        old.lastSeenAt = seenAt;
        return;
      }

      changed = true;
      const amountChanged = old && old.amount !== next.amount;
      state.holdings[holdingId] = {
        expiringAmount: null,
        period: null,
        firstSeenAt: seenAt,
        lastChange: null,
        ...old,
        ...next,
        holdingId,
        accountKey,
        type,
        source: "captured",
        state: "active",
        goneAt: null,
        // Rounded, since money amounts are not whole numbers
        ...(amountChanged && { lastChange: Math.round((next.amount - old.amount) * 100) / 100 }),
        lastChangedAt: seenAt,
        lastSeenAt: seenAt,
      };
    });

    Object.values(state.holdings).forEach((holding) => {
      const listed = holding.accountKey === accountKey && holding.type === type && holding.source === "captured";
      if (listed && holding.state === "active" && !seen.has(holding.holdingId)) {
        holding.state = "gone";
        holding.goneAt = seenAt;
        changed = true;
      }
    });
  });

  return changed;
}

/**
 * Drops holdings that have been gone longer than GONE_KEEP_MS.
 */
function pruneGone(state, now) {
  Object.values(state.holdings).forEach((holding) => {
    if (holding.state === "gone" && now - new Date(holding.goneAt).getTime() > GONE_KEEP_MS) {
      delete state.holdings[holding.holdingId];
    }
  });
}

/**
 * The active holdings of an account other than its balance, for display.
 */
function getExtras(state, accountKey) {
  return Object.values(state.holdings).filter(
    (holding) => holding.accountKey === accountKey && holding.type !== "balance" && holding.state === "active",
  );
}

// Export for Node.js / testing environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = { LIST_TYPES, GONE_KEEP_MS, getListHoldingId, applyLists, pruneGone, getExtras };
}
