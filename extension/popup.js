/**
 * popup.js
 * Renders points overview.
 */

let currentDisplayMode = "pts";
let scraperConfigs = null;
let programValuations = null;
let activeModalAccount = null;
// The program row an account window was opened from, for its back button
let modalParent = null;
let knownPeople = [];
let currentViewMode = "person";

document.addEventListener("DOMContentLoaded", () => {
  chrome.runtime.sendMessage({ type: "POPUP_OPENED" }).catch(() => {});

  setupModalListeners();
  document.getElementById("export-btn").addEventListener("click", async () => {
    downloadExport(await loadConfig());
  });
  setupImportModal();

  // Load preferred display mode
  store.get(["displayMode", "viewMode"], (result) => {
    currentDisplayMode = result.displayMode || "pts";
    currentViewMode = result.viewMode || "person";
    updateToggleUI();
    renderData();
  });

  // Switch between the person view and the combined program view
  document.getElementById("toggle-view").addEventListener("click", () => {
    currentViewMode = currentViewMode === "person" ? "program" : "person";
    store.set({ viewMode: currentViewMode }, () => {
      updateToggleUI();
      renderData();
    });
  });

  const toggleBtn = document.getElementById("toggle-display");
  toggleBtn.addEventListener("click", () => {
    currentDisplayMode = currentDisplayMode === "pts" ? "usd" : "pts";
    store.set({ displayMode: currentDisplayMode }, () => {
      updateToggleUI();
      renderData();
      if (activeModalAccount) {
        openHistoryModal(activeModalAccount, programValuations, scraperConfigs);
      }
    });
  });

  // Listen for storage changes to refresh UI instantly
  onStoreChanged((changes) => {
    if (changes.displayMode) {
      currentDisplayMode = changes.displayMode.newValue;
      updateToggleUI();
      renderData();
      if (activeModalAccount) {
        openHistoryModal(activeModalAccount, programValuations, scraperConfigs);
      }
    } else if (changes.accounts || changes.holdings) {
      // Re-render, then refresh the open history window from the new rows
      renderData((rows) => {
        // A program window is left as it is; it is rebuilt when next opened
        if (!activeModalAccount || activeModalAccount.combined) return;
        const openKey = activeModalAccount.accountKey;
        const fresh = rows.find((row) => row.members.some((m) => m.accountKey === openKey));
        if (fresh) {
          openHistoryModal(fresh, programValuations, scraperConfigs);
        }
      });
    }
  });
});

function updateToggleUI() {
  const toggleBtn = document.getElementById("toggle-display");
  const ptsLabel = toggleBtn.querySelector(".points-label");
  const usdLabel = toggleBtn.querySelector(".usd-label");

  if (currentDisplayMode === "usd") {
    toggleBtn.classList.add("usd-active");
    ptsLabel.classList.remove("active");
    usdLabel.classList.add("active");
  } else {
    toggleBtn.classList.remove("usd-active");
    ptsLabel.classList.add("active");
    usdLabel.classList.remove("active");
  }

  const viewBtn = document.getElementById("toggle-view");
  const programActive = currentViewMode === "program";
  viewBtn.classList.toggle("program-active", programActive);
  viewBtn.querySelector(".person-label").classList.toggle("active", !programActive);
  viewBtn.querySelector(".program-label").classList.toggle("active", programActive);
}

async function loadConfig() {
  if (scraperConfigs) return scraperConfigs;
  try {
    const url = chrome.runtime.getURL("site-config.json");
    const response = await fetch(url);
    scraperConfigs = await response.json();
    return scraperConfigs;
  } catch (error) {
    console.error("[Points Nest] Failed to load site-config.json:", error);
    return [];
  }
}

async function loadValuations() {
  if (programValuations) return programValuations;
  try {
    const url = chrome.runtime.getURL("constants.json");
    const response = await fetch(url);
    programValuations = await response.json();
    return programValuations;
  } catch (error) {
    console.error("[Points Nest] Failed to load constants.json:", error);
    return {};
  }
}

