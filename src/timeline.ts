// Pure planning logic for placing a note's lyric lines onto the Live arrangement
// timeline - no SDK/Live dependency, so it's unit-testable headlessly. The host
// (extension.ts) feeds the resulting plan to the data model as either cue points
// (locators) or named clips on a dedicated track.
//
// Everything here is deterministic and in BEATS. There is intentionally no notion
// of "the playhead" - the SDK exposes no transport position, so placement is
// anchored to a start beat, not to where you happen to be playing.

// Pull the "singable" lines out of a Markdown note: drop blank lines, headings,
// horizontal rules, the seeded ♪ placeholder, and strip a leading list/checkbox
// marker so "- [ ] word" or "* word" becomes "word". Everything else counts as a
// lyric line.
// Does a line carry a leading [tag] SHAPED like a position tag - musical
// (`[17]`, `[17.3]`), clock (`[1:04]`), or expression (`[=8*4]`)? This is
// bpm-independent on purpose: it asks "does this line use the timing notation",
// not "does it resolve to a beat", so the webview (which doesn't know the tempo)
// and the host agree on which lines are lyrics. `[verse]` and prose don't match.
export const POSITION_TAG = /^\[(?:=[^\]]+|\d+(?:\.\d+){0,2}|\d+:\d{1,2}(?:\.\d+)?)\]/;
export const hasPositionTag = (line: string): boolean => POSITION_TAG.test(line.trim());

