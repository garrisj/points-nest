/**
 * valuations.js
 * What a point is worth, in cents, per program. Built-in values come from
 * constants.json; the user's own values are stored under "valuations" and
 * win over them. A program with neither counts at FALLBACK_CPP.
 * Relies on `store` from storage.js.
 */

const VALUATIONS_KEY = "valuations";
const FALLBACK_CPP = 1.0;

let builtInValues = null;

/**
 * The program a value belongs to. A bank's points are named by provider
 * and currency ("Chase Ultimate Rewards"); an airline's or hotel's by the
 * provider alone, since its program name is the status tier.
 */
function getValueKey(account) {
  return account.category === "Bank" ? `${account.provider} ${account.currency}` : account.provider;
}

/**
 * Loads both sets: { builtIn, custom }. The built-in file is read once.
 */
async function loadValuationSets() {
  if (!builtInValues) {
    try {
      const response = await fetch(chrome.runtime.getURL("constants.json"));
      builtInValues = await response.json();
    } catch (error) {
      console.error("[Points Nest] Failed to load constants.json:", error);
      builtInValues = {};
    }
  }
  const stored = await new Promise((resolve) => store.get(VALUATIONS_KEY, resolve));
  return { builtIn: builtInValues, custom: stored[VALUATIONS_KEY] || {} };
}

/**
 * The values in force: the user's where set, else the built-in ones.
 */
async function loadValuations() {
  const { builtIn, custom } = await loadValuationSets();
  return { ...builtIn, ...custom };
}

function getValuationCpp(account, valuations) {
  const cpp = valuations[getValueKey(account)];
  return cpp === undefined ? FALLBACK_CPP : cpp;
}

/**
 * Sets the user's value for a program, or clears it when `cpp` is null so
 * the built-in value applies again.
 */
function setValuation(key, cpp, callback) {
  store.get(VALUATIONS_KEY, (stored) => {
    const custom = { ...(stored[VALUATIONS_KEY] || {}) };
    if (cpp == null) delete custom[key];
    else custom[key] = cpp;
    store.set({ [VALUATIONS_KEY]: custom }, callback);
  });
}

// Export for Node.js / testing environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = { VALUATIONS_KEY, FALLBACK_CPP, getValueKey, getValuationCpp, setValuation };
}
