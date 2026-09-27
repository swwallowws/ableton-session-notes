// Guided walkthrough for Session Notes' lyric timing: the same render as the
// full playground (../demo.ts), narrowed to one short verse, laid out by the
// design system's demo shell and walked through by its step rail. Tempo is
// fixed at 120 BPM, so one bar is two seconds; the ruler shows both.

import { demoShell } from "../vendor/design/demoshell.js";
import { render as renderView, type Mode } from "../view.js";
import { VERSE, activeTag, stepFor } from "./steps.js";

const BPM = 120;
// Bar 9 plus the three lines that flow after it, and one bar of room: the
// ruler holds this range for both steps, so [0:08] visibly moves the line left.
const RULER_BARS = 13;

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
  renderView(
    { md, linesEl, countEl, timeline },
    { bpm: BPM, mode, scales: { mark: activeTag(md.value, BPM), minBars: RULER_BARS } },
  );
}

// Advances the rail when the current text/mode satisfies the next step it's
// waiting on. The rail never guesses on its own.
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

const { rail } = demoShell($("demo"), {
  product: "Session Notes",
  title: "Tag a lyric line, watch it land.",
  intro:
    "Lyrics in a note, placed in Ableton Live's arrangement by a tag at the start of a line. This runs Session Notes' real timing code at 120 BPM, where one bar is two seconds.",
  steps: [
    { id: "tag", label: "Type [9] in front of the first line", hint: "A plain number is a bar: the line lands on bar 9." },
    { id: "time", label: "Change it to [0:08]", hint: "A colon makes it a time: 0:08 is eight seconds in, which is bar 5." },
    { id: "mode", label: "Show it as clips on a Lyrics track" },
  ],
  full: {
    label: "extension for Ableton Live 12",
    href: "https://github.com/swwallowws/ableton-session-notes/releases",
    where: "on GitHub",
  },
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

// The playground link sits under the rail, shown once the steps are done.
document.querySelector(".demoshell-rail")?.append(after);

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
