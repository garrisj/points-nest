/**
 * refresh.js
 * The popup's refresh bar. When the current tab is on a tracked site, it
 * offers to re-read that site's saved account pages for the sign-in in
 * use. It works out that sign-in from the account the tab shows and never
 * asks. Where a site keeps business cards under their own sign-in (config
 * `businessUrlRegex`), a person's business cards form their own group. The
 * background worker does the reading (see "Refresh" in background.js);
 * nothing here runs unless the user clicks.
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
 * The saved pages on a host, grouped by sign-in: one group per person, and
 * a person's business cards apart where the site says so. Each group lists
 * its pages as { url, keys }: an address and the accounts saved there.
 * `rows` are the popup's rows from owners.js `poolAccounts`.
 */
function getSignInGroups(rows, host, configs) {
  const groups = {};
  rows.forEach((row) => {
    row.members.forEach((member) => {
      if (!host || getHost(member.scrapedUrl) !== host) return;
      const site = configs.find((config) => config.siteName === member.provider);
      const business = site && site.businessUrlRegex && new RegExp(site.businessUrlRegex).test(member.scrapedUrl);
      const name = business ? `${row.owner} business` : row.owner;
      const group = (groups[name] = groups[name] || { name, pages: [] });
      let page = group.pages.find((p) => p.url === member.scrapedUrl);
      if (!page) group.pages.push((page = { url: member.scrapedUrl, keys: [] }));
      page.keys.push(member.accountKey);
    });
  });
  return Object.values(groups);
}

/**
 * Picks the one group a refresh may read, or null when it cannot tell.
 * The user is never asked who is signed in.
 *
 * - A site with one address for everyone (most airlines and hotels): the
 *   page itself says whose account it is, so that address is the target.
 * - A site with a page per card: the group of the account this tab is
 *   showing, or last showed. `tabAccountKey` is that account's key.
 */
function pickRefreshTarget(groups, tabAccountKey) {
  if (groups.length === 0) return null;
  const allPages = groups.flatMap((group) => group.pages);
  const urls = [...new Set(allPages.map((page) => page.url))];
  if (urls.length === 1) {
    return { name: "this account", pages: [{ url: urls[0], keys: allPages.flatMap((page) => page.keys) }] };
  }
  return groups.find((group) => group.pages.some((page) => page.keys.includes(tabAccountKey))) || null;
}

/**
 * Shows the refresh button when the current tab is on a tracked site and
 * the signed-in account is known, a hint when it is not known, and nothing
 * on any other site.
 */
function renderRefreshBar(rows, configs) {
  const bar = document.getElementById("refresh-bar");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    const host = getHost(tab && tab.url);
    const groups = getSignInGroups(rows, host, configs);
    bar.hidden = groups.length === 0;
    if (bar.hidden) return;

    // The account this tab shows: the worker's record of its last capture
    // here, else an exact match of the tab's address to a saved page
    chrome.runtime.sendMessage({ type: "GET_TAB_ACCOUNT", tabId: tab.id }, (reply) => {
      void chrome.runtime.lastError;
      const lastKey = reply && reply.accountKey;
      // A popup opened in mid-run picks up the run's progress
      if (reply && reply.progress && reply.progress.running) refreshProgress = reply.progress;
      const onPage = rows.flatMap((row) => row.members).find((member) => member.scrapedUrl === tab.url);
      const target = pickRefreshTarget(groups, lastKey || (onPage && onPage.accountKey));

      const status = document.createElement("span");
      status.id = "refresh-status";
      status.className = "refresh-label";
      if (!target) {
        status.textContent = "Open one of your account pages on this site, then the rest can be re-read from here.";
        bar.replaceChildren(status);
        return;
      }
      const count = target.pages.length;
      const button = document.createElement("button");
      button.className = "export-btn";
      button.textContent = `Re-read ${count === 1 ? "the saved page" : `${count} saved pages`} for ${target.name}`;
      button.title = "Walk this tab through each saved page, one at a time, then return here";
      button.onclick = () =>
        chrome.runtime.sendMessage({
          type: "REFRESH_SITE",
          pages: target.pages,
          tabId: tab.id,
          returnUrl: tab.url,
        });
      bar.replaceChildren(button, status);
      showRefreshProgress();
    });
  });
}

// The worker's latest progress message, kept so a redraw of the bar keeps it
let refreshProgress = null;

function showRefreshProgress() {
  const status = document.getElementById("refresh-status");
  if (!status || !refreshProgress) return;
  const { running, done, read, total } = refreshProgress;
  document.querySelectorAll("#refresh-bar button").forEach((button) => (button.disabled = running));
  status.textContent = running
    ? `Reading page ${done + 1} of ${total}…`
    : refreshProgress.stopped
      ? "Stopped: this sign-in shows a different account. Nothing else was opened."
      : `Read ${read} of ${total} pages.`;
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
  module.exports = { getHost, getSignInGroups, pickRefreshTarget };
}
