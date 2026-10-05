// Headless test for the guided try page's pure helpers (demo/try/steps.ts,
// plus the seconds label from demo/view.ts). Run with: npm test
import assert from "node:assert/strict";
import { VERSE, activeTag, stepFor } from "../demo/try/steps.js";
import { secondsLabel } from "../demo/view.js";

// The verse is short: every line two to five words, so a flag or clip at one
// bar per line can still show it.
const verseLines = VERSE.trim().split("\n");
assert.ok(verseLines.length >= 3 && verseLines.length <= 4, "three or four lines");
for (const l of verseLines) {
  const words = l.trim().split(/\s+/).length;
  assert.ok(words >= 2 && words <= 5, `"${l}" has two to five words`);
}

const V = "low sun, high tide\nswallow whole the off-key hums";
assert.equal(stepFor(V, "locators", new Set()), null);
assert.equal(stepFor("[9] " + V, "locators", new Set()), "tag");
assert.equal(stepFor("[9]" + V, "locators", new Set()), "tag");
assert.equal(stepFor("[17] " + V, "locators", new Set()), null); // only [9] counts for step one
assert.equal(stepFor("[0:08] " + V, "locators", new Set()), null); // step one wants a bar
assert.equal(stepFor("[0:08] " + V, "locators", new Set(["tag"])), "time");
assert.equal(stepFor("[0:8] " + V, "locators", new Set(["tag"])), "time");
assert.equal(stepFor("[8] " + V, "locators", new Set(["tag"])), null); // bar 8 is not 8 seconds
assert.equal(stepFor("[1:04] " + V, "locators", new Set(["tag"])), null);
assert.equal(stepFor("[0:08] " + V, "clips", new Set(["tag", "time"])), "mode");

// Which scale the first line's tag reads from, and where it lands (beats).
assert.deepEqual(activeTag("[9] " + V, 120), { scale: "bars", beat: 32 });
assert.deepEqual(activeTag("[0:08] " + V, 120), { scale: "seconds", beat: 16 });
assert.equal(activeTag(V, 120), null);
assert.equal(activeTag("[verse] " + V, 120), null);

// Seconds row labels read like a clock tag, so [0:08] sits under "0:08".
assert.equal(secondsLabel(0, 120), "0:00");
assert.equal(secondsLabel(16, 120), "0:08");
assert.equal(secondsLabel(32, 120), "0:16");
assert.equal(secondsLabel(120, 120), "1:00");

console.log("demo-try ok");
