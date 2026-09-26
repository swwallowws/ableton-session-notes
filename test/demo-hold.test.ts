// Headless tests for the web demo's press-and-hold pacing (demo/hold.ts).
// Run with: npm test
import * as assert from "node:assert/strict";
import { HOLD, holdPace, stepValue } from "../demo/hold.js";

let passed = 0;
const failures: string[] = [];
const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}`);
    console.log(`    ${(e as Error).message}`);
  }
};

const rate = (ms: number) => 1000 / holdPace(ms).intervalMs;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

console.log("demo/hold.ts");

test("starts at the slow rate, one step at a time", () => {
  assert.ok(close(rate(0), HOLD.minRate));
  assert.equal(holdPace(0).step, 1);
});

test("the start is gentle: the first 300 ms stay close to the slow rate", () => {
  assert.ok(rate(300) < HOLD.minRate + 2, `rate at 300 ms was ${rate(300)}`);
});

test("speeds up monotonically across the ramp", () => {
  let prev = 0;
  for (let ms = 0; ms <= HOLD.rampMs; ms += 50) {
    const r = rate(ms);
    assert.ok(r >= prev, `rate dropped at ${ms} ms`);
    prev = r;
  }
});

test("settles into the cap: the last stretch of the ramp barely changes", () => {
  assert.ok(HOLD.maxRate - rate(HOLD.rampMs - 200) < 1.5);
});

test("caps at the top rate after the ramp", () => {
  assert.ok(close(rate(HOLD.rampMs), HOLD.maxRate));
  assert.ok(close(rate(HOLD.rampMs + HOLD.coarseAfterMs - 1), HOLD.maxRate));
});

test("switches to coarse steps after a while at the cap", () => {
  const p = holdPace(HOLD.rampMs + HOLD.coarseAfterMs);
  assert.equal(p.step, HOLD.coarseStep);
  assert.ok(close(1000 / p.intervalMs, HOLD.coarseRate));
});

test("stepValue: single steps move by one", () => {
  assert.equal(stepValue(123, 1, 1), 124);
  assert.equal(stepValue(123, -1, 1), 122);
});

test("stepValue: coarse steps snap to multiples", () => {
  assert.equal(stepValue(123, 1, 5), 125);
  assert.equal(stepValue(125, 1, 5), 130);
  assert.equal(stepValue(123, -1, 5), 120);
  assert.equal(stepValue(120, -1, 5), 115);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
