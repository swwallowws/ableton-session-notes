// Headless tests for the follow-playback core in src/follow.ts. This is the part
// of the (SDK-blocked) karaoke mode that can be verified today.
// Run with: npm test
import * as assert from "node:assert/strict";
import { buildSchedule, activeLineAt } from "../src/follow.js";

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

console.log("follow.ts");

test("buildSchedule places lines one bar apart by default", () => {
  assert.deepEqual(buildSchedule(["a", "b", "c"]), [
    { beat: 0, name: "a" },
    { beat: 4, name: "b" },
    { beat: 8, name: "c" },
  ]);
});

test("buildSchedule honours startBeat and spacingBeats", () => {
  assert.deepEqual(buildSchedule(["a", "b"], { startBeat: 2, spacingBeats: 8 }), [
    { beat: 2, name: "a" },
    { beat: 10, name: "b" },
  ]);
});

const sched = buildSchedule(["a", "b", "c"]); // beats 0, 4, 8

test("activeLineAt returns -1 before the first line", () => {
  assert.equal(activeLineAt(sched, -1), -1);
});

test("activeLineAt lands on the current line at and after its beat", () => {
  assert.equal(activeLineAt(sched, 0), 0);
  assert.equal(activeLineAt(sched, 3.9), 0);
  assert.equal(activeLineAt(sched, 4), 1);
  assert.equal(activeLineAt(sched, 7), 1);
  assert.equal(activeLineAt(sched, 8), 2);
  assert.equal(activeLineAt(sched, 999), 2);
});

test("activeLineAt on an empty schedule is -1", () => {
  assert.equal(activeLineAt([], 5), -1);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
