/** Types for demoshell.js, for TypeScript projects. */

import type { StepRailStep } from './steprail.js';

/** Where the full product lives: "The full <label> is <where>." with <where> linked. */
export interface DemoFullLink {
  label: string;
  href: string;
  /** The linked words that end the note. Default "here". */
  where?: string;
}

export interface DemoNote {
  text: string;
  link: { text: string; href: string } | null;
}

export declare function demoNote(full: DemoFullLink | { coming: true }): DemoNote;

export declare function isEmbed(search: string): boolean;

export declare function heightReporter(
  post: (message: { type: 'demo-height'; height: number }) => void,
): (height: number) => void;

export interface DemoShellOptions {
  /** Product name, shown as "<product> · demo". */
  product: string;
  title: string;
  intro?: string;
  steps: StepRailStep[];
  full: DemoFullLink | { coming: true };
  onDone?: () => void;
  onReset?: () => void;
  endText?: string;
  /** Framed view. Default: ?embed=1 in the page URL. */
  embed?: boolean;
}

/**
 * Builds the shell inside root. Anything already inside root is moved into
 * the stage. In embed mode a ResizeObserver posts
 * { type: 'demo-height', height } to window.parent on every size change.
 */
export declare function demoShell(
  root: HTMLElement,
  opts: DemoShellOptions,
): {
  stage: HTMLElement;
  rail: { readonly current: string | null; done(id: string): void; reset(): void };
};
