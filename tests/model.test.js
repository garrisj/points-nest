// Model: account keys, capture handling, and display rows.
const assert = require("assert");
const { load } = require("./harness");
load(["storage.js", "model.js"]);

const capture = (over = {}) => ({
  provider: "Alaska Atmos", category: "Airline", programName: "Member", accountName: "Pat",
  accountId: "12345", points: 1000, lastUpdated: "2026-01-01T10:00:00.000Z", scrapedUrl: "https://a.example/1", ...over,
});
const at = (iso) => new Date(iso).getTime();
const state = { accounts: {}, holdings: {} };

// A first capture makes one account and one balance holding.
let r = applyCapture(state, capture(), at("2026-01-01T10:00:00Z"));
assert.deepStrictEqual(r, { accountKey: "alaska_atmos_12345", holdingId: "alaska_atmos_12345:balance", write: true, balanceChanged: true });
const account = () => state.accounts.alaska_atmos_12345;
const holding = () => state.holdings["alaska_atmos_12345:balance"];
assert.strictEqual(account().tier, "Member");
assert.strictEqual(account().currency, "Alaska Atmos");
assert.strictEqual(account().owner, null);
assert.strictEqual(account().kind, null);
assert.strictEqual(holding().type, "balance");
assert.strictEqual(holding().amount, 1000);
assert.strictEqual(holding().lastChange, null);
assert.ok(HOLDING_TYPES.includes(holding().type));

// Same balance inside the throttle window: nothing to write, nothing changed.
const before = JSON.stringify(state);
r = applyCapture(state, capture({ lastUpdated: "2026-01-01T10:00:30.000Z" }), at("2026-01-01T10:00:30Z"));
assert.strictEqual(r.write, false);
assert.strictEqual(JSON.stringify(state), before);

// Same balance after the window: the last-seen time moves, the change does not.
r = applyCapture(state, capture({ lastUpdated: "2026-01-01T10:05:00.000Z" }), at("2026-01-01T10:05:00Z"));
assert.deepStrictEqual([r.write, r.balanceChanged], [true, false]);
assert.strictEqual(holding().lastSeenAt, "2026-01-01T10:05:00.000Z");
assert.strictEqual(holding().lastChangedAt, "2026-01-01T10:00:00.000Z");

// A tier change keeps the same account, owner and history key.
account().owner = "Pat";
r = applyCapture(state, capture({ programName: "Gold", lastUpdated: "2026-01-01T10:05:10.000Z" }), at("2026-01-01T10:05:10Z"));
assert.deepStrictEqual([r.write, r.balanceChanged, r.accountKey], [true, false, "alaska_atmos_12345"]);
assert.strictEqual(Object.keys(state.accounts).length, 1);
assert.strictEqual(account().tier, "Gold");
assert.strictEqual(account().owner, "Pat");

// A name fix on an unchanged balance is saved at once.
r = applyCapture(state, capture({ programName: "Gold", accountName: "Patricia", lastUpdated: "2026-01-01T10:05:20.000Z" }), at("2026-01-01T10:05:20Z"));
assert.strictEqual(r.write, true);
assert.strictEqual(account().accountName, "Patricia");

// A changed balance records the difference and keeps owner and first-seen time.
r = applyCapture(state, capture({ programName: "Gold", accountName: "Patricia", points: 1500, lastUpdated: "2026-01-02T09:00:00.000Z", scrapedUrl: "https://a.example/2" }), at("2026-01-02T09:00:00Z"));
assert.deepStrictEqual([r.write, r.balanceChanged], [true, true]);
assert.strictEqual(holding().amount, 1500);
assert.strictEqual(holding().lastChange, 500);
assert.strictEqual(holding().firstSeenAt, "2026-01-01T10:00:00.000Z");
assert.strictEqual(account().scrapedUrl, "https://a.example/2");
assert.strictEqual(account().owner, "Pat");

// A bank card: the program name is the currency, and there is no tier.
applyCapture(state, capture({ provider: "Chase", category: "Bank", programName: "Ultimate Rewards", accountName: "Freedom", accountId: "8959", points: 40 }), 0);
assert.strictEqual(state.accounts.chase_8959.currency, "Ultimate Rewards");
assert.strictEqual(state.accounts.chase_8959.tier, null);

// Rows show the tier for an airline and the currency for a bank card.
const rows = toRows(state);
assert.strictEqual(rows.length, 2);
const air = rows.find((row) => row.accountKey === "alaska_atmos_12345");
assert.deepStrictEqual([air.programName, air.points, air.change, air.lastUpdated], ["Gold", 1500, 500, "2026-01-02T09:00:00.000Z"]);
assert.strictEqual(rows.find((row) => row.accountKey === "chase_8959").programName, "Ultimate Rewards");

// State saves and loads through the storage interface.
saveState(state, () => loadState((loaded) => {
  assert.deepStrictEqual(loaded, state);
  console.log("ok model");
}));
