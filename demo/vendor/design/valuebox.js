/** Value box: a number in a box that you click or hold to change.
 *
 *  Hovering shows an up arrow on the top half and a down arrow on the bottom
 *  half. A click steps once that way. Holding keeps stepping on a time-based
 *  curve: after a short delay the rate eases from slow to a cap (smoothstep, so
 *  it starts calm and settles into the cap), then switches to coarse steps that
 *  snap to multiples, so a long range is quick to cross. Holding an arrow key
 *  uses the same curve; Shift+arrow and Page Up/Down jump by the coarse step.
 *  Styles are in valuebox.css. */

export const HOLD = {
  delayMs: 380,
  minRate: 6,
  maxRate: 30,
  rampMs: 2000,
  coarseAfterMs: 1000,
  coarseRate: 12,
};

/** Pace at `heldMs` since repeating started: the wait before the next step,
 *  and whether that step is a single or a coarse one. */
export function holdPace(heldMs) {
  if (heldMs >= HOLD.rampMs + HOLD.coarseAfterMs) {
    return { intervalMs: 1000 / HOLD.coarseRate, coarse: true };
  }
  const p = Math.min(1, Math.max(0, heldMs / HOLD.rampMs));
  const eased = p * p * (3 - 2 * p);
  const rate = HOLD.minRate + (HOLD.maxRate - HOLD.minRate) * eased;
  return { intervalMs: 1000 / rate, coarse: false };
}

/** One step from `value` in `dir` (1 or -1). A coarse step lands on the next
 *  multiple of `size` in that direction. */
export function stepValue(value, dir, size, coarse) {
  if (!coarse) return value + dir * size;
  return dir > 0 ? Math.floor(value / size) * size + size : Math.ceil(value / size) * size - size;
}

/** Turn `el` into a value box. Options: min, max, value, step (1),
 *  coarse (5 x step), format (v => String(v)), labelledBy or label, onChange.
 *  Returns { get value, set(v) }. */
export function valueBox(el, opts) {
  const min = opts.min;
  const max = opts.max;
  const step = opts.step ?? 1;
  const coarse = opts.coarse ?? step * 5;
  const format = opts.format ?? ((v) => String(v));
  const clamp = (v) => Math.min(max, Math.max(min, Math.round(v / step) * step));

  let value = clamp(opts.value ?? min);
  let dir = 1;
  let timer;
  let repeatStart = 0;

  el.classList.add("valuebox");
  el.setAttribute("role", "spinbutton");
  el.tabIndex = 0;
  el.setAttribute("aria-valuemin", String(min));
  el.setAttribute("aria-valuemax", String(max));
  if (opts.labelledBy) el.setAttribute("aria-labelledby", opts.labelledBy);
  else if (opts.label) el.setAttribute("aria-label", opts.label);
  const shown = document.createElement("span");
  shown.className = "valuebox-value";
  const arrow = document.createElement("span");
  arrow.className = "valuebox-arrow";
  arrow.setAttribute("aria-hidden", "true");
  el.replaceChildren(shown, arrow);

  const paint = () => {
    shown.textContent = format(value);
    el.setAttribute("aria-valuenow", String(value));
    el.setAttribute("aria-valuetext", format(value));
  };
  const set = (v) => {
    const next = clamp(v);
    if (next === value) return;
    value = next;
    paint();
    opts.onChange?.(value);
  };

  const halfAt = (e) => {
    const r = el.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 1 : -1;
  };
  const showHalf = (d) => {
    el.dataset.half = d === 1 ? "up" : "down";
  };
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    el.classList.remove("held");
  };
  const tick = () => {
    const pace = holdPace(performance.now() - repeatStart);
    set(stepValue(value, dir, pace.coarse ? coarse : step, pace.coarse));
    if (value <= min || value >= max) return stop();
    timer = setTimeout(tick, pace.intervalMs);
  };
  const start = (d) => {
    stop();
    dir = d;
    el.classList.add("held");
    set(value + dir * step);
    timer = setTimeout(() => {
      repeatStart = performance.now();
      tick();
    }, HOLD.delayMs);
  };

  el.addEventListener("pointermove", (e) => {
    if (timer === undefined) showHalf(halfAt(e));
  });
  el.addEventListener("pointerleave", () => {
    delete el.dataset.half;
    stop();
  });
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.focus();
    const d = halfAt(e);
    showHalf(d);
    el.setPointerCapture(e.pointerId);
    start(d);
  });
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
  el.addEventListener("lostpointercapture", stop);
  el.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
    const jump = e.key === "PageUp" ? 1 : e.key === "PageDown" ? -1 : e.shiftKey ? d : 0;
    if (!d && !jump) return;
    e.preventDefault();
    if (jump) return set(stepValue(value, jump, coarse, true));
    if (e.repeat) return; // the hold curve is already repeating
    start(d);
  });
  el.addEventListener("keyup", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") stop();
  });
  el.addEventListener("blur", stop);

  paint();
  return {
    get value() {
      return value;
    },
    set,
  };
}
