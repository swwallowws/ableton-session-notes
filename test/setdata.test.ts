// Headless tests for src/setdata.ts against a small stand-in for the SDK's Song,
// Track, TakeLane and Clip (the real ones need Live). Covers where the data clips
// go and how a write reuses them. Run with: npm test
import * as assert from "node:assert/strict";
import {
  DATA_LANE,
  LEGACY_TRACK,
  NOTES_TRACK,
  UNUSED,
  ensureNotesTrack,
  findNotesTrack,
  readDataNames,
  writeDataNames,
} from "../src/setdata.js";

let passed = 0;
const failures: string[] = [];
const test = async (name: string, fn: () => Promise<void> | void) => {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${(e as Error).message.split("\n").join("\n      ")}`);
  }
};

// ---- a minimal stand-in for the SDK objects ----
class Clip {
  name = "";
  constructor(public startTime: number, public duration: number) {}
}
class Lane {
  name = "";
  clips: Clip[] = [];
  async createMidiClip(start: number, duration: number) {
    const c = new Clip(start, duration);
    this.clips.push(c);
    return c;
  }
}
class Track {
  takeLanes: Lane[] = [];
  arrangementClips: Clip[] = [];
  constructor(public name = "") {}
  async createTakeLane() {
    const l = new Lane();
    this.takeLanes.push(l);
    return l;
  }
}
class Song {
  tracks: Track[] = [];
  async createMidiTrack() {
    const t = new Track();
    this.tracks.push(t);
    return t;
  }
}
const ctx = () => {
  const c = { transactions: 0, withinTransaction: (fn: () => unknown) => (c.transactions++, fn()) };
  return c;
};
const data = (n: number) => Array.from({ length: n }, (_, i) => `SN1 7f3k2q9a ${i + 1}/${n} 9 body${i}`);

console.log("setdata");

await test("an empty Set has no data", () => {
  assert.deepEqual(readDataNames(new Song()), []);
  assert.equal(findNotesTrack(new Song()), null);
});

await test("the first write makes the Session Notes track, its data lane and the clips", async () => {
  const song = new Song();
  await writeDataNames(ctx(), song, data(2));
  assert.equal(song.tracks.length, 1);
  assert.equal(song.tracks[0]!.name, NOTES_TRACK);
  assert.equal(song.tracks[0]!.takeLanes[0]!.name, DATA_LANE);
  assert.deepEqual(readDataNames(song), data(2));
});

await test("a later write with fewer clips renames in place and blanks the rest", async () => {
  const song = new Song();
  await writeDataNames(ctx(), song, data(3));
  const one = ["SN1 7f3k2q9a 1/1 9 short"];
  await writeDataNames(ctx(), song, one);
  const lane = song.tracks[0]!.takeLanes[0]!;
  assert.equal(lane.clips.length, 3, "no clips deleted");
  assert.deepEqual(lane.clips.map((c) => c.name), [one[0], UNUSED, UNUSED]);
  assert.deepEqual(readDataNames(song), one);
  assert.equal(song.tracks.length, 1);
});

await test("a later write with more clips adds them after the existing ones", async () => {
  const song = new Song();
  await writeDataNames(ctx(), song, data(1));
  await writeDataNames(ctx(), song, data(3));
  const starts = song.tracks[0]!.takeLanes[0]!.clips.map((c) => c.startTime);
  assert.equal(new Set(starts).size, 3, "no two clips at the same spot");
  assert.deepEqual(readDataNames(song), data(3));
});

await test("an existing write takes two undo steps", async () => {
  const song = new Song();
  await writeDataNames(ctx(), song, data(1));
  const c = ctx();
  await writeDataNames(c, song, data(2));
  assert.equal(c.transactions, 2);
});

await test("a Lyrics track from an older version is reused", async () => {
  const song = new Song();
  song.tracks.push(new Track("Drums"), new Track(LEGACY_TRACK));
  await writeDataNames(ctx(), song, data(1));
  assert.equal(song.tracks.length, 2);
  assert.equal(song.tracks[1]!.takeLanes[0]!.name, DATA_LANE);
  assert.equal(await ensureNotesTrack(song), song.tracks[1]);
});

await test("a data lane on a renamed track is still found and reused", async () => {
  const song = new Song();
  await writeDataNames(ctx(), song, data(1));
  song.tracks[0]!.name = "My notes";
  song.tracks.push(new Track(NOTES_TRACK));
  await writeDataNames(ctx(), song, data(2));
  assert.equal(findNotesTrack(song), song.tracks[0]);
  assert.equal(song.tracks[1]!.takeLanes.length, 0);
  assert.deepEqual(readDataNames(song), data(2));
});

await test("data clips on another track's data lane are blanked by a write", async () => {
  const song = new Song();
  await writeDataNames(ctx(), song, data(1));
  const other = new Track("Pasted");
  const lane = await other.createTakeLane();
  lane.name = DATA_LANE;
  (await lane.createMidiClip(0, 1)).name = "SN1 zzzz0000 1/1 9 other";
  song.tracks.push(other);
  assert.equal(readDataNames(song).length, 2);
  await writeDataNames(ctx(), song, data(1));
  assert.deepEqual(readDataNames(song), data(1));
  assert.equal(lane.clips[0]!.name, UNUSED);
});

await test("a lane with another name and non-data clip names are ignored", async () => {
  const song = new Song();
  const t = new Track("Keys");
  const lane = await t.createTakeLane();
  lane.name = "Take 1";
  (await lane.createMidiClip(0, 1)).name = "SN1 7f3k2q9a 1/1 9 x";
  song.tracks.push(t);
  assert.deepEqual(readDataNames(song), []);
});

await test("a throwing getter doesn't break reading", () => {
  const song = new Song();
  const bad = new Track("Bad");
  Object.defineProperty(bad, "takeLanes", { get: () => { throw new Error("gone"); } });
  song.tracks.push(bad);
  assert.deepEqual(readDataNames(song), []);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
