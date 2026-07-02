import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import interfaceHtml from "./interface.html";

// There is no global/Song scope, so we attach to the object types reachable
// almost everywhere you right-click.
const SCOPES = ["AudioTrack", "MidiTrack", "ClipSlot", "Scene"] as const;

// Seeded into a pad that has no content yet.
const DEFAULT_MD =
  "# TO-DO\n- [x] Create new pad file\n- [ ] Capture lyrics, ideas and to-dos…\n\n# LYRICS\n♪\n";

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  const baseDir =
    context.environment.storageDirectory ||
    path.join(os.homedir(), ".ableton-extensions", "lyrics-pad");
  const notebooksDir = path.join(baseDir, "notebooks");
  const stateFile = path.join(baseDir, "state.json");
  const legacyMd = path.join(baseDir, "lyrics.md");
  const legacyTxt = path.join(baseDir, "lyrics.txt");

  // ---- filesystem helpers -------------------------------------------------
  const readFile = (p: string): string => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };
  const sanitize = (name: string): string =>
    name.replace(/[\/\\:*?"<>|]/g, "_").trim() || "Untitled";
  const notebookPath = (name: string) =>
    path.join(notebooksDir, sanitize(name) + ".md");

  // Migration: (a) rename a previously-created "General" notebook to "Global";
  // (b) move the old single global note into a "Global" notebook.
  const ensureMigrated = () => {
    try {
      const general = notebookPath("General");
      const global = notebookPath("Global");
      if (fs.existsSync(general) && !fs.existsSync(global))
        fs.renameSync(general, global);
      if (readState().current === "General") writeState({ current: "Global" });
    } catch {
      /* ignore */
    }
    if (fs.existsSync(notebooksDir)) return;
    fs.mkdirSync(notebooksDir, { recursive: true });
    const legacy = readFile(legacyMd) || readFile(legacyTxt);
    if (legacy.trim()) fs.writeFileSync(notebookPath("Global"), legacy, "utf8");
  };

  const listNotebooks = (): string[] => {
    try {
      return fs
        .readdirSync(notebooksDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  };

  const readState = (): { current?: string } => {
    try {
      return JSON.parse(readFile(stateFile));
    } catch {
      return {};
    }
  };
  const writeState = (s: { current?: string }) => {
    try {
      fs.mkdirSync(baseDir, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(s), "utf8");
    } catch {
      /* ignore */
    }
  };

  // ---- project-folder detection via audio sample paths --------------------
  const arr = (x: unknown): any[] => {
    try {
      return Array.isArray(x) ? x : [];
    } catch {
      return [];
    }
  };
  const collectSamplePaths = (): string[] => {
    const paths: string[] = [];
    const add = (p: unknown) => {
      if (typeof p === "string" && p) paths.push(p);
    };
    const song: any = context.application.song;
    for (const t of arr(song?.tracks)) {
      try {
        for (const c of arr(t.arrangementClips))
          if (c?.className === "AudioClip") add(c.filePath);
        for (const s of arr(t.clipSlots)) {
          const c = s?.clip;
          if (c?.className === "AudioClip") add(c.filePath);
        }
        for (const d of arr(t.devices))
          if (d?.className === "Simpler" && d.sample) add(d.sample.filePath);
      } catch {
        /* skip this track */
      }
    }
    return paths;
  };
  // Walk up from a sample file until we hit an Ableton project folder.
  const projectRootFromSample = (sample: string): string | null => {
    let dir = path.dirname(sample);
    for (let i = 0; i < 8; i++) {
      try {
        if (fs.existsSync(path.join(dir, "Ableton Project Info"))) return dir;
      } catch {
        /* ignore */
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  };
  const detectProjectRoot = (): string | null => {
    try {
      for (const p of collectSamplePaths()) {
        const root = projectRootFromSample(p);
        if (root) return root;
      }
    } catch {
      /* fall through */
    }
    return null;
  };
  const projectFile = (root: string) => path.join(root, "Lyrics.md");

  // ---- command ------------------------------------------------------------
  type Payload = {
    action: string;
    target?: { type: string; name?: string };
    projectText?: string;
    map?: Record<string, string>;
    renames?: { from: string; to: string }[];
    editing?: boolean;
    caret?: number;
  };

  // Build the pad's state from disk, or (for save-and-stay) from in-memory
  // contents plus restore info for the reopened window.
  const buildState = (
    root: string | null,
    restore: { editing: boolean; caret: number } | null,
    override: { projectText?: string; map?: Record<string, string>; current?: string } | null,
  ) => {
    const notebookContents: Record<string, string> = override?.map
      ? { ...override.map }
      : Object.fromEntries(listNotebooks().map((n) => [n, readFile(notebookPath(n))]));

    let projectName: string | null = null;
    let projectDir: string | null = null;
    let projectContent = "";
    if (root) {
      projectName = path.basename(root);
      projectDir = root;
      projectContent = override?.projectText ?? (readFile(projectFile(root)) || DEFAULT_MD);
    }

    // Reopen whatever was open last (project note or a specific notebook),
    // falling back to the project note, then the first notebook.
    let current: string;
    if (override?.current) {
      current = override.current;
    } else {
      const saved = readState().current || "";
      if (root && saved === "__project__") current = "__project__";
      else if (saved && saved in notebookContents) current = saved;
      else if (root) current = "__project__";
      else {
        current = Object.keys(notebookContents)[0] || "Global";
        if (!(current in notebookContents)) notebookContents[current] = DEFAULT_MD;
      }
    }

    return {
      projectName,
      projectDir,
      projectContent,
      notebooksDir,
      notebooks: Object.keys(notebookContents).sort((a, b) => a.localeCompare(b)),
      notebookContents,
      current,
      restore,
    };
  };

  const persist = (payload: Payload, root: string | null) => {
    if (root && typeof payload.projectText === "string")
      fs.writeFileSync(projectFile(root), payload.projectText, "utf8");
    // Apply renames before writing so the moved file gets the fresh content and
    // no stale copy is left under the old name.
    if (Array.isArray(payload.renames)) {
      fs.mkdirSync(notebooksDir, { recursive: true });
      for (const r of payload.renames) {
        if (!r || !r.from || !r.to) continue;
        const from = notebookPath(r.from);
        const to = notebookPath(r.to);
        try {
          if (from !== to && fs.existsSync(from)) {
            if (fs.existsSync(to)) fs.unlinkSync(to);
            fs.renameSync(from, to);
          }
        } catch {
          /* ignore a failed rename — the map write below still saves content */
        }
      }
    }
    if (payload.map && typeof payload.map === "object") {
      fs.mkdirSync(notebooksDir, { recursive: true });
      for (const [name, text] of Object.entries(payload.map))
        fs.writeFileSync(notebookPath(name), text, "utf8");
    }
  };

  // The dropdown value that was open at close ("__project__" or a notebook name).
  const currentSelection = (payload: Payload): string | null =>
    payload.target?.type === "project"
      ? "__project__"
      : payload.target?.type === "notebook" && payload.target.name
        ? payload.target.name
        : null;

  context.commands.registerCommand("lyrics.open", async () => {
    ensureMigrated();
    const root = detectProjectRoot();
    const state = buildState(root, null, null);
    const html = interfaceHtml.replace("'__STATE__'", JSON.stringify(state));
    const url = `data:text/html,${encodeURIComponent(html)}`;
    const result = await context.ui.showModalDialog(url, 640, 560);
    // Autosave on close: "save" persists content; "cancel" discards it.
    // Either way, remember which note was open so it reopens next time.
    try {
      const payload = JSON.parse(result) as Payload;
      const sel = currentSelection(payload);
      if (sel) writeState({ current: sel });
      if (payload.action === "save") persist(payload, root);
    } catch {
      /* closed without a valid payload — nothing to save */
    }
  });

  for (const scope of SCOPES) {
    context.ui.registerContextMenuAction(scope, "Lyrics…", "lyrics.open");
  }
}
