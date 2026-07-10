import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import interfaceHtml from "./interface.html";
import {
  type SavedState,
  type Payload,
  readFile,
  projectNotesDir,
  listMd,
  migrationOffer,
  buildState,
  persist,
  bringNotes,
  isTransientProject,
  migrateNotebooksDir,
} from "./notes.js";

// There is no global/Song scope, so we attach to the object types reachable
// almost everywhere you right-click.
const SCOPES = ["AudioTrack", "MidiTrack", "ClipSlot", "Scene"] as const;

// Seeded into a pad that has no content yet.
const DEFAULT_MD =
  "# TO-DO\n- [x] Create a session note\n- [ ] Capture lyrics, ideas and to-dos…\n\n# LYRICS\n♪\n";

// Two presets: m is the default; s is the compact variant.
const SIZES: Record<string, { w: number; h: number }> = {
  s: { w: 480, h: 460 },
  m: { w: 640, h: 560 },
};

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  // Installed: Live provides storageDirectory. Dev: fall back under $HOME.
  const baseDir =
    context.environment.storageDirectory ||
    path.join(os.homedir(), ".ableton-extensions", "session-notes");
  migrateNotebooksDir(baseDir); // fold any legacy "notebooks/" into "Global Notes/"
  const notebooksDir = path.join(baseDir, "Global Notes");
  const stateFile = path.join(baseDir, "state.json");

  const readState = (): SavedState => {
    try {
      return JSON.parse(readFile(stateFile));
    } catch {
      return {};
    }
  };
  const writeState = (s: SavedState) => {
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
  const detectProjectRootFromSamples = (): string | null => {
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

  const dbg = (...a: unknown[]) => {
    try {
      console.log("[session-notes]", ...a);
    } catch {
      /* ignore */
    }
  };

  // A minimal valid mono 16-bit PCM WAV (a few samples of silence). importIntoProject
  // only accepts media Live can manage, so the probe must be a real audio file.
  const silentWav = (): Buffer => {
    const sampleRate = 44100;
    const dataSize = 8; // 4 samples * 2 bytes
    const buf = Buffer.alloc(44 + dataSize);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write("WAVE", 8);
    buf.write("fmt ", 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20); // PCM
    buf.writeUInt16LE(1, 22); // mono
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buf.writeUInt16LE(2, 32); // block align
    buf.writeUInt16LE(16, 34); // bits per sample
    buf.write("data", 36);
    buf.writeUInt32LE(dataSize, 40);
    return buf; // sample bytes already zeroed = silence
  };

  // Fallback when the Set has no audio to trace (e.g. a MIDI-only or brand-new
  // project): the SDK exposes no project path, but importIntoProject copies a
  // file into the project folder and hands back its new path. We import a
  // throwaway probe purely to learn where the project lives, then delete it.
  const detectProjectRootViaImport = async (): Promise<string | null> => {
    const tmpDir = context.environment.tempDirectory || os.tmpdir();
    const probe = path.join(tmpDir, "session-notes-probe.wav");
    try {
      fs.writeFileSync(probe, silentWav());
    } catch (e) {
      dbg("probe write failed", String(e));
      return null;
    }
    let imported: string | null = null;
    try {
      imported = await context.resources.importIntoProject(probe);
      dbg("importIntoProject returned", imported);
    } catch (e) {
      dbg("importIntoProject threw", String(e));
    }
    try {
      fs.unlinkSync(probe);
    } catch {
      /* ignore */
    }
    if (!imported) return null;
    const root = projectRootFromSample(imported);
    dbg("root from imported path", root);
    // The probe was only a locator; don't leave a stray file in the project.
    for (const p of [imported, imported + ".asd"]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
    return root;
  };

  // Prefer the cheap, side-effect-free sample scan; only import a probe when
  // that finds nothing, so audio-less Sets still get per-project notes.
  const detectProjectRoot = async (): Promise<string | null> => {
    const samplePaths = collectSamplePaths();
    dbg("sample paths found:", samplePaths.length, samplePaths.slice(0, 3));
    const fromSamples = detectProjectRootFromSamples();
    dbg("root from samples:", fromSamples);
    if (fromSamples) return fromSamples;
    const fromImport = await detectProjectRootViaImport();
    dbg("root from import:", fromImport);
    return fromImport;
  };

  // The "bring notes" source is scoped to THIS session (host lifetime ≈ one Live
  // launch), so a project you noted in days ago never haunts a fresh project. The
  // Save-As flow all happens within one session, so it stays fully covered.
  let sessionSource: { path: string; name: string } | null = null;

  context.commands.registerCommand("notes.open", async () => {
    const root = await detectProjectRoot();
    let size = readState().size || "m";
    // The loop lets a size change or a "bring notes" action close and instantly
    // reopen the pad — the SDK dialog can't be resized or refreshed in place.
    for (;;) {
      const st = readState();
      const src: SavedState = { dismissed: st.dismissed ?? [] };
      if (sessionSource) src.lastProject = sessionSource;
      const offer = migrationOffer(root, src);
      const state = buildState(
        root,
        offer && {
          // A temp/unsaved source has an ugly timestamped folder name; the notes
          // are really from the session you were just in, so say that instead.
          fromName: isTransientProject(offer.fromPath) ? "your previous session" : offer.fromName,
          count: offer.count,
        },
        { notebooksDir, saved: st, defaultMd: DEFAULT_MD },
      );
      state.size = size;
      const html = interfaceHtml.replace("'__STATE__'", JSON.stringify(state));
      const url = `data:text/html,${encodeURIComponent(html)}`;
      const dim = SIZES[size] ?? { w: 640, h: 560 };
      let payload: Payload | null = null;
      try {
        const result = await context.ui.showModalDialog(url, dim.w, dim.h);
        payload = JSON.parse(result) as Payload;
      } catch {
        // Closed without a valid payload — nothing to save.
        payload = null;
      }
      if (!payload) break;
      if (payload.size) size = payload.size;

      // Bring notes from the last project, then reopen showing them. Edits made
      // on the placeholder note aren't persisted here — the offer only appears
      // on an empty project, so there's nothing worth keeping.
      if (payload.action === "bring" && offer && root) {
        const dest = bringNotes(projectNotesDir(offer.fromPath), projectNotesDir(root));
        const next: SavedState = { ...st, size };
        if (dest) next.current = "p:" + dest;
        writeState(next);
        continue;
      }

      // Persist on save AND resize, so resizing never drops in-progress edits.
      if (payload.action === "save" || payload.action === "resize")
        persist(payload, root, notebooksDir);

      const dismissed = new Set(st.dismissed || []);
      if (payload.dismissMigration && root) dismissed.add(root);
      // Remember the project we just took notes in as THIS session's offer source
      // for a later Save-As. Includes temp/unsaved projects — their notes should
      // carry into the saved project — but only in memory, so it never persists
      // across restarts to nag unrelated future projects.
      if (root && listMd(projectNotesDir(root)).length > 0)
        sessionSource = { path: root, name: path.basename(root) };

      const next: SavedState = { size, dismissed: [...dismissed] };
      const cur = payload.current || st.current;
      if (cur) next.current = cur;
      writeState(next);
      if (payload.action === "resize") continue; // reopen at the new size
      break;
    }
  });

  // Live prefixes submenu items with the extension name ("Session Notes:"),
  // so the action title is just the verb to avoid a doubled label.
  for (const scope of SCOPES) {
    context.ui.registerContextMenuAction(scope, "Open…", "notes.open");
  }
}
