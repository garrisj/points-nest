# Points Nest

A browser extension that tracks points, miles and travel credits for a household. It reads your balances from the account pages you open and keeps them in your browser. It stores no passwords, makes no logins, and sends your data nowhere.

This is a fork of [hzqtc/points-nest](https://github.com/hzqtc/points-nest). It keeps the original's config-driven page reader and adds a household model on top. The site config format stays compatible with the original.

## What it does

- **Reads as you browse.** Sign in to a supported site and open your account page. The extension reads the balance from the page and saves it. It never opens pages by itself.
- **Tracks more than the balance.** Where a page shows them, it also reads expiry dates, flight credits and free night certificates.
- **Knows who owns what.** Each account has an owner. The popup groups accounts by person, or combines each program across the household.
- **Counts shared balances once.** Cards that share one points balance, such as several Amex cards under one person, show as one pool.
- **Keeps history.** Each balance change is recorded, and a chart shows it.
- **Backs up to a file.** Export writes everything to one JSON file. Import restores from it.

## Privacy

- All data lives in `chrome.storage.local`, on this machine, in this browser profile.
- The extension asks for the `storage` permission and for access to the supported sites only.
- The one request it sends to a tracked site is for that site's icon, when the popup opens.
- An export file holds your account numbers and balances. Keep it private.

## Supported sites

| Kind | Sites |
|---|---|
| Banks | Chase (personal and business), American Express, Citi, Capital One |
| Airlines | Alaska, American, Delta, EVA Air, Southwest, United |
| Hotels | Choice, Hilton, Hyatt, IHG, Marriott, Wyndham |

Extras read today: Wyndham and EVA Air points expiry, Southwest flight credits, IHG free night count.

## Install

1. Clone this repository.
2. Open `chrome://extensions` (or `brave://extensions`) and turn on **Developer mode**.
3. Select **Load unpacked** and pick the `extension` folder.
4. Pin Points Nest to the toolbar.

To update: `git pull`, select the reload arrow on the extension's card, then reload any open account tabs.

Keep the folder where it is, and reload the extension to update it. Removing the extension deletes its stored data.

## Use

1. Sign in to a supported site and open your account page. On a bank site, open each card.
2. Wait a few seconds. A red dot on the toolbar icon marks a new or changed balance.
3. Open the popup.

In the popup:

- **PERSON / PROGRAM** switches between accounts grouped by person and programs combined across the household.
- **PTS / USD** switches between points and an estimated dollar value.
- Click a card to see what the account holds, its balance history, and its owner. Bank cards start unassigned: set the owner there.
- A tag on a card flags points that expire, credits or certificates, or a balance not read in five weeks.

## How it is built

```
extension/
  manifest.json      Manifest V3: permissions and the supported sites
  site-config.json   One entry per site: where to read each value
  constants.json     Default value of a point, per program
  content.js         Page side: reads a page using its site config
  fields.js          Page side: extra fields, list rows, and their parsers
  snapshot.js        Developer tool: saves a masked copy of a page
  background.js      Service worker: applies each read to storage
  storage.js         The only file that touches chrome.storage
  model.js           Accounts and balance holdings
  holdings.js        Other holdings: credits, certificates, funds
  owners.js          Owners, pools, household views
  export.js          Backup file: build, check, restore
  import.js          Import window
  popup.html/js      The popup
  chart.js           Balance history chart
  styles.css
tests/               Plain Node tests: sh tests/run.sh
```

### Data model

- An **account** is a membership or card, keyed by provider and account number.
- A **holding** is one thing of value in an account: a points balance, a certificate, a credit, travel funds, or status progress. Every account has one balance holding.
- A balance's changes are kept as **events**.

Stored keys: `schemaVersion`, `accounts`, `holdings`, and one `events:<holdingId>` list per balance.

### Export file

```json
{
  "format": "points-nest-export",
  "version": 2,
  "exportedAt": "...",
  "accounts": [],
  "holdings": [],
  "events": [],
  "raw": {}
}
```

`accounts`, `holdings` and `events` are flat lists for any outside reader. Each account carries its resolved `owner` and a `balanceGroup`: accounts that share a `balanceGroup` share one balance, so count it once. `raw` is storage as-is, and is the only part an import reads.

## Adding a site

A site is one entry in `extension/site-config.json`, plus its address in the three site lists in `manifest.json`.

```json
{
  "siteName": "Example Air",
  "category": "Airline",
  "icon": "https://www.example.com/favicon.ico",
  "urlRegex": "https://www\\.example\\.com/account",
  "selectors": {
    "accountName": ".member-name",
    "accountId": ".member-number",
    "programName": ".tier-name",
    "rewardsValue": ".miles-balance"
  },
  "normalizations": {
    "accountId": { "pattern": "^Member #", "replace": "" }
  }
}
```

- **`category`**: `Bank`, `Airline` or `Hotel`.
- **`urlRegex`**: the page, or pages, to read. A string or a list.
- **`selectors`**: CSS selectors for the four values. A selector may be a list, tried in order. Append `::attr(name)` to read an attribute instead of the text.
- **`programName`**: for a bank, the points currency ("Ultimate Rewards"). For an airline or hotel, the status tier.
- **`normalizations`**: optional cleanup per value. `pattern` and `replace` run a regex replace; `transform` is `titlecase`, `uppercase` or `lowercase`. Use one on `rewardsValue` when the balance shares an element with other text.

### Optional extras

```json
"fields": {
  "balance.expiresOn": { "selector": ".expiry", "pattern": "on (\\S+)$", "parse": "date" },
  "balance.expiringAmount": { "selector": ".expiry", "pattern": "^([\\d,]+)", "parse": "number" }
},
"lists": [
  {
    "type": "funds",
    "row": ".credit-row",
    "label": "Flight Credit",
    "amount": { "selector": ".amount", "parse": "money" },
    "expiresOn": { "selector": ".expires", "parse": "date" },
    "id": { "selector": ".code", "parse": "text" }
  }
]
```

- **`fields`** adds an expiry date and amount to the balance.
- **`lists`** turns each matching row into a holding of `type` `certificate`, `credit`, `funds` or `status`. Rules inside a list read relative to the row. `skipZero` leaves out rows with an amount of 0.
- A rule is `{ selector, pattern, parse }`. `pattern` keeps its first capture group. `parse` is `text`, `number`, `money`, `date` or `monthEnd`. A parser refuses text it cannot read, so a wrong match saves nothing.
- **`pooled: true`** marks a site whose cards share one balance per person.
- **`businessUrlRegex`** marks the pages of business cards, where a site tells them apart by address.

### Working from a snapshot

A snapshot is a masked copy of a page, for writing a config without sharing your data.

1. Add the site's address to `manifest.json` and reload the extension.
2. At `chrome://extensions/shortcuts`, set a key for "Developer: save a masked snapshot of this page".
3. Open the account page and press the key. A file named `points-nest-snapshot-...html` downloads.
4. Write the config, then run `node tests/try-snapshot.js <snapshot file> "<siteName>"` to see what the reader captures from it. This needs Chrome.

A snapshot drops scripts, styles, form values and link targets, and turns every digit into 1. Names and other words stay, so read a snapshot before you share it. Keep snapshots out of the repository.

### When a page does not read

Open the page's console and filter on `[Points Nest]`. The lines name the selector that failed or the value that was refused.

## License

The original project has no license file at the time of writing, and a request for one is open with its author. This fork adds none of its own until that is settled, so no license covers this code yet.
