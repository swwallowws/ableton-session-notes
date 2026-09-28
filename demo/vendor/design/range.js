/** Range: a thin slider in the accent, with its label and its value above it.
 *
 *  Give it `stops` and it moves between those values only, never in between,
 *  with a small tick under each one (a swing menu as a slider: 0.00, 0.50, 0.58,
 *  0.67...). The track fills in the accent up to the thumb. Arrow keys move one
 *  stop, Home and End jump to the ends. Styles are in range.css. */

/** Where the fill ends, as a percentage of the track, for stop `i` of `n`. */
export function fillPercent(i, n) {
  return n > 1 ? (Math.min(n - 1, Math.max(0, i)) / (n - 1)) * 100 : 0;
}

/** Turn `el` into a range. Options: label, stops (the values it can take),
 *  index (the starting stop, 0), format (v => String(v)), onChange(value, index).
 *  Returns { get index, get value, set(index) }. */
export function range(el, opts) {
  const stops = opts.stops;
  if (!Array.isArray(stops) || stops.length < 2) throw new Error("range: give it at least two stops");
  const format = opts.format ?? ((v) => String(v));
  const doc = el.ownerDocument ?? document;
  const id = `range-${Math.random().toString(36).slice(2, 8)}`;

  el.classList.add("range");
  const head = doc.createElement("div");
  head.className = "range-head";
  const label = doc.createElement("label");
  label.htmlFor = id;
  label.textContent = opts.label ?? "";
  const out = doc.createElement("output");
  out.htmlFor = id;
  head.append(label, out);

  const input = doc.createElement("input");
  input.type = "range";
  input.id = id;
  input.min = "0";
  input.max = String(stops.length - 1);
  input.step = "1";

  const ticks = doc.createElement("div");
  ticks.className = "range-ticks";
  ticks.setAttribute("aria-hidden", "true");
  for (let i = 0; i < stops.length; i++) ticks.append(doc.createElement("span"));

  el.replaceChildren(head, input, ticks);

  let index = 0;
  const paint = () => {
    input.value = String(index);
    input.setAttribute("aria-valuetext", format(stops[index]));
    out.textContent = format(stops[index]);
    el.style.setProperty("--fill", `${fillPercent(index, stops.length)}%`);
  };
  const set = (i, notify = false) => {
    const next = Math.min(stops.length - 1, Math.max(0, Math.round(i)));
    const changed = next !== index;
    index = next;
    paint();
    if (changed && notify) opts.onChange?.(stops[index], index);
  };
  input.addEventListener("input", () => set(Number(input.value), true));

  index = Math.min(stops.length - 1, Math.max(0, opts.index ?? 0));
  paint();
  return {
    get index() { return index; },
    get value() { return stops[index]; },
    set: (i) => set(i, false),
  };
}
