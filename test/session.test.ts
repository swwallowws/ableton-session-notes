// Headless tests for src/session.ts: opening a Set (decode, reconcile, adopt,
// damaged dumps) and saving its notes (new id, backup first, write, read back,
// fork split, failed writes). The Set is an in-memory list of clip names.
// Run with: npm test
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { backupsDir, history } from "../src/backups.js";
import { decodeNames, encodeBundle } from "../src/codec.js";
import { type SessionDeps, openSet, saveSetNotes } from "../src/session.js";

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

let root = "";
const fresh = () => (root = fs.mkdtempSync(path.join(os.tmpdir(), "sn-session-")));
let clock = Date.UTC(2026, 9, 15, 10, 0, 0);
// One Set: its clip names live in `names`. `persist: false` simulates a write the
// Set never takes; `fail` makes the write throw; `landAfter` makes the names show
// up only after that many sleeps (a slow Set).
const setOf = (names: string[] = [], opts: { persist?: boolean; fail?: boolean; landAfter?: number } = {}) => {
  let sleeps = 0;
  let late: string[] | null = null;
  const deps: SessionDeps = {
    root: () => root,
    readNames: () => {
      if (late && sleeps >= (opts.landAfter ?? 0)) {
        names.splice(0, names.length, ...late);
        late = null;
      }
      return [...names];
    },
    writeNames: async (next) => {
      if (opts.fail) throw new Error("write refused");
      if (opts.persist === false) return;
      if (opts.landAfter) late = next;
      else names.splice(0, names.length, ...next);
    },
    sleep: async () => void sleeps++,
    now: () => new Date((clock += 60000)),
  };
  return { deps, names, sleeps: () => sleeps };
};

console.log("session");

await test("opening a Set without data: no id, nothing adopted, nothing written", () => {
  fresh();
  const s = setOf();
  const d = openSet(s.deps, {});
  assert.equal(d.id, null);
  assert.deepEqual(d.notes, {});
  assert.equal(fs.existsSync(backupsDir(root)), false);
});

await test("the first save mints an id, backs up, writes the Set and reads it back", async () => {
  fresh();
  const s = setOf();
  const r = await saveSetNotes(s.deps, { id: null, base: "", notes: { Lyrics: "low sun" }, current: "Lyrics", failed: new Set() });
  assert.equal(r.ok, true);
  assert.match(r.id, /^[0-9a-z]{8}$/);
  const inSet = decodeNames(s.names).bundles;
  assert.equal(inSet.length, 1);
  assert.deepEqual(inSet[0]!.notes, { Lyrics: "low sun" });
  assert.equal(inSet[0]!.parent, "");
  assert.equal(inSet[0]!.current, "Lyrics");
  assert.equal(history(root, r.id)[0]!.rev, r.rev);
});

await test("reopening after a save shows the saved notes with the new base", async () => {
  fresh();
  const s = setOf();
  const r = await saveSetNotes(s.deps, { id: null, base: "", notes: { A: "1" }, failed: new Set() });
  const d = openSet(s.deps, {});
  assert.deepEqual(d.notes, { A: "1" });
  assert.equal(d.id, r.id);
  assert.equal(d.base, r.rev);
  assert.equal(d.notice, null);
});

await test("a second save continues the chain under the same id", async () => {
  fresh();
  const s = setOf();
  const one = await saveSetNotes(s.deps, { id: null, base: "", notes: { A: "1" }, failed: new Set() });
  const two = await saveSetNotes(s.deps, { id: one.id, base: one.rev, notes: { A: "2" }, failed: new Set() });
  assert.equal(two.id, one.id);
  assert.equal(decodeNames(s.names).bundles[0]!.parent, one.rev);
});

await test("a refused write is reported, the backup still has it", async () => {
  fresh();
  const s = setOf([], { fail: true });
  const failed = new Set<string>();
  const r = await saveSetNotes(s.deps, { id: null, base: "", notes: { A: "kept" }, failed });
  assert.equal(r.ok, false);
  assert.equal(history(root, r.id)[0]!.notes["A"], "kept");
  assert.ok(failed.has(r.rev));
});

