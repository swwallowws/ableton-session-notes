# Sandbox Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Session Notes keeps working under Live 12.4.15b7's extension sandbox: Set notes live inside the Set (a data clip), with a local backup; global notes stay local and always save.

**Architecture:** Four focused modules: `codec.ts` (bundle to clip names and back, pure), `reconcile.ts` (decides what the pad shows, pure), `backups.ts` (snapshots, restore list, damaged dumps, one-time migration, file system inside the storage dir only), `setdata.ts` (finds and writes the data lane through the SDK). `extension.ts` wires them and loses project detection and staging. `notes.ts` keeps only global-note file logic and state building.

**Tech Stack:** TypeScript, Node 24 in the extension host (`zlib` Brotli and `crc32`), esbuild, tsx test scripts, Ableton Extensions SDK 1.0.0-beta.0.

**Spec:** `docs/superpowers/specs/2026-10-15-sandbox-storage-design.md`

## Global Constraints

- The extension may only touch `context.environment.storageDirectory` and `tempDirectory`. No `fs` call on any other path.
- Data clip name format: `SN1 <id> <part>/<total> <byteLength> <chunk>`; chunk at most 16,000 characters; base16384 alphabet U+4E00 + n.
- Bundle `v` is 1. `id` is 8 base36 characters. `rev` is `<counter>-<4 base36>`.
- Data lane name: `Session Notes data`. Track name: `Session Notes` (a legacy `Lyrics` track is reused).
- Opening the pad without changing Set notes never writes to the Set.
- Backups keep the last 20 snapshots per id.
- Never delete take-lane clips (untested in the SDK): rename in place, create more, blank leftovers.
- No em dashes in code, comments, copy or commits. Match the file's existing comment style.
- Tests are tsx scripts using `node:assert/strict` and the repo's `test()` helper pattern; CI runs on Node 22.

## Review Focus

1. A bundle bigger than one clip (more than 16,000 characters encoded): must round-trip across several clips. Test in Task 1.
2. A user renames, deletes or edits one data clip: decode must report damage, not crash or return wrong notes. Test in Task 1 (missing part, edited char) and Task 2 (damaged row).
3. Opening and pressing Done without edits: must not write to the Set. Test in Task 4 (`setNotesChanged`).
4. A failed clip write followed by a retry: must not be taken for a fork. Test in Task 2 (`isFork` with excluded revs).
5. Old notes in sibling author folders with name clashes: must import without overwriting. Test in Task 3.

---

### Task 1: codec

**Files:**
- Create: `src/codec.ts`
- Test: `test/codec.test.ts`

**Interfaces:**
- Produces:
  - `type Bundle = { v: 1; id: string; rev: string; parent: string; saved: string; current?: string; forkedFrom?: string; notes: Record<string, string> }`
  - `type Damaged = { id: string | null; reason: string; names: string[] }`
  - `encodeBundle(b: Bundle, chunkChars?: number): string[]`
  - `decodeNames(names: string[]): { bundles: Bundle[]; damaged: Damaged[] }`
  - `isDataName(name: string): boolean`
  - `newId(): string`, `nextRev(parent: string): string`, `revCounter(rev: string): number`
  - `toBase16384(bytes: Uint8Array): string`, `fromBase16384(s: string, byteLength: number): Uint8Array`

- [ ] Step 1: Write `test/codec.test.ts` covering: base16384 round trip for lengths 0..40 and random bytes; bundle round trip (empty notes, one note, emoji and line breaks, 200 KB of random text that forces several clips with `chunkChars` default); a changed body character reports damage with the id kept; a missing part reports `reason: "missing part"`; unknown `v` is refused; non-data names are ignored; two complete bundles with different ids both come back; `nextRev("3-ab12")` starts with `4-`, `nextRev("")` starts with `1-`.
- [ ] Step 2: Run `node_modules/.bin/tsx test/codec.test.ts`, expect failure (module missing).
- [ ] Step 3: Implement `src/codec.ts`: JSON, `brotliCompressSync` (text mode, quality 11), 4-byte big-endian `crc32` prefix, base16384, chunking, header parsing with a regex `^SN1 ([0-9a-z]{8}) (\d+)\/(\d+) (\d+) (.*)$`s, grouping by id, CRC check, `brotliDecompressSync`, `JSON.parse`, `v === 1` check, all inside try/catch so any failure becomes a `Damaged` entry.
- [ ] Step 4: Run the test, expect all pass.
- [ ] Step 5: Commit `codec: Set notes bundle to clip names and back`.

### Task 2: reconcile

**Files:**
- Create: `src/reconcile.ts`
- Test: `test/reconcile.test.ts`

