/**
 * settings.js
 * The settings page: point values, people, accounts and backup.
 * Relies on storage.js, model.js, holdings.js, owners.js, valuations.js,
 * export.js and import.js.
 */

const VALUE_MAX_CPP = 20;
let configs = [];
// Storage changes this page caused while editing a value: the page has
// already shown them, so it skips a redraw that would drop the cursor
let quietUntil = 0;

document.addEventListener("DOMContentLoaded", async () => {
  configs = await loadConfigs();
  document.getElementById("export-btn").addEventListener("click", () => downloadExport(configs));
  setupImportModal();
  render();
  onStoreChanged((changes) => {
    const onlyValues = Object.keys(changes).every((key) => key === VALUATIONS_KEY);
    if (onlyValues && Date.now() < quietUntil) return;
    render();
  });
});

async function loadConfigs() {
  try {
    const response = await fetch(chrome.runtime.getURL("site-config.json"));
    return await response.json();
  } catch (error) {
    console.error("[Points Nest] Failed to load site-config.json:", error);
    return [];
  }
}

function render() {
  loadState(async (state) => {
    const rows = toRows(state);
    const sets = await loadValuationSets();
    renderValues(rows, sets);
    renderPeople(rows);
    renderAccounts(rows);
    renderDataSummary(rows);
  });
}

/* ---------- Small builders ---------- */

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function table(headings, bodyRows, extraClass = "") {
  return el("table", { className: `settings-table ${extraClass}`.trim() }, [
    el("thead", {}, [el("tr", {}, headings.map((text) => el("th", { textContent: text, scope: "col" })))]),
    el("tbody", {}, bodyRows),
  ]);
}

const formatNumber = (n) => Math.round(n).toLocaleString("en-US");
const formatDollars = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

/* ---------- Point values ---------- */

/**
 * One row per program: every supported site, every program held, and any
 * program with a stored value. Points are summed over pooled rows, so a
 * shared balance counts once.
 */
function getValueRows(rows, builtIn, custom) {
  const byKey = {};
  const add = (key, category) => (byKey[key] = byKey[key] || { key, category, points: 0, held: false });

  configs.forEach((config) => {
    if (config.category !== "Bank") add(config.siteName, config.category);
    else Object.keys(builtIn).filter((key) => key.startsWith(`${config.siteName} `)).forEach((key) => add(key, "Bank"));
  });
  poolAccounts(rows, configs).forEach((row) => {
    const entry = add(getValueKey(row), row.category);
    entry.points += row.points;
    entry.held = true;
  });
  Object.keys(custom).forEach((key) => add(key, "Other"));

  return Object.values(byKey);
}

function renderValues(rows, { builtIn, custom }) {
  const valueRows = getValueRows(rows, builtIn, custom);
  const groups = [...CATEGORY_ORDER, "Other"]
    .map((category) => [category, valueRows.filter((row) => row.category === category)])
    .filter(([, list]) => list.length > 0);

  document.getElementById("values-body").replaceChildren(
    ...groups.map(([category, list]) =>
      el("div", { className: "settings-group" }, [
        el("h3", { textContent: category }),
        table(
          ["Program", "Your points", "Built-in ¢", "Your ¢", "Worth"],
          list.sort((a, b) => a.key.localeCompare(b.key)).map((row) => valueRow(row, builtIn[row.key], custom[row.key])),
          "values-table",
        ),
      ]),
    ),
  );
}

function valueRow(row, builtInCpp, customCpp) {
  const worth = el("td", { className: "num" });
  const status = el("span", { className: "settings-status" });
  const showWorth = (cpp) => {
    const value = cpp === undefined ? FALLBACK_CPP : cpp;
    worth.textContent = row.held ? formatDollars((row.points * value) / 100) : "";
  };

  const input = el("input", {
    type: "number",
    min: "0",
    max: String(VALUE_MAX_CPP),
    step: "0.01",
    value: customCpp === undefined ? "" : String(customCpp),
    placeholder: builtInCpp === undefined ? String(FALLBACK_CPP) : String(builtInCpp),
    className: "settings-input value-input",
  });
  input.setAttribute("aria-label", `Your value for ${row.key}, in cents per point`);

  const reset = el("button", { type: "button", textContent: "Reset", className: "settings-link" });
  reset.hidden = customCpp === undefined;

  const save = (cpp) => {
    quietUntil = Date.now() + 1000;
    setValuation(row.key, cpp, () => {
      reset.hidden = cpp == null;
      showWorth(cpp == null ? builtInCpp : cpp);
      status.textContent = "Saved";
      setTimeout(() => (status.textContent = ""), 1500);
    });
  };

  input.addEventListener("change", () => {
    const text = input.value.trim();
    if (text === "") return save(null);
    const cpp = Number(text);
    if (!Number.isFinite(cpp) || cpp < 0 || cpp > VALUE_MAX_CPP) {
      input.setCustomValidity(`Enter a value from 0 to ${VALUE_MAX_CPP}.`);
      input.reportValidity();
      return;
    }
    input.setCustomValidity("");
    save(Math.round(cpp * 100) / 100);
  });
  reset.addEventListener("click", () => {
    input.value = "";
    save(null);
  });

  showWorth(customCpp === undefined ? builtInCpp : customCpp);
  return el("tr", { className: row.held ? "" : "not-held" }, [
    el("td", { textContent: row.key }),
    el("td", { className: "num", textContent: row.held ? formatNumber(row.points) : "" }),
    el("td", { className: "num", textContent: builtInCpp === undefined ? "None" : String(builtInCpp) }),
    el("td", {}, [input, reset, status]),
    worth,
  ]);
}

