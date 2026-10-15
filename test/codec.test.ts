// Headless tests for src/codec.ts: Set notes bundled into clip names and back.
// Run with: npm test
import * as assert from "node:assert/strict";
import * as zlib from "node:zlib";
import {
  type Bundle,
  decodeNames,
  encodeBundle,
  fromBase16384,
  isDataName,
  newId,
  nextRev,
  revCounter,
  toBase16384,
  toWave,
  fromWave,
} from "../src/codec.js";

let passed = 0;
const failures: string[] = [];
const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${(e as Error).message.split("\n").join("\n      ")}`);
  }
};

const bundle = (notes: Record<string, string>, extra: Partial<Bundle> = {}): Bundle => ({
  v: 1,
  id: "7f3k2q9a",
  rev: "3-ab12",
  parent: "2-cd34",
  saved: "2026-10-15T14:32:05.000Z",
  notes,
  ...extra,
});

// Deterministic pseudo-random bytes and text, so failures reproduce.
const rand = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) >>> 0;
  return seed / 4294967296;
};
const bytes = (n: number, seed: number) => {
  const r = rand(seed);
  return Uint8Array.from({ length: n }, () => Math.floor(r() * 256));
};
const text = (n: number, seed: number) => {
  const r = rand(seed);
  const pool = "abcdefghijklmnopqrstuvwxyz     \n♪中ü🎵[]:";
  const chars = [...pool];
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(r() * chars.length)];
  return s;
};

console.log("codec");

test("base16384 round-trips every length from 0 to 40", () => {
  for (let n = 0; n <= 40; n++) {
    const b = bytes(n, n + 1);
    const s = toBase16384(b);
    assert.deepEqual(fromBase16384(s, n), b, `length ${n}`);
  }
});

test("base16384 only uses U+4E00 to U+8DFF", () => {
  const s = toBase16384(bytes(500, 7));
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    assert.ok(c >= 0x4e00 && c <= 0x8dff, `code point ${c.toString(16)}`);
  }
});

test("an empty bundle round-trips", () => {
  const b = bundle({});
  const { bundles, damaged } = decodeNames(encodeBundle(b));
  assert.deepEqual(damaged, []);
  assert.deepEqual(bundles, [b]);
});

test("notes with emoji, line breaks and tabs round-trip, current and forkedFrom too", () => {
  const b = bundle(
    { "Whole Again": "# Whole Again\n\nlow sun, high tide\n\tswallow 🎵 ü 中\n", lyrics: "" },
    { current: "Whole Again", forkedFrom: "aaaabbbb" },
  );
  assert.deepEqual(decodeNames(encodeBundle(b)).bundles, [b]);
});

test("a 200 KB bundle splits into several clips and round-trips", () => {
  const notes: Record<string, string> = {};
  for (let i = 0; i < 10; i++) notes["note " + i] = text(20000, i + 10);
  const b = bundle(notes);
  const names = encodeBundle(b);
  assert.ok(names.length > 1, `expected several clips, got ${names.length}`);
  for (const n of names) assert.ok(n.length <= 16000 + 80, `name length ${n.length}`);
  assert.deepEqual(decodeNames(names).bundles, [b]);
});

test("parts decode in any order", () => {
  const b = bundle({ a: text(40000, 3) });
  const names = encodeBundle(b, 500);
  assert.ok(names.length > 2);
  assert.deepEqual(decodeNames([...names].reverse()).bundles, [b]);
});

test("each name starts with a readable label and the plain header", () => {
  const names = encodeBundle(bundle({ a: "x" }));
  assert.match(names[0]!, /^Session Notes \(do not edit\) SN2 7f3k2q9a 1\/1 \d+ [▁-█]+$/);
});

test("after the ASCII header the body is only waveform bars", () => {
  const b = bundle({ "Whole Again": "low sun 🎵 ü 中\n" + text(30000, 9) });
  for (const n of encodeBundle(b)) assert.match(n, /^[\x20-\x7e]+ [▁▂▃▄▅▆▇█]*$/);
});

test("waveform bars round-trip every length from 0 to 40", () => {
  for (let n = 0; n <= 40; n++) {
    const b = bytes(n, n + 100);
    assert.deepEqual(fromWave(toWave(b), n), b, `length ${n}`);
  }
});

test("a changed body character is reported as damaged, keeping the id", () => {
  const n = encodeBundle(bundle({ a: "hello there, low sun, high tide" }))[0]!;
  const k = n.length - 6;
  const swapped = n.slice(0, k) + (n[k] === "▁" ? "█" : "▁") + n.slice(k + 1);
  const { bundles, damaged } = decodeNames([swapped]);
  assert.deepEqual(bundles, []);
  assert.equal(damaged.length, 1);
  assert.equal(damaged[0]!.id, "7f3k2q9a");
});

test("a body character that isn't a bar is damaged", () => {
  const n = encodeBundle(bundle({ a: "hello" }))[0]!;
  const { bundles, damaged } = decodeNames([n.slice(0, -2) + "中" + n.slice(-1)]);
  assert.deepEqual(bundles, []);
  assert.equal(damaged.length, 1);
});

test("a v0.3.0 beta name (SN1, CJK body) still decodes", () => {
  const b = bundle({ "Whole Again": "low sun, high tide" });
  const packed = zlib.brotliCompressSync(Buffer.from(JSON.stringify(b)));
  const stream = Buffer.alloc(4 + packed.length);
  stream.writeUInt32BE(zlib.crc32(packed), 0);
  packed.copy(stream, 4);
  const name = `SN1 7f3k2q9a 1/1 ${stream.length} ${toBase16384(stream)}`;
  assert.equal(isDataName(name), true);
  assert.deepEqual(decodeNames([name]).bundles, [b]);
});

test("a missing part is reported", () => {
  const names = encodeBundle(bundle({ a: text(40000, 4) }), 500);
  const { bundles, damaged } = decodeNames(names.slice(1));
  assert.deepEqual(bundles, []);
  assert.equal(damaged.length, 1);
  assert.equal(damaged[0]!.reason, "missing part");
  assert.equal(damaged[0]!.names.length, names.length - 1);
});

test("an unknown format version is refused as damaged", () => {
  const b = { ...bundle({ a: "x" }), v: 2 } as unknown as Bundle;
  const { bundles, damaged } = decodeNames(encodeBundle(b));
  assert.deepEqual(bundles, []);
  assert.equal(damaged.length, 1);
});

test("a header-shaped name with a broken header is damaged with no id", () => {
  const { bundles, damaged } = decodeNames(["SN1 garbage"]);
  assert.deepEqual(bundles, []);
  assert.equal(damaged.length, 1);
  assert.equal(damaged[0]!.id, null);
});

test("a bundle that decompresses past the size limit is damaged, not loaded", () => {
  // A crafted Set: 40 MB of JSON that compresses to a few KB.
  const huge = JSON.stringify({ ...bundle({}), notes: { a: "x".repeat(40 * 1024 * 1024) } });
  const packed = zlib.brotliCompressSync(Buffer.from(huge));
  const stream = Buffer.alloc(4 + packed.length);
  stream.writeUInt32BE(zlib.crc32(packed), 0);
  packed.copy(stream, 4);
  const name = `Session Notes (do not edit) SN2 7f3k2q9a 1/1 ${stream.length} ${toWave(stream)}`;
  const { bundles, damaged } = decodeNames([name]);
  assert.equal(bundles.length, 0, "the oversized bundle must not load");
  assert.equal(damaged.length, 1);
});

test("names that aren't data are ignored", () => {
  assert.deepEqual(decodeNames(["", "Verse 1", "Session Notes data (unused)"]), { bundles: [], damaged: [] });
  assert.equal(isDataName("SN1 7f3k2q9a 1/1 3 x"), true);
  assert.equal(isDataName("Session Notes (do not edit) SN2 7f3k2q9a 1/1 3 x"), true);
  assert.equal(isDataName("Verse"), false);
});

test("two bundles with different ids both come back", () => {
  const a = bundle({ a: "one" });
  const b = bundle({ b: "two" }, { id: "zzzz0000" });
  const got = decodeNames([...encodeBundle(a), ...encodeBundle(b)]).bundles;
  assert.equal(got.length, 2);
  assert.deepEqual(new Set(got.map((x) => x.id)), new Set(["7f3k2q9a", "zzzz0000"]));
});

test("revisions count up from their parent", () => {
  assert.match(nextRev(""), /^1-[0-9a-z]{4}$/);
  assert.match(nextRev("3-ab12"), /^4-[0-9a-z]{4}$/);
  assert.equal(revCounter("12-x4p1"), 12);
  assert.equal(revCounter(""), 0);
  assert.equal(revCounter("junk"), 0);
});

test("new ids are 8 base36 characters", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const id = newId();
    assert.match(id, /^[0-9a-z]{8}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 50);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
