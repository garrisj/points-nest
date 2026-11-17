/**
 * background.js
 * Chrome Extension background service worker.
 */

importScripts("storage.js", "model.js", "holdings.js");

// Captures run one at a time. Each one reads storage fresh, so it does not
// write back a stale copy over a change the popup made earlier, such as an
// owner.
let captureQueue = Promise.resolve();

function enqueueCapture(capture) {
  captureQueue = captureQueue.then(() => new Promise((resolve) => processCapture(capture, resolve)));
}

// Listen for messages from content.js and popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "POINTS_SCRAPED") {
    const data = message.payload;
    console.log("[Points Nest] Received scraped points in background:", data);
    enqueueCapture(data);
    if (sender && sender.tab) {
      const accountKey = getAccountKey(data);
      lastAccountByTab[sender.tab.id] = accountKey;
      if (activeRefresh && sender.tab.id === activeRefresh.tabId) activeRefresh.settle(accountKey);
    }
  } else if (message.type === "GET_TAB_ACCOUNT") {
    sendResponse(lastAccountByTab[message.tabId] || null);
  } else if (message.type === "REFRESH_SITE") {
    runRefresh(message);
  } else if (message.type === "POPUP_OPENED") {
    // Update icon to clear "update" state (with red dot)
    updateIconForActiveTab();
  }
});

/*
 * Refresh: re-reads a list of saved account pages when the user asks from
 * the popup (refresh.js). It walks the user's current tab through the
 * pages one at a time, where the page scraper reads them as on any visit,
 * with a pause between pages, then returns the tab to where it was. A
 * visible tab is used because sites do not finish drawing in a hidden one.
 * Nothing here runs on its own.
 */
const REFRESH_PAUSE_MS = 4000;
// Under the worker's 30-second idle limit, and over the scraper's 20 seconds
const REFRESH_PAGE_TIMEOUT_MS = 25000;
const REFRESH_BOUNCE_GRACE_MS = 5000;
// The walk in progress: { tabId, settle }. One at a time.
let activeRefresh = null;
// The account each tab last showed, by tab ID: how a refresh knows which
// sign-in is in use. Kept in memory only.
const lastAccountByTab = {};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `pages` lists what to read: [{ url, keys }], where `keys` are the
 * accounts saved at that address. Every key together is the sign-in the
 * popup expects.
 */
async function runRefresh({ pages, tabId, returnUrl }) {
  if (activeRefresh || !Array.isArray(pages) || pages.length === 0 || tabId == null) return;
  const urls = pages.map((page) => page.url);
  const keys = pages.flatMap((page) => page.keys);
  const report = (state) =>
    chrome.runtime.sendMessage({ type: "REFRESH_PROGRESS", total: urls.length, ...state }).catch(() => {});
  // Loads an address in the tab as a fresh document. Two addresses that
  // differ only after "#" are one document to the browser, and the site
  // would swap cards in place: a reload rules out reading one card's name
  // beside another card's balance in mid-swap.
  let currentUrl = returnUrl;
  const go = async (url) => {
    const sameDocument = url.split("#")[0] === (currentUrl || "").split("#")[0];
    if (url !== currentUrl) await chrome.tabs.update(tabId, { url });
    if (sameDocument) await chrome.tabs.reload(tabId);
    currentUrl = url;
  };
  let read = 0;
  let stopped = false;
  activeRefresh = { tabId, settle: () => {} };

  try {
    for (let i = 0; i < urls.length; i++) {
      report({ done: i, read, running: true });
      if (i > 0) await sleep(REFRESH_PAUSE_MS);
      // Wait for this page's capture, a bounce away from the site, or the timeout
      const captured = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), REFRESH_PAGE_TIMEOUT_MS);
        activeRefresh.settle = (accountKey) => {
          // A late read of another card of this sign-in is not this page's: keep waiting
          if (accountKey && keys.includes(accountKey) && !pages[i].keys.includes(accountKey)) return;
          clearTimeout(timer);
          resolve(accountKey);
        };
      });
      await go(urls[i]);
      const accountKey = await captured;
      activeRefresh.settle = () => {};
      // A page that shows an account outside the expected sign-in means
      // someone else is signed in: stop, and open nothing more.
      if (accountKey && !keys.includes(accountKey)) {
        stopped = true;
        break;
      }
      if (accountKey) read++;
    }
    if (returnUrl && returnUrl !== currentUrl) await go(returnUrl);
  } catch (error) {
    // The user closed the tab, or the page could not load: stop quietly
    console.log("[Points Nest] Refresh stopped:", error);
  } finally {
    activeRefresh = null;
    report({ done: urls.length, read, running: false, stopped });
  }
}

// A refresh page that lands off the tracked pages, such as a sign-in
// screen for another person's account, is skipped after a short grace.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!activeRefresh || tabId !== activeRefresh.tabId || changeInfo.status !== "complete") return;
  const settle = activeRefresh.settle;
  setTimeout(async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !matchesSiteConfig(tab.url)) settle(null);
  }, REFRESH_BOUNCE_GRACE_MS);
});

// Developer shortcut, unset by default: ask the page for a masked snapshot
// (see snapshot.js). Pages outside the tracked sites have no listener.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "snapshot-page" && tab) {
    chrome.tabs.sendMessage(tab.id, { type: "SNAPSHOT_PAGE" }).catch(() => {});
  }
});

// Listen for URL/navigation changes natively and notify content.js
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    updateIconForActiveTab();
    chrome.tabs
      .sendMessage(tabId, {
        type: "URL_CHANGED",
        url: changeInfo.url,
      })
      .catch(() => {});
  }
});

// Listen for tab activation (switching tabs)
chrome.tabs.onActivated.addListener(() => {
  updateIconForActiveTab();
});

// Listen for window focus changes
chrome.windows.onFocusChanged.addListener(() => {
  updateIconForActiveTab();
});

let scraperConfigs = [];

fetch(chrome.runtime.getURL("site-config.json"))
  .then((res) => res.json())
  .then((data) => {
    scraperConfigs = data;
    updateIconForActiveTab();
  });

function matchesSiteConfig(url) {
  if (!scraperConfigs || !url) return false;
  return scraperConfigs.some((site) => {
    try {
      const patterns = Array.isArray(site.urlRegex) ? site.urlRegex : [site.urlRegex];
      return patterns.some((pattern) => {
        const regex = new RegExp(pattern, "i");
        return regex.test(url);
      });
    } catch (e) {
      return false;
    }
  });
}

function setIconState(state) {
  const details = {
    path: {
      16: `icon16-${state}.png`,
      32: `icon32-${state}.png`,
      48: `icon48-${state}.png`,
      128: `icon128-${state}.png`,
    },
  };
  chrome.action.setIcon(details);
}

function updateIconForActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      if (tabs[0].url && matchesSiteConfig(tabs[0].url)) {
        setIconState("active");
      } else {
        setIconState("inactive");
      }
    }
  });
}

/**
 * Applies one capture to stored state and saves it when something changed.
 * A changed balance also appends to the holding's history.
 */
function processCapture(capture, done) {
  loadState((state) => {
    const result = applyCapture(state, capture, Date.now());
    if (!result.write) return done();
    if (result.balanceChanged) setIconState("update");
    saveState(state, () => {
      console.log("[Points Nest] Capture saved:", result.accountKey);
      if (!result.balanceChanged) return done();
      updatePointsHistory(getEventsKey(result.holdingId), capture, done);
    });
  });
}

console.log("[Points Nest] Background service worker loaded.");
