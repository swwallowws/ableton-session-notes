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
import { buildLocators, buildClips, placeWithoutCollision } from "./timeline.js";

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
    let root = projectRootFromSample(imported);
    // Fallback: importIntoProject always lands the file in the project's Samples
    // folder, so a successful import means we ARE in a project even if the
    // "Ableton Project Info" marker walk missed it (reported on Windows, where
    // per-project notes never appeared). Take the parent of the nearest "Samples"
    // ancestor as the root.
    if (!root) {
      const parts = imported.split(/[\\/]/);
      const si = parts.map((p) => p.toLowerCase()).lastIndexOf("samples");
      if (si > 0) root = parts.slice(0, si).join(path.sep);
      dbg("root via Samples fallback", root);
    }
    dbg("root from imported path", root);
    // The probe was only a locator; delete it (and its .asd analysis sidecar) so
    // no stray sample is left in the project. Live can briefly hold a lock on a
    // just-imported file (seen on Windows), so retry a few times before giving up.
    for (const p of [imported, imported + ".asd"]) {
      for (let i = 0; i < 6; i++) {
        try {
          if (!fs.existsSync(p)) break; // nothing there (e.g. no .asd was written)
          fs.unlinkSync(p);
          break;
        } catch (e) {
          dbg("probe cleanup retry", p, String(e));
          if (i < 5) await new Promise((r) => setTimeout(r, 150));
        }
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

  // ---- send lyric lines to the arrangement timeline --------------------------
  // Placement is driven by inline timing tags on the lyric lines (see timeline.ts):
  //   • [bar] / [bar.beat] — musical time, tempo-map-proof
  //   • [m:ss]             — clock time, converted to beats via the Set's tempo
  // Untagged lines flow one bar apart. Two shapes:
  //   • locators — one named cue point per line (a point on the arrangement ruler)
  //   • clips    — one named MIDI clip per line on a dedicated "Lyrics" track,
  //                spanning to the next line (timed) or width ∝ text (untimed)
  // The math lives in timeline.ts (pure/tested); here we just drive the SDK.
  const LYRIC_TRACK = "Lyrics";
  // Lyric locators are named "♪ <line>" so a re-send can find and clear only OUR
  // locators, leaving the user's own section markers (Verse, Drop…) untouched.
  const LYRIC_MARK = "♪ ";
  const sendLyricsToTimeline = async (lines: string[], mode: string) => {
    const song: any = context.application.song;
    if (!song || !Array.isArray(lines) || lines.length === 0) return;
    // Tempo is needed only to convert [m:ss] clock tags to beats; musical tags
    // and untagged spacing don't use it. Guard the getter like everything else.
    const tOpts: { bpm?: number } = {};
    try {
      if (typeof song.tempo === "number") tOpts.bpm = song.tempo;
    } catch {
      /* no tempo getter → clock tags simply stay untimed */
    }
    try {
      if (mode === "clips") {
        // Reuse an existing "Lyrics" track if one is there, else make one, so
        // repeated sends don't pile up duplicate tracks.
        let track: any = arr(song.tracks).find((t) => {
          try {
            return t?.name === LYRIC_TRACK;
          } catch {
            return false;
          }
        });
        if (!track) {
          track = await song.createMidiTrack();
          try {
            track.name = LYRIC_TRACK;
          } catch {
            /* naming is best-effort */
          }
        }
        // withinTransaction only groups operations FIRED synchronously inside its
        // callback into one undo step — awaiting inside splits later work into
        // separate steps. So fire all deletes and creates together (they stay in
        // order on the message queue, so old clips clear before the new ones land)
        // as one transaction, then name the created clips in a second transaction
        // (naming needs the handle, which only exists once the create resolves).
        // Result: two undo steps (structure, then names) instead of one-per-clip.
        const existing = arr(track.arrangementClips);
        const plan = buildClips(lines, tOpts);
        const made: any[] = await context.withinTransaction(() =>
          Promise.all([
            ...existing.map((c: any) =>
              track.deleteClip(c).catch((e: any) => (dbg("deleteClip failed", String(e)), null)),
            ),
            ...plan.map((c) =>
              track
                .createMidiClip(c.startTime, c.duration)
                .then((clip: any) => ({ clip, name: c.name }))
                .catch((e: any) => (dbg("createMidiClip failed", String(e)), null)),
            ),
          ]),
        );
        context.withinTransaction(() => {
          for (const m of made) {
            if (m && m.clip)
              try {
                m.clip.name = m.name;
              } catch {
                /* naming is best-effort */
              }
          }
        });
      } else {
        // Take a single snapshot of the cue points and split it: OURS (name-
        // prefixed, to be cleared) and everything else (the user's own markers,
        // which stay). Deriving `occupied` from this same snapshot — rather than
        // re-reading after the delete — avoids depending on when the model
        // reflects the deletion, so re-sends don't drift a locator forward.
        const allCues = arr(song.cuePoints);
        const isMine = (cp: any) => {
          try {
            return typeof cp?.name === "string" && cp.name.startsWith(LYRIC_MARK);
          } catch {
            return false;
          }
        };
        const mine = allCues.filter(isMine);
        // Cue points can't share an exact beat, so a lyric locator that lands on
        // one of the user's OWN markers would be dropped (and creating there can
        // hijack their marker). Nudge our new locators off any clash with those.
        const occupied = allCues
          .filter((cp: any) => !isMine(cp))
          .map((cp: any) => {
            try {
              return typeof cp?.time === "number" ? cp.time : null;
            } catch {
              return null;
            }
          })
          .filter((t: number | null): t is number => t != null);
        const plan = buildLocators(lines, tOpts);
        const times = placeWithoutCollision(plan.map((p) => p.time), occupied);
        // Same two-transaction shape as clips (see the clips branch): fire the
        // deletes and creates together as one undo step — queued in order, so ours
        // clear before the new ones are created at the same freed beats — then name
        // the created cue points in a second batched transaction.
        const made: any[] = await context.withinTransaction(() =>
          Promise.all([
            ...mine.map((cp: any) =>
              song.deleteCuePoint(cp).catch((e: any) => (dbg("deleteCuePoint failed", String(e)), null)),
            ),
            ...plan.map((p, i) =>
              song
                .createCuePoint(times[i] ?? p.time)
                .then((cue: any) => ({ cue, name: LYRIC_MARK + p.name }))
                .catch((e: any) => (dbg("createCuePoint failed", String(e)), null)),
            ),
          ]),
        );
        context.withinTransaction(() => {
          for (const m of made) {
            if (m && m.cue)
              try {
                m.cue.name = m.name;
              } catch {
                /* naming is best-effort */
              }
          }
        });
      }
    } catch (e) {
      dbg("sendLyricsToTimeline failed", String(e));
    }
  };

  // The "bring notes" source is scoped to THIS session (host lifetime ≈ one Live
  // launch), so a project you noted in days ago never haunts a fresh project. The
  // Save-As flow all happens within one session, so it stays fully covered.
  let sessionSource: { path: string; name: string } | null = null;

  context.commands.registerCommand("notes.open", async () => {
    const root = await detectProjectRoot();
    let size = readState().size || "m";
    // True right after we ask for a resize/bring reopen. The SDK can briefly refuse
    // to open a new modal while the previous one is still tearing down, so in that
    // window we retry instead of silently leaving the pad closed.
    let reopening = false;
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
      // On a reopen the modal can momentarily refuse (the previous one is still
      // closing), so retry a few times before giving up — otherwise a resize or
      // "bring notes" silently leaves the pad closed.
      const maxTries = reopening ? 4 : 1;
      for (let attempt = 1; attempt <= maxTries; attempt++) {
        try {
          const result = await context.ui.showModalDialog(url, dim.w, dim.h);
          payload = JSON.parse(result) as Payload;
          break;
        } catch (e) {
          // A genuine user close (X / Esc) resolves via beforeunload instead of
          // rejecting, so a rejection here is a transient open failure worth retrying.
          dbg("showModalDialog failed", attempt + "/" + maxTries, String(e));
          payload = null;
          if (attempt < maxTries) await new Promise((r) => setTimeout(r, 150));
        }
      }
      reopening = false;
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
        reopening = true;
        continue;
      }

      // Send the current note's lyric lines to the arrangement, then reopen so
      // the user lands back in the pad. Persist first so the edits that produced
      // those lines aren't lost.
      if (payload.action === "timeline") {
        try {
          persist(payload, root, notebooksDir);
        } catch (e) {
          dbg("persist failed (timeline)", String(e));
        }
        const mode = payload.timelineMode === "clips" ? "clips" : "locators";
        await sendLyricsToTimeline(payload.lines ?? [], mode);
        const cur = payload.current || st.current;
        writeState({ ...st, size, ...(cur ? { current: cur } : {}) });
        reopening = true;
        continue;
      }

      // Persist on save AND resize, so resizing never drops in-progress edits.
      // Guard it — a failed write must not throw out of the loop and stop a resize
      // from reopening the pad.
      if (payload.action === "save" || payload.action === "resize") {
        try {
          persist(payload, root, notebooksDir);
        } catch (e) {
          dbg("persist failed", String(e));
        }
      }

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
      if (payload.action === "resize") { reopening = true; continue; } // reopen at the new size
      break;
    }
  });

  // Live prefixes submenu items with the extension name ("Session Notes:"),
  // so the action title is just the verb to avoid a doubled label.
  for (const scope of SCOPES) {
    context.ui.registerContextMenuAction(scope, "Open…", "notes.open");
  }
}
