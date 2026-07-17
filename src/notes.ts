// Pure file/state logic for Session Notes - no SDK or Live dependency, so it can
// be unit-tested headlessly. The extension (extension.ts) wires these to the
// Live host; detection of the project folder lives there since it needs Live.
// Project notes always live in <root>/Session Notes/.
import * as fs from "node:fs";
import * as path from "node:path";

export type SavedState = {
  current?: string;
  size?: string;
  zoom?: number; // note text size in px (see interface.html ZOOM_LEVELS)
  lastProject?: { path: string; name: string }; // most recent project with notes
  dismissed?: string[]; // project roots where the "bring notes" offer was declined
};

export type Payload = {
  action: string; // "save" | "cancel" | "resize" | "bring" | "timeline"
  current?: string; // scoped id open at close
  lines?: string[]; // lyric lines to place on the arrangement (action "timeline")
  timelineMode?: string; // "locators" | "clips" (action "timeline")
  size?: string;
  zoom?: number; // note text size in px
  dismissMigration?: boolean; // user declined the "bring notes" offer
  projectMap?: Record<string, string>;
  globalMap?: Record<string, string>;
  projectRenames?: { from: string; to: string }[];
  globalRenames?: { from: string; to: string }[];
  projectDeletes?: string[]; // on-disk note names to remove
  globalDeletes?: string[];
};

// `fromStaging` marks an offer whose `fromPath` is a staging notes dir (read
// directly), as opposed to a project root (read via its Session Notes subdir).
export type Offer = { fromPath: string; fromName: string; count: number; fromStaging?: boolean };

export const readFile = (p: string): string => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
};

