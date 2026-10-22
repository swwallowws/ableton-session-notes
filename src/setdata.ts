// Where a Set's notes live inside the Set: the names of empty MIDI clips on a
// take lane called "Session Notes data", on the "Session Notes" track (which also
// gets the lyric clips). Take lanes don't play and don't change the Set's length.
// The names themselves are made and read by codec.ts.
//
// Writes never delete clips (the SDK's deleteClip is documented for arrangement
// clips only): existing data clips are renamed in place, more are added after
// them, and leftovers get a plain name that isn't data. Every SDK access is
// guarded, as elsewhere in this extension.
import { isDataName } from "./codec.js";

export const DATA_LANE = "Session Notes data";
export const NOTES_TRACK = "Session Notes";
export const LEGACY_TRACK = "Lyrics"; // made by v0.2.x for lyric clips
export const UNUSED = "Session Notes data (unused)";

const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);
const get = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};
const byStart = (a: any, b: any) => get(() => a.startTime - b.startTime, 0);

const dataLanes = (track: any): any[] =>
  arr(get(() => track.takeLanes, [])).filter((l) => get(() => l.name, "") === DATA_LANE);

// A copy: the lane's own list grows as clips are created.
const clipsOf = (lane: any): any[] => [...arr(get(() => lane.clips, []))].sort(byStart);

// Every data clip name in the Set, in clip order.
export function readDataNames(song: any): string[] {
  const names: string[] = [];
  for (const t of arr(get(() => song.tracks, [])))
    for (const lane of dataLanes(t))
      for (const c of clipsOf(lane)) {
        const n = get(() => c.name, "");
        if (isDataName(n)) names.push(n);
      }
  return names;
}

// The track holding the data lane (whatever it's called now), else the one named
// "Session Notes", else an older "Lyrics" track.
export function findNotesTrack(song: any): any | null {
  const tracks = arr(get(() => song.tracks, []));
  return (
    tracks.find((t) => dataLanes(t).length > 0) ??
    tracks.find((t) => get(() => t.name, "") === NOTES_TRACK) ??
    tracks.find((t) => get(() => t.name, "") === LEGACY_TRACK) ??
    null
  );
}

export async function ensureNotesTrack(song: any): Promise<any> {
  const found = findNotesTrack(song);
  if (found) return found;
  const track = await song.createMidiTrack();
  try {
    track.name = NOTES_TRACK;
  } catch {
    /* naming is best-effort */
  }
  return track;
}

export async function writeDataNames(context: any, song: any, names: string[]): Promise<void> {
  const track = await ensureNotesTrack(song);
  let lane = dataLanes(track)[0];
  if (!lane) {
    lane = await track.createTakeLane();
    lane.name = DATA_LANE;
  }
  const existing = clipsOf(lane);

  // New clips go after the existing ones, one per 4 beats, 1 beat long.
  let next = 0;
  for (const c of existing) next = Math.max(next, get(() => c.startTime + c.duration, 0));
  next = Math.ceil(next / 4) * 4;
  const missing = Math.max(0, names.length - existing.length);
  const made: any[] = missing
    ? await context.withinTransaction(() =>
        Promise.all(Array.from({ length: missing }, (_, i) => lane.createMidiClip(next + i * 4, 1))),
      )
    : [];
  const clips = [...existing, ...made];

  // Data clips on any other data lane (a track pasted in from another Set) are
  // blanked too, so the Set ends up holding exactly this bundle.
  const strays: any[] = [];
  for (const t of arr(get(() => song.tracks, [])))
    for (const l of dataLanes(t))
      if (l !== lane) for (const c of clipsOf(l)) if (isDataName(get(() => c.name, ""))) strays.push(c);

  await context.withinTransaction(() => {
    clips.forEach((c, i) => {
      c.name = i < names.length ? names[i] : UNUSED;
    });
    for (const c of strays) c.name = UNUSED;
  });
}
