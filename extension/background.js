/**
 * background.js
 * Chrome Extension background service worker.
 */

importScripts("storage.js", "model.js", "holdings.js", "migrate.js");

// Captures run one at a time, after any pending storage migration. Each one
// reads storage fresh, so it does not write back a stale copy over a change
// the popup made earlier, such as an owner.
let captureQueue = new Promise((resolve) => ensureMigrated(resolve));

function enqueueCapture(capture) {
  captureQueue = captureQueue.then(() => new Promise((resolve) => processCapture(capture, resolve)));
}

// Listen for messages from content.js and popup.js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "POINTS_SCRAPED") {
    const data = message.payload;
    console.log("[Points Nest] Received scraped points in background:", data);
    enqueueCapture(data);
  } else if (message.type === "POPUP_OPENED") {
    // Update icon to clear "update" state (with red dot)
    updateIconForActiveTab();
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
