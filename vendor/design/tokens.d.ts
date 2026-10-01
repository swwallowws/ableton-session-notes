/** Resolve a colour token to a concrete colour string, as `el` sees it. */
export function cssColor(name: string, el?: Element): string;
/** Accent share of a piano-roll note: 0.4 at `lo` up to 1 at `hi` (roll.md). */
export function pitchShade(pitch: number, lo: number, hi: number): number;
/** A note's fill, "rgb(r, g, b)": the resolved accent mixed into the resolved ground by pitch. */
export function noteColor(acc: string, ground: string, pitch: number, lo: number, hi: number): string;
