/** Resolve a colour token to a concrete colour string for canvas or WebGL,
 *  which cannot read var() or light-dark(). The token is resolved as `el`
 *  sees it, so its theme and data-category apply. */
export function cssColor(name, el = document.documentElement) {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${name})`;
  el.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** How much accent a note carries on a piano roll (roll.md): 0.4 for the lowest pitch
 *  in view up to 1 for the highest, a continuous gradient so neighbouring notes stay
 *  close in shade. One pitch in view gets the full accent. */
export function pitchShade(pitch, lo, hi) {
  if (!(hi > lo)) return 1;
  const u = Math.min(1, Math.max(0, (pitch - lo) / (hi - lo)));
  return 0.4 + 0.6 * u;
}

const rgb = (c) => (String(c).match(/[\d.]+/g) || []).slice(0, 3).map(Number);

/** A note's fill: the accent mixed into the ground by pitchShade(). `acc` and `ground`
 *  are resolved colours as cssColor() returns them ("rgb(r, g, b)"). */
export function noteColor(acc, ground, pitch, lo, hi) {
  const t = pitchShade(pitch, lo, hi);
  const [a, g] = [rgb(acc), rgb(ground)];
  const mix = a.map((v, i) => Math.round(v * t + (g[i] ?? v) * (1 - t)));
  return `rgb(${mix.join(", ")})`;
}
