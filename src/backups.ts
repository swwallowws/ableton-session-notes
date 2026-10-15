// This computer's copy of each Set's notes, inside the extension's own storage
// dir (the only place the 12.4.15b7 sandbox lets it write). The Set carries the
// notes itself (codec.ts); these snapshots cover "closed without saving the
// Set", a deleted data clip, and Restore. Also the one-time import of notes from
// older installs, which lived in sibling folders under other author ids.
//
// <root>/Set Backups/<id>/<rev>.json   one snapshot per Done, last 20 kept
// <root>/Set Backups/damaged/*.json    raw names of data clips that didn't decode
import * as fs from "node:fs";
import * as path from "node:path";
import { type Bundle, newId, nextRev, revCounter } from "./codec.js";
import { freeName, listMd, mdPath, readFile } from "./notes.js";

export type BackupSummary = { id: string; rev: string; saved: string; titles: string[]; firstLine: string };

const SAFE_ID = /^[0-9a-z]{8}$/;
const SAFE_REV = /^\d+-[0-9a-z]{4}$/;
const DAMAGED = "damaged";

export const backupsDir = (root: string) => path.join(root, "Set Backups");

const isBundle = (x: any): x is Bundle =>
  !!x && x.v === 1 && typeof x.id === "string" && typeof x.rev === "string" && typeof x.saved === "string" && !!x.notes;

export function writeSnapshot(root: string, b: Bundle, keep = 20): void {
  // Ids and revs come from the Set, which anyone can edit: never let one name a path.
  if (!SAFE_ID.test(b.id) || !SAFE_REV.test(b.rev)) throw new Error("unsafe id or rev");
  const dir = path.join(backupsDir(root), b.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, b.rev + ".json"), JSON.stringify(b), "utf8");
  const all = history(root, b.id);
  for (const old of all.slice(keep)) {
    try {
      fs.unlinkSync(path.join(dir, old.rev + ".json"));
    } catch {
      /* already gone */
    }
  }
}

export function history(root: string, id: string): Bundle[] {
  if (!SAFE_ID.test(id)) return [];
  const dir = path.join(backupsDir(root), id);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: Bundle[] = [];
  for (const f of files) {
    try {
      const b = JSON.parse(readFile(path.join(dir, f)));
      if (isBundle(b) && b.id === id) out.push(b);
    } catch {
      /* skip an unreadable snapshot */
    }
  }
  return out.sort((a, b) => b.saved.localeCompare(a.saved) || revCounter(b.rev) - revCounter(a.rev));
}

const firstLineOf = (text: string) => {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l) ?? "";
  return line.length > 80 ? line.slice(0, 79) + "…" : line;
};

export function listBackups(root: string): BackupSummary[] {
  let ids: string[];
  try {
    ids = fs.readdirSync(backupsDir(root)).filter((d) => d !== DAMAGED && SAFE_ID.test(d));
  } catch {
    return [];
  }
  const out: BackupSummary[] = [];
  for (const id of ids) {
    const head = history(root, id)[0];
    if (!head) continue;
    const titles = Object.keys(head.notes);
    const shown = head.current && head.current in head.notes ? head.current : titles[0];
    out.push({ id, rev: head.rev, saved: head.saved, titles, firstLine: firstLineOf(shown ? head.notes[shown]! : "") });
  }
  return out.sort((a, b) => b.saved.localeCompare(a.saved));
}

export function dumpDamaged(root: string, names: string[]): string {
  const dir = path.join(backupsDir(root), DAMAGED);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}-${newId().slice(0, 4)}.json`);
  fs.writeFileSync(file, JSON.stringify(names), "utf8");
  return file;
}

// Notes worth carrying over: not empty and not the untouched starter note.
const worth = (text: string, defaultMd: string) => text.trim() !== "" && text.trim() !== defaultMd.trim();

const newestMtime = (files: string[]) => {
  let t = 0;
  for (const f of files) {
    try {
      t = Math.max(t, fs.statSync(f).mtimeMs);
    } catch {
      /* ignore */
    }
  }
  return new Date(t || Date.now()).toISOString();
};

// Older installs used other author ids, so their data sits in sibling folders
// "<author>.session-notes". Global notes join ours (never overwriting, exact
// duplicates skipped); unsaved-Set batches become backups, so they show in
// Restore. The caller records that this ran.
export function migrateOnce(root: string, globalDir: string, defaultMd: string): { globals: number; batches: number } {
  let globals = 0;
  let batches = 0;
  const parent = path.dirname(root);
  let siblings: string[];
  try {
    siblings = fs.readdirSync(parent).filter((n) => n.endsWith(".session-notes") && n !== path.basename(root));
  } catch {
    return { globals, batches };
  }
  const existing = () => new Set(listMd(globalDir).map((n) => readFile(mdPath(globalDir, n))));

  for (const sib of siblings) {
    const base = path.join(parent, sib);
    for (const sub of ["Global Notes", "notebooks"]) {
      const dir = path.join(base, sub);
      for (const name of listMd(dir)) {
        const text = readFile(mdPath(dir, name));
        if (!worth(text, defaultMd) || existing().has(text)) continue;
        fs.mkdirSync(globalDir, { recursive: true });
        fs.writeFileSync(mdPath(globalDir, freeName(globalDir, name)), text, "utf8");
        globals++;
      }
    }

    const staging = path.join(base, "Unsaved Notes");
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(staging);
    } catch {
      /* none */
    }
    const dirs = entries.map((e) => path.join(staging, e)).filter((p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
    for (const dir of [...dirs, staging]) {
      const notes: Record<string, string> = {};
      for (const name of listMd(dir)) {
        const text = readFile(mdPath(dir, name));
        if (worth(text, defaultMd)) notes[name] = text;
      }
      if (!Object.keys(notes).length) continue;
      const saved = newestMtime(listMd(dir).map((n) => mdPath(dir, n)));
      writeSnapshot(root, { v: 1, id: newId(), rev: nextRev(""), parent: "", saved, notes });
      batches++;
    }
  }
  return { globals, batches };
}
