// Press-and-hold pacing for the demo's tempo box, kept pure so it can be tested.
//
// A press steps once, waits `delayMs`, then repeats. The repeat rate eases from
// `minRate` to `maxRate` steps a second over `rampMs` on a smoothstep curve
// (calm start, steady build, settles into the cap instead of hitting it). After
// `coarseAfterMs` at the cap it switches to coarse steps that snap to multiples
// of `coarseStep`, at a rate slow enough to read, so a long range is quick to cross.

export const HOLD = {
  delayMs: 380,
  minRate: 6,
  maxRate: 30,
  rampMs: 2000,
  coarseAfterMs: 1000,
  coarseStep: 5,
  coarseRate: 12,
} as const;

/** Pace at `heldMs` since repeating started (after the initial delay). */
export function holdPace(heldMs: number): { intervalMs: number; step: number } {
  if (heldMs >= HOLD.rampMs + HOLD.coarseAfterMs) {
    return { intervalMs: 1000 / HOLD.coarseRate, step: HOLD.coarseStep };
  }
  const p = Math.min(1, Math.max(0, heldMs / HOLD.rampMs));
  const eased = p * p * (3 - 2 * p);
  const rate = HOLD.minRate + (HOLD.maxRate - HOLD.minRate) * eased;
  return { intervalMs: 1000 / rate, step: 1 };
}

/** One step from `value` in `dir`; steps above 1 land on multiples of `step`. */
export function stepValue(value: number, dir: 1 | -1, step: number): number {
  if (step <= 1) return value + dir;
  return dir > 0 ? Math.floor(value / step) * step + step : Math.ceil(value / step) * step - step;
}
