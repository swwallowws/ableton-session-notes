# Session Notes storage under the extension sandbox

Date: 2026-10-15. Status: design, awaiting review.

## Why

Ableton Live 12.4.15 beta 7 runs extensions under Node's permission model. The
extension host starts with read access to `Extensions` and `Extensions Data`
and write access to `Extensions Data` and a temp folder, nothing else. Verified
with Live's own Node (v24.14.1) and the same flags: on any other path,
`fs.existsSync`, `readdirSync` and `mkdirSync` throw `ERR_ACCESS_DENIED`.

Consequences in v0.2.5:

- Set notes can't be read from or written to `<Project>/Session Notes/`.
- `persist` calls `existsSync` on the project before writing, it throws, and
  the whole save aborts, so global notes are lost too.
- The project-detection probe WAV is imported into the project but can't be
  deleted, so every pad open leaves a file in `Samples/Imported/`.
- The SDK exposes no Set name, path or id.

The sandbox is assumed permanent. The goal is a design that keeps notes safe
and lets them travel with the Set without any access to the project folder.

## Goals

1. No note is ever lost silently.
2. A Set's notes travel inside the Set: Save As, moving or renaming the project
   folder, duplicating it, another computer, a collaborator.
3. When the pad can't be sure which version is right, it asks.
4. Global notes always save, whatever happens with Set notes.
5. Opening the pad without editing never changes the Set.

Out of scope: encryption, syncing between computers beyond what the Set
carries, any access to the project folder.

## Spike results (2026-10-15, Live 12.4.15b7)

A throwaway extension wrote test data into a Set, then read it back after save,
close and reopen:

- Clip names of 64 to 16,384 characters in ASCII, CJK and mixed Unicode
  (emoji, NBSP, line break, tab) came back exactly.
- MIDI pitch, start time, duration, velocity and per-note mute came back
  exactly for 5,000 notes; release velocity is not returned by the SDK.
- A take lane created by the SDK, with 18 clips, survived; the Set's length did
  not change. In this beta the new lane showed expanded.
- Writes not wrapped in `withinTransaction` produce one undo step each.

Decision: the carrier is the clip name. MIDI is not used.

## Design

### 1. Where things live

| What | Where |
|---|---|
| Set notes (source of truth) | Inside the Set: data clip(s) on the "Session Notes data" take lane |
| Set notes backup | `<storage>/Set Backups/<id>/` |
| Global notes | `<storage>/Global Notes/` (unchanged) |
| Pad state | `<storage>/state.json` |

`<storage>` is `context.environment.storageDirectory`, which the sandbox allows.

### 2. The Session Notes track

- One MIDI track per Set, named "Session Notes", with no devices, so it can
  never sound. It is created on the first Done that saves Set notes, never on
  a plain open.
- The track holds both the data lane and the lyric clips (arrangement main
  lane). A Set that already has a "Lyrics" track from v0.2.x keeps using it for
  lyric clips and also gets the data lane, so no second track appears.
