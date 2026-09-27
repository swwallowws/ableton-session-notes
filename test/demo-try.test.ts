// Headless test for the guided try page's pure step-detection helper
// (demo/try/steps.ts). Run with: npm test
import assert from "node:assert/strict";
import { stepFor } from "../demo/try/steps.js";

const V = "Salt on the window\nI hum the chorus";
assert.equal(stepFor(V, "locators", new Set()), null);
assert.equal(stepFor("[17] " + V, "locators", new Set()), "tag");
assert.equal(stepFor("[17]" + V, "locators", new Set()), "tag");
assert.equal(stepFor("[1:04] " + V, "locators", new Set(["tag"])), "time");
assert.equal(stepFor("[1:04] " + V, "clips", new Set(["tag", "time"])), "mode");
assert.equal(stepFor("[18] " + V, "locators", new Set()), null); // only [17] counts for step one
console.log("demo-try ok");
