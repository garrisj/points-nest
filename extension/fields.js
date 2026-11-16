/**
 * fields.js
 * Optional extra values read beside the balance, such as its expiry date.
 * A site config lists them under `fields`:
 *
 *   "fields": {
 *     "balance.expiresOn": { "selector": "...", "pattern": "on (\\S+)", "parse": "date" }
 *   }
 *
 * `selector` takes the same forms as the main selectors. `pattern` is
 * optional and keeps its first capture group. `parse` names a parser below.
 * Each parser returns null for text it cannot read, so a wrong match saves
 * nothing instead of a wrong value.
 */

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Builds a YYYY-MM-DD date, or null if the parts do not form a real date.
 */
function toIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real && year >= 2000 ? date.toISOString().slice(0, 10) : null;
}

const PARSERS = {
  text: (text) => text || null,

  // A whole number, with optional thousands commas: "12,500"
  number: (text) => (/^\d{1,3}(,\d{3})*$|^\d+$/.test(text) ? parseInt(text.replace(/,/g, ""), 10) : null),

  // A dollar amount: "$239.40", "1,200", "239.40 USD"
  money: (text) => {
    const match = text.match(/^\$?\s*(\d{1,3}(?:,\d{3})*|\d+)(\.\d{1,2})?(?:\s*USD)?$/i);
    return match ? parseFloat(match[1].replace(/,/g, "") + (match[2] || "")) : null;
  },

  // "2027-05-01", "5/1/2027" (month first), "May 1, 2027", "1 May 2027"
  date: (text) => {
    let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return toIsoDate(+m[1], +m[2], +m[3]);
    m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return toIsoDate(+m[3], +m[1], +m[2]);
    // A month name or its short form: "May", "Sep", "Sept", "September"
    const monthOf = (name) => MONTHS.findIndex((month) => month.startsWith(name.toLowerCase())) + 1;
    m = text.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
    if (m && monthOf(m[1])) return toIsoDate(+m[3], monthOf(m[1]), +m[2]);
    m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
    if (m && monthOf(m[2])) return toIsoDate(+m[3], monthOf(m[2]), +m[1]);
    return null;
  },
};

/**
 * Applies one field rule to the text found on the page. Returns the parsed
 * value, or null when the text is missing or does not fit.
 */
function parseField(text, rule) {
  if (!text || !PARSERS[rule.parse]) return null;
  let value = text.replace(/\s+/g, " ").trim();
  if (rule.pattern) {
    const match = value.match(new RegExp(rule.pattern, "i"));
    if (!match || match[1] === undefined) return null;
    value = match[1].trim();
  }
  return PARSERS[rule.parse](value);
}

/**
 * Reads every field a config declares. `getText` finds a selector's text.
 * A declared field the page does not show comes back as null, so a value
 * that has left the page also leaves storage.
 */
function readFields(fieldRules, getText) {
  const fields = {};
  Object.entries(fieldRules || {}).forEach(([name, rule]) => {
    fields[name] = parseField(getText(rule.selector), rule);
  });
  return fields;
}

/**
 * Reads the rows a config declares under `lists`. Each list names a holding
 * type, a `row` selector, and rules read inside each row:
 *
 *   "lists": [{
 *     "type": "funds",
 *     "row": ".fund-row",
 *     "label": "Travel Funds",
 *     "amount": { "selector": ".amount", "parse": "money" },
 *     "expiresOn": { "selector": ".expiry", "parse": "date" }
 *   }]
 *
 * `label` is fixed text or a rule. `amount` is required. `expiresOn`,
 * `total` and `id` are optional rules, and `unit` is optional text. A rule
 * with no selector reads the row's own text.
 *
 * `getRows` finds the row elements; `getText` finds a selector's text inside
 * a row. Returns { type: [items] }. A list with a row it cannot read is
 * left out whole, so its stored holdings stay as they are.
 */
function readLists(listRules, getRows, getText) {
  const lists = {};
  const failed = new Set();

  (listRules || []).forEach((list) => {
    const read = (row, rule) => parseField(getText(rule.selector, row), rule);
    const items = getRows(list.row).map((row) => {
      const item = {
        label: typeof list.label === "string" ? list.label : read(row, { parse: "text", ...list.label }),
        amount: read(row, list.amount),
        unit: list.unit,
      };
      ["expiresOn", "total", "id"].forEach((name) => {
        if (list[name]) item[name] = read(row, list[name]);
      });
      // An optional rule that is declared must still read, except expiry
      const complete = item.label && item.amount != null && (!list.id || item.id) && (!list.total || item.total != null);
      return complete ? item : null;
    });

    if (items.includes(null)) failed.add(list.type);
    lists[list.type] = (lists[list.type] || []).concat(items);
  });

  failed.forEach((type) => {
    console.warn(`[Points Nest] A "${type}" row did not read cleanly; that list was skipped.`);
    delete lists[type];
  });
  return lists;
}

// Export for Node.js / testing environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseField, readFields, readLists };
}
