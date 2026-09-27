/** Types for steprail.js, for TypeScript projects. */

export interface RailState {
  readonly current: string | null;
  readonly finished: boolean;
  isDone(id: string): boolean;
  done(id: string): boolean;
  reset(): void;
}

export declare function createRail(ids: string[]): RailState;

export interface StepRailStep {
  id: string;
  label: string;
  hint?: string;
}

export interface StepRailOptions {
  steps: StepRailStep[];
  onDone?: () => void;
  onReset?: () => void;
  endText?: string;
}

export declare function stepRail(
  el: HTMLElement,
  opts: StepRailOptions,
): { readonly current: string | null; done(id: string): void; reset(): void };
