// Web demo of Session Notes' lyric timing, for the showcase site. It runs the
// extension's own planning code (src/timeline.ts) on the text in the page, so
// what you see is what "Send to arrangement" would do in Live. Nothing here
// talks to Live or the SDK.

import { valueBox } from "./vendor/design/valuebox.js";
import { render as renderView, type Mode } from "./view.js";

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

let mode: Mode = "locators";

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

function render(): void {
  renderView({ md, linesEl, countEl, timeline }, { bpm: bpm(), mode });
}

function setMode(next: Mode): void {
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
