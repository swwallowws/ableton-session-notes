// Headless tests for src/backups.ts: local snapshots of each Set's notes, the
// restore list, damaged dumps and the one-time import of older notes. Run with:
// npm test
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Bundle } from "../src/codec.js";
import { backupsDir, dumpDamaged, history, listBackups, migrateOnce, writeSnapshot } from "../src/backups.js";

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

// <tmp>/Extensions Data/swwallowws.session-notes is "our" storage dir.
let data = "";
let root = "";
const fresh = () => {
  data = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sn-backups-")), "Extensions Data");
  root = path.join(data, "swwallowws.session-notes");
  fs.mkdirSync(root, { recursive: true });
};
const write = (p: string, body: string) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf8");
};
const read = (p: string) => fs.readFileSync(p, "utf8");

let clock = Date.UTC(2026, 9, 15, 10, 0, 0);
const b = (rev: string, parent: string, notes: Record<string, string> = { a: rev }, id = "7f3k2q9a"): Bundle => ({
  v: 1,
  id,
  rev,
  parent,
  saved: new Date((clock += 60000)).toISOString(),
  notes,
});
const DEFAULT = "# Notes\n- [x] Create a session note\n";

console.log("backups");

test("snapshots come back newest first", () => {
  fresh();
  const one = b("1-aaaa", "");
  const two = b("2-bbbb", "1-aaaa");
  writeSnapshot(root, one);
  writeSnapshot(root, two);
  assert.deepEqual(history(root, "7f3k2q9a"), [two, one]);
  assert.ok(fs.existsSync(path.join(backupsDir(root), "7f3k2q9a", "2-bbbb.json")));
});

test("only the last 20 snapshots per Set are kept", () => {
  fresh();
  let parent = "";
  for (let i = 1; i <= 25; i++) {
    const rev = `${i}-aaaa`;
    writeSnapshot(root, b(rev, parent));
    parent = rev;
  }
  const h = history(root, "7f3k2q9a");
  assert.equal(h.length, 20);
  assert.equal(h[0]!.rev, "25-aaaa");
  assert.equal(h.at(-1)!.rev, "6-aaaa");
});

test("history of an unknown or unsafe id is empty", () => {
  fresh();
  assert.deepEqual(history(root, "zzzzzzzz"), []);
  assert.deepEqual(history(root, "../../etc"), []);
});

test("a snapshot with an unsafe id or rev is refused", () => {
  fresh();
  assert.throws(() => writeSnapshot(root, b("1-aaaa", "", {}, "../x")));
  assert.throws(() => writeSnapshot(root, b("../1", "")));
});

test("the restore list has one entry per Set, newest first, with titles and first line", () => {
  fresh();
  writeSnapshot(root, b("1-aaaa", "", { Lyrics: "low sun" }, "aaaaaaaa"));
  writeSnapshot(root, { ...b("1-bbbb", "", { "Whole Again": "\n\n  low sun, high tide  \nmore", ideas: "x" }, "bbbbbbbb"), current: "Whole Again" });
  writeSnapshot(root, b("2-aaaa", "1-aaaa", { Lyrics: "swallow whole" }, "aaaaaaaa"));
  const list = listBackups(root);
  assert.deepEqual(
    list.map((x) => [x.id, x.rev]),
    [["aaaaaaaa", "2-aaaa"], ["bbbbbbbb", "1-bbbb"]],
  );
  assert.deepEqual(list[0]!.titles, ["Lyrics"]);
  assert.equal(list[0]!.firstLine, "swallow whole");
  assert.deepEqual(list[1]!.titles, ["Whole Again", "ideas"]);
  assert.equal(list[1]!.firstLine, "low sun, high tide");
});

test("damaged clip names are dumped and don't appear in the restore list", () => {
  fresh();
  const p = dumpDamaged(root, ["SN1 one", "SN1 two\nwith a break"]);
  assert.ok(p.startsWith(path.join(backupsDir(root), "damaged")));
  assert.deepEqual(JSON.parse(read(p)), ["SN1 one", "SN1 two\nwith a break"]);
  assert.deepEqual(listBackups(root), []);
});

test("migration copies global notes from older author folders without overwriting", () => {
  fresh();
  const globals = path.join(root, "Global Notes");
  write(path.join(globals, "Ideas.md"), "mine");
  write(path.join(data, "bengybade.session-notes", "Global Notes", "Ideas.md"), "old ideas");
  write(path.join(data, "bengybade.session-notes", "Global Notes", "Mix.md"), "mix list");
  write(path.join(data, "somaluden.session-notes", "notebooks", "Global.md"), "older still");
  const r = migrateOnce(root, globals, DEFAULT);
  assert.equal(read(path.join(globals, "Ideas.md")), "mine");
  assert.equal(read(path.join(globals, "Ideas 2.md")), "old ideas");
  assert.equal(read(path.join(globals, "Mix.md")), "mix list");
  assert.equal(read(path.join(globals, "Global.md")), "older still");
  assert.equal(r.globals, 3);
});

test("migration skips the default seed, empty notes and exact duplicates", () => {
  fresh();
  const globals = path.join(root, "Global Notes");
  write(path.join(data, "bengybade.session-notes", "Global Notes", "Global.md"), DEFAULT);
  write(path.join(data, "bengybade.session-notes", "Global Notes", "Empty.md"), "  \n");
  write(path.join(data, "bengybade.session-notes", "Global Notes", "Same.md"), "same");
  write(path.join(data, "somaluden.session-notes", "notebooks", "Same.md"), "same");
  const r = migrateOnce(root, globals, DEFAULT);
  assert.deepEqual(fs.readdirSync(globals).sort(), ["Same.md"]);
  assert.equal(r.globals, 1);
});

test("unsaved-set batches become backups; our own folder and other extensions are ignored", () => {
  fresh();
  const globals = path.join(root, "Global Notes");
  const old = path.join(data, "bengybade.session-notes", "Unsaved Notes");
  write(path.join(old, "s1nz5rn", "Session.md"), "verse one");
  write(path.join(old, "s5w4xi", "Session.md"), DEFAULT);
  write(path.join(old, "Session.md"), "loose legacy note");
  write(path.join(root, "Unsaved Notes", "sx", "Session.md"), "ours, not migrated");
  write(path.join(data, "tabridge.tabridge", "Global Notes", "Other.md"), "not ours");
  const r = migrateOnce(root, globals, DEFAULT);
  assert.equal(r.batches, 2);
  const firsts = listBackups(root).map((x) => x.firstLine).sort();
  assert.deepEqual(firsts, ["loose legacy note", "verse one"]);
  assert.equal(fs.existsSync(path.join(globals, "Other.md")), false);
});

test("migration with no older folders does nothing", () => {
  fresh();
  assert.deepEqual(migrateOnce(root, path.join(root, "Global Notes"), DEFAULT), { globals: 0, batches: 0 });
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