- Finding the data: first any take lane named "Session Notes data" on any
  track (so renaming the track doesn't break anything), then the track named
  "Session Notes", then "Lyrics".
- Data clips sit on the lane at start times 0, 4, 8, ... with a 1-beat length.
  They are empty MIDI clips. Only their names carry data.

### 3. The data format

A bundle of the Set's notes:

```json
{ "v": 1, "id": "7f3k2q9a", "rev": "12-x4p1", "parent": "11-b8d0",
  "saved": "2026-10-15T14:32:05Z", "current": "Whole Again",
  "notes": { "Whole Again": "...", "lyrics": "..." } }
```

- `id`: 8 random base36 characters, minted the first time a Set saves notes.
- `rev`: `<counter>-<4 random base36>`, unique even when two copies edit the
  same parent. `parent` is the rev the edit started from (empty for the first).

Encoding, in order:

1. `JSON.stringify(bundle)` as UTF-8.
2. `zlib.brotliCompressSync` with `BROTLI_MODE_TEXT`, quality 11.
3. Prefix a CRC32 (`zlib.crc32`, 4 bytes, big endian) of the compressed bytes.
4. Base16384: each 14 bits becomes one character `U+4E00 + n` (range
   U+4E00 to U+8DFF, all assigned CJK ideographs, tested in the spike).
5. Split into chunks of at most 16,000 characters.

Each clip name: `SN1 <id> <part>/<total> <byteLength> <chunk>`. The header is
plain ASCII, so the id and part count survive even if the body is damaged.

Decoding reverses this: collect parts 1..total for one id, check all are
present, decode base16384, check the CRC, decompress, parse, check `v`.

Capacity: 16,000 characters carry 28,000 bytes compressed, about 60 to 80 KB of
Markdown per clip. Larger bundles use more clips.

### 4. Saving (Done, resize, sending lyrics)

Global and Set notes are saved independently. A failure in one never stops the
other.

1. Global notes: write to `Global Notes/` as today, in its own try/catch.
2. Set notes, only if they changed since the pad opened:
   1. Build the bundle with a new rev whose parent is the rev the pad opened.
   2. Write the backup snapshot (always allowed).
   3. Fork check (section 6).
   4. Write the data clips: delete old data clips and create new ones in one
      `withinTransaction`, then name them in a second one (two undo steps,
      the same pattern lyric clips already use).
   5. Read the names back and decode. If that fails or doesn't match, reopen
      the pad with a bar: "Saved on this computer, but couldn't write into the
      Set. Try again". Nothing is lost: the backup has it.
3. Ableton Live now shows the Set as changed and asks to save on close.

### 5. Opening

The pad decodes the Set's data (if any) and reads the backup for that id, then
decides with one pure function, `reconcile(setData, backup, state)`:

| Found | Action |
|---|---|
| Data in the Set, same rev as backup head, or no backup | Use the Set's notes. A Set from another computer gets a backup created. |
| Data in the Set; backup head is newer and descends from the Set's rev | Use the Set's notes and show a bar: "Newer notes from 14:32 weren't saved into the Set. Restore / Keep the Set's". "Keep" is remembered per id and rev so it doesn't ask again. |
| Data in the Set is newer than the backup | Use the Set's notes and add them to the backup. |
| Data in the Set is damaged (missing part, CRC or parse failure) | Save the raw names to `Set Backups/damaged/<time>.txt`, then offer the latest backup for the id from the header. Never overwrite the damaged clips before the user chooses. |
| No data in the Set | Start with one empty note. Show a quiet "Restore notes from a backup..." link (section 7). |
| Two different ids in the Set | Ask which belongs to this Set; the other stays in its backup. |

### 6. Save As copies that drift apart

Save As copies the data clips, so both Sets share an id until one of them
edits. On Done, if the backup for this id already holds a rev with the same
parent as the one being written, and it isn't this pad's own previous write,
the two Sets have diverged. The Set being saved then gets a new id (the bundle
records `forkedFrom`). From then on the copies have separate backups.

Known false positive: pressing Done, undoing the data-clip write in Ableton
Live, then pressing Done again also writes a sibling, so that Set gets a new
id. Nothing is lost; its notes simply continue under the new id.

### 7. Restore from a backup

Lists backups newest first: the note titles, the first line of the current
note, and the save time. Picking one loads its notes into the pad; Done writes
them into the Set under that backup's id, with the backup's head as parent. If
another Set has since written to that id, the fork check (section 6) gives this
Set a new id. The SDK has no Set name, so titles and first lines are what
identify a Set.

### 8. Bringing old notes across (once)

Runs on first launch of this version, recorded in `state.json` as
`migrated: 1`. Never overwrites: name clashes get " 2", " 3".

- Global notes from sibling folders `*.session-notes` in `Extensions Data`
  (author ids `bengybade`, `somaluden`, `bengisu-somaluden`), both `notebooks/`
  and `Global Notes/`, are copied into `Global Notes/`.
- Their `Unsaved Notes/` batches become backups, so they appear in Restore.
- Notes inside project folders can't be read by the extension. The pad accepts
  `.md` files dropped onto it (read in the web view, no file system access
  needed) and adds each as a note. The release notes explain this.

### 9. Removed

Project-folder detection (sample paths and the probe import), the probe WAV,
the `Unsaved Notes` staging, the "bring notes from your last project" offer and
the vanished-folder recovery. The data clip makes all of them unnecessary:
an unsaved Set carries its clip like a saved one, and Save As copies it.

### 10. Wording

- Pad and README: "Set notes are saved inside the Set and travel with it.
  Global notes stay on this computer and are in every Set."
- The path bar for a Set note says "Saved in this Set" with the backup folder
  as a secondary line; global notes keep their folder path.
- Showcase beat "Notes that live with the set" keeps its title; its text
  becomes "Set notes travel inside the set; global notes are in every set."
- Video Take 2 drops the "reveal the folder" shot. The lyrics track in Take 1
  is now called "Session Notes".

### 11. Units

- `codec.ts`: bundle to clip names and back. Pure, no SDK.
- `reconcile.ts`: the decision table in section 5 and the fork check in
  section 6. Pure.
- `backups.ts`: snapshots, retention (last 20 per id), index, damaged dumps,
  one-time migration. File system only, inside `<storage>`.
- `setdata.ts`: find, read and write the data lane through the SDK.
- `extension.ts`: wiring; loses the detection and staging code.
- `interface.html`: the bars, the Restore list, `.md` drop, wording.

### 12. Testing

- Codec: round trips (empty, one note, many notes, emoji, 200 KB forcing
  several clips), a flipped character fails the CRC, a missing part is
  reported, unknown `v` is refused.
- Reconcile: one test per table row, plus fork detection and "Keep" memory.
- Backups: retention, migration with clashes, damaged dumps, all in a temp dir.
- Save independence: a throwing Set write still saves global notes.
- Manual, once, in the beta: write a note, Done, save, quit, reopen, note is
  there; then Save As, edit both copies, check they split.

### 13. Release

v0.3.0 (storage change). Release notes cover where notes live now, the
one-time import of old global notes, and dragging old `.md` files in.
