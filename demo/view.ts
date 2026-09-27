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
  // When true, the ruler always spans bar 1 through at least two bars past
  // the last placed line (minimum 18 bars), scaled to fit the container
  // width with no horizontal scroll, and eases into a new range over ~600ms
  // when that range changes (skipped under prefers-reduced-motion). Used by
  // the guided try page, which narrows to one verse and needs the retimed
  // line to stay on screen. Default false keeps the full playground's
  // original content-sized, scrollable ruler.
  fitRuler?: boolean;
}

const MIN_FIT_BARS = 18;
const RANGE_EASE_MS = 600;

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    opts.fitRuler ?? false,
  );
}

export function drawTimeline(
  timeline: HTMLElement,
  mode: Mode,
  locators: Locator[],
  clips: ClipPlan[],
  beatsPerBar = BEATS_PER_BAR,
  fitRuler = false,
): void {
  let bars: number;
  if (fitRuler) {
    // Bar 1 through at least two bars past the last placed line, never
    // narrower than MIN_FIT_BARS, so a retimed line can't land off screen.
    const lastPlacedBeat = Math.max(
      0,
      ...locators.map((l) => l.time),
      ...clips.map((c) => c.startTime + c.duration),
    );
    const lastPlacedBar = Math.floor(lastPlacedBeat / beatsPerBar) + 1;
    bars = Math.max(MIN_FIT_BARS, lastPlacedBar + 2);
  } else {
    const lastBeat = Math.max(
      16,
      ...locators.map((l) => l.time + 4),
      ...clips.map((c) => c.startTime + c.duration),
    );
    bars = Math.ceil(lastBeat / beatsPerBar) + 1;
  }
  const pct = (beat: number) => `${(beat / (bars * beatsPerBar)) * 100}%`;

  const prevBars = fitRuler ? Number(timeline.dataset["bars"] ?? 0) : 0;
  timeline.dataset["bars"] = String(bars);
  timeline.style.setProperty("--bars", String(bars));

  timeline.replaceChildren();
  // Ruler and lane share one wrapper so a range change can ease both of them
  // together with a single transform (see the FLIP animation below).
  const track = node("div", "track");

  const ruler = node("div", "ruler");
  for (let b = 0; b < bars; b++) {
    const tick = node("span", "bar", String(b + 1));
    tick.style.left = pct(b * beatsPerBar);
    ruler.append(tick);
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

  // Every position above is linear in 1/bars, so a uniform horizontal scale
  // reproduces exactly what the in-between layout would look like: paint the
  // new (correct) layout, scale it back to look like the old one, then ease
  // the scale to 1. Left-anchored (bar 1 never moves), skipped when the
  // range didn't actually change, on first paint, or under reduced motion.
  if (fitRuler && prevBars > 0 && prevBars !== bars && !prefersReducedMotion()) {
    track.style.transformOrigin = "left top";
    track.style.transform = `scaleX(${bars / prevBars})`;
    track.getBoundingClientRect(); // force layout before easing, so the jump above isn't itself animated
    track.style.transition = `transform ${RANGE_EASE_MS}ms ease`;
    requestAnimationFrame(() => {
      track.style.transform = "scaleX(1)";
    });
    track.addEventListener(
      "transitionend",
      () => {
        track.style.transition = "";
        track.style.transform = "";
      },
      { once: true },
    );
  }
}