export const sanitize = (name: string): string =>
  name.replace(/[\/\\:*?"<>|]/g, "_").trim() || "Untitled";

export const mdPath = (dir: string, name: string) =>
  path.join(dir, sanitize(name) + ".md");

export const listMd = (dir: string): string[] => {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
};

export const projectNotesDir = (root: string) => path.join(root, "Session Notes");

// The SDK never hands us the open .als path, so we recover the Set's own name
// from the project folder: the .als whose basename matches the folder, or the
// sole .als when there's only one. Returns null when it's ambiguous (several
// Sets, no match) so callers keep the folder name as the label. Note the label
// only - project notes stay available either way.
// Heuristic contributed by Axel LoganMolbert (PR #1).
export const resolveSetName = (root: string): string | null => {
  let als: string[];
  try {
    als = fs.readdirSync(root).filter((f) => f.toLowerCase().endsWith(".als"));
  } catch {
    return null;
  }
  if (!als.length) return null;
  const folder = path.basename(root);
  const match = als.find((f) => path.basename(f, ".als") === folder);
  if (match) return path.basename(match, ".als");
  if (als.length === 1 && als[0]) return path.basename(als[0], ".als");
  return null;
};

// --- per-Set staging (unsaved Sets have no project folder yet) --------------
// An unsaved Set's notes are staged in our own data dir until the Set is saved.
// Staging is keyed by the transient project path so two different unsaved Sets
// get separate subfolders and can't read each other's notes back (the
// cross-project "bleed"); the SAME unsaved Set reopens to its own notes.
// FNV-1a over the path -> a short, filesystem-safe, stable folder name.
export const stagedRootKey = (root: string): string => {
  let h = 2166136261;
  for (let i = 0; i < root.length; i++) {
    h ^= root.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "s" + (h >>> 0).toString(36);
};

export const stagedNotesDir = (stagingDir: string, root: string): string =>
  path.join(stagingDir, stagedRootKey(root));

// The project-notes location the host reads AND writes for an open Set: a per-Set
// staging subfolder while the Set is transient (unsaved), or undefined meaning
// "<root>/Session Notes" once saved. Passed to both buildState and persist so
// reads and writes always agree.
export const stagingOverride = (
  stagingDir: string,
  root: string,
  transient: boolean,
): string | undefined => (transient ? stagedNotesDir(stagingDir, root) : undefined);

// Candidate staged batches to offer when landing in a saved, empty project: each
// per-Set subfolder, plus any legacy notes older versions wrote loose directly in
// stagingDir. Callers filter by real (non-default) content and pick by recency.
export const stagedBatches = (stagingDir: string): string[] => {
  const dirs: string[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(stagingDir);
  } catch {
    return dirs;
  }
  for (const e of entries) {
    const full = path.join(stagingDir, e);
    try {
      if (fs.statSync(full).isDirectory()) dirs.push(full);
    } catch {
      /* ignore */
    }
  }
  if (listMd(stagingDir).length) dirs.push(stagingDir); // legacy loose files
  return dirs;
};

// Ableton parks a not-yet-saved Set in a throwaway project folder: either
// "Untitled Project" or a timestamped "… Temp Project" under Live Recordings
// (the latter is what the import-probe creates for an audio-less unsaved Set).
// We don't prompt the "bring notes" offer when landing IN one (you don't pull
// notes into a throwaway) - but a temp project CAN still be an offer *source*,
// so notes taken in an unsaved Set carry into the real project once it's saved
// (keeping the temp files when Ableton prompts).
export const isTransientProject = (root: string) => {
  const base = path.basename(root);
  return base === "Untitled Project" || / Temp Project$/.test(base);
};

// Earlier versions wrote a single <root>/Session Notes.md file. Fold it into the
// new <root>/Session Notes/ folder so existing notes aren't orphaned.
export const migrateLegacyProjectNote = (root: string) => {
  const legacy = path.join(root, "Session Notes.md");
  try {
    if (!fs.existsSync(legacy) || !fs.statSync(legacy).isFile()) return;
    const dir = projectNotesDir(root);
    fs.mkdirSync(dir, { recursive: true });
    // "Session Notes" is the folder name; don't reuse it for the file.
    const dest = path.join(dir, "Session.md");
    if (!fs.existsSync(dest)) fs.renameSync(legacy, dest);
  } catch {
    /* ignore - worst case the legacy file just stays where it was */
  }
};

// Earlier versions stored global notes in a "notebooks" folder; they're now
// called Global Notes. Fold the old folder into the new name (visible in the
// path bar) so nothing orphans. Runs once - after that the legacy folder is gone.
export const migrateNotebooksDir = (baseDir: string) => {
  const legacy = path.join(baseDir, "notebooks");
  const dest = path.join(baseDir, "Global Notes");
  try {
    if (!fs.existsSync(legacy) || !fs.statSync(legacy).isDirectory()) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(legacy)) {
      if (!f.endsWith(".md")) continue;
      const to = path.join(dest, f);
      if (!fs.existsSync(to)) fs.renameSync(path.join(legacy, f), to);
    }
    try {
      if (fs.readdirSync(legacy).length === 0) fs.rmdirSync(legacy);
    } catch {
      /* leftover non-md files - leave the old folder in place */
    }
  } catch {
    /* ignore - worst case the old notes stay under notebooks/ */
  }
};

// A name that isn't already taken as a .md in dir (for safe recovery writes).
export const freeName = (dir: string, base: string): string => {
  let nm = base;
  for (let i = 2; fs.existsSync(mdPath(dir, nm)); i++) nm = base + " " + i;
  return nm;
};

// Apply renames before writing so the moved file gets fresh content and no stale
// copy is left behind under the old name.
export const applyRenames = (
  dir: string,
  renames?: { from: string; to: string }[],
) => {
  if (!Array.isArray(renames)) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const r of renames) {
    if (!r || !r.from || !r.to) continue;
    const from = mdPath(dir, r.from);
    const to = mdPath(dir, r.to);
    try {
      if (from !== to && fs.existsSync(from)) {
        if (fs.existsSync(to)) fs.unlinkSync(to);
        fs.renameSync(from, to);
      }
    } catch {
      /* ignore - the map write below still saves the content */
    }
  }
};

export const writeMap = (dir: string, map?: Record<string, string>) => {
  if (!map || typeof map !== "object") return;
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(map))
    fs.writeFileSync(mdPath(dir, name), text, "utf8");
};

export const applyDeletes = (dir: string, names?: string[]) => {
  if (!Array.isArray(names)) return;
  for (const name of names) {
    try {
      fs.unlinkSync(mdPath(dir, name));
    } catch {
      /* already gone */
    }
  }
};

// Copy every note from one project's folder into another, never clobbering.
// Returns the first note's landing name, so the pad can reopen on it.
export const bringNotes = (fromDir: string, toDir: string): string | null => {
  fs.mkdirSync(toDir, { recursive: true });
  let firstDest: string | null = null;
  for (const name of listMd(fromDir)) {
    const dest = freeName(toDir, name);
    if (!firstDest) firstDest = dest;
    fs.writeFileSync(mdPath(toDir, dest), readFile(mdPath(fromDir, name)), "utf8");
  }
  return firstDest;
};

// A Save-As spins up a fresh project folder that Ableton doesn't copy our notes
// into. When we open in a project that has none of its own but the last project
// we took notes in still does, offer to bring those across.
export const migrationOffer = (
  root: string | null,
  st: SavedState,
): Offer | null => {
  if (!root) return null;
  if (isTransientProject(root)) return null; // never offer INTO a throwaway/unsaved Set
  if (listMd(projectNotesDir(root)).length > 0) return null; // has its own notes
  if ((st.dismissed || []).includes(root)) return null; // already declined here
  const last = st.lastProject; // fed from the current session's last-noted project
  if (!last || !last.path || last.path === root) return null;
  if (!fs.existsSync(path.join(last.path, "Ableton Project Info"))) return null;
  const count = listMd(projectNotesDir(last.path)).length;
  if (count === 0) return null;
  return { fromPath: last.path, fromName: last.name, count };
};

