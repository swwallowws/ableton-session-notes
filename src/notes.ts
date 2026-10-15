// Pure file/state logic for Session Notes - no SDK or Live dependency, so it can
// be unit-tested headlessly. The extension (extension.ts) wires these to the
// Live host. Set notes travel inside the Set (codec.ts, setdata.ts); this file
// keeps the global notes, which live in <storage>/Global Notes/, and builds the
// state the pad opens with.
import * as fs from "node:fs";
import * as path from "node:path";
import type { BackupSummary } from "./backups.js";

export type SavedState = {
  current?: string;
  size?: string;
  zoom?: number; // note text size in px (see interface.html ZOOM_LEVELS)
  kept?: Record<string, string>; // Set id -> backup rev the user chose not to restore
  migrated?: number; // 1 once notes from older installs were imported
};

export type Payload = {
  action: string; // "save" | "cancel" | "resize" | "timeline" | "restore" | "keep" | "retry"
  current?: string; // scoped id open at close
  lines?: string[]; // lyric lines to place on the arrangement (action "timeline")
  timelineMode?: string; // "locators" | "clips" (action "timeline")
  size?: string;
  zoom?: number; // note text size in px
  pick?: { id: string; rev: string }; // the backup chosen (actions "restore" / "keep")
  projectMap?: Record<string, string>; // every Set note, as the pad closes
  globalMap?: Record<string, string>;
  projectRenames?: { from: string; to: string }[];
  globalRenames?: { from: string; to: string }[];
  projectDeletes?: string[];
  globalDeletes?: string[]; // on-disk note names to remove
};

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

// Global notes only. Set notes are written into the Set by the host, separately,
// so a failure on one side never costs the other.
export const persistGlobal = (payload: Payload, globalDir: string) => {
  applyDeletes(globalDir, payload.globalDeletes);
  applyRenames(globalDir, payload.globalRenames);
  writeMap(globalDir, payload.globalMap);
};

// Whether the pad's Set notes differ from what it opened with. When they don't,
// the host leaves the Set alone: no write, no undo step, no "unsaved" Set.
export const setNotesChanged = (
  loaded: Record<string, string>,
  map: Record<string, string> | undefined,
): boolean => {
  if (!map) return false;
  const a = Object.keys(loaded);
  const b = Object.keys(map);
  if (a.length !== b.length) return true;
  return b.some((k) => !(k in loaded) || loaded[k] !== map[k]);
};

// Everything the webview needs: the Set's notes, the global notes, what to say
// (a notice from reconcile.ts), the restore list, and which note to open first.
export const buildState = (opts: {
  setNotes: Record<string, string>;
  globalDir: string;
  backupDir: string;
  saved: SavedState;
  defaultMd: string;
  hasData: boolean; // whether the Set already carries notes
  notice: unknown;
  backups: BackupSummary[];
  current?: string; // the note open when the Set's notes were last saved
}) => {
  const { globalDir, saved, defaultMd } = opts;
  const globalNotes: Record<string, string> = Object.fromEntries(
    listMd(globalDir).map((n) => [n, readFile(mdPath(globalDir, n))]),
  );
  // Seed a first note so there's something to write into. Named "Session", as in
  // earlier versions. Unedited, it never reaches the Set (setNotesChanged).
  const projectNotes: Record<string, string> = { ...opts.setNotes };
  if (Object.keys(projectNotes).length === 0) projectNotes["Session"] = defaultMd;

  const has = (id: string) =>
    (id.startsWith("p:") && id.slice(2) in projectNotes) ||
    (id.startsWith("g:") && id.slice(2) in globalNotes);
  const first = Object.keys(projectNotes).sort((a, b) => a.localeCompare(b))[0]!;

  // Reopen whatever was open last if this Set has it; otherwise the note that
  // was open when the Set's notes were saved; otherwise the first Set note.
  let current = "p:" + first;
  if (saved.current && has(saved.current)) current = saved.current;
  else if (opts.current && has("p:" + opts.current)) current = "p:" + opts.current;

  return {
    hasProject: true,
    setHasData: opts.hasData,
    backupDir: opts.backupDir,
    notebooksDir: globalDir,
    projectNotes,
    globalNotes,
    size: saved.size || "m",
    zoom: saved.zoom || 0, // 0 = default; interface.html resolves to a px size
    mac: process.platform === "darwin", // drives ⌘-vs-Ctrl shortcut labels
    notice: opts.notice,
    backups: opts.backups,
    current,
  };
};
