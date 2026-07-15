// Headless tests for the pure note logic in src/notes.ts - no Ableton needed.
// Run with: npm test
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildState,
  persist,
  migrationOffer,
  bringNotes,
  migrateLegacyProjectNote,
  migrateNotebooksDir,
  projectNotesDir,
  listMd,
  mdPath,
  readFile,
  type Payload,
  type SavedState,
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
const notebooks = () => path.join(tmp, "notebooks");
// A saved Ableton project folder (has the "Ableton Project Info" marker).
const project = (name: string): string => {
  const root = path.join(tmp, name + " Project");
  fs.mkdirSync(path.join(root, "Ableton Project Info"), { recursive: true });
  return root;
};
const writeNote = (root: string, name: string, body: string) => {
  const dir = projectNotesDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mdPath(dir, name), body, "utf8");
};
const noteNames = (root: string) => listMd(projectNotesDir(root));
const hasFolder = (root: string) => fs.existsSync(projectNotesDir(root));
const save = (map: Record<string, string>, extra: Partial<Payload> = {}): Payload => ({
  action: "save",
  projectMap: map,
  ...extra,
});

console.log("notes.ts");

// ---- buildState ----
test("empty project seeds a 'Session' note and opens it", () => {
  fresh();
  const root = project("Song");
  const st = buildState(root, null, { notebooksDir: notebooks(), saved: {}, defaultMd: D });
  assert.equal(st.hasProject, true);
  assert.deepEqual(Object.keys(st.projectNotes), ["Session"]);
  assert.equal(st.projectNotes["Session"], D);
  assert.equal(st.current, "p:Session");
  assert.equal(st.size, "m");
  assert.equal(st.projectName, "Song Project");
  assert.equal(st.projectDir, root);
});

test("a pending offer suppresses the seeded note", () => {
  fresh();
  const st = buildState(project("Song"), { fromName: "Old", count: 2 }, { notebooksDir: notebooks(), saved: {}, defaultMd: D });
  assert.equal(Object.keys(st.projectNotes).length, 0);
  assert.ok(st.current.startsWith("g:"));
  assert.deepEqual(st.migration, { fromName: "Old", count: 2 });
});

test("existing project notes are listed, none seeded", () => {
  fresh();
  const root = project("Song");
  writeNote(root, "Ideas", "i");
  writeNote(root, "Lyrics", "l");
  const st = buildState(root, null, { notebooksDir: notebooks(), saved: {}, defaultMd: D });
  assert.deepEqual(Object.keys(st.projectNotes).sort(), ["Ideas", "Lyrics"]);
  assert.equal(st.current, "p:Ideas");
});

test("reopens the last-open note and remembers size", () => {
  fresh();
  const root = project("Song");
  writeNote(root, "Ideas", "i");
  writeNote(root, "Lyrics", "l");
  const saved: SavedState = { current: "p:Lyrics", size: "s" };
  const st = buildState(root, null, { notebooksDir: notebooks(), saved, defaultMd: D });
  assert.equal(st.current, "p:Lyrics");
  assert.equal(st.size, "s");
});

test("no project → seeds a 'Global' global notebook", () => {
  fresh();
  const st = buildState(null, null, { notebooksDir: notebooks(), saved: {}, defaultMd: D });
  assert.equal(st.hasProject, false);
  assert.equal(st.current, "g:Global");
  assert.equal(st.globalNotes["Global"], D);
});

// ---- persist ----
test("saves project notes into the Session Notes folder", () => {
  fresh();
  const root = project("Song");
  persist(save({ Ideas: "i", Lyrics: "l" }), root, notebooks());
  assert.deepEqual(noteNames(root), ["Ideas", "Lyrics"]);
  assert.equal(readFile(mdPath(projectNotesDir(root), "Ideas")), "i");
  assert.equal(fs.existsSync(mdPath(root, "Ideas")), false); // not loose at the root
});