// Gather everything the webview needs: project notes, global notebooks, the
// remembered window size, a pending "bring notes" offer, and which note to open
// first. `offer` is set when this (empty) project could inherit notes.
export const buildState = (
  root: string | null,
  offer: { fromName: string; count: number } | null,
  opts: {
    notebooksDir: string;
    saved: SavedState;
    defaultMd: string;
    // When set, project notes are read from here instead of <root>/Session Notes.
    // Used to stage an unsaved Set's notes in the extension's own data dir, out of
    // reach of Ableton's "Delete temp files" (which nukes the temp project folder).
    projNotesDir?: string | undefined;
  },
) => {
  const { notebooksDir, saved, defaultMd } = opts;
  const globalNotes: Record<string, string> = Object.fromEntries(
    listMd(notebooksDir).map((n) => [n, readFile(mdPath(notebooksDir, n))]),
  );

  let projectName: string | null = null;
  let projectDir: string | null = null;
  let projNotesDir: string | null = null;
  const projectNotes: Record<string, string> = {};
  if (root) {
    // Staging keeps its own flat folder; only a real project has a legacy note.
    if (!opts.projNotesDir) migrateLegacyProjectNote(root);
    projectName = resolveSetName(root) ?? path.basename(root);
    projectDir = root;
    projNotesDir = opts.projNotesDir ?? projectNotesDir(root);
    for (const n of listMd(projNotesDir))
      projectNotes[n] = readFile(mdPath(projNotesDir, n));
    // Seed a first note so there's something to write into on save - but not
    // while offering to bring notes in, so the picker stays clean. Named "Session"
    // ("Session Notes" is the folder, not a file inside it).
    if (Object.keys(projectNotes).length === 0 && !offer)
      projectNotes["Session"] = defaultMd;
  }

  const has = (id: string) =>
    (id.startsWith("p:") && id.slice(2) in projectNotes) ||
    (id.startsWith("g:") && id.slice(2) in globalNotes);
  const first = (o: Record<string, string>) =>
    Object.keys(o).sort((a, b) => a.localeCompare(b))[0];

  // Reopen whatever was open last; otherwise the first project note, then the
  // first global notebook (seeding one if there are none at all).
  let current: string;
  const projFirst = first(projectNotes);
  if (saved.current && has(saved.current)) current = saved.current;
  else if (root && projFirst) current = "p:" + projFirst;
  else {
    let g = first(globalNotes);
    if (!g) {
      g = "Global";
      globalNotes[g] = defaultMd;
    }
    current = "g:" + g;
  }

  return {
    hasProject: !!root,
    projectName,
    projectDir,
    projectNotesDir: projNotesDir,
    notebooksDir,
    projectNotes,
    globalNotes,
    size: saved.size || "m",
    zoom: saved.zoom || 0, // 0 = default; interface.html resolves to a px size
    mac: process.platform === "darwin", // drives ⌘-vs-Ctrl shortcut labels
    migration: offer,
    current,
  };
};

export const persist = (
  payload: Payload,
  root: string | null,
  notebooksDir: string,
  // When set, project notes are written here (the staging dir for an unsaved Set)
  // instead of <root>/Session Notes. Staging is always ours to write, so it skips
  // the vanished-project-folder guard below.
  projNotesDirOverride?: string,
) => {
  if (root && projNotesDirOverride) {
    applyDeletes(projNotesDirOverride, payload.projectDeletes);
    applyRenames(projNotesDirOverride, payload.projectRenames);
    writeMap(projNotesDirOverride, payload.projectMap);
  } else if (root) {
    const dir = projectNotesDir(root);
    // Only write into the project if its folder is still there. If it was
    // renamed or moved while the pad was open, writing would recreate a ghost
    // folder at the stale path - so instead keep the edits by recovering them
    // into global notebooks (under a non-colliding name) rather than lose them.
    if (fs.existsSync(path.join(root, "Ableton Project Info"))) {
      applyDeletes(dir, payload.projectDeletes);
      applyRenames(dir, payload.projectRenames);
      writeMap(dir, payload.projectMap);
    } else if (payload.projectMap) {
      fs.mkdirSync(notebooksDir, { recursive: true });
      for (const [name, text] of Object.entries(payload.projectMap)) {
        const nm = freeName(notebooksDir, name + " (recovered)");
        fs.writeFileSync(mdPath(notebooksDir, nm), text, "utf8");
      }
    }
  }
  applyDeletes(notebooksDir, payload.globalDeletes);
  applyRenames(notebooksDir, payload.globalRenames);
  writeMap(notebooksDir, payload.globalMap);
};
