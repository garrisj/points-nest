// Background worker: captures flow from a message into storage.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createStorage } = require("./harness");

const dir = path.join(__dirname, "..", "extension");
const storage = createStorage();
const noop = { addListener() {} };
let onMessage;
global.chrome = {
  storage: { local: storage.area, sync: storage.area, onChanged: noop },
  runtime: { onMessage: { addListener: (f) => (onMessage = f) }, getURL: (x) => x },
  tabs: { onUpdated: noop, onActivated: noop, query() {} },
  windows: { onFocusChanged: noop },
  action: { setIcon() {} },
};
global.fetch = () => new Promise(() => {});
global.importScripts = (...files) => files.forEach((f) => vm.runInThisContext(fs.readFileSync(path.join(dir, f), "utf8")));
const log = console.log;
console.log = () => {};
vm.runInThisContext(fs.readFileSync(path.join(dir, "background.js"), "utf8"));

const send = (over) => onMessage({ type: "POINTS_SCRAPED", payload: {
  provider: "World of Hyatt", category: "Hotel", programName: "Member", accountName: "Pat", accountId: "X1",
  lastUpdated: new Date().toISOString(), scrapedUrl: "u", ...over } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

(async () => {
  send({ points: 100 });
  send({ points: 150 });
  await settle();
  const holding = () => storage.data.holdings["world_of_hyatt_x1:balance"];
  assert.deepStrictEqual([holding().amount, holding().lastChange], [150, 50]);
  assert.strictEqual(storage.data["events:world_of_hyatt_x1:balance"].length, 2);
  assert.strictEqual(storage.data.schemaVersion, 2);

  // Same balance again: no write. A new tier: one write, same account, no new history.
  let writes = storage.area.writes;
  send({ points: 150 });
  await settle();
  assert.strictEqual(storage.area.writes, writes);
  send({ points: 150, programName: "Globalist" });
  await settle();
  assert.strictEqual(storage.area.writes, writes + 1);
  assert.strictEqual(Object.keys(storage.data.accounts).length, 1);
  assert.strictEqual(storage.data.accounts.world_of_hyatt_x1.tier, "Globalist");
  assert.strictEqual(storage.data["events:world_of_hyatt_x1:balance"].length, 2);

  // An owner set between captures survives the next capture.
  storage.data.accounts.world_of_hyatt_x1.owner = "Pat";
  send({ points: 175, programName: "Globalist" });
  await settle();
  assert.deepStrictEqual([storage.data.accounts.world_of_hyatt_x1.owner, holding().amount], ["Pat", 175]);
  log("ok background");
})();