test("rename moves the file and leaves no stale copy", () => {
  fresh();
  const root = project("Song");
  writeNote(root, "Ideas", "i");
  persist(save({ Verse: "v" }, { projectRenames: [{ from: "Ideas", to: "Verse" }] }), root, notebooks());
  assert.deepEqual(noteNames(root), ["Verse"]);
  assert.equal(readFile(mdPath(projectNotesDir(root), "Verse")), "v");
});

test("delete removes the file", () => {
  fresh();
  const root = project("Song");
  writeNote(root, "A", "a");
  writeNote(root, "B", "b");
  persist(save({ B: "b" }, { projectDeletes: ["A"] }), root, notebooks());
  assert.deepEqual(noteNames(root), ["B"]);
});

test("delete+rewrite of the same name keeps the rewrite", () => {
  fresh();
  const root = project("Song");
  writeNote(root, "C", "old");
  persist(save({ C: "new" }, { projectDeletes: ["C"] }), root, notebooks());
  assert.deepEqual(noteNames(root), ["C"]);
  assert.equal(readFile(mdPath(projectNotesDir(root), "C")), "new");
});

test("global notebooks persist independently of the project", () => {
  fresh();
  const root = project("Song");
  persist({ action: "save", projectMap: { Ideas: "i" }, globalMap: { Global: "g" } }, root, notebooks());
  assert.deepEqual(noteNames(root), ["Ideas"]);
  assert.deepEqual(listMd(notebooks()), ["Global"]);
});

// ---- unsaved-Set staging ----
// An unsaved Set resolves to a throwaway temp project Ableton may delete. The host
// passes a staging dir so notes land in our own data dir instead of that folder.
const staging = () => path.join(tmp, "Unsaved Notes");

test("staging: persist writes to the override dir, never the temp project folder", () => {
  fresh();
  const temp = project("2026-07-07 230052 Temp"); // an unsaved-Set temp project
  persist(save({ Session: "jot" }), temp, notebooks(), staging());
  assert.deepEqual(listMd(staging()), ["Session"]);
  assert.equal(readFile(mdPath(staging(), "Session")), "jot");
  assert.equal(hasFolder(temp), false, "must not write into the temp project folder");
});

test("staging: notes survive deleting the temp project (the reported bug)", () => {
  fresh();
  const temp = project("Untitled"); // -> "Untitled Project"
  persist(save({ Session: "keep me" }), temp, notebooks(), staging());
  fs.rmSync(temp, { recursive: true, force: true }); // Ableton "Delete temp files"
  assert.deepEqual(listMd(staging()), ["Session"]);
  assert.equal(readFile(mdPath(staging(), "Session")), "keep me");
});

test("staging: buildState reads staged notes but still shows the Set as unsaved", () => {
  fresh();
  const temp = project("Untitled"); // -> "Untitled Project"
  fs.mkdirSync(staging(), { recursive: true });
  fs.writeFileSync(mdPath(staging(), "Session"), "staged", "utf8");
  const st = buildState(temp, null, { notebooksDir: notebooks(), saved: {}, defaultMd: D, projNotesDir: staging() });
  assert.equal(st.hasProject, true);
  assert.equal(st.projectNotesDir, staging());
  assert.equal(st.projectName, "Untitled Project", "name drives the 'unsaved' hint in the UI");
  assert.deepEqual(Object.keys(st.projectNotes), ["Session"]);
  assert.equal(st.projectNotes["Session"], "staged");
});

// ---- stale-write guard ----
test("guard: vanished project folder recovers edits to globals, no ghost folder", () => {
  fresh();
  const root = path.join(tmp, "Gone Project"); // no "Ableton Project Info" marker
  fs.mkdirSync(root, { recursive: true });
  persist(save({ Ideas: "keep me" }), root, notebooks());
  assert.equal(hasFolder(root), false, "should not recreate a ghost Session Notes folder");
  assert.deepEqual(listMd(notebooks()), ["Ideas (recovered)"]);
  assert.equal(readFile(mdPath(notebooks(), "Ideas (recovered)")), "keep me");
});