await test("a write the Set never takes fails after polling the read-back", async () => {
  fresh();
  const s = setOf([], { persist: false });
  const r = await saveSetNotes(s.deps, { id: null, base: "", notes: { A: "x" }, failed: new Set() });
  assert.equal(r.ok, false);
  assert.equal(s.sleeps(), 50, "polls for 5 s before giving up");
});

await test("a slow Set that takes the names after 3 s still counts as written", async () => {
  fresh();
  const s = setOf([], { landAfter: 30 });
  const r = await saveSetNotes(s.deps, { id: null, base: "", notes: { A: "x" }, failed: new Set() });
  assert.equal(r.ok, true);
  assert.deepEqual(decodeNames(s.names).bundles[0]!.notes, { A: "x" });
});

await test("retrying after a failed write keeps the id (not a fork)", async () => {
  fresh();
  const s = setOf();
  const one = await saveSetNotes(s.deps, { id: null, base: "", notes: { A: "1" }, failed: new Set() });
  const failed = new Set<string>();
  const bad = setOf([...s.names], { fail: true });
  const lost = await saveSetNotes(bad.deps, { id: one.id, base: one.rev, notes: { A: "2" }, failed });
  assert.equal(lost.ok, false);
  const retry = await saveSetNotes(s.deps, { id: one.id, base: one.rev, notes: { A: "2" }, failed });
  assert.equal(retry.ok, true);
  assert.equal(retry.id, one.id);
});

await test("two Save As copies editing the same version split: the second gets a new id", async () => {
  fresh();
  const a = setOf();
  const p = await saveSetNotes(a.deps, { id: null, base: "", notes: { A: "shared" }, failed: new Set() });
  const b = setOf([...a.names]); // Save As copies the data clips
  await saveSetNotes(a.deps, { id: p.id, base: p.rev, notes: { A: "edited in A" }, failed: new Set() });
  const fromB = await saveSetNotes(b.deps, { id: p.id, base: p.rev, notes: { A: "edited in B" }, failed: new Set() });
  assert.notEqual(fromB.id, p.id);
  const inB = decodeNames(b.names).bundles[0]!;
  assert.equal(inB.forkedFrom, p.id);
  assert.deepEqual(inB.notes, { A: "edited in B" });
  assert.equal(openSet(a.deps, {}).notice, null, "A is unaffected");
});

await test("a Set from another computer is adopted into the backup", () => {
  fresh();
  const b = { v: 1 as const, id: "abcdefgh", rev: "4-aaaa", parent: "3-zzzz", saved: "2026-10-01T10:00:00.000Z", notes: { A: "x" } };
  const s = setOf(encodeBundle(b));
  const d = openSet(s.deps, {});
  assert.deepEqual(d.notes, { A: "x" });
  assert.deepEqual(history(root, "abcdefgh"), [b]);
});

await test("damaged data is dumped once and reported", () => {
  fresh();
  const s = setOf(["SN1 broken header"]);
  const d = openSet(s.deps, {});
  assert.equal(d.notice?.kind, "damaged");
  openSet(s.deps, {}); // the pad reopens (resize, send) on the same Set
  const dumps = fs.readdirSync(path.join(backupsDir(root), "damaged"));
  assert.equal(dumps.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backupsDir(root), "damaged", dumps[0]!), "utf8")), ["SN1 broken header"]);
});

await test("closing without saving the Set: reopening offers the newer backup", async () => {
  fresh();
  const s = setOf();
  const one = await saveSetNotes(s.deps, { id: null, base: "", notes: { A: "1" }, failed: new Set() });
  const savedSet = [...s.names]; // what the Set file holds
  await saveSetNotes(s.deps, { id: one.id, base: one.rev, notes: { A: "2" }, failed: new Set() });
  const reopened = setOf(savedSet); // Live reopens the file without the last write
  const d = openSet(reopened.deps, {});
  assert.deepEqual(d.notes, { A: "1" });
  assert.equal(d.notice?.kind, "newer");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
