// Runs the page scraper against a saved snapshot and prints what it would
// capture. Needs Chrome. Usage:
//   node tests/try-snapshot.js <snapshot.html> "<siteName>" [chrome binary]
// Snapshots hold personal data. Keep them outside the repository.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const [file, siteName, chromeBin = "google-chrome"] = process.argv.slice(2);
const ext = path.join(__dirname, "..", "extension");
const site = require(path.join(ext, "site-config.json")).find((s) => s.siteName === siteName);
if (!file || !site) throw new Error("Give a snapshot file and a siteName from site-config.json.");

// The snapshot is opened from disk, so the site's URL rule is swapped for one that matches it
const config = [{ ...site, urlRegex: "^file:" }];
const read = (name) => fs.readFileSync(path.join(ext, name), "utf8");
const inject = `
<pre id="points-nest-result">no capture</pre>
<script>
  window.chrome = { runtime: { getURL: (x) => x, onMessage: { addListener() {} },
    sendMessage: (m) => { document.getElementById("points-nest-result").textContent = JSON.stringify(m.payload); } } };
  window.fetch = () => Promise.resolve({ json: () => Promise.resolve(${JSON.stringify(config)}) });
</script>
<script>${read("fields.js")}</script>
<script>${read("content.js")}</script>`;

const page = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pn-")), "page.html");
fs.writeFileSync(page, fs.readFileSync(file, "utf8").replace(/<\/body>(?![\s\S]*<\/body>)/, `${inject}</body>`));
const dom = execFileSync(chromeBin, ["--headless=new", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=25000", "--dump-dom", `file://${page}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 });
const result = dom.match(/<pre id="points-nest-result">([\s\S]*?)<\/pre>/);
const text = result ? result[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&") : "no capture";
console.log(text === "no capture" ? text : JSON.stringify(JSON.parse(text), null, 2));
fs.rmSync(path.dirname(page), { recursive: true });
