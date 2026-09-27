// Shared rendering for the Session Notes web demo: turns note text into the
// lyric-line list and the mock Ableton Live arrangement. Both the full
// playground (demo.ts) and the guided walkthrough (try/try.ts) call this, so
// the two pages can't drift apart.

import {
  buildClips,
  buildLocators,
  extractLyricLines,
  parseTimingTag,
  placeWithoutCollision,
  type ClipPlan,
  type Locator,
} from "../src/timeline.js";

export const BEATS_PER_BAR = 4;

export type Mode = "locators" | "clips";

export interface ViewEls {
  md: HTMLTextAreaElement;
  linesEl: HTMLOListElement;
  countEl: HTMLElement;
  timeline: HTMLElement;
}

export interface RenderOpts {
  bpm: number;
  mode: Mode;
  beatsPerBar?: number;
  // When set, the ruler gets a second row under the bar numbers with the
  // clock time at each bar (at opts.bpm), and `mark` lights the row a tag
  // counts in plus the tick it lands on, and the ruler never shows fewer than
  // minBars bars, so a retimed line visibly moves against a steady ruler.
  // Used by the guided try page to show what changes between a bar tag and a
  // clock tag. Left out (the default), the ruler is the full playground's
  // single bar row, sized to its content.
  scales?: { mark: ScaleMark | null; minBars?: number };
}

export interface ScaleMark {
  scale: "bars" | "seconds";
  beat: number;
}

// Whole seconds as m:ss, the way a clock tag is typed ([0:08]).
export const secondsLabel = (beat: number, bpm: number): string => {
  const s = Math.round((beat * 60) / bpm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// 1-indexed bar.beat, the way Live's ruler reads.
export const barBeat = (beat: number, beatsPerBar = BEATS_PER_BAR): string => {
  const bar = Math.floor(beat / beatsPerBar) + 1;
  const b = Math.floor(beat % beatsPerBar) + 1;
  return `${bar}.${b}`;
};

export const clockText = (beat: number, bpm: number): string => {
  const s = (beat * 60) / bpm;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};

export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Renders the lyric-line list and the mock arrangement from the note text.
// Both pages call this on every input change and every mode switch.
export function render(els: ViewEls, opts: RenderOpts): void {
  const beatsPerBar = opts.beatsPerBar ?? BEATS_PER_BAR;
  const lines = extractLyricLines(els.md.value);
  const timingOpts = { beatsPerBar, bpm: opts.bpm };

  els.linesEl.replaceChildren();
  const locators: Locator[] = buildLocators(lines, timingOpts);
  const placed = placeWithoutCollision(locators.map((l) => l.time));
  locators.forEach((loc, i) => {
    const tagged = parseTimingTag(lines[i] ?? "", timingOpts).beat !== null;
    const li = node("li", tagged ? "tagged" : "flowed");
    li.append(
      node("span", "pos", barBeat(loc.time, beatsPerBar)),
      node("span", "name", loc.name || "(empty line)"),
      node("span", "how mut", tagged ? clockText(loc.time, opts.bpm) : "flows"),
    );
    els.linesEl.append(li);
  });
  els.countEl.textContent = lines.length === 1 ? "1 line" : `${lines.length} lines`;
  if (lines.length === 0) {
    els.linesEl.append(node("li", "empty mut", "No tagged lines yet. Start a line with [1]."));
  }

  const clips: ClipPlan[] = buildClips(lines, timingOpts);
  drawTimeline(
    els.timeline,
    opts.mode,
    locators.map((l, i) => ({ ...l, time: placed[i] ?? l.time })),
    clips,
    beatsPerBar,
    opts.scales ? { bpm: opts.bpm, ...opts.scales } : undefined,
  );
}

export function drawTimeline(
  timeline: HTMLElement,
  mode: Mode,
  locators: Locator[],
  clips: ClipPlan[],
  beatsPerBar = BEATS_PER_BAR,
  scales?: { bpm: number; mark: ScaleMark | null; minBars?: number },
): void {
  const lastBeat = Math.max(
    16,
    ...locators.map((l) => l.time + 4),
    ...clips.map((c) => c.startTime + c.duration),
  );
  const bars = Math.max(Math.ceil(lastBeat / beatsPerBar) + 1, scales?.minBars ?? 0);
  const pct = (beat: number) => `${(beat / (bars * beatsPerBar)) * 100}%`;

  timeline.dataset["bars"] = String(bars);
  timeline.style.setProperty("--bars", String(bars));

  timeline.replaceChildren();
  const track = node("div", "track");

  const ruler = node("div", "ruler");
  const mark = scales?.mark ?? null;
  // The tick the mark lands on, when it sits exactly on a bar line.
  const markBar = mark && mark.beat % beatsPerBar === 0 ? mark.beat / beatsPerBar : -1;
  if (scales) {
    ruler.classList.add("scales");
    if (mark) ruler.dataset["scale"] = mark.scale;
  }
  for (let b = 0; b < bars; b++) {
    const tick = node("span", "bar", String(b + 1));
    tick.style.left = pct(b * beatsPerBar);
    if (mark?.scale === "bars" && b === markBar) tick.classList.add("on");
    ruler.append(tick);
    if (scales) {
      const sec = node("span", b % 2 ? "sec odd" : "sec", secondsLabel(b * beatsPerBar, scales.bpm));
      sec.style.left = pct(b * beatsPerBar);
      if (mark?.scale === "seconds" && b === markBar) sec.classList.add("on");
      ruler.append(sec);
    }
  }
  track.append(ruler);

  const lane = node("div", "lane");
  lane.append(node("span", "lane-name", "Lyrics"));
  if (mode === "locators") {
    for (const loc of locators) {
      const flag = node("div", "locator");
      flag.style.left = pct(loc.time);
      flag.append(node("span", "flag", loc.name));
      flag.title = `${barBeat(loc.time, beatsPerBar)}  ${loc.name}`;
      ruler.append(flag);
    }
  } else {
    for (const c of clips) {
      const clip = node("div", "clip", c.name);
      clip.style.left = pct(c.startTime);
      clip.style.width = pct(c.duration);
      clip.title = `${barBeat(c.startTime, beatsPerBar)}  ${c.name}`;
      lane.append(clip);
    }
  }
  track.append(lane);
  timeline.append(track);
}
