/**
 * storage.js
 * The storage interface for Points Nest, plus the balance history helpers.
 * Shared between background service worker and popup dashboard.
 *
 * Every other file reads and writes through `store` (get, set, remove,
 * clear) and listens through `onStoreChanged`. No other file touches
 * chrome.storage, so the engine behind this file can change.
 */

const MAX_HISTORY_ENTRIES = 100;

/**
 * Storage area for all extension data: "sync" follows the browser account
 * across devices, "local" stays on this machine.
 */
const STORAGE_AREA = "local";
const store = chrome.storage[STORAGE_AREA];

/**
 * Calls the listener with the changes whenever stored data changes.
 */
function onStoreChanged(listener) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === STORAGE_AREA) listener(changes);
  });
}

/**
 * Encodes timestamp and points into a Base-36 compressed entry.
 */
/**
 * Calls back with the bytes the extension's storage uses.
 */
function getStorageBytes(callback) {
  store.getBytesInUse(null, callback);
}

function encodeHistoryEntry(timestamp, points) {
  const epochSec = Math.floor(new Date(timestamp).getTime() / 1000);
  return {
    t: epochSec.toString(36),
    p: Number(points).toString(36),
  };
}

/**
 * Decodes a Base-36 entry back into standard epoch ms timestamp and number points.
 */
function decodeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  let timestamp = 0;
  let points = 0;

  if (entry.t !== undefined) {
    timestamp = parseInt(entry.t, 36) * 1000;
  } else if (entry.timestamp) {
    timestamp = new Date(entry.timestamp).getTime();
  }

  if (entry.p !== undefined) {
    points = parseInt(entry.p, 36);
  } else if (entry.points !== undefined) {
    points = Number(entry.points);
  }

  if (!timestamp || isNaN(points)) return null;

  return { timestamp, points };
}

/**
 * Parses and sorts an array of raw storage history entries ascending by timestamp.
 */
function parseHistoryEntries(rawHistory) {
  if (!Array.isArray(rawHistory)) return [];

  const points = [];
  rawHistory.forEach((entry) => {
    const decoded = decodeHistoryEntry(entry);
    if (decoded) {
      points.push(decoded);
    }
  });

  points.sort((a, b) => a.timestamp - b.timestamp);
  return points;
}

/**
 * Fetches the points history stored under `key`, synthesizes a starting
 * entry from `account` if empty, and anchors the latest check timestamp.
 */
function getAccountHistory(key, account, callback) {
  store.get([key], (result) => {
    const rawHistory = result[key] || [];
    const historyPoints = parseHistoryEntries(rawHistory);

    // If history is empty, synthesize a starting entry from current state
    if (historyPoints.length === 0) {
      historyPoints.push({
        timestamp: new Date(account.lastUpdated || Date.now()).getTime(),
        points: account.points,
      });
    }

    // Anchor latest check timestamp if newer than last recorded history entry
    const lastPoint = historyPoints[historyPoints.length - 1];
    const currentUpdatedMs = new Date(account.lastUpdated || Date.now()).getTime();
    if (currentUpdatedMs > lastPoint.timestamp) {
      historyPoints.push({
        timestamp: currentUpdatedMs,
        points: account.points,
      });
    } else if (lastPoint.points !== account.points) {
      historyPoints.push({
        timestamp: Math.max(currentUpdatedMs, lastPoint.timestamp + 1000),
        points: account.points,
      });
    }

    if (callback) {
      callback(historyPoints);
    }
  });
}

/**
 * Appends a new balance entry to the history stored under `key` if the
 * points balance has changed.
 */
function updatePointsHistory(key, data, callback) {
  store.get([key], (result) => {
    const history = result[key] || [];

    // Avoid duplicate entry if latest recorded entry already has the same balance
    if (history.length > 0) {
      const lastEntry = history[history.length - 1];
      const decoded = decodeHistoryEntry(lastEntry);
      if (decoded && decoded.points === data.points) {
        if (callback) callback(history);
        return;
      }
    }

    // Convert current state to Base-36 compressed entry
    const newEntry = encodeHistoryEntry(data.lastUpdated, data.points);
    history.push(newEntry);

    // Cap at MAX_HISTORY_ENTRIES
    if (history.length > MAX_HISTORY_ENTRIES) {
      history.shift();
    }

    store.set({ [key]: history }, () => {
      console.log(`[Points Nest] History updated for key ${key}. Length: ${history.length}`);
      if (callback) callback(history);
    });
  });
}

// Export for Node.js / testing environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    store,
    onStoreChanged,
    encodeHistoryEntry,
    decodeHistoryEntry,
    parseHistoryEntries,
    getAccountHistory,
    updatePointsHistory,
    MAX_HISTORY_ENTRIES,
    STORAGE_AREA,
    getStorageBytes,
  };
}
