// Listed holdings: reading rows, storing them, marking them gone.
const assert = require("assert");
const { load } = require("./harness");
load(["storage.js", "model.js", "holdings.js", "fields.js"]);
const warn = console.warn;
console.warn = () => {};

// Reading: rows are plain objects here; getText looks a selector up in the row.
const rules = [{
  type: "certificate", row: ".cert", label: { selector: ".name" },
  amount: { selector: ".n", parse: "number" }, expiresOn: { selector: ".exp", parse: "date" }, id: { selector: ".id" , parse: "text" },
}, { type: "funds", row: ".fund", label: "Travel Funds", amount: { pattern: "^([\\d,.]+) Dollars$", parse: "money" } }];
const page = {
  ".cert": [{ ".name": "Free Night", ".n": "1", ".exp": "5/1/2027", ".id": "A1" }, { ".name": "Free Night", ".n": "1", ".exp": "", ".id": "A2" }],
  ".fund": [{ text: "239.40 Dollars" }],
};
const getRows = (pg) => (selector) => pg[selector] || [];
const getText = (selector, row) => (selector ? row[selector] : row.text) || null;
let lists = readLists(rules, getRows(page), getText);
assert.deepStrictEqual(lists.funds, [{ label: "Travel Funds", amount: 239.4, unit: undefined }]);
assert.deepStrictEqual(lists.certificate.map((c) => [c.id, c.amount, c.expiresOn]), [["A1", 1, "2027-05-01"], ["A2", 1, null]]);

// A row that does not read drops its whole list; a list with no rows is empty, not missing.
const bad = { ...page, ".fund": [{ text: "76,869 Points" }], ".cert": [] };
assert.deepStrictEqual(readLists(rules, getRows(bad), getText), { certificate: [] });
assert.deepStrictEqual(readLists(undefined, getRows(page), getText), {});

// Storing, through a capture.
const state = { accounts: {}, holdings: {} };
const day = (n) => `2026-01-${String(n).padStart(2, "0")}T00:00:00.000Z`;
const capture = (n, extra) => ({ provider: "Air", category: "Airline", programName: "Member", accountName: "Pat", accountId: "9", points: 100, lastUpdated: day(n), scrapedUrl: "u", ...extra });
const now = (n) => new Date(day(n)).getTime();
applyCapture(state, capture(1, { lists }), now(1));
const funds = () => state.holdings["air_9:funds:travel_funds:"];
assert.deepStrictEqual([funds().amount, funds().unit, funds().state, funds().lastChange], [239.4, "USD", "active", null]);
assert.strictEqual(state.holdings["air_9:certificate:a1"].unit, "count");
assert.strictEqual(Object.keys(state.holdings).length, 4);
assert.strictEqual(state.holdings["air_9:balance"].amount, 100);

// Same rows again inside the throttle window: no write.
assert.strictEqual(applyCapture(state, capture(1, { lists }), now(1) + 1000).write, false);

// An amount change on an unchanged balance is saved at once and keeps the first-seen time.
let r = applyCapture(state, capture(2, { lists: { funds: [{ label: "Travel Funds", amount: 100.15 }] } }), now(1) + 2000);
assert.deepStrictEqual([r.write, r.balanceChanged], [true, false]);
assert.deepStrictEqual([funds().amount, funds().lastChange, funds().firstSeenAt], [100.15, -139.25, day(1)]);
// Certificates were not in that capture, so they stay active.
assert.strictEqual(state.holdings["air_9:certificate:a1"].state, "active");

// A listed type with no rows marks its holdings gone; a capture without lists touches nothing.
applyCapture(state, capture(3, { lists: { funds: [] } }), now(3));
assert.deepStrictEqual([funds().state, funds().goneAt], ["gone", day(3)]);
applyCapture(state, capture(4, { points: 120 }), now(4));
assert.strictEqual(state.holdings["air_9:certificate:a2"].state, "active");
assert.deepStrictEqual(toRows(state)[0].extras.map((h) => h.holdingId).sort(), ["air_9:certificate:a1", "air_9:certificate:a2"]);

// A gone holding that returns is active again; twins without an ID get a counter.
const twin = { label: "Upgrade", amount: 1, expiresOn: "2027-01-01" };
applyCapture(state, capture(5, { points: 120, lists: { funds: [{ label: "Travel Funds", amount: 50 }], certificate: [twin, twin] } }), now(5));
assert.deepStrictEqual([funds().state, funds().goneAt, funds().amount], ["active", null, 50]);
assert.ok(state.holdings["air_9:certificate:upgrade:2027-01-01"] && state.holdings["air_9:certificate:upgrade:2027-01-01:2"]);
assert.strictEqual(state.holdings["air_9:certificate:a1"].state, "gone");

// Gone holdings drop after about 13 months; an unknown type and "balance" are ignored.
applyCapture(state, capture(6, { points: 130, lists: { balance: [{ label: "x", amount: 1 }], bogus: [] } }), now(5) + GONE_KEEP_MS - 1000);
assert.ok(state.holdings["air_9:certificate:a1"]);
applyCapture(state, capture(7, { points: 140 }), now(5) + GONE_KEEP_MS + 1000);
assert.ok(!state.holdings["air_9:certificate:a1"] && state.holdings["air_9:balance"].amount === 140);

// Site rules, against rows shaped like their pages. A row maps each selector to its text.
const sites = require("../extension/site-config.json");
const listsOf = (site, rows) => readLists(sites.find((s) => s.siteName === site).lists, () => rows, (selector, row) => row[selector] || null);
const swAmount = '[class*="travelFundAmount__"] [class*="hiddenFromScreen"]';
const swId = '[class*="confirmationNumber__"] [class*="numberPrefix__"] + span';
const swExpiry = '[class*="transferabilitySection__"] [class*="additionalText__"]';
const credit = (amount, id, expiry) => ({ [swAmount]: amount, [swId]: id, [swExpiry]: expiry });
assert.deepStrictEqual(listsOf("Southwest Rapid Rewards", [credit("139.40 Dollars", "ABC123", "Expiration: None"), credit("100.00 Dollars", "XYZ789", "Expiration: 05/31/2027")]).funds, [
  { label: "Flight Credit", amount: 139.4, unit: undefined, id: "ABC123", expiresOn: null },
  { label: "Flight Credit", amount: 100, unit: undefined, id: "XYZ789", expiresOn: "2027-05-31" },
]);
assert.deepStrictEqual(listsOf("Southwest Rapid Rewards", []), { funds: [] });
// A collapsed row shows no expiry element, so the list is skipped, not saved without dates.
assert.deepStrictEqual(listsOf("Southwest Rapid Rewards", [credit("139.40 Dollars", "ABC123", null)]), {});
assert.deepStrictEqual(listsOf("Southwest Rapid Rewards", [credit("76,869 Points", "ABC123", "Expiration: None")]), {});

// IHG: the free nights tile gives a count; a count of 0 is no holding.
const ihgTile = (text) => [{ '[data-testid="walletBodyTileBodyHeaderSID"]': text }];
assert.deepStrictEqual(listsOf("IHG One", ihgTile("2 Free Night(s)")).certificate, [{ label: "Free Nights", amount: 2, unit: undefined }]);
assert.deepStrictEqual(listsOf("IHG One", ihgTile("0 Free Night(s)")), { certificate: [] });
assert.deepStrictEqual(listsOf("IHG One", ihgTile("Book a Reward Night")), {});
console.warn = warn;
console.log("ok holdings");
