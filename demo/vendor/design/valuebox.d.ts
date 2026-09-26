/** Types for valuebox.js, for TypeScript projects. */

export declare const HOLD: {
  delayMs: number;
  minRate: number;
  maxRate: number;
  rampMs: number;
  coarseAfterMs: number;
  coarseRate: number;
};

export declare function holdPace(heldMs: number): { intervalMs: number; coarse: boolean };

export declare function stepValue(value: number, dir: 1 | -1, size: number, coarse: boolean): number;

export interface ValueBoxOptions {
  min: number;
  max: number;
  value?: number;
  step?: number;
  coarse?: number;
  format?: (v: number) => string;
  labelledBy?: string;
  label?: string;
  onChange?: (v: number) => void;
}

export declare function valueBox(
  el: HTMLElement,
  opts: ValueBoxOptions,
): { readonly value: number; set(v: number): void };
