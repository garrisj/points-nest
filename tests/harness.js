/**
 * Test harness: a fake chrome.storage area, and the extension's script
 * files loaded the way the browser loads them, as shared globals.
 */
const path = require("path");

function createStorage(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  const listeners = [];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const emit = (changes) => listeners.forEach((listener) => listener(changes, "local"));
  const area = {
    get(keys, callback) {
      const wanted = keys === null ? Object.keys(data) : [].concat(keys);
      callback(clone(Object.fromEntries(wanted.filter((k) => k in data).map((k) => [k, data[k]]))));
    },
    set(items, callback) {
      const changes = {};
      Object.entries(clone(items)).forEach(([key, value]) => {
        changes[key] = { oldValue: data[key], newValue: value };
        data[key] = value;
      });
      area.writes += 1;
      if (callback) callback();
      emit(changes);
    },
    remove(keys, callback) {
      [].concat(keys).forEach((key) => delete data[key]);
      if (callback) callback();
    },
    clear(callback) {
      Object.keys(data).forEach((key) => delete data[key]);
      if (callback) callback();
    },
    writes: 0,
  };
  return { area, data, listeners };
}

/**
 * Installs a fake chrome with the given stored data and loads the named
 * extension files into the global scope. Returns the fake storage.
 */
function load(files, initial) {
  const storage = createStorage(initial);
  global.chrome = {
    storage: { local: storage.area, sync: storage.area, onChanged: { addListener: (f) => storage.listeners.push(f) } },
  };
  files.forEach((file) => {
    const full = path.join(__dirname, "..", "extension", file);
    delete require.cache[require.resolve(full)];
    Object.assign(global, require(full));
  });
  return storage;
}

module.exports = { load, createStorage };