// Reduce a raw note line to its lyric text, or null if it can never be a lyric
// (blank, heading, rule, or the seeded ♪). Strips a leading bullet/checkbox.
const cleanLyricLine = (raw: string): string | null => {
  let line = raw.trim();
  if (!line) return null;
  if (/^#{1,6}\s/.test(line)) return null; // heading
  if (/^(---|\*\*\*|___)$/.test(line)) return null; // horizontal rule
  if (line === "♪") return null; // seeded LYRICS placeholder
  line = line.replace(/^[-*+]\s+(\[[ xX]?\]\s*)?/, "").trim(); // leading bullet / checkbox
  return line || null;
};

// Pull the lyric lines out of a note using "tagged blocks": a line with a
// position tag starts a lyric block, untagged lines directly beneath it flow as
// lyrics, and a blank line or heading ends the block. Prose outside a block is
// ignored - so lyrics, notes and to-dos can live in one file. A note with no
// position tags yields no lyrics (tag at least one line; the rest flow from it).
export const extractLyricLines = (md: string): string[] => {
  const cleaned = (md || "").replace(/\r\n?/g, "\n").split("\n").map(cleanLyricLine);
  const out: string[] = [];
  let inBlock = false;
  for (const line of cleaned) {
    if (line == null) {
      inBlock = false; // a blank line or heading ends the current block
      continue;
    }
    if (hasPositionTag(line)) {
      inBlock = true;
      out.push(line);
    } else if (inBlock) {
      out.push(line);
    }
    // else: prose outside any block → skip
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

// ---- inline timing tags -----------------------------------------------------
// A lyric line may carry a leading [..] tag saying WHERE it goes, so lyrics are
// placed at real positions instead of evenly. Supported tags:
//   musical: [bar] | [bar.beat] | [bar.beat.sixteenth]  - 1-indexed, 4/4 assumed
//   clock:   [m:ss] | [m:ss.frac]                        - seconds, → beats via bpm
// Musical tags are tempo-map-proof (Live maps beats→time itself); clock tags rely
// on a constant tempo (the SDK exposes no tempo map). beatsPerBar defaults to 4
// because the SDK doesn't expose the arrangement time signature.

export type TimedLine = { name: string; beat: number };

export type TimingOpts = {
  beatsPerBar?: number;
  spacingBeats?: number;
  startBeat?: number;
  bpm?: number;
};

// A tiny, safe arithmetic evaluator for the `[=…]` expression tag - supports
// `+ - * /`, parentheses, unary minus, decimals, and named variables (we pass
// `bpm`). No eval(): a hand-rolled recursive-descent parser. Returns the number,
// or null on any malformed input or unknown identifier.
export const evalExpr = (
  src: string,
  vars: Record<string, number> = {},
): number | null => {
  const tokens = src.match(/\d*\.?\d+|[a-zA-Z_]+|[+\-*/()]/g);
  if (!tokens) return null;
  // The tokenizer only COLLECTS matches, so any stray character is silently
  // dropped ("100@" → ["100"]). Reject when the tokens don't reconstruct the
  // input (ignoring whitespace), or a malformed tag resolves to a wrong beat.
  if (tokens.join("") !== src.replace(/\s+/g, "")) return null;
  let i = 0;
  let ok = true;
  const peek = (): string | undefined => tokens[i];
  const eat = (): string | undefined => tokens[i++];
  const factor = (): number => {
    const t = peek();
    if (t === "-") return eat(), -factor();
    if (t === "+") return eat(), factor();
    if (t === "(") {
      eat();
      const v = expr();
      if (peek() === ")") eat();
      else ok = false;
      return v;
    }
    if (t === undefined) return (ok = false), 0;
    if (/^\d*\.?\d+$/.test(t)) return eat(), parseFloat(t);
    if (/^[a-zA-Z_]+$/.test(t)) {
      eat();
      const v = vars[t];
      if (v === undefined) return (ok = false), 0;
      return v;
    }
    return (ok = false), eat(), 0;
  };
  const term = (): number => {
    let v = factor();
    for (let op = peek(); op === "*" || op === "/"; op = peek()) {
      eat();
      const r = factor();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const expr = (): number => {
    let v = term();
    for (let op = peek(); op === "+" || op === "-"; op = peek()) {
      eat();
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const result = expr();
  if (!ok || i !== tokens.length || !isFinite(result)) return null;
  return result;
};

// Parse a leading [..] tag off a line. Returns the resolved beat (or null when
// there's no tag / it doesn't parse / a clock tag has no bpm to convert with) and
// the line text with the tag stripped.
export const parseTimingTag = (
  line: string,
  opts: { beatsPerBar?: number; bpm?: number } = {},
): { beat: number | null; name: string } => {
  const bpb = opts.beatsPerBar && opts.beatsPerBar > 0 ? opts.beatsPerBar : 4;
  const m = line.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
  if (!m) return { beat: null, name: line.trim() };
  const tag = (m[1] ?? "").trim();
  const name = (m[2] ?? "").trim();
  // expression: [=…] → beats, with `bpm` available. e.g. [=32], [=8*4], [=bpm/2].
  if (tag.startsWith("=")) {
    const vars: Record<string, number> = {};
    if (opts.bpm && opts.bpm > 0) vars.bpm = opts.bpm;
    const v = evalExpr(tag.slice(1), vars);
    return { beat: v == null ? null : Math.max(v, 0), name };
  }
  // clock: m:ss(.frac)
  const clock = tag.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (clock) {
    const bpm = opts.bpm;
    if (!bpm || bpm <= 0) return { beat: null, name }; // no tempo → can't convert
    const seconds = parseInt(clock[1] ?? "0", 10) * 60 + parseFloat(clock[2] ?? "0");
    return { beat: (seconds * bpm) / 60, name };
  }
  // musical: bar(.beat(.sixteenth)), all 1-indexed
  const mus = tag.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (mus) {
    const bar = parseInt(mus[1] ?? "1", 10);
    const beat = mus[2] ? parseInt(mus[2], 10) : 1;
    const six = mus[3] ? parseInt(mus[3], 10) : 1;
    return { beat: Math.max((bar - 1) * bpb + (beat - 1) + (six - 1) / 4, 0), name };
  }
  return { beat: null, name }; // unrecognised tag → keep text, treat as untimed
};

export const hasTimingTags = (
  lines: string[],
  opts: { beatsPerBar?: number; bpm?: number } = {},
): boolean => lines.some((l) => parseTimingTag(l, opts).beat !== null);

// Resolve every line to an absolute beat: tagged lines use their tag; untagged
// lines flow after the previous line by spacingBeats (the first, if untagged,
// starts at startBeat).
export const resolveTimeline = (lines: string[], opts: TimingOpts = {}): TimedLine[] => {
  const bpb = opts.beatsPerBar && opts.beatsPerBar > 0 ? opts.beatsPerBar : 4;
  const spacing = opts.spacingBeats && opts.spacingBeats > 0 ? opts.spacingBeats : 4;
  const start = opts.startBeat ?? 0;
  const tagOpts: { beatsPerBar: number; bpm?: number } = { beatsPerBar: bpb };
  if (opts.bpm != null) tagOpts.bpm = opts.bpm;
  const out: TimedLine[] = [];
  let prev: number | null = null;
  for (const line of lines) {
    const { beat, name } = parseTimingTag(line, tagOpts);
    const pos: number = beat != null ? beat : prev == null ? start : prev + spacing;
    out.push({ name, beat: pos });
    prev = pos;
  }
  return out;
};

// Locators from resolved timing (works for tagged and untagged input).
export const buildLocators = (lines: string[], opts: TimingOpts = {}): Locator[] =>
  resolveTimeline(lines, opts).map((t) => ({ time: t.beat, name: t.name }));

// Clips from resolved timing. When any line is tagged, each clip spans from its
// beat to the NEXT line's beat (real durations from the timings); the last line
// gets tailBeats. With no tags at all we fall back to branch-1 proportional
// widths, since without timings a clip's width is the only readability signal.
export const buildClips = (
  lines: string[],
  opts: TimingOpts & { minBeats?: number; tailBeats?: number } = {},
): ClipPlan[] => {
  const min = opts.minBeats && opts.minBeats > 0 ? opts.minBeats : MIN_CLIP_BEATS;
  const tail = opts.tailBeats && opts.tailBeats > 0 ? opts.tailBeats : 4;
  const timed = resolveTimeline(lines, opts);
  if (!hasTimingTags(lines, opts)) {
    return planClips(timed.map((t) => t.name), {
      ...(opts.startBeat != null ? { startBeat: opts.startBeat } : {}),
      minBeats: min,
    });
  }
  // Sort by beat so gaps are computed against the next clip on the timeline.
  const sorted = [...timed].sort((a, b) => a.beat - b.beat);
  const clips: ClipPlan[] = [];
  // Clips can't overlap on an arrangement track - a later clip trims/overwrites
  // an earlier one - so when two lines resolve to the same (or too-close) beat,
  // start the later clip where the previous one ends rather than on top of it.
  let prevEnd = -Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (!cur) continue;
    const next = sorted[i + 1];
    const startTime = Math.max(cur.beat, prevEnd);
    const duration = next ? Math.max(next.beat - startTime, min) : tail;
    clips.push({ startTime, duration, name: cur.name });
    prevEnd = startTime + duration;
  }
  return clips;
};

// A locator (cue point) can't share an exact beat with another. When a lyric
// locator would land on an already-occupied beat - the user's own marker, or an
// earlier line placed this pass - nudge it forward by a tiny epsilon until it's
// free, so nothing is dropped and no existing marker gets overwritten. Returns
// the resolved beat per input, in order.
export const NUDGE_BEATS = 1 / 32; // a hair - ~2ms at 120 BPM, still visibly adjacent

export const placeWithoutCollision = (
  beats: number[],
  occupied: number[] = [],
  opts: { epsilon?: number; tolerance?: number } = {},
): number[] => {
  const tol = opts.tolerance && opts.tolerance > 0 ? opts.tolerance : 1e-6;
  const rawEps = opts.epsilon && opts.epsilon > 0 ? opts.epsilon : NUDGE_BEATS;
  // The nudge must clear the tolerance window, or a too-small epsilon can never
  // escape an occupied slot and the while-loop below spins forever.
  const eps = Math.max(rawEps, tol * 2);
  const taken = occupied.slice();
  const isTaken = (b: number) => taken.some((t) => Math.abs(t - b) < tol);
  const out: number[] = [];
  for (const beat of beats) {
    let b = beat;
    while (isTaken(b)) b += eps;
    taken.push(b);
    out.push(b);
  }
  return out;
};