/* ---------- People ---------- */

function renderPeople(rows) {
  const counts = {};
  rows.forEach((row) => {
    const owner = resolveOwner(row);
    if (owner !== UNASSIGNED) counts[owner] = (counts[owner] || 0) + 1;
  });
  const people = Object.keys(counts).sort();

  document.getElementById("people-list").replaceChildren(...people.map((name) => el("option", { value: name })));
  document.getElementById("people-body").replaceChildren(
    people.length === 0
      ? el("p", { className: "settings-note", textContent: "No people yet." })
      : table(
          ["Person", "Accounts", "Rename to"],
          people.map((name) => {
            const input = el("input", { type: "text", className: "settings-input", placeholder: "New name" });
            input.setAttribute("aria-label", `New name for ${name}`);
            input.setAttribute("list", "people-list");
            const button = el("button", { type: "button", textContent: "Rename", className: "settings-action" });
            const rename = () => {
              const to = input.value.trim();
              if (to && to !== name) renamePerson(rows, name, to, render);
            };
            button.addEventListener("click", rename);
            input.addEventListener("keydown", (e) => e.key === "Enter" && rename());
            return el("tr", {}, [
              el("td", { textContent: name }),
              el("td", { className: "num", textContent: String(counts[name]) }),
              el("td", { className: "settings-row" }, [input, button]),
            ]);
          }),
        ),
  );
}

/* ---------- Accounts ---------- */

function renderAccounts(rows) {
  const order = (row) => CATEGORY_ORDER.indexOf(row.category);
  const sorted = [...rows].sort(
    (a, b) =>
      resolveOwner(a).localeCompare(resolveOwner(b)) ||
      order(a) - order(b) ||
      getValueKey(a).localeCompare(getValueKey(b)) ||
      String(a.accountId).localeCompare(String(b.accountId)),
  );

  document.getElementById("accounts-body").replaceChildren(
    table(["Program", "Account", "Owner", "Kind", "Last read", ""], sorted.map(accountRow)),
  );
}

function accountRow(account) {
  const site = configs.find((config) => config.siteName === account.provider);
  const readFromPage = Boolean(site && site.businessUrlRegex);

  const owner = el("input", {
    type: "text",
    className: "settings-input",
    value: account.owner || "",
    placeholder: resolveOwner(account),
  });
  owner.setAttribute("list", "people-list");
  owner.setAttribute("aria-label", `Owner of ${account.provider} ${account.accountId}`);
  owner.addEventListener("change", () => setOwner([account], owner.value.trim() || null, render));

  const kind = el("select", { className: "settings-input", disabled: readFromPage }, [
    el("option", { value: "", textContent: "Not set" }),
    el("option", { value: "personal", textContent: "Personal" }),
    el("option", { value: "business", textContent: "Business" }),
  ]);
  kind.value = account.kind || "";
  kind.title = readFromPage ? "Read from the page on each visit" : "";
  kind.setAttribute("aria-label", `Personal or business: ${account.provider} ${account.accountId}`);
  kind.addEventListener("change", () => setKind([account], kind.value || null, render));

  // Two clicks remove, as in the popup
  const remove = el("button", { type: "button", textContent: "Remove", className: "settings-link danger" });
  let armed = false;
  remove.addEventListener("click", () => {
    if (armed) return removeAccounts([account], render);
    armed = true;
    remove.textContent = "Click to confirm";
    setTimeout(() => {
      armed = false;
      remove.textContent = "Remove";
    }, 3000);
  });

  const label =
    account.category === "Bank"
      ? `${account.accountName} (${account.accountId})`
      : [account.accountId, account.tier].filter(Boolean).join(" · ");
  return el("tr", {}, [
    el("td", { textContent: getValueKey(account) }),
    el("td", { textContent: label }),
    el("td", {}, [owner]),
    el("td", {}, [kind]),
    el("td", { textContent: new Date(account.lastUpdated).toLocaleDateString() }),
    el("td", {}, [remove]),
  ]);
}

/* ---------- Backup ---------- */

function renderDataSummary(rows) {
  getStorageBytes((bytes) => {
    document.getElementById("data-summary").textContent =
      `${rows.length} accounts stored, using ${Math.ceil(bytes / 1024)} KB.`;
  });
}
