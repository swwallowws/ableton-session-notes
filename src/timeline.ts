// Pure planning logic for placing a note's lyric lines onto the Live arrangement
// timeline — no SDK/Live dependency, so it's unit-testable headlessly. The host
// (extension.ts) feeds the resulting plan to the data model as either cue points
// (locators) or named clips on a dedicated track.
//
// Everything here is deterministic and in BEATS. There is intentionally no notion
// of "the playhead" — the SDK exposes no transport position, so placement is
// anchored to a start beat, not to where you happen to be playing.

// Pull the "singable" lines out of a Markdown note: drop blank lines, headings,
// horizontal rules, the seeded ♪ placeholder, and strip a leading list/checkbox
// marker so "- [ ] word" or "* word" becomes "word". Everything else counts as a
// lyric line.
export const extractLyricLines = (md: string): string[] => {
  const out: string[] = [];
  for (const raw of (md || "").replace(/\r\n?/g, "\n").split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) continue; // heading
    if (/^(---|\*\*\*|___)$/.test(line)) continue; // horizontal rule
    if (line === "♪") continue; // seeded LYRICS placeholder
    line = line.replace(/^[-*+]\s+(\[[ xX]?\]\s*)?/, ""); // leading bullet / checkbox
    line = line.trim();
    if (!line) continue;
    out.push(line);
  }
  return out;
};

export type Locator = { time: number; name: string };

// One locator per line, evenly spaced. spacingBeats defaults to one bar (4 beats
// in 4/4). Times are absolute beats from startBeat.
export const planLocators = (
  lines: string[],
  opts: { startBeat?: number; spacingBeats?: number } = {},
): Locator[] => {
  const start = opts.startBeat ?? 0;
  const spacing = opts.spacingBeats && opts.spacingBeats > 0 ? opts.spacingBeats : 4;
  return lines.map((name, i) => ({ time: start + i * spacing, name }));
};

export type ClipPlan = { startTime: number; duration: number; name: string };

// Live's minimum clip/loop length: one 16th note.
export const MIN_CLIP_BEATS = 0.25;

// Tile a span of beats with one clip per line, each clip's width PROPORTIONAL to
// its text length. That's the answer to "make the clip span more/less depending
// on the lyrics": a long line gets a proportionally wider clip, so at any given
// zoom every clip truncates about equally instead of one line hogging the space.
// Widths are floored to minBeats (Live can't create anything shorter); when the
// proportional share would fall below the floor, that clip gets the floor and the
// row simply runs a little past `totalBeats` rather than producing invalid clips.
export const planClips = (
  lines: string[],
  opts: { startBeat?: number; totalBeats?: number; minBeats?: number } = {},
): ClipPlan[] => {
  const start = opts.startBeat ?? 0;
  const min = opts.minBeats && opts.minBeats > 0 ? opts.minBeats : MIN_CLIP_BEATS;
  // Default span: one bar per line, so the untouched case looks like the locator
  // spacing but as ranges rather than points.
  const total =
    opts.totalBeats && opts.totalBeats > 0 ? opts.totalBeats : lines.length * 4;
  const weightOf = (l: string) => Math.max((l || "").length, 1);
  const sum = lines.reduce((a, l) => a + weightOf(l), 0) || 1;
  const plans: ClipPlan[] = [];
  let t = start;
  for (const name of lines) {
    const duration = Math.max((weightOf(name) / sum) * total, min);
    plans.push({ startTime: t, duration, name });
    t += duration;
  }
  return plans;
};