// ---- migration ----
test("legacy Session Notes.md migrates into the folder as Session.md", () => {
  fresh();
  const root = project("Song");
  fs.writeFileSync(path.join(root, "Session Notes.md"), "legacy", "utf8");
  migrateLegacyProjectNote(root);
  assert.equal(fs.existsSync(path.join(root, "Session Notes.md")), false);
  assert.equal(readFile(mdPath(projectNotesDir(root), "Session")), "legacy");
});

test("legacy notebooks/ folder migrates to Global Notes/", () => {
  fresh();
  const legacy = path.join(tmp, "notebooks");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "Global.md"), "g", "utf8");
  migrateNotebooksDir(tmp);
  assert.equal(fs.existsSync(legacy), false, "old notebooks/ folder should be gone");
  const dest = path.join(tmp, "Global Notes");
  assert.deepEqual(listMd(dest), ["Global"]);
  assert.equal(readFile(mdPath(dest, "Global")), "g");
});

// ---- migration offer ----
test("offer fires for an empty project when the last one had notes", () => {
  fresh();
  const a = project("A");
  writeNote(a, "x", "1");
  writeNote(a, "y", "2");
  const b = project("B");
  assert.deepEqual(migrationOffer(b, { lastProject: { path: a, name: "A Project" } }), { fromPath: a, fromName: "A Project", count: 2 });
});

test("offer suppressed when project has notes / dismissed / source gone", () => {
  fresh();
  const a = project("A");
  writeNote(a, "x", "1");
  const b = project("B");
  writeNote(b, "own", "z");
  assert.equal(migrationOffer(b, { lastProject: { path: a, name: "A" } }), null);
  const c = project("C");
  assert.equal(migrationOffer(c, { lastProject: { path: a, name: "A" }, dismissed: [c] }), null);
  fs.rmSync(path.join(a, "Ableton Project Info"), { recursive: true });
  assert.equal(migrationOffer(c, { lastProject: { path: a, name: "A" } }), null);
});

test("no offer when landing IN a transient project, but a temp project IS a valid source", () => {
  fresh();
  const a = project("A");
  writeNote(a, "x", "1");
  // Landing in a brand-new unsaved Set ("Untitled Project" or a timestamped
  // "… Temp Project") must never nag - you don't pull notes into a throwaway.
  const untitled = path.join(tmp, "Untitled Project");
  fs.mkdirSync(path.join(untitled, "Ableton Project Info"), { recursive: true });
  const temp = project("2026-07-07 230052 Temp"); // -> "…2026-07-07 230052 Temp Project"
  assert.equal(migrationOffer(untitled, { lastProject: { path: a, name: "A Project" } }), null);
  assert.equal(migrationOffer(temp, { lastProject: { path: a, name: "A Project" } }), null);
  // But notes taken in a temp project SHOULD be offerable into a saved project -
  // the Save-As-then-keep-temp-files flow. The temp project is a valid source.
  writeNote(temp, "scratch", "s");
  const saved = project("Saved");
  const offer = migrationOffer(saved, { lastProject: { path: temp, name: path.basename(temp) } });
  assert.ok(offer && offer.fromPath === temp && offer.count === 1, "temp project should be offerable");
});

// ---- bring notes ----
test("bring copies every note across, never clobbering", () => {
  fresh();
  const a = project("A");
  writeNote(a, "x", "1");
  writeNote(a, "y", "2");
  const b = project("B");
  writeNote(b, "x", "already here");
  bringNotes(projectNotesDir(a), projectNotesDir(b));
  assert.deepEqual(noteNames(b), ["x", "x 2", "y"]);
  assert.equal(readFile(mdPath(projectNotesDir(b), "x")), "already here");
  assert.equal(readFile(mdPath(projectNotesDir(b), "x 2")), "1");
});

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
