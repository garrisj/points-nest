// Migration: version 1 storage becomes accounts, holdings and events.
// Pass a version 1 export file as the first argument to check real data.
const assert = require("assert");
const fs = require("fs");
const { load } = require("./harness");

const entry = (over) => ({
  provider: "Delta SkyMiles", category: "Airline", programName: "Silver", accountName: "PAT",
  accountId: "77", points: 500, change: 100, lastChanged: "2026-02-01T00:00:00.000Z",
  lastUpdated: "2026-03-01T00:00:00.000Z", scrapedUrl: "https://d.example", ...over,
});
const hist = (iso, points) => ({ t: Math.floor(new Date(iso) / 1000).toString(36), p: points.toString(36) });
const v1 = {
  latestBalances: {
    // One Delta account split in two by a tier change
    delta_skymiles_member_77: entry({ programName: "Member", points: 400, change: null, lastChanged: "2026-01-01T00:00:00.000Z", lastUpdated: "2026-01-15T00:00:00.000Z" }),
    delta_skymiles_silver_77: entry(),
    chase_ultimate_rewards_8959: entry({ provider: "Chase", category: "Bank", programName: "Ultimate Rewards", accountName: "Freedom", accountId: "8959", points: 40, change: undefined }),
  },
  owners: { chase_8959: "Pat" },
  delta_skymiles_member_77: [hist("2026-01-01T00:00:00Z", 400)],
  delta_skymiles_silver_77: [hist("2026-01-20T00:00:00Z", 400), hist("2026-02-01T00:00:00Z", 500)],
  chase_ultimate_rewards_8959: [hist("2026-01-05T00:00:00Z", 40)],
};

const storage = load(["storage.js", "model.js", "migrate.js"], v1);
assert.strictEqual(migrateV1({}), null, "fresh install: nothing to do");

const plan = migrateV1(v1);
const { accounts, holdings } = plan.set;
assert.deepStrictEqual(Object.keys(accounts).sort(), ["chase_8959", "delta_skymiles_77"]);

// The split account merges: newest tier and balance, one joined history.
const delta = accounts.delta_skymiles_77;
assert.deepStrictEqual([delta.tier, delta.currency, delta.owner], ["Silver", "Delta SkyMiles", null]);
const balance = holdings["delta_skymiles_77:balance"];
assert.deepStrictEqual([balance.amount, balance.lastChange, balance.lastSeenAt], [500, 100, "2026-03-01T00:00:00.000Z"]);
assert.strictEqual(balance.firstSeenAt, "2026-01-01T00:00:00.000Z");
assert.deepStrictEqual(parseHistoryEntries(plan.set["events:delta_skymiles_77:balance"]).map((p) => p.points), [400, 500]);

// The bank card keeps its owner and has a currency, no tier.
assert.deepStrictEqual([accounts.chase_8959.owner, accounts.chase_8959.currency, accounts.chase_8959.tier], ["Pat", "Ultimate Rewards", null]);
assert.strictEqual(holdings["chase_8959:balance"].lastChange, null);
assert.deepStrictEqual(plan.remove.sort(), ["chase_ultimate_rewards_8959", "delta_skymiles_member_77", "delta_skymiles_silver_77", "latestBalances", "owners"]);

// Through storage: old keys go, and a second run does nothing.
ensureMigrated(() => {
  assert.deepStrictEqual(Object.keys(storage.data).sort(), ["accounts", "events:chase_8959:balance", "events:delta_skymiles_77:balance", "holdings", "schemaVersion"]);
  assert.strictEqual(migrateV1(storage.data), null);
  // An interrupted run left old keys behind: only clean up, never rebuild.
  const half = migrateV1({ ...plan.set, latestBalances: v1.latestBalances });
  assert.deepStrictEqual(half.set, {});
  console.log("ok migrate");
});

// Optional check against a real version 1 export: totals must survive.
if (process.argv[2]) {
  const raw = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).raw;
  const real = migrateV1(raw);
  const old = Object.values(raw.latestBalances);
  const ids = new Set(old.map((a) => getAccountKey(a)));
  const newHoldings = Object.values(real.set.holdings);
  assert.strictEqual(newHoldings.length, ids.size);
  if (ids.size === old.length) {
    const sum = (list, field) => list.reduce((total, item) => total + item[field], 0);
    assert.strictEqual(sum(newHoldings, "amount"), sum(old, "points"));
  }
  const owned = Object.values(real.set.accounts).filter((a) => a.owner).length;
  assert.strictEqual(owned, Object.keys(raw.owners || {}).filter((ref) => ids.has(ref)).length);
  const events = Object.keys(real.set).filter((key) => key.startsWith("events:")).length;
  console.log(`ok real data: ${old.length} old entries -> ${ids.size} accounts, ${owned} with owners, ${events} histories`);
}