**Interfaces:**
- Consumes: `Bundle`, `Damaged`, `revCounter` from Task 1.
- Produces:
  - `type Notice = { kind: "newer"; text: string; restore: Bundle } | { kind: "damaged"; text: string; restore: Bundle | null } | { kind: "choose"; text: string; options: Bundle[] }`
  - `type Decision = { notes: Record<string, string>; id: string | null; base: string; current?: string; notice: Notice | null; adopt: Bundle | null }`
  - `reconcile(input: { bundles: Bundle[]; damaged: Damaged[]; history: (id: string) => Bundle[]; kept: Record<string, string> }): Decision` (history newest first)
  - `descends(history: Bundle[], from: string, to: string): boolean`
  - `isFork(history: Bundle[], parent: string, writing: string, exclude: Set<string>): boolean`
  - `timeLabel(iso: string): string` (local HH:MM, or date when not today)

- [ ] Step 1: Write tests, one per spec table row: same rev, no backup (adopt), backup newer and descends (newer notice, and none when `kept[id] === head.rev`), Set newer (adopt), Set rev unknown to a newer non-descending backup (use Set, adopt), damaged with history (restore head) and without, no data (empty, null id), two ids (choose, shows the newest). Plus `isFork`: sibling found; own excluded rev ignored; no sibling for a linear chain.
- [ ] Step 2: Run, expect failure.
- [ ] Step 3: Implement as pure functions. Texts: `Newer notes from <time> weren't saved into the set.`, `This set's notes are damaged. The last backup is from <time>.` / `This set's notes are damaged and there is no backup.`, `This set holds notes from two sets. Which belong here?`.
- [ ] Step 4: Run, expect pass.
- [ ] Step 5: Commit `reconcile: decide which notes the pad shows`.

### Task 3: backups

**Files:**
- Create: `src/backups.ts`
- Test: `test/backups.test.ts`

**Interfaces:**
- Consumes: `Bundle`, `nextRev`, `newId` from Task 1; `freeName`, `mdPath`, `listMd`, `readFile` from `notes.ts`.
- Produces:
  - `type BackupSummary = { id: string; rev: string; saved: string; titles: string[]; firstLine: string }`
  - `backupsDir(root: string): string` (`<root>/Set Backups`)
  - `writeSnapshot(root: string, b: Bundle, keep?: number): void`
  - `history(root: string, id: string): Bundle[]`
  - `listBackups(root: string): BackupSummary[]`
  - `dumpDamaged(root: string, names: string[]): string`
  - `migrateOnce(root: string, globalDir: string): { globals: number; batches: number }`

- [ ] Step 1: Tests in a temp dir: snapshot write and history order; retention keeps 20; `listBackups` gives one head per id, newest first, titles and first line; `dumpDamaged` writes a file under `Set Backups/damaged`; `migrateOnce` with two sibling folders (`notebooks/` and `Global Notes/`, a clash gets " 2"), an `Unsaved Notes` subfolder and loose file become backups, the default seed note is skipped, our own folder is ignored, a non-`.session-notes` sibling is ignored.
- [ ] Step 2: Run, expect failure.
- [ ] Step 3: Implement. Snapshot file: `<root>/Set Backups/<id>/<rev>.json`. Prune by `saved` ascending. `migrateOnce` reads `dirname(root)` siblings ending in `.session-notes`, skipping `basename(root)`.
- [ ] Step 4: Run, expect pass.
- [ ] Step 5: Commit `backups: local snapshots, restore list and old-notes import`.

### Task 4: notes.ts slimmed

**Files:**
- Modify: `src/notes.ts` (drop project, staging and migration-offer code)
- Rewrite: `test/notes.test.ts` (keep tests for what remains)

**Interfaces:**
- Produces:
  - `persistGlobal(payload: Payload, globalDir: string): void`
  - `setNotesChanged(loaded: Record<string, string>, map: Record<string, string> | undefined): boolean`
  - `buildState(opts: { setNotes: Record<string, string>; globalDir: string; backupDir: string; saved: SavedState; defaultMd: string; hasData: boolean; notice: unknown; backups: BackupSummary[]; current?: string }): object`
  - `SavedState` gains `kept?: Record<string, string>` and `migrated?: number`; `Payload` gains `pick?: { id: string; rev: string }`.

