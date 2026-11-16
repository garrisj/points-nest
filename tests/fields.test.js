// Field parsers, and declared fields flowing onto the balance holding.
const assert = require("assert");
const { load } = require("./harness");
load(["storage.js", "model.js", "fields.js"]);

const parse = (text, parseAs, pattern) => parseField(text, { parse: parseAs, pattern });

// Dates come out as YYYY-MM-DD; anything else is refused.
["2027-05-01", "5/1/2027", "05/01/2027", "May 1, 2027", "May 1st 2027", "1 May 2027", "MAY 1, 2027"]
  .forEach((text) => assert.strictEqual(parse(text, "date"), "2027-05-01", text));
["2/30/2027", "13/1/2027", "soon", "5/1/27", "Mayhem 1, 2027", ""].forEach((text) => assert.strictEqual(parse(text, "date"), null, text));
assert.strictEqual(parse("Sept. 3, 2027", "date"), "2027-09-03");

assert.strictEqual(parse("12,500", "number"), 12500);
assert.strictEqual(parse("12,500 points", "number"), null);
assert.strictEqual(parse("$239.40", "money"), 239.4);
assert.strictEqual(parse("239.40 Dollars", "money"), null);

// A pattern keeps its first group; no match means no value.
const message = "5,000  points will expire\n on 5/1/2027";
assert.strictEqual(parse(message, "date", "on (\\S+)$"), "2027-05-01");
assert.strictEqual(parse(message, "number", "^([\\d,]+) points"), 5000);
assert.strictEqual(parse("No points expiring", "date", "on (\\S+)$"), null);
assert.strictEqual(parse("5/1/2027", "nonsense"), null);

// Every declared field is read; one the page lacks is null.
const rules = { "balance.expiresOn": { selector: "#e", parse: "date" }, "balance.expiringAmount": { selector: "#a", parse: "number" } };
assert.deepStrictEqual(readFields(rules, (sel) => ({ "#e": "5/1/2027" })[sel] || null), { "balance.expiresOn": "2027-05-01", "balance.expiringAmount": null });
assert.deepStrictEqual(readFields(undefined, () => null), {});

// On the holding: a new expiry on an unchanged balance is saved at once.
const state = { accounts: {}, holdings: {} };
const capture = (over) => ({ provider: "Inn", category: "Hotel", programName: "Blue", accountName: "Pat", accountId: "1", points: 900, lastUpdated: "2026-01-01T00:00:00.000Z", scrapedUrl: "u", ...over });
const holding = () => state.holdings["inn_1:balance"];
applyCapture(state, capture(), 0);
assert.strictEqual(holding().expiresOn, null);
let r = applyCapture(state, capture({ fields: { "balance.expiresOn": "2027-05-01", "balance.expiringAmount": 500 } }), 1000);
assert.deepStrictEqual([r.write, r.balanceChanged, holding().expiresOn, holding().expiringAmount], [true, false, "2027-05-01", 500]);

// The same values again: no write. A capture that declares nothing leaves them alone.
assert.strictEqual(applyCapture(state, capture({ fields: { "balance.expiresOn": "2027-05-01", "balance.expiringAmount": 500 } }), 2000).write, false);
applyCapture(state, capture({ points: 950 }), 3000);
assert.deepStrictEqual([holding().amount, holding().expiresOn], [950, "2027-05-01"]);

// A declared field that left the page clears; an unknown field is ignored.
applyCapture(state, capture({ points: 950, fields: { "balance.expiresOn": null, "balance.hacked": 1 } }), 4000);
assert.deepStrictEqual([holding().expiresOn, holding().expiringAmount, "hacked" in holding()], [null, 500, false]);
assert.strictEqual(toRows(state)[0].expiresOn, null);
console.log("ok fields");

// Site rules read the text their pages show.
const sites = require("../extension/site-config.json");
const fieldsOf = (site, text) => readFields(sites.find((s) => s.siteName === site).fields, () => text);
assert.deepStrictEqual(fieldsOf("Wyndham Rewards", "15,000 of your points will expire on 05/31/2027."), { "balance.expiresOn": "2027-05-31", "balance.expiringAmount": 15000 });
assert.deepStrictEqual(fieldsOf("Wyndham Rewards", "Stay active to keep your points."), { "balance.expiresOn": null, "balance.expiringAmount": null });
console.log("ok site fields");
