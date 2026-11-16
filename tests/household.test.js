// Owners, pooling, removal, and the version 2 export round trip.
const assert = require("assert");
const { load } = require("./harness");
const storage = load(["storage.js", "model.js", "holdings.js", "owners.js", "export.js"]);

const configs = [{ siteName: "Amex", pooled: true }, { siteName: "Chase" }, { siteName: "Hyatt" }];
const state = { accounts: {}, holdings: {} };
const add = (provider, category, programName, accountName, accountId, points, when) =>
  applyCapture(state, { provider, category, programName, accountName, accountId, points, lastUpdated: when, scrapedUrl: "u" }, 0);
add("Amex", "Bank", "Membership Rewards", "Gold", "1001", 900, "2026-01-01T00:00:00.000Z");
add("Amex", "Bank", "Membership Rewards", "Platinum", "1002", 950, "2026-01-02T00:00:00.000Z");
add("Amex", "Bank", "Membership Rewards", "Green", "1003", 300, "2026-01-03T00:00:00.000Z");
add("Chase", "Bank", "Ultimate Rewards", "Freedom", "8959", 40, "2026-01-01T00:00:00.000Z");
add("Hyatt", "Hotel", "Explorist", "JANE DOE", "H1", 70, "2026-01-01T00:00:00.000Z");
add("Hyatt", "Hotel", "Member", "Sam Doe", "H2", 30, "2026-01-01T00:00:00.000Z");

const rowsOf = (s) => poolAccounts(toRows(s), configs);
const find = (rows, key) => rows.find((row) => row.members.some((m) => m.accountKey === key));

// Unassigned bank cards stand alone; hotel accounts take the member name.
let rows = rowsOf(state);
assert.strictEqual(rows.length, 6);
assert.strictEqual(find(rows, "amex_1001").owner, UNASSIGNED);
assert.strictEqual(find(rows, "hyatt_h1").owner, "Jane Doe");

saveState(state, () => {
  const amex = (id) => ({ accountKey: `amex_${id}` });
  setOwner([amex(1001), amex(1002)], "Jane Doe", () => setOwner([amex(1003)], "Sam Doe", () => loadState((owned) => {
    // Same owner pools into one row with the newest balance; another owner stays apart.
    rows = rowsOf(owned);
    assert.strictEqual(rows.length, 5);
    const pool = find(rows, "amex_1001");
    assert.deepStrictEqual([pool.points, pool.members.length, pool.owner], [950, 2, "Jane Doe"]);
    assert.strictEqual(find(rows, "amex_1003").points, 300);
    assert.deepStrictEqual(listPeople(rows), ["Jane Doe", "Sam Doe"]);

    // Program view: Hyatt combines across tiers; Amex sums the two pools.
    const programs = combineByProgram(rows);
    assert.strictEqual(programs.length, 3);
    assert.strictEqual(programs.find((p) => p.provider === "Hyatt").points, 100);
    assert.strictEqual(programs.find((p) => p.provider === "Amex").points, 1250);

    // Export: resolved owners, null when unassigned, pool members share a group.
    const file = buildExport(storage.data, "2026-01-04T00:00:00.000Z", configs);
    const acct = (key) => file.accounts.find((a) => a.accountKey === key);
    assert.deepStrictEqual([file.format, file.version], ["points-nest-export", 2]);
    assert.strictEqual(acct("amex_1001").balanceGroup, "amex_membership_rewards_jane_doe");
    assert.strictEqual(acct("amex_1002").balanceGroup, acct("amex_1001").balanceGroup);
    assert.notStrictEqual(acct("amex_1003").balanceGroup, acct("amex_1001").balanceGroup);
    assert.deepStrictEqual([acct("chase_8959").owner, acct("chase_8959").balanceGroup], [null, null]);
    assert.deepStrictEqual([acct("hyatt_h1").owner, acct("hyatt_h1").tier, acct("hyatt_h1").balanceGroup], ["Jane Doe", "Explorist", null]);
    assert.strictEqual(file.holdings.length, 6);
    assert.ok(file.holdings.every((h) => acct(h.accountKey) && h.type === "balance"));

    // Validation: version 2 passes; older or broken files fail with a reason.
    assert.deepStrictEqual(validateExport(file), { ok: true, accounts: 6, exportedAt: file.exportedAt });
    assert.match(validateExport({ ...file, version: 1 }).error, /old version 1 format/);
    assert.strictEqual(validateExport({ ...file, raw: {} }).ok, false);
    assert.strictEqual(validateExport({ hello: 1 }).ok, false);

    // Removal takes the account, its holding and its history; restore brings them back.
    storage.data["events:hyatt_h2:balance"] = [{ t: "1", p: "1" }];
    const backup = JSON.parse(JSON.stringify(buildExport(storage.data, "x", configs)));
    removeAccounts([{ accountKey: "hyatt_h2", holdingId: "hyatt_h2:balance" }], () => {
      assert.ok(!storage.data.accounts.hyatt_h2 && !storage.data.holdings["hyatt_h2:balance"]);
      assert.ok(!("events:hyatt_h2:balance" in storage.data));
      restoreExport(backup.raw, () => {
        assert.deepStrictEqual(storage.data, backup.raw);
        console.log("ok household");
      });
    });
  })));
});
