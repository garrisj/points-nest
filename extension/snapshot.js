/**
 * snapshot.js
 * Developer tool, not a user feature. Saves a masked copy of the current
 * page as one HTML file, for writing and testing site configs offline.
 *
 * It has no button. It runs only from a keyboard shortcut that is unset by
 * default: assign one to "Developer: save a masked snapshot" on the
 * browser's extension shortcuts page.
 *
 * The copy keeps the page's structure and drops what a config never needs:
 * scripts, styles, frames, comments, form values and link targets. Every
 * digit becomes 1, except a year from 2000 to 2099, so dates still read as
 * dates. Names and other words stay as they are.
 */

const SNAPSHOT_DROP = "script, style, link, meta, noscript, iframe, object, embed, template, svg > *";
// Attributes that selectors match on. All other attribute values are masked.
const SNAPSHOT_KEEP = /^(class|role|type|rel|data-(testid|test|test-id|locator|qa|cy))$/;
// Attributes that can hold addresses, tokens or typed values
const SNAPSHOT_STRIP = /^(href|src|srcset|action|value|style|content|nonce|integrity|on.*)$/;

/**
 * Masks the digits in a string: "76,869 points by 05/31/2027" becomes
 * "11,111 points by 11/11/2027".
 */
function maskDigits(text) {
  return text.replace(/\d+/g, (run) => (/^20\d\d$/.test(run) ? run : "1".repeat(run.length)));
}

/**
 * Returns the masked HTML of a document. Works on a copy; the page is not
 * changed.
 */
function buildSnapshot(doc, url, takenAt) {
  const root = doc.documentElement.cloneNode(true);
  root.querySelectorAll(SNAPSHOT_DROP).forEach((el) => el.remove());

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ALL);
  const comments = [];
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === Node.COMMENT_NODE) {
      comments.push(node);
    } else if (node.nodeType === Node.TEXT_NODE) {
      node.textContent = maskDigits(node.textContent);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      [...node.attributes].forEach((attr) => {
        if (SNAPSHOT_STRIP.test(attr.name)) node.removeAttribute(attr.name);
        else if (!SNAPSHOT_KEEP.test(attr.name)) node.setAttribute(attr.name, maskDigits(attr.value));
      });
    }
  }
  comments.forEach((comment) => comment.remove());

  // The address without its query, which can hold account keys
  const page = maskDigits(url.split(/[?#]/)[0]);
  return `<!DOCTYPE html>\n<!-- Points Nest snapshot | ${page} | ${takenAt} -->\n${root.outerHTML}\n`;
}

/**
 * Downloads the snapshot as points-nest-snapshot-<host>-<time>.html.
 */
function saveSnapshot() {
  const now = new Date();
  const html = buildSnapshot(document, window.location.href, now.toISOString());
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const stamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, "");

  const link = document.createElement("a");
  link.href = url;
  link.download = `points-nest-snapshot-${window.location.hostname}-${stamp}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  console.log(`[Points Nest] Saved a masked snapshot of this page (${html.length} characters).`);
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "SNAPSHOT_PAGE") saveSnapshot();
  });
}

// Export for Node.js / testing environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = { maskDigits, buildSnapshot };
}
