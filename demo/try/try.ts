// Guided walkthrough for Session Notes' lyric timing: the same render as the
// full playground (../demo.ts), narrowed to one verse and walked through by
// the design system's step rail. Tempo is fixed; there is no tempo box here.

import { stepRail } from "../vendor/design/steprail.js";
import { render as renderView, type Mode } from "../view.js";
import { stepFor } from "./steps.js";

const BPM = 120;

// The verse this walkthrough is built around (untagged - step one is adding
// the first tag).
const VERSE = `Salt on the window, the kettle's low hum
I hum the chorus before it has come
Counting the bars on the back of my hand
Every line lands where I told it to land
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
const after = $("after");
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")];

let mode: Mode = "locators";
const doneSteps = new Set<string>();

function render(): void {
  renderView({ md, linesEl, countEl, timeline }, { bpm: BPM, mode });
}

// Advances the rail when the current text/mode satisfies the next step it's
// waiting on. The rail never guesses on its own - it only moves on when we
// tell it to.
function checkStep(): void {
  const id = stepFor(md.value, mode, doneSteps);
  if (id) {
    doneSteps.add(id);
    rail.done(id);
  }
}

function setMode(next: Mode): void {
  mode = next;
  for (const b of modeButtons) b.setAttribute("aria-pressed", String(b.dataset["mode"] === next));
  render();
  checkStep();
}

// The note box grows with its text, so the whole verse is always visible.
const fit = () => {
  md.style.height = "auto";
  md.style.height = `${md.scrollHeight + 2}px`;
};

const rail = stepRail($("rail"), {
  steps: [
    { id: "tag", label: "Type [17] in front of the first line" },
    { id: "time", label: "Change it to [1:04]" },
    { id: "mode", label: "Show it as clips on a Lyrics track" },
  ],
  onDone: () => {
    after.hidden = false;
  },
  onReset: () => {
    doneSteps.clear();
    mode = "locators";
    for (const b of modeButtons) b.setAttribute("aria-pressed", String(b.dataset["mode"] === "locators"));
    md.value = VERSE;
    fit();
    render();
    after.hidden = true;
  },
});

md.value = VERSE;
md.addEventListener("input", () => {
  fit();
  render();
  checkStep();
});
window.addEventListener("resize", fit);
for (const b of modeButtons) {
  b.addEventListener("click", () => setMode(b.dataset["mode"] === "clips" ? "clips" : "locators"));
}
fit();
render();
