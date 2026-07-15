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
  placeWithoutCollision,
  NUDGE_BEATS,
  evalExpr,
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

test("extractLyricLines: a note with no position tags yields no lyrics", () => {
  // Tagging is required now - an untagged note is treated as ordinary prose.
  assert.deepEqual(extractLyricLines("Walking in the rain\nWith you tonight"), []);
});

test("extractLyricLines returns [] for empty / structure-only notes", () => {
  assert.deepEqual(extractLyricLines(""), []);
  assert.deepEqual(extractLyricLines("# TO-DO\n\n♪\n---"), []);
});

test("extractLyricLines: one tag at the top pulls the whole block (rest flow)", () => {
  const md = "[1] Walking in the rain\nWith you tonight\nunder the light";
  assert.deepEqual(extractLyricLines(md), [
    "[1] Walking in the rain",
    "With you tonight",
    "under the light",
  ]);
});

test("extractLyricLines (tagged blocks): a tagged line starts a block, untagged lines flow", () => {
  const md = "# Ideas\nfix the bridge\n\n[1] Walking in the rain\nwith you tonight\n[5] Under the neon light\n\n- [ ] mix down vocals";
  // "fix the bridge" and the to-do are prose (outside a block); the three lyric
  // lines - including the untagged flow line - are kept, tags intact.
  assert.deepEqual(extractLyricLines(md), [
    "[1] Walking in the rain",
    "with you tonight",
    "[5] Under the neon light",
  ]);
});

test("extractLyricLines (tagged blocks): a blank line ends a block", () => {
  const md = "[1] first\nflow one\n\nprose after the blank\n[9] second";
  assert.deepEqual(extractLyricLines(md), ["[1] first", "flow one", "[9] second"]);
});

test("extractLyricLines: clock/expression tags also start a block", () => {
  assert.deepEqual(extractLyricLines("note\n[1:04] clocked\nflow"), ["[1:04] clocked", "flow"]);
  assert.deepEqual(extractLyricLines("note\n[=8*4] mathy\nflow"), ["[=8*4] mathy", "flow"]);
  // A non-position bracket like [verse] does NOT start a block: with a real tag
  // present, [verse] stays prose while [1] opens the block.
  assert.deepEqual(extractLyricLines("[verse] words\n\n[1] real lyric"), ["[1] real lyric"]);
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
  // "aaaa" gets twice the width of "aa" - the branch-1 heuristic still applies
  // when there are no timing tags to drive real durations.
  const clips = buildClips(["aaaa", "aa"]);
  assert.ok(Math.abs(clips[0]!.duration - 2 * clips[1]!.duration) < 1e-9);
});

test("buildClips: never emits below the floor even with equal beats", () => {
  const clips = buildClips(["[1] a", "[1] b"]); // same beat → 0 gap
  for (const c of clips) assert.ok(c.duration >= MIN_CLIP_BEATS);
});

test("buildClips: clips on the same/too-close beat never overlap", () => {
  // Two lines tagged at the same beat, and a clock pair closer than the floor,
  // must produce strictly non-overlapping clips (a later clip would otherwise
  // overwrite an earlier one on the arrangement track).
  const cases = [
    buildClips(["[1] a", "[1] b", "[1] c"]),
    buildClips(["[0:00] a", "[0:00.05] b"], { bpm: 120 }),
  ];
  for (const clips of cases) {
    for (let i = 1; i < clips.length; i++) {
      const prevEnd = clips[i - 1]!.startTime + clips[i - 1]!.duration;
      assert.ok(
        clips[i]!.startTime >= prevEnd - 1e-9,
        `clip ${i} starts at ${clips[i]!.startTime}, overlapping prev end ${prevEnd}`,
      );
    }
  }
});

test("placeWithoutCollision: leaves clash-free beats untouched", () => {
  assert.deepEqual(placeWithoutCollision([0, 4, 8], [100]), [0, 4, 8]);
});

test("placeWithoutCollision: nudges off an occupied beat (user's marker)", () => {
  // A line at beat 16 where the user's marker already sits → +NUDGE_BEATS.
  assert.deepEqual(placeWithoutCollision([16], [16]), [16 + NUDGE_BEATS]);
});

test("placeWithoutCollision: nudges duplicates within the same batch apart", () => {
  assert.deepEqual(placeWithoutCollision([8, 8, 8]), [8, 8 + NUDGE_BEATS, 8 + 2 * NUDGE_BEATS]);
});

test("placeWithoutCollision: cascades past a second occupied slot", () => {
  // Target 8; both 8 and 8+eps are taken → lands on 8+2eps.
  const got = placeWithoutCollision([8], [8, 8 + NUDGE_BEATS]);
  assert.ok(Math.abs(got[0]! - (8 + 2 * NUDGE_BEATS)) < 1e-9);
});

test("placeWithoutCollision: an epsilon below tolerance still terminates", () => {
  // A nudge smaller than the match tolerance would loop forever without the
  // clamp; the result must resolve off the occupied slot in finite time.
  const got = placeWithoutCollision([0], [0], { epsilon: 1e-9, tolerance: 1e-6 });
  assert.ok(got[0]! > 0, "should have nudged off the occupied beat");
});

// ---- arithmetic expression tags ----

test("evalExpr: arithmetic, precedence, parentheses, unary minus", () => {
  assert.equal(evalExpr("8*4"), 32);
  assert.equal(evalExpr("2 + 3 * 4"), 14);
  assert.equal(evalExpr("(2 + 3) * 4"), 20);
  assert.equal(evalExpr("16.5 / 2"), 8.25);
  assert.equal(evalExpr("-4 + 10"), 6);
});

test("evalExpr: resolves known vars, rejects unknown ones", () => {
  assert.equal(evalExpr("bpm/2", { bpm: 120 }), 60);
  assert.equal(evalExpr("bpm*2 + 4", { bpm: 90 }), 184);
  assert.equal(evalExpr("bpm/2", {}), null); // no bpm supplied
  assert.equal(evalExpr("nope", { bpm: 120 }), null);
});

test("evalExpr: malformed input → null (no throw, no eval)", () => {
  assert.equal(evalExpr("2 +"), null);
  assert.equal(evalExpr("(2 + 3"), null);
  assert.equal(evalExpr("2 3"), null);
  assert.equal(evalExpr(""), null);
});

test("evalExpr: stray characters are rejected, not silently dropped", () => {
  // The tokenizer only collects matches, so a stray char would vanish and the
  // rest would evaluate - these must be null, not a confident wrong number.
  assert.equal(evalExpr("100@"), null);
  assert.equal(evalExpr("8*!4"), null);
  assert.equal(evalExpr("2 & 3"), null);
  assert.equal(evalExpr("8/0"), null); // Infinity → rejected by isFinite guard
});

test("parseTimingTag: [=expr] resolves to beats, bpm-aware", () => {
  assert.deepEqual(parseTimingTag("[=32] line"), { beat: 32, name: "line" });
  assert.deepEqual(parseTimingTag("[=8*4] line"), { beat: 32, name: "line" });
  // [=bpm/2] is always 30s worth of beats regardless of tempo.
  assert.deepEqual(parseTimingTag("[=bpm/2] x", { bpm: 128 }), { beat: 64, name: "x" });
  assert.deepEqual(parseTimingTag("[=bpm/2] x"), { beat: null, name: "x" }); // no bpm
  assert.deepEqual(parseTimingTag("[=-5] x"), { beat: 0, name: "x" }); // clamped ≥ 0
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
