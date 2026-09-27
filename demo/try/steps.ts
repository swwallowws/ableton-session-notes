// Pure helpers for the guided Session Notes walkthrough (try.ts): the verse,
// step detection, and which ruler scale the first line's tag reads from.
// No DOM, no rail: try.ts feeds the results straight into the page.

import { extractLyricLines, parseTimingTag } from "../../src/timeline.js";

export type TryMode = "locators" | "clips";
export type Scale = "bars" | "seconds";

// The verse the walkthrough is built around. Untagged (step one is adding
// the first tag) and short, so each line fits in a one-bar flag or clip.
export const VERSE = `Low tide at noon
Gulls count the boats
I hum it back
The pier keeps time
`;

const BEATS_PER_BAR = 4;
const BRACKET = /^\s*\[([^\]]+)\]/;
const CLOCK_SHAPE = /^\d+:\d{1,2}(?:\.\d+)?$/;

const firstLyricLine = (text: string): string | null => extractLyricLines(text)[0] ?? null;

const tagOf = (line: string): string => line.match(BRACKET)?.[1]?.trim() ?? "";

// Step "tag": the first lyric line is tagged to bar 9 exactly. Musical tags
// don't need a tempo to resolve, so this holds regardless of bpm.
const isBar9 = (line: string): boolean =>
  !CLOCK_SHAPE.test(tagOf(line)) &&
  parseTimingTag(line, { beatsPerBar: BEATS_PER_BAR }).beat === 32;

// Step "time": the same line retagged as an 0:08 timecode. A clock tag needs a
// bpm to resolve to beats; passing bpm=60 makes one beat equal one second, so
// beat === 8 reads as "the raw tag is exactly 8 seconds" without depending on
// the page's tempo. The clock-shape check keeps a bar tag like [8] out.
const isEightSeconds = (line: string): boolean =>
  CLOCK_SHAPE.test(tagOf(line)) &&
  parseTimingTag(line, { beatsPerBar: BEATS_PER_BAR, bpm: 60 }).beat === 8;

export function stepFor(text: string, mode: TryMode, done: Set<string>): string | null {
  const line = firstLyricLine(text);

  if (!done.has("tag")) {
    return line != null && isBar9(line) ? "tag" : null;
  }
  if (!done.has("time")) {
    return line != null && isEightSeconds(line) ? "time" : null;
  }
  if (!done.has("mode")) {
    return mode === "clips" ? "mode" : null;
  }
  return null;
}

// The scale the first lyric line's tag counts in (a clock tag counts in
// seconds, anything else in bars) and the beat it lands on, or null when the
// first line has no tag that resolves.
export function activeTag(text: string, bpm: number): { scale: Scale; beat: number } | null {
  const line = firstLyricLine(text);
  if (line == null) return null;
  const { beat } = parseTimingTag(line, { beatsPerBar: BEATS_PER_BAR, bpm });
  if (beat == null) return null;
  return { scale: CLOCK_SHAPE.test(tagOf(line)) ? "seconds" : "bars", beat };
}
