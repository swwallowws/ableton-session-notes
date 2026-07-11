// Headless tests for the pure timeline-planning logic in src/timeline.ts.
// Run with: npm test
import * as assert from "node:assert/strict";
import {
  extractLyricLines,
  planLocators,
  planClips,
  MIN_CLIP_BEATS,
  parseTimingTag,
  hasTimingTags,
  resolveTimeline,
  buildLocators,
  buildClips,
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

// ---- inline timing tags ----

test("parseTimingTag: musical [bar], [bar.beat], [bar.beat.16th] at 4/4", () => {
  assert.deepEqual(parseTimingTag("[17] chorus"), { beat: 64, name: "chorus" }); // (17-1)*4
  assert.deepEqual(parseTimingTag("[9.3] line"), { beat: 34, name: "line" }); // 32 + 2
  assert.deepEqual(parseTimingTag("[1.1.3] hey"), { beat: 0.5, name: "hey" }); // (3-1)/4
});

test("parseTimingTag: clock [m:ss] converts via bpm", () => {
  // 120 bpm → 2 beats/sec. 0:04 = 4s = 8 beats.
  assert.deepEqual(parseTimingTag("[0:04] hi", { bpm: 120 }), { beat: 8, name: "hi" });
  const half = parseTimingTag("[1:00.5] x", { bpm: 120 }); // 60.5s * 2
  assert.ok(Math.abs(half.beat! - 121) < 1e-9);
});

test("parseTimingTag: clock without bpm stays untimed but keeps the name", () => {
  assert.deepEqual(parseTimingTag("[0:04] hi"), { beat: null, name: "hi" });
});

test("parseTimingTag: no tag / unrecognised tag → untimed, text preserved", () => {
  assert.deepEqual(parseTimingTag("just a line"), { beat: null, name: "just a line" });
  assert.deepEqual(parseTimingTag("[verse] words"), { beat: null, name: "words" });
});

test("hasTimingTags detects any resolvable tag", () => {
  assert.equal(hasTimingTags(["plain", "[17] tagged"]), true);
  assert.equal(hasTimingTags(["plain", "more plain"]), false);
  assert.equal(hasTimingTags(["[0:04] needs bpm"]), false); // no bpm → not resolvable
  assert.equal(hasTimingTags(["[0:04] ok"], { bpm: 120 }), true);
});

test("resolveTimeline: tagged lines anchor, untagged flow after by one bar", () => {
  assert.deepEqual(
    resolveTimeline(["[5] a", "b", "c", "[20] d"]),
    [
      { name: "a", beat: 16 }, // bar 5
      { name: "b", beat: 20 }, // +4
      { name: "c", beat: 24 }, // +4
      { name: "d", beat: 76 }, // bar 20
    ],
  );
});

test("buildLocators maps resolved timing to cue points", () => {
  assert.deepEqual(buildLocators(["[3] a", "b"]), [
    { time: 8, name: "a" },
    { time: 12, name: "b" },
  ]);
});

test("buildClips: timed lines span to the next line's beat", () => {
  const clips = buildClips(["[1] a", "[3] b", "[9] c"]); // beats 0, 8, 32
  assert.deepEqual(clips[0], { startTime: 0, duration: 8, name: "a" });
  assert.deepEqual(clips[1], { startTime: 8, duration: 24, name: "b" });
  assert.equal(clips[2]!.startTime, 32);
  assert.equal(clips[2]!.duration, 4); // last → tail default
});

test("buildClips: untagged input falls back to proportional widths", () => {
  // "aaaa" gets twice the width of "aa" — the branch-1 heuristic still applies
  // when there are no timing tags to drive real durations.
  const clips = buildClips(["aaaa", "aa"]);
  assert.ok(Math.abs(clips[0]!.duration - 2 * clips[1]!.duration) < 1e-9);
});

test("buildClips: never emits below the floor even with equal beats", () => {
  const clips = buildClips(["[1] a", "[1] b"]); // same beat → 0 gap
  for (const c of clips) assert.ok(c.duration >= MIN_CLIP_BEATS);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
