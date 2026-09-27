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
}

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
  );
}

export function drawTimeline(
  timeline: HTMLElement,
  mode: Mode,
  locators: Locator[],
  clips: ClipPlan[],
  beatsPerBar = BEATS_PER_BAR,
): void {
  const lastBeat = Math.max(
    16,
    ...locators.map((l) => l.time + 4),
    ...clips.map((c) => c.startTime + c.duration),
  );
  const bars = Math.ceil(lastBeat / beatsPerBar) + 1;
  const pct = (beat: number) => `${(beat / (bars * beatsPerBar)) * 100}%`;

  timeline.replaceChildren();
  timeline.style.setProperty("--bars", String(bars));

  const ruler = node("div", "ruler");
  for (let b = 0; b < bars; b++) {
    const tick = node("span", "bar", String(b + 1));
    tick.style.left = pct(b * beatsPerBar);
    ruler.append(tick);
  }
  timeline.append(ruler);

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
  timeline.append(lane);
}
