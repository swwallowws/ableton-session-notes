// Pure step-detection for the guided Session Notes walkthrough (try.ts).
// Given the note text, the current send mode, and which steps are already
// done, decides which step (if any) the state just satisfied. No DOM, no
// rail: try.ts feeds the result straight into rail.done().

import { extractLyricLines, parseTimingTag } from "../../src/timeline.js";

export type TryMode = "locators" | "clips";

const BEATS_PER_BAR = 4;
const BRACKET = /^\s*\[([^\]]+)\]/;
const CLOCK_SHAPE = /^\d+:\d{1,2}(?:\.\d+)?$/;

const firstLyricLine = (text: string): string | null => {
  const lines = extractLyricLines(text);
  return lines[0] ?? null;
};

// Step "tag": the first lyric line is tagged to bar 17 exactly. Musical tags
// don't need a tempo to resolve, so this holds regardless of bpm.
const isBar17 = (line: string): boolean =>
  parseTimingTag(line, { beatsPerBar: BEATS_PER_BAR }).beat === 64;

// Step "time": the same line retagged as a 1:04 timecode. A clock tag needs a
// bpm to resolve to beats; passing bpm=60 makes one beat equal one second, so
// checking beat === 64 here reads as "the raw tag is exactly 64 seconds"
// without depending on the page's actual tempo. The bracket-shape check first
// keeps a musical tag (which also resolves to 64 at bpm 60) from matching.
const isOneOhFour = (line: string): boolean => {
  const m = line.match(BRACKET);
  const tag = m?.[1]?.trim() ?? "";
  if (!CLOCK_SHAPE.test(tag)) return false;
  return parseTimingTag(line, { beatsPerBar: BEATS_PER_BAR, bpm: 60 }).beat === 64;
};

export function stepFor(text: string, mode: TryMode, done: Set<string>): string | null {
  const line = firstLyricLine(text);

  if (!done.has("tag")) {
    return line != null && isBar17(line) ? "tag" : null;
  }
  if (!done.has("time")) {
    return line != null && isOneOhFour(line) ? "time" : null;
  }
  if (!done.has("mode")) {
    return mode === "clips" ? "mode" : null;
  }
  return null;
}