- [ ] Step 1: Tests: `persistGlobal` writes, renames and deletes only in the global dir; `setNotesChanged` false for identical maps (also key order), true for an edit, an added or removed note, and for an undefined map false; `buildState` seeds `Session` with the default note when there are no Set notes, keeps `current` when it exists, falls back to the first Set note, puts a global seed when needed.
- [ ] Step 2: Run, expect failure.
- [ ] Step 3: Implement; remove `projectNotesDir`, `resolveSetName`, staging helpers, `migrationOffer`, `bringNotes`, `isTransientProject`, `migrateLegacyProjectNote`, `persist`.
- [ ] Step 4: Run all tests, expect pass.
- [ ] Step 5: Commit `notes: global notes only, Set notes come from the Set`.

### Task 5: setdata (SDK)

**Files:**
- Create: `src/setdata.ts`
- Modify: `src/extension.ts` (lyric clips use the Session Notes track)

**Interfaces:**
- Produces:
  - `DATA_LANE = "Session Notes data"`, `NOTES_TRACK = "Session Notes"`, `LEGACY_TRACK = "Lyrics"`
  - `readDataNames(song: any): string[]`
  - `findNotesTrack(song: any): any | null`
  - `ensureNotesTrack(song: any): Promise<any>`
  - `writeDataNames(context: any, song: any, names: string[]): Promise<void>` (rename in place, create the rest in one transaction, name in a second, blank leftovers to `Session Notes data (unused)`)
- No unit test (needs Live); covered by `tsc --noEmit` and the manual check.

- [ ] Step 1: Implement with every SDK access guarded like the existing code.
- [ ] Step 2: Point `sendLyricsToTimeline` at `ensureNotesTrack`.
- [ ] Step 3: `node_modules/.bin/tsc --noEmit`, expect no errors.
- [ ] Step 4: Commit `setdata: read and write the data lane`.

### Task 6: extension wiring

**Files:**
- Modify: `src/extension.ts`

- [ ] Step 1: `activate`: run `migrateOnce` when `state.migrated !== 1`, then set it.
- [ ] Step 2: `notes.open`: read names, `decodeNames`, dump damaged raw names once per open, `reconcile`, `buildState`, show the pad.
- [ ] Step 3: Save path (`save`, `resize`, `timeline`): `persistGlobal` in its own try; if `setNotesChanged`, build the bundle (`id` from the decision or `newId()`, `rev = nextRev(base)`, `parent = base`), `isFork` against history minus failed revs gives a new id with `forkedFrom`, `writeSnapshot`, `writeDataNames`, then poll `readDataNames` up to 10 x 100 ms for the written rev. On failure, remember the rev as failed and reopen with a `writeFailed` notice (`Saved on this computer, but couldn't write into the set.`, buttons Try again / Close).
- [ ] Step 4: Actions `restore` (load `pick` from history into the pad as unsaved changes, base = picked rev) and `keep` (store `kept[id] = rev`), both reopen.
- [ ] Step 5: Remove detection, probe and staging code.
- [ ] Step 6: `tsc --noEmit`, all tests, build. Commit `extension: Set notes through the data clip`.

### Task 7: pad (interface.html)

**Files:**
- Modify: `src/interface.html`

- [ ] Step 1: Set group label `This set`; hint for Set notes before the Set holds any: `Set notes are saved inside the set. Save the set to keep them.`; global hint: `This is a global note. It stays on this computer and looks the same in every set.`
- [ ] Step 2: Notice bar from `STATE.notice` (newer, damaged, choose, writeFailed) using the existing `migrate` bar; buttons post `restore`, `keep`, `save`, or close the bar.
- [ ] Step 3: `Restore from backup…` in the note menu opens a panel listing `STATE.backups`; a pick posts `restore` with `pick`.
- [ ] Step 4: Path bar for Set notes: `Saved inside this set. Backup: <backupDir>`; copy copies the backup dir.
- [ ] Step 5: Dropping `.md` files adds them as Set notes (FileReader, `freeName`-style suffixes).
- [ ] Step 6: Smoke check: render the pad with sample states in headless Chrome (showcase's playwright-core), screenshot each notice, no console errors. Commit `pad: notices, restore list, .md drop, new wording`.

### Task 8: release prep

**Files:**
- Modify: `package.json` (test script, version 0.3.0), `manifest.json` (0.3.0), `.github/workflows/ci.yml` (new test files), `README.md` (storage wording, old notes)

- [ ] Step 1: Add the new test files to `npm test` and CI.
- [ ] Step 2: README: Features "Two kinds of notes" and Install notes on old notes. Showcase and Discord wait for the user.
- [ ] Step 3: Bump to 0.3.0, `npm run package`, check the `.ablx` lists only `manifest.json` and `dist/extension.js`.
- [ ] Step 4: Commit `v0.3.0: notes saved inside the set`. Do not push or release.
