/** Types for range.js, for TypeScript projects. */

export declare function fillPercent(i: number, n: number): number;

export interface RangeOptions<T> {
  stops: T[];
  label?: string;
  index?: number;
  format?: (v: T) => string;
  onChange?: (value: T, index: number) => void;
}

export declare function range<T>(
  el: HTMLElement,
  opts: RangeOptions<T>,
): { readonly index: number; readonly value: T; set(index: number): void };
