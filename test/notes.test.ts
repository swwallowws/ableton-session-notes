// Headless tests for the pure note logic in src/notes.ts - no Ableton needed.
// Set notes now travel inside the Set (codec.ts); notes.ts keeps the global-note
// files and builds the state the pad opens with. Run with: npm test
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildState,
  persistGlobal,
  setNotesChanged,
  migrateNotebooksDir,
  listMd,
  mdPath,
  readFile,
  type Payload,
} from "../src/notes.js";

const D = "DEFAULT";
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

// ---- helpers ----
let tmp = "";
const fresh = () => (tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sn-test-")));
const globals = () => path.join(tmp, "Global Notes");
const writeGlobal = (name: string, body: string) => {
  fs.mkdirSync(globals(), { recursive: true });
  fs.writeFileSync(mdPath(globals(), name), body, "utf8");
};
const save = (map: Record<string, string>, extra: Partial<Payload> = {}): Payload => ({
  action: "save",
  globalMap: map,
  ...extra,
});
const state = (opts: Partial<Parameters<typeof buildState>[0]> = {}) =>
  buildState({
    setNotes: {},
    globalDir: globals(),
    backupDir: path.join(tmp, "Set Backups"),
    saved: {},
    defaultMd: D,
    hasData: false,
    notice: null,
    backups: [],
    ...opts,
  });

console.log("notes.ts");

// ---- buildState ----
test("a Set without notes seeds a 'Session' note and opens it", () => {
  fresh();
  const st = state();
  assert.equal(st.hasProject, true);
  assert.deepEqual(st.projectNotes, { Session: D });
  assert.equal(st.current, "p:Session");
  assert.equal(st.size, "m");
  assert.equal(st.setHasData, false);
});

test("the Set's notes are listed, none seeded", () => {
  fresh();
  const st = state({ setNotes: { Lyrics: "l", Ideas: "i" }, hasData: true });
  assert.deepEqual(Object.keys(st.projectNotes).sort(), ["Ideas", "Lyrics"]);
  assert.equal(st.current, "p:Ideas");
  assert.equal(st.setHasData, true);
});

test("global notes are read from their folder", () => {
  fresh();
  writeGlobal("Ideas", "g");
  assert.deepEqual(state().globalNotes, { Ideas: "g" });
});

test("reopens the last-open note and remembers size", () => {
  fresh();
  writeGlobal("Ideas", "g");
  const st = state({ setNotes: { A: "a", B: "b" }, saved: { current: "g:Ideas", size: "s" } });
  assert.equal(st.current, "g:Ideas");
  assert.equal(st.size, "s");
});

test("the Set's own current note wins over a last-open note it doesn't have", () => {
  fresh();
  const st = state({ setNotes: { A: "a", B: "b" }, current: "B", saved: { current: "p:Gone" } });
  assert.equal(st.current, "p:B");
});

test("notice, backups and the backup folder reach the pad", () => {
  fresh();
  const notice = { kind: "newer", text: "x" };
  const backups = [{ id: "aaaaaaaa", rev: "1-aaaa", saved: "s", titles: ["A"], firstLine: "a" }];
  const st = state({ notice, backups });
  assert.deepEqual(st.notice, notice);
  assert.deepEqual(st.backups, backups);
  assert.equal(st.backupDir, path.join(tmp, "Set Backups"));
  assert.equal(st.notebooksDir, globals());
});

// ---- setNotesChanged ----
test("setNotesChanged: identical maps, in any key order, are unchanged", () => {
  assert.equal(setNotesChanged({ a: "1", b: "2" }, { b: "2", a: "1" }), false);
});

test("setNotesChanged: an edit, an added note or a removed note is a change", () => {
  assert.equal(setNotesChanged({ a: "1" }, { a: "2" }), true);
  assert.equal(setNotesChanged({ a: "1" }, { a: "1", b: "" }), true);
  assert.equal(setNotesChanged({ a: "1", b: "2" }, { a: "1" }), true);
});

test("setNotesChanged: no map from the pad is no change", () => {
  assert.equal(setNotesChanged({ a: "1" }, undefined), false);
});

// ---- persistGlobal ----
test("persistGlobal saves global notes into their folder", () => {
  fresh();
  persistGlobal(save({ Ideas: "i", Mix: "m" }), globals());
  assert.deepEqual(listMd(globals()), ["Ideas", "Mix"]);
  assert.equal(readFile(mdPath(globals(), "Ideas")), "i");
});

test("persistGlobal ignores Set notes in the payload", () => {
  fresh();
  persistGlobal({ action: "save", projectMap: { Lyrics: "l" }, globalMap: { G: "g" } }, globals());
  assert.deepEqual(listMd(globals()), ["G"]);
  assert.equal(fs.existsSync(path.join(tmp, "Session Notes")), false);
});

test("rename moves the file and leaves no stale copy", () => {
  fresh();
  writeGlobal("Ideas", "i");
  persistGlobal(save({ Verse: "v" }, { globalRenames: [{ from: "Ideas", to: "Verse" }] }), globals());
  assert.deepEqual(listMd(globals()), ["Verse"]);
  assert.equal(readFile(mdPath(globals(), "Verse")), "v");
});

test("delete removes the file", () => {
  fresh();
  writeGlobal("A", "a");
  writeGlobal("B", "b");
  persistGlobal(save({ B: "b" }, { globalDeletes: ["A"] }), globals());
  assert.deepEqual(listMd(globals()), ["B"]);
});

test("delete+rewrite of the same name keeps the rewrite", () => {
  fresh();
  writeGlobal("C", "old");
  persistGlobal(save({ C: "new" }, { globalDeletes: ["C"] }), globals());
  assert.equal(readFile(mdPath(globals(), "C")), "new");
});

// ---- migration ----
test("legacy notebooks/ folder migrates to Global Notes/", () => {
  fresh();
  const legacy = path.join(tmp, "notebooks");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "Global.md"), "g", "utf8");
  migrateNotebooksDir(tmp);
  assert.equal(fs.existsSync(legacy), false, "old notebooks/ folder should be gone");
  assert.deepEqual(listMd(globals()), ["Global"]);
  assert.equal(readFile(mdPath(globals(), "Global")), "g");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
