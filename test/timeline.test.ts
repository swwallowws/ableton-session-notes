// Headless tests for the pure timeline-planning logic in src/timeline.ts.
// Run with: npm test
import * as assert from "node:assert/strict";
import {
  extractLyricLines,
  planLocators,
  planClips,
  MIN_CLIP_BEATS,
} from "../src/timeline.js";

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

console.log("timeline.ts");

test("extractLyricLines keeps singable lines, drops structure", () => {
  const md = "# LYRICS\nWalking in the rain\n- [ ] a todo\n- bullet line\n\n♪\n---\nWith you tonight";
  assert.deepEqual(extractLyricLines(md), [
    "Walking in the rain",
    "a todo",
    "bullet line",
    "With you tonight",
  ]);
});

test("extractLyricLines returns [] for empty / structure-only notes", () => {
  assert.deepEqual(extractLyricLines(""), []);
  assert.deepEqual(extractLyricLines("# TO-DO\n\n♪\n---"), []);
});

test("planLocators spaces one bar apart by default", () => {
  assert.deepEqual(planLocators(["a", "b", "c"]), [
    { time: 0, name: "a" },
    { time: 4, name: "b" },
    { time: 8, name: "c" },
  ]);
});

test("planLocators honours startBeat and spacingBeats", () => {
  assert.deepEqual(planLocators(["a", "b"], { startBeat: 8, spacingBeats: 2 }), [
    { time: 8, name: "a" },
    { time: 10, name: "b" },
  ]);
});

test("planClips tile back-to-back with no gaps", () => {
  const plan = planClips(["aa", "bb", "cc"]);
  for (let i = 1; i < plan.length; i++) {
    assert.equal(
      Number((plan[i].startTime).toFixed(6)),
      Number((plan[i - 1].startTime + plan[i - 1].duration).toFixed(6)),
      "clip " + i + " should start where the previous ends",
    );
  }
  assert.equal(plan[0].startTime, 0);
});

test("planClips widths are proportional to text length", () => {
  // "aaaa" (4 chars) should get twice the width of "aa" (2 chars).
  const plan = planClips(["aaaa", "aa"], { totalBeats: 12 });
  assert.ok(
    Math.abs(plan[0].duration - 2 * plan[1].duration) < 1e-9,
    `expected 2:1 ratio, got ${plan[0].duration}:${plan[1].duration}`,
  );
  // Proportional case fills exactly the requested span.
  const span = plan[0].duration + plan[1].duration;
  assert.ok(Math.abs(span - 12) < 1e-9, `span ${span} should equal 12`);
});

test("planClips never emits a clip shorter than the floor", () => {
  // A tiny span across many lines would push proportional widths below the floor.
  const plan = planClips(["a", "b", "c", "d"], { totalBeats: 0.1 });
  for (const c of plan) assert.ok(c.duration >= MIN_CLIP_BEATS, `duration ${c.duration} < floor`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
