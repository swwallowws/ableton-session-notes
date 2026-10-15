import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import interfaceHtml from "./interface.html";
import {
  type SavedState,
  type Payload,
  readFile,
  buildState,
  persistGlobal,
  setNotesChanged,
  migrateNotebooksDir,
} from "./notes.js";
import { backupsDir, history, listBackups, migrateOnce } from "./backups.js";
import type { Bundle } from "./codec.js";
import { type Decision, type Notice, timeLabel } from "./reconcile.js";
import { type SessionDeps, openSet, saveSetNotes } from "./session.js";
import { ensureNotesTrack, readDataNames, writeDataNames } from "./setdata.js";
import { buildLocators, buildClips, placeWithoutCollision } from "./timeline.js";

// There is no global/Song scope, so we attach to the object types reachable
// almost everywhere you right-click.
const SCOPES = ["AudioTrack", "MidiTrack", "ClipSlot", "Scene"] as const;

// Seeded into a pad that has no content yet. Shows a checkbox and a tagged lyric
// block (a [1] line plus a flow line) so the timeline feature is discoverable.
const DEFAULT_MD =
  "# Notes\n- [x] Create a session note\n- [ ] Jot your first idea\n\n# Lyrics\n[1] your first line here\nand this line flows one bar later\n";

// Two presets: m is the default; s is the compact variant.
const SIZES: Record<string, { w: number; h: number }> = {
  s: { w: 480, h: 460 },
  m: { w: 640, h: 560 },
};

const WRITE_FAILED = "Saved on this computer, but couldn't write into the set.";