function getValuationCpp(account, valuations) {
  // 1. Try exact match on programName
  if (account.programName && valuations[account.programName] !== undefined) {
    return valuations[account.programName];
  }

  // 2. Try substring match on programName keys
  if (account.programName) {
    for (const [key, cpp] of Object.entries(valuations)) {
      if (account.programName.toLowerCase().includes(key.toLowerCase())) {
        return cpp;
      }
    }
  }

  // 3. Try match/substring match on provider/siteName
  if (account.provider && valuations[account.provider] !== undefined) {
    return valuations[account.provider];
  }
  if (account.provider) {
    for (const [key, cpp] of Object.entries(valuations)) {
      if (account.provider.toLowerCase().includes(key.toLowerCase())) {
        return cpp;
      }
    }
  }

  // Default fallback (1.0 cent per point)
  return 1.0;
}

async function renderData(afterRender) {
  const configs = await loadConfig();
  const valuations = await loadValuations();

  loadState((state) => {
    const accounts = poolAccounts(toRows(state), configs);
    // Runs once this render pass ends, on every path out of it
    if (afterRender) setTimeout(() => afterRender(accounts), 0);
    const overallTotal = accounts.reduce((sum, account) => sum + account.points, 0);

    const titleTotalEl = document.getElementById("title-total");
    if (currentDisplayMode === "usd") {
      const overallUsdTotal = accounts.reduce((sum, account) => {
        const cpp = getValuationCpp(account, valuations);
        return sum + account.points * (cpp / 100);
      }, 0);
      titleTotalEl.textContent = `($${formatCurrency(overallUsdTotal)})`;
    } else {
      titleTotalEl.textContent = `(${formatNumber(overallTotal)} pts)`;
    }

    const accountsListContainer = document.getElementById("accounts-list");

    if (accounts.length === 0) {
      document.body.classList.remove("two-column");
      accountsListContainer.replaceChildren();
      const emptyTemplate = document.getElementById("empty-state-template");
      accountsListContainer.appendChild(emptyTemplate.content.cloneNode(true));
      return;
    }

    // Build the sections for the chosen view: one per person, or one per
    // category with each program combined across people
    knownPeople = listPeople(accounts);
    const sections =
      currentViewMode === "program"
        ? groupByCategory(combineByProgram(accounts)).map(({ category, rows }) => ({
            size: rows.length,
            build: () => createCategoryGroup(category, rows, configs, valuations),
          }))
        : groupByOwner(accounts).map((group) => ({
            size: group.rows.length,
            build: () => createOwnerGroup(group, configs, valuations),
          }));

    // Balance the sections across up to two columns
    const columns = sections.length === 1 ? [[]] : [[], []];
    const columnRows = columns.map(() => 0);
    sections.forEach((section) => {
      const i = columns.length === 1 || columnRows[0] <= columnRows[1] ? 0 : 1;
      columns[i].push(section);
      columnRows[i] += section.size;
    });

    document.body.classList.toggle("two-column", columns.length === 2);
    accountsListContainer.replaceChildren();
    columns.forEach((column) => {
      const colDiv = document.createElement("div");
      colDiv.className = "accounts-column";
      column.forEach((section) => {
        colDiv.appendChild(section.build());
      });
      accountsListContainer.appendChild(colDiv);
    });
  });
}

/**
 * Formats the total of a list of accounts in the current display mode.
 */
function formatTotal(items, valuations) {
  if (currentDisplayMode === "usd") {
    const totalUsd = items.reduce((sum, item) => {
      const cpp = getValuationCpp(item, valuations);
      return sum + item.points * (cpp / 100);
    }, 0);
    return `$${formatCurrency(totalUsd)}`;
  }
  const totalPoints = items.reduce((sum, item) => sum + item.points, 0);
  return `${formatNumber(totalPoints)} pts`;
}

/**
 * Creates an owner section: the owner's name and total, then one category
 * group per program type.
 */
function createOwnerGroup(group, configs, valuations) {
  const ownerDiv = document.createElement("div");
  ownerDiv.className = "owner-group";

  const titleDiv = document.createElement("div");
  titleDiv.className = "owner-title";
  titleDiv.textContent = `${group.owner} (${formatTotal(group.rows, valuations)})`;
  if (group.owner === UNASSIGNED) {
    titleDiv.title = "Select a card to assign its owner";
  }
  ownerDiv.appendChild(titleDiv);

  group.categories.forEach(({ category, rows }) => {
    ownerDiv.appendChild(createCategoryGroup(category, rows, configs, valuations));
  });
  return ownerDiv;
}

