// Snapshot masking (the page copy itself is checked in a browser).
const assert = require("assert");
const { maskDigits } = require("../extension/snapshot.js");
assert.strictEqual(maskDigits("76,869 Points"), "11,111 Points");
assert.strictEqual(maskDigits("15,000 expire on 05/31/2027."), "11,111 expire on 11/11/2027.");
assert.strictEqual(maskDigits("May 31, 2027 · RR# 633283560 · 9E47UK4"), "May 11, 2027 · RR# 111111111 · 1E11UK1");
assert.strictEqual(maskDigits("card 20271 and 12027"), "card 11111 and 11111");
console.log("ok snapshot");