// What the pad needs from a notice: its text and the choices, as ids and revs.
type PadNotice = {
  kind: string;
  text: string;
  pick?: { id: string; rev: string };
  options?: { id: string; rev: string; label: string }[];
};
const optionLabel = (b: Bundle) => {
  const titles = Object.keys(b.notes);
  const name = titles.length ? titles.slice(0, 2).join(", ") + (titles.length > 2 ? "…" : "") : "empty";
  return `${name} (${timeLabel(b.saved)})`;
};
const padNotice = (n: Notice | PadNotice | null): PadNotice | null => {
  if (!n) return null;
  if (n.kind === "choose" && "options" in n && n.options)
    return {
      kind: n.kind,
      text: n.text,
      options: (n.options as any[]).map((b) => ("label" in b ? b : { id: b.id, rev: b.rev, label: optionLabel(b) })),
    };
  if ("restore" in n && n.restore) return { kind: n.kind, text: n.text, pick: { id: n.restore.id, rev: n.restore.rev } };
  return { kind: n.kind, text: n.text };
};

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  // Installed: Live provides storageDirectory. Dev: fall back under $HOME.
  // Since Live 12.4.15b7 this (and tempDirectory) is all an extension may touch.
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

  const dbg = (...a: unknown[]) => {
    try {
      console.log("[session-notes]", ...a);
    } catch {
      /* ignore */
    }
  };

  // Notes from older installs (other author ids, sibling folders): once.
  {
    const st = readState();
    if (st.migrated !== 1) {
      try {
        const r = migrateOnce(baseDir, notebooksDir, DEFAULT_MD);
        dbg("migrated", r);
      } catch (e) {
        dbg("migration failed", String(e));
      }
      writeState({ ...st, migrated: 1 });
    }
  }

  const arr = (x: unknown): any[] => {
    try {
      return Array.isArray(x) ? x : [];
    } catch {
      return [];
    }
  };

  // ---- send lyric lines to the arrangement timeline --------------------------
  // Placement is driven by inline timing tags on the lyric lines (see timeline.ts):
  //   • [bar] / [bar.beat] - musical time, tempo-map-proof
  //   • [m:ss]             - clock time, converted to beats via the Set's tempo
  // Untagged lines flow one bar apart. Two shapes:
  //   • locators - one named cue point per line (a point on the arrangement ruler)
  //   • clips    - one named MIDI clip per line on the "Session Notes" track (an
  //                older "Lyrics" track is reused), spanning to the next line
  //                (timed) or width ∝ text (untimed)
  // The math lives in timeline.ts (pure/tested); here we just drive the SDK.
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
        // The Session Notes track holds the lyric clips (main lane) and the notes'
        // data lane, so repeated sends never pile up tracks.
        const track: any = await ensureNotesTrack(song);
        // withinTransaction only groups operations FIRED synchronously inside its
        // callback into one undo step - awaiting inside splits later work into
        // separate steps. So fire all deletes and creates together (they stay in
        // order on the message queue, so old clips clear before the new ones land)
        // as one transaction, then name the created clips in a second transaction
        // (naming needs the handle, which only exists once the create resolves).
        // Result: two undo steps (structure, then names) instead of one-per-clip.
        // arrangementClips is the main lane only, so the data lane is untouched.
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
        // which stay). Deriving `occupied` from this same snapshot - rather than
        // re-reading after the delete - avoids depending on when the model
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
        // Unlike clips, cue points CAN'T share a beat, so a new locator created at
        // a beat one of ours is still occupying gets dropped. Fully clear ours
        // FIRST (awaited), freeing those beats, before creating the new ones - this
        // is what made re-sends flaky when both ran in one batch. Each phase is its
        // own batched transaction (deletes, then creates, then names).
        if (mine.length)
          await context.withinTransaction(() =>
            Promise.all(
              mine.map((cp: any) =>
                song.deleteCuePoint(cp).catch((e: any) => (dbg("deleteCuePoint failed", String(e)), null)),
              ),
            ),
          );
        const made: any[] = await context.withinTransaction(() =>
          Promise.all(
            plan.map((p, i) =>
              song
                .createCuePoint(times[i] ?? p.time)
                .then((cue: any) => ({ cue, name: LYRIC_MARK + p.name }))
                .catch((e: any) => (dbg("createCuePoint failed", String(e)), null)),
            ),
          ),
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

  // ---- Set notes: inside the Set, backed up here ------------------------------
  const deps: SessionDeps = {
    root: () => baseDir,
    readNames: () => readDataNames(context.application.song),
    writeNames: (names) => writeDataNames(context, context.application.song, names),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
  };
  // Revs this Live session tried to write but the Set never took, so a retry of
  // the same edit isn't mistaken for a diverged Save As copy (reconcile.isFork).
  const failed = new Set<string>();
  const EMPTY: Decision = { notes: {}, id: null, base: "", notice: null, adopt: null };

  context.commands.registerCommand("notes.open", async () => {
    let size = readState().size || "m";
    let zoom = readState().zoom || 0; // note text size in px (0 = default)
    // True right after we ask for a reopen. The SDK can briefly refuse to open a
    // new modal while the previous one is still tearing down, so in that window
    // we retry instead of silently leaving the pad closed.
    let reopening = false;
    // What the next open shows instead of the Set's own notes: a restored backup,
    // or the edits a failed write couldn't put into the Set.
    type View = { notes: Record<string, string>; id: string | null; base: string; current?: string; notice: PadNotice | null };
    let pending: View | null = null;
    // The loop lets a size change, a send or a notice action close and instantly
    // reopen the pad - the SDK dialog can't be resized or refreshed in place.
    for (;;) {
      const st = readState();
      let decision = EMPTY;
      try {
        decision = openSet(deps, st.kept ?? {});
      } catch (e) {
        dbg("openSet failed", String(e));
      }
      // What the pad shows when the Set holds nothing: the seeded starter note.
      // Comparing against it means an untouched starter never reaches the Set.
      const inSet = Object.keys(decision.notes).length ? decision.notes : { Session: DEFAULT_MD };
      const view: View = pending ?? {
        notes: decision.notes,
        id: decision.id,
        base: decision.base,
        ...(decision.current !== undefined ? { current: decision.current } : {}),
        notice: padNotice(decision.notice),
      };
      pending = null;
      let backups: ReturnType<typeof listBackups> = [];
      try {
        backups = listBackups(baseDir);
      } catch {
        /* the restore list is a convenience */
      }
      const state = buildState({
        setNotes: view.notes,
        globalDir: notebooksDir,
        backupDir: backupsDir(baseDir),
        saved: st,
        defaultMd: DEFAULT_MD,
        hasData: decision.id !== null,
        notice: view.notice,
        backups,
        ...(view.current !== undefined ? { current: view.current } : {}),
      });
      state.size = size;
      state.zoom = zoom;

      const html = interfaceHtml.replace("'__STATE__'", JSON.stringify(state));
      const url = `data:text/html,${encodeURIComponent(html)}`;
      const dim = SIZES[size] ?? { w: 640, h: 560 };
      let payload: Payload | null = null;
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
      if (typeof payload.zoom === "number") zoom = payload.zoom;
      const cur = payload.current || st.current;
      const remember = (extra: Partial<SavedState> = {}) =>
        writeState({ ...readState(), size, zoom, ...(cur ? { current: cur } : {}), ...extra });
      const setCurrent = cur && cur.startsWith("p:") ? cur.slice(2) : view.current;

      // Global notes save on every close that keeps edits, on their own, so a
      // problem with the Set never costs them.
      if (payload.action !== "cancel") {
        try {
          persistGlobal(payload, notebooksDir);
        } catch (e) {
          dbg("persistGlobal failed", String(e));
        }
      }

      // Restore a backup (or pick one of two Sets' notes): show it, unsaved, so
      // Done writes it into the Set.
      if (payload.action === "restore" && payload.pick) {
        const { id, rev } = payload.pick;
        const fromNotice = (decision.notice && "options" in decision.notice ? decision.notice.options : []).concat(
          decision.notice && "restore" in decision.notice && decision.notice.restore ? [decision.notice.restore] : [],
        );
        const b = fromNotice.find((x) => x.id === id && x.rev === rev) ?? history(baseDir, id).find((x) => x.rev === rev);
        if (b) pending = { notes: b.notes, id: b.id, base: b.rev, ...(b.current ? { current: b.current } : {}), notice: null };
        remember(b?.current ? { current: "p:" + b.current } : {});
        reopening = true;
        continue;
      }
      // "Keep the set's": don't offer that backup again.
      if (payload.action === "keep" && payload.pick) {
        remember({ kept: { ...(readState().kept ?? {}), [payload.pick.id]: payload.pick.rev } });
        pending = { notes: payload.projectMap ?? view.notes, id: view.id, base: view.base, ...(setCurrent ? { current: setCurrent } : {}), notice: null };
        reopening = true;
        continue;
      }

      // Set notes go into the Set on save, resize and send, only when they changed.
      if (payload.action === "save" || payload.action === "resize" || payload.action === "timeline") {
        if (payload.projectMap && setNotesChanged(inSet, payload.projectMap)) {
          const r = await saveSetNotes(deps, {
            id: view.id,
            base: view.base,
            notes: payload.projectMap,
            ...(setCurrent ? { current: setCurrent } : {}),
            failed,
          });
          if (!r.ok) {
            dbg("Set write failed", r.id, r.rev);
            pending = {
              notes: payload.projectMap,
              id: r.id,
              base: view.base,
              ...(setCurrent ? { current: setCurrent } : {}),
              notice: { kind: "writeFailed", text: WRITE_FAILED },
            };
            remember();
            reopening = true;
            continue;
          }
        }
      }

      if (payload.action === "timeline") {
        await sendLyricsToTimeline(payload.lines ?? [], payload.timelineMode === "clips" ? "clips" : "locators");
        remember();
        reopening = true;
        continue;
      }

      remember();
      if (payload.action === "resize") {
        reopening = true;
        continue;
      }
      break;
    }
  });

  // Live prefixes submenu items with the extension name ("Session Notes:"),
  // so the action title is just the verb to avoid a doubled label.
  for (const scope of SCOPES) {
    context.ui.registerContextMenuAction(scope, "Open…", "notes.open");
  }
}
