/**
 * refresh.js
 * The popup's refresh bar. When the current tab is on a tracked site, it
 * offers to re-read that site's saved account pages for one person: the
 * one signed in. The background worker does the reading (see "Refresh" in
 * background.js); nothing here runs unless the user clicks.
 */

/**
 * Host name of an address, or "" when it has none or cannot be read.
 */
function getHost(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return "";
  }
}

/**
 * The saved pages on a host, grouped by owner: { owner: [url, ...] }.
 * `rows` are the popup's rows from owners.js `poolAccounts`.
 */
function getPagesByOwner(rows, host) {
  const pages = {};
  rows.forEach((row) => {
    row.members.forEach((member) => {
      if (!host || getHost(member.scrapedUrl) !== host) return;
      const urls = (pages[row.owner] = pages[row.owner] || []);
      if (!urls.includes(member.scrapedUrl)) urls.push(member.scrapedUrl);
    });
  });
  return pages;
}

/**
 * Shows one button per person with saved pages on the current tab's site,
 * or hides the bar when the tab is on no tracked site.
 */
function renderRefreshBar(rows) {
  const bar = document.getElementById("refresh-bar");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const host = getHost(tabs && tabs[0] && tabs[0].url);
    const pages = getPagesByOwner(rows, host);
    const owners = Object.keys(pages).sort();
    bar.hidden = owners.length === 0;
    if (bar.hidden) return;

    const label = document.createElement("span");
    label.className = "refresh-label";
    label.textContent = `Signed in on ${host.replace(/^www\./, "")}? Re-read the pages of`;
    const buttons = owners.map((owner) => {
      const button = document.createElement("button");
      button.className = "export-btn";
      button.textContent = `${owner} (${pages[owner].length})`;
      button.title = `Open each of ${owner}'s saved pages on this site in a background tab, one at a time`;
      button.onclick = () => chrome.runtime.sendMessage({ type: "REFRESH_SITE", urls: pages[owner] });
      return button;
    });
    const status = document.createElement("span");
    status.id = "refresh-status";
    status.className = "refresh-label";
    bar.replaceChildren(label, ...buttons, status);
    showRefreshProgress();
  });
}

// The worker's latest progress message, kept so a redraw of the bar keeps it
let refreshProgress = null;

function showRefreshProgress() {
  const status = document.getElementById("refresh-status");
  if (!status || !refreshProgress) return;
  const { running, done, read, total } = refreshProgress;
  document.querySelectorAll("#refresh-bar button").forEach((button) => (button.disabled = running));
  status.textContent = running ? `Reading page ${done + 1} of ${total}…` : `Read ${read} of ${total} pages.`;
}

/**
 * Shows the worker's progress in the bar as it reports it.
 */
function setupRefreshProgress() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "REFRESH_PROGRESS") return;
    refreshProgress = message;
    showRefreshProgress();
  });
}

// Export for Node.js / testing environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getHost, getPagesByOwner };
}