/**
 * Creates and returns a styled category group element.
 */
/**
 * Formats a stored YYYY-MM-DD date as "May 1, 2027".
 */
function formatDate(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Returns a short expiry note for a card, such as "5,000 expire May 1, 2027",
 * or an empty string when the row has no expiry date.
 */
function formatExpiry(account) {
  if (account.combined || !account.expiresOn) return "";
  const date = formatDate(account.expiresOn);
  const partial = account.expiringAmount != null && account.expiringAmount !== account.points;
  return partial ? `${formatNumber(account.expiringAmount)} expire ${date}` : `Expires ${date}`;
}

/**
 * Returns short lines for the holdings beside the balance, such as "$239.40
 * Flight Credit (3) · exp May 1, 2027". A pooled row covers every member.
 */
function formatExtras(account) {
  if (account.combined) return [];
  // Holdings of one kind share a line: their sum, count and nearest expiry
  const groups = {};
  account.members
    .flatMap((member) => member.extras || [])
    .forEach((holding) => {
      const key = `${holding.type}|${holding.label}|${holding.unit}`;
      (groups[key] = groups[key] || []).push(holding);
    });

  return Object.values(groups).map((group) => {
    const { label, unit } = group[0];
    const sum = group.reduce((total, holding) => total + holding.amount, 0);
    const amount = unit === "USD" ? `$${formatCurrency(sum)}` : formatNumber(sum);
    const count = group.length > 1 ? ` (${group.length})` : "";
    const nearest = group.map((holding) => holding.expiresOn).filter(Boolean).sort()[0];
    return `${amount} ${label}${count}${nearest ? ` · exp ${formatDate(nearest)}` : ""}`;
  });
}

// A card is flagged once its balance has not been read for this long
const STALE_AFTER_MS = 35 * 24 * 60 * 60 * 1000;

/**
 * The one short tag a card shows under its balance, so every card keeps the
 * same height: a stale warning, else the balance expiry, else the other
 * holdings. "+N" counts what did not fit; the detail window lists it all.
 * Returns { text, warn }.
 */
function getCardTag(account) {
  const age = Date.now() - new Date(account.lastUpdated).getTime();
  if (age > STALE_AFTER_MS) {
    return { text: `Not seen in ${Math.floor(age / (7 * 24 * 60 * 60 * 1000))} weeks`, warn: true };
  }
  const expiry = formatExpiry(account);
  const notes = (expiry ? [expiry] : []).concat(formatExtras(account));
  if (notes.length === 0) return { text: "", warn: false };
  return { text: notes[0] + (notes.length > 1 ? ` +${notes.length - 1}` : ""), warn: Boolean(expiry) };
}

/**
 * The line under a card's title: what tells this account from its
 * neighbors. A bank card shows its card name; the rest show their number.
 */
function getCardSubtitle(account, formatAmount) {
  if (account.combined) {
    // Each owner's share of a combined program
    return account.parts.map((p) => `${p.owner} ${formatAmount(p.points)}`).join(" · ");
  }
  if (account.members.length > 1) return `Pool of ${account.members.length} cards`;
  return account.category === "Bank" ? `${account.accountName} (${account.accountId})` : account.accountId;
}

/**
 * Card and window title: the program, without the status tier.
 */
function getAccountTitle(account) {
  if (account.title) return account.title;
  return account.category === "Bank" ? `${account.provider} ${account.currency}` : account.provider;
}

/**
 * Fills the detail window's list: the cards of a pool, then what the
 * account holds beside its balance: points due to expire, then each
 * credit, certificate or fund.
 */
function renderHoldings(account, openAccount) {
  const listEl = document.getElementById("modal-holdings");
  const members = account.members || [account];
  const rows = [];
  // A program lists its accounts; a click opens that account's own window
  if (account.combined) {
    account.rows.forEach((row) => {
      rows.push({
        label: row.owner,
        note: getCardSubtitle(row, formatNumber),
        value: formatNumber(row.points),
        onClick: () => openAccount(row),
      });
    });
  }
  // A pool lists its cards, each with a link to its own page
  if (members.length > 1 && !account.combined) {
    members.forEach((member) => {
      rows.push({
        label: `${member.accountName} (${member.accountId})`,
        note: `Updated ${getRelativeTime(member.lastUpdated)}`,
        value: member.scrapedUrl ? "Open" : "",
        url: member.scrapedUrl,
      });
    });
  }
  if (account.expiresOn && !account.combined) {
    const partial = account.expiringAmount != null && account.expiringAmount !== account.points;
    rows.push({
      label: "Points expiring",
      note: formatDate(account.expiresOn),
      value: partial ? formatNumber(account.expiringAmount) : "All",
    });
  }
  // In a program window each extra names its owner
  const ownerOf = {};
  (account.rows || []).forEach((row) => row.members.forEach((member) => (ownerOf[member.accountKey] = row.owner)));
  members
    .flatMap((member) => member.extras || [])
    .forEach((holding) => {
      const expiry = holding.expiresOn ? `Expires ${formatDate(holding.expiresOn)}` : "No expiry shown";
      rows.push({
        label: holding.label,
        note: account.combined ? `${ownerOf[holding.accountKey]} · ${expiry}` : expiry,
        value: holding.unit === "USD" ? `$${formatCurrency(holding.amount)}` : formatNumber(holding.amount),
      });
    });

  listEl.replaceChildren(
    ...rows.map((row) => {
      const rowEl = document.createElement(row.onClick ? "button" : "div");
      rowEl.className = "modal-holding-row" + (row.onClick ? " clickable" : "");
      if (row.onClick) rowEl.onclick = row.onClick;
      [["modal-holding-label", row.label], ["modal-holding-note", row.note], ["modal-holding-value", row.value]].forEach(
        ([className, text]) => {
          const isLink = row.url && className === "modal-holding-value";
          const el = document.createElement(isLink ? "button" : "span");
          el.className = className + (isLink ? " modal-holding-link" : "");
          el.textContent = text;
          if (isLink) el.onclick = () => chrome.tabs.create({ url: row.url });
          rowEl.appendChild(el);
        },
      );
      return rowEl;
    }),
  );
}

function createCategoryGroup(cat, items, configs, valuations) {
  const groupDiv = document.createElement("div");
  groupDiv.className = "category-group";

  const titleDiv = document.createElement("div");
  titleDiv.className = "category-title";

  titleDiv.textContent = `${cat} (${formatTotal(items, valuations)})`;
  groupDiv.appendChild(titleDiv);

  const cardTemplate = document.getElementById("account-card-template");

  items.forEach((account) => {
    const clone = cardTemplate.content.cloneNode(true);
    const siteConfig = configs.find((c) => c.siteName === account.provider);
    const iconUrl = siteConfig ? siteConfig.icon : "";

    const cpp = getValuationCpp(account, valuations);
    const formatAmount = (points) =>
      currentDisplayMode === "usd" ? `$${formatCurrency(points * (cpp / 100))}` : formatNumber(points);
    const displayName = getCardSubtitle(account, formatAmount);
    const tag = getCardTag(account);

    // A bank card leads with its card name; the program sits below it
    const cardFirst = account.category === "Bank" && !account.combined;
    bindData(clone, {
      title: cardFirst ? displayName : getAccountTitle(account),
      account: cardFirst ? getAccountTitle(account) : displayName,
      points: formatAmount(account.points),
      tag: tag.text,
      icon: iconUrl,
    });
    clone.querySelector(".account-tag").classList.toggle("tag-warn", tag.warn);

    // Add change indicators if changed recently (e.g. within last 24 hours)
    const cardEl = clone.querySelector(".account-card");
    const isRecentlyChanged = Date.now() - new Date(account.lastChanged).getTime() < 86400000;
    if (isRecentlyChanged) {
      cardEl.classList.add("highlighted");
      const ptsChangeEl = clone.querySelector(".pts-change");
      if (account.change > 0) {
        cardEl.classList.add("change-up");
        if (ptsChangeEl) {
          if (currentDisplayMode === "usd") {
            ptsChangeEl.textContent = `+$${formatCurrency(account.change * (cpp / 100))}`;
          } else {
            ptsChangeEl.textContent = `+${formatNumber(account.change)}`;
          }
        }
      } else if (account.change < 0) {
        cardEl.classList.add("change-down");
        if (ptsChangeEl) {
          if (currentDisplayMode === "usd") {
            ptsChangeEl.textContent = `-$${formatCurrency(Math.abs(account.change) * (cpp / 100))}`;
          } else {
            ptsChangeEl.textContent = `-${formatNumber(Math.abs(account.change))}`;
          }
        }
      }
    }

    // Click on the logo opens the scraped portal URL
    const iconEl = clone.querySelector(".account-icon");
    if (iconEl && account.scrapedUrl) {
      iconEl.classList.add("clickable-icon");
      iconEl.setAttribute("title", `Open ${account.provider} portal`);
      iconEl.addEventListener("click", (e) => {
        e.stopPropagation();
        chrome.tabs.create({ url: account.scrapedUrl });
      });
    }

    // Click on the card opens the balance history line chart modal.
    // A combined row opens the program window, which lists its accounts.
    if (cardEl) {
      cardEl.classList.add("clickable");
      cardEl.addEventListener("click", () => {
        modalParent = null;
        openHistoryModal(account, valuations, configs);
      });
    }

    groupDiv.appendChild(clone);
  });

  return groupDiv;
}

/**
 * Binds values to matching data-text and data-src elements inside a container.
 */
function bindData(element, data) {
  element.querySelectorAll("[data-text]").forEach((el) => {
    const key = el.getAttribute("data-text");
    if (data[key] !== undefined) {
      el.textContent = data[key];
    }
  });
  element.querySelectorAll("[data-src]").forEach((el) => {
    const key = el.getAttribute("data-src");
    if (data[key] !== undefined) {
      el.src = data[key];
    }
  });
}

/**
 * Helper to display values cleanly (e.g. 123456 -> "123,456")
 */
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Helper to display currency cleanly (e.g. 1234.56 -> "1,234.56")
 */
function formatCurrency(val) {
  return val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Converts an ISO timestamp into a human-readable relative time string.
 * Supports "just now", minutes, hours, days, months, and years ago.
 */
function getRelativeTime(timestamp) {
  if (!timestamp) return "";
  const now = new Date();
  const past = new Date(timestamp);
  const diffMs = now - past;

  // If time is in the future or under 60 seconds, display "just now"
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffMs < 0 || diffSeconds < 60) {
    return "Just now";
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? "1 minute ago" : `${diffMinutes} minutes ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return diffMonths === 1 ? "1 month ago" : `${diffMonths} months ago`;
  }

  const diffYears = Math.floor(diffMonths / 12);
  const remainingMonths = diffMonths % 12;
  const yearText = diffYears === 1 ? "1 year" : `${diffYears} years`;
  if (remainingMonths > 0) {
    const monthText = remainingMonths === 1 ? "1 month" : `${remainingMonths} months`;
    return `${yearText} ${monthText} ago`;
  } else {
    return `${yearText} ago`;
  }
}

let isEscapeHandled = false;

/**
 * Sets up global click and keyboard listeners for the balance history modal.
 */
function setupModalListeners() {
  const backdrop = document.getElementById("history-modal-backdrop");
  const closeBtn = document.getElementById("modal-close-btn");

  if (closeBtn) {
    closeBtn.addEventListener("click", closeHistoryModal);
  }

  if (backdrop) {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        closeHistoryModal();
      }
    });
  }

  // Intercept Escape key during the capture phase to close the modal
  // without allowing the browser to dismiss the whole extension popup.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && activeModalAccount) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        isEscapeHandled = true;
        closeHistoryModal();
      }
    },
    true,
  );

  window.addEventListener(
    "keyup",
    (e) => {
      if (e.key === "Escape" && isEscapeHandled) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        isEscapeHandled = false;
      }
    },
    true,
  );
}

/**
 * Closes the balance history modal.
 */
function closeHistoryModal() {
  activeModalAccount = null;
  modalParent = null;
  const backdrop = document.getElementById("history-modal-backdrop");
  if (backdrop) {
    backdrop.classList.add("hidden");
    backdrop.setAttribute("aria-hidden", "true");
  }
}

/**
 * Opens the balance history modal for the specified account and fetches history.
 */
function openHistoryModal(account, valuations, configs) {
  activeModalAccount = account;

  const backdrop = document.getElementById("history-modal-backdrop");
  if (!backdrop) return;

  const iconEl = document.getElementById("modal-account-icon");
  const providerEl = document.getElementById("modal-account-provider");
  const nameEl = document.getElementById("modal-account-name");
  const portalBtn = document.getElementById("modal-portal-btn");
  const portalWrapper = portalBtn ? portalBtn.closest(".modal-portal-wrapper") : null;

  // Header info
  if (providerEl) {
    providerEl.textContent = getAccountTitle(account);
  }
  if (nameEl) {
    const members = account.members || [account];
    // The tier shows here, not on the card
    const parts = [account.accountName, account.tier, account.accountId].filter(Boolean);
    nameEl.textContent = account.combined
      ? `${account.rows.length} accounts`
      : members.length > 1
        ? `Pool of ${members.length} cards`
        : parts.join(" · ");
  }
  if (iconEl) {
    const siteConfig = configs ? configs.find((c) => c.siteName === account.provider) : null;
    iconEl.src = siteConfig ? siteConfig.icon : "";
  }

  // Portal button
  if (portalWrapper && portalBtn) {
    if (account.scrapedUrl && !account.combined) {
      portalWrapper.classList.remove("hidden");
      portalBtn.onclick = () => {
        chrome.tabs.create({ url: account.scrapedUrl });
      };
    } else {
      portalWrapper.classList.add("hidden");
    }
  }

  // A program window sums several accounts: it has no chart, owner or remove
  backdrop.querySelector(".modal-card").classList.toggle("program-view", Boolean(account.combined));
  const backBtn = document.getElementById("modal-back-btn");
  backBtn.hidden = !modalParent;
  backBtn.onclick = () => {
    const program = modalParent;
    modalParent = null;
    openHistoryModal(program, valuations, configs);
  };

  setupOwnerControls(account);
  renderHoldings(account, (row) => {
    modalParent = account;
    openHistoryModal(row, valuations, configs);
  });
  document.getElementById("modal-updated").textContent = account.combined
    ? ""
    : `Updated ${getRelativeTime(account.lastUpdated)}`;

  // Reveal modal
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");

  // Focus close button for keyboard accessibility and reliable escape capture
  const closeBtn = document.getElementById("modal-close-btn");
  if (closeBtn && typeof closeBtn.focus === "function") {
    closeBtn.focus();
  }

  if (account.combined) {
    const cpp = getValuationCpp(account, valuations);
    document.getElementById("modal-current-points").textContent =
      currentDisplayMode === "usd" ? `$${formatCurrency(account.points * (cpp / 100))}` : `${formatNumber(account.points)} pts`;
    document.getElementById("modal-pts-change").textContent = "";
    return;
  }

  // Fetch points history using storage.js and render using chart.js
  getAccountHistory(getEventsKey(account.holdingId), account, (historyPoints) => {
    renderHistoryChart(historyPoints, account, valuations, currentDisplayMode);
  });
}

/**
 * Binds the modal's owner picker and remove button to the account. A pooled
 * row applies both to every card in the pool.
 */
function setupOwnerControls(account) {
  const NEW_PERSON = "New person…";
  const members = account.members || [account];
  const select = document.getElementById("modal-owner-select");
  const input = document.getElementById("modal-owner-new");
  const removeBtn = document.getElementById("modal-remove-btn");

  const current = account.owner || UNASSIGNED;
  const names = [UNASSIGNED, ...knownPeople, NEW_PERSON];
  select.replaceChildren(...names.map((name) => new Option(name, name, false, name === current)));
  input.hidden = true;
  input.value = "";

  select.onchange = () => {
    if (select.value === NEW_PERSON) {
      input.hidden = false;
      input.focus();
      return;
    }
    setOwner(members, select.value === UNASSIGNED ? "" : select.value, closeHistoryModal);
  };
  input.onkeydown = (e) => {
    const name = input.value.trim();
    if (e.key === "Enter" && name) {
      setOwner(members, name, closeHistoryModal);
    }
  };

  // Two clicks to remove, so a slip does not delete an entry
  let armed = false;
  removeBtn.textContent = "Remove";
  removeBtn.onclick = () => {
    if (!armed) {
      armed = true;
      removeBtn.textContent = "Click again to remove";
      return;
    }
    removeAccounts(members, closeHistoryModal);
  };
}
