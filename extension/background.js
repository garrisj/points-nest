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
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "POINTS_SCRAPED") {
    const data = message.payload;
    console.log("[Points Nest] Received scraped points in background:", data);
    enqueueCapture(data);
    if (activeRefresh && sender.tab && sender.tab.id === activeRefresh.tabId) activeRefresh.settle(true);
  } else if (message.type === "REFRESH_SITE") {
    runRefresh(message.urls);
  } else if (message.type === "POPUP_OPENED") {
    // Update icon to clear "update" state (with red dot)
    updateIconForActiveTab();
  }
});

/*
 * Refresh: re-reads a list of saved account pages when the user asks from
 * the popup (refresh.js). The pages load one at a time in one background
 * tab, where the page scraper reads them as on any visit, with a pause
 * between pages. The tab closes at the end. Nothing here runs on its own.
 */
const REFRESH_PAUSE_MS = 4000;
// Under the worker's 30-second idle limit, and over the scraper's 20 seconds
const REFRESH_PAGE_TIMEOUT_MS = 25000;
const REFRESH_BOUNCE_GRACE_MS = 5000;
// The walk in progress: { tabId, settle }. One at a time.
let activeRefresh = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runRefresh(urls) {
  if (activeRefresh || !Array.isArray(urls) || urls.length === 0) return;
  const report = (state) =>
    chrome.runtime.sendMessage({ type: "REFRESH_PROGRESS", total: urls.length, ...state }).catch(() => {});
  let read = 0;
  const tab = await chrome.tabs.create({ url: urls[0], active: false });
  activeRefresh = { tabId: tab.id, settle: () => {} };

  try {
    for (let i = 0; i < urls.length; i++) {
      report({ done: i, read, running: true });
      if (i > 0) {
        await sleep(REFRESH_PAUSE_MS);
        await chrome.tabs.update(tab.id, { url: urls[i] });
      }
      // Wait for this page's capture, a bounce away from the site, or the timeout
      const captured = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), REFRESH_PAGE_TIMEOUT_MS);
        activeRefresh.settle = (result) => {
          clearTimeout(timer);
          resolve(result);
        };
      });
      activeRefresh.settle = () => {};
      if (captured) read++;
    }
  } catch (error) {
    // The user closed the tab, or the page could not load: stop quietly
    console.log("[Points Nest] Refresh stopped:", error);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
    activeRefresh = null;
    report({ done: urls.length, read, running: false });
  }
}

// A refresh page that lands off the tracked pages, such as a sign-in
// screen for another person's account, is skipped after a short grace.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!activeRefresh || tabId !== activeRefresh.tabId || changeInfo.status !== "complete") return;
  const settle = activeRefresh.settle;
  setTimeout(async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !matchesSiteConfig(tab.url)) settle(false);
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
