// Web demo of Session Notes' lyric timing, for the showcase site. It runs the
// extension's own planning code (src/timeline.ts) on the text in the page, so
// what you see is what "Send to arrangement" would do in Live. Nothing here
// talks to Live or the SDK.

import {
  buildClips,
  buildLocators,
  extractLyricLines,
  parseTimingTag,
  placeWithoutCollision,
  type ClipPlan,
  type Locator,
} from "../src/timeline.js";
import { valueBox } from "./vendor/design/valuebox.js";

// Original example lyrics (the same made-up song as the README's cover image).
const EXAMPLE = `# Midnight Drive

- [x] Track the drums
- [ ] Re-amp the bass on the second drop

## Lyrics
[1] Headlights bleed into the rain
chasing signals down the lane
[5] every mile a different me
[0:24] and I let the whole thing go

[=17*4] outro, whispered
`;

const BEATS_PER_BAR = 4;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const md = $<HTMLTextAreaElement>("md");
const linesEl = $<HTMLOListElement>("lines");
const countEl = $("count");
const timeline = $("timeline");
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")];

let mode: "locators" | "clips" = "locators";

// Tempo: the design system's value box (click or hold to change; see
// vendor/design/valuebox.js).
const tempo = valueBox($("bpm"), {
  min: 40,
  max: 300,
  value: 120,
  labelledBy: "tempo-label",
  onChange: () => render(),
});
const bpm = (): number => tempo.value;

// 1-indexed bar.beat, the way Live's ruler reads.
const barBeat = (beat: number): string => {
  const bar = Math.floor(beat / BEATS_PER_BAR) + 1;
  const b = Math.floor(beat % BEATS_PER_BAR) + 1;
  return `${bar}.${b}`;
};

const clock = (beat: number): string => {
  const s = (beat * 60) / bpm();
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function render(): void {
  const lines = extractLyricLines(md.value);
  const opts = { beatsPerBar: BEATS_PER_BAR, bpm: bpm() };

  // Lyric list: each line with where it resolved to, and whether it was tagged
  // or flowed from the line above.
  linesEl.replaceChildren();
  const locators: Locator[] = buildLocators(lines, opts);
  const placed = placeWithoutCollision(locators.map((l) => l.time));
  locators.forEach((loc, i) => {
    const tagged = parseTimingTag(lines[i] ?? "", opts).beat !== null;
    const li = node("li", tagged ? "tagged" : "flowed");
    li.append(
      node("span", "pos", barBeat(loc.time)),
      node("span", "name", loc.name || "(empty line)"),
      node("span", "how mut", tagged ? clock(loc.time) : "flows"),
    );
    linesEl.append(li);
  });
  countEl.textContent = lines.length === 1 ? "1 line" : `${lines.length} lines`;
  if (lines.length === 0) {
    linesEl.append(node("li", "empty mut", "No tagged lines yet. Start a line with [1]."));
  }

  const clips: ClipPlan[] = buildClips(lines, opts);
  drawTimeline(
    locators.map((l, i) => ({ ...l, time: placed[i] ?? l.time })),
    clips,
  );
}

function drawTimeline(locators: Locator[], clips: ClipPlan[]): void {
  const lastBeat = Math.max(
    16,
    ...locators.map((l) => l.time + 4),
    ...clips.map((c) => c.startTime + c.duration),
  );
  const bars = Math.ceil(lastBeat / BEATS_PER_BAR) + 1;
  const pct = (beat: number) => `${(beat / (bars * BEATS_PER_BAR)) * 100}%`;

  timeline.replaceChildren();
  timeline.style.setProperty("--bars", String(bars));

  const ruler = node("div", "ruler");
  for (let b = 0; b < bars; b++) {
    const tick = node("span", "bar", String(b + 1));
    tick.style.left = pct(b * BEATS_PER_BAR);
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
      flag.title = `${barBeat(loc.time)}  ${loc.name}`;
      ruler.append(flag);
    }
  } else {
    for (const c of clips) {
      const clip = node("div", "clip", c.name);
      clip.style.left = pct(c.startTime);
      clip.style.width = pct(c.duration);
      clip.title = `${barBeat(c.startTime)}  ${c.name}`;
      lane.append(clip);
    }
  }
  timeline.append(lane);
}

function setMode(next: "locators" | "clips"): void {
  mode = next;
  for (const b of modeButtons) b.setAttribute("aria-pressed", String(b.dataset["mode"] === next));
  render();
}

// The note box grows with its text, so the whole note is always visible.
const fit = () => {
  md.style.height = "auto";
  md.style.height = `${md.scrollHeight + 2}px`;
};

md.value = EXAMPLE;
md.addEventListener("input", () => {
  fit();
  render();
});
window.addEventListener("resize", fit);
$("reset").addEventListener("click", () => {
  md.value = EXAMPLE;
  fit();
  render();
});
for (const b of modeButtons) {
  b.addEventListener("click", () => setMode(b.dataset["mode"] === "clips" ? "clips" : "locators"));
}
fit();
render();
