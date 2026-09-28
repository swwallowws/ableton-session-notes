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

/** Children of root carrying this attribute go to the aside, under the rail. */
export declare const ASIDE_ATTR: 'data-demoshell-aside';

export declare function splitContent<T>(nodes: Iterable<T>): { stage: T[]; aside: T[] };

/** No mark on or behind this element. */
export declare const NOMARK_ATTR: 'data-demoshell-nomark';
/** A mark of its own for an element deeper in the stage (a nested editor). */
export declare const MARK_ATTR: 'data-demoshell-mark';
export declare const MARK_WORD: 'DEMO';
export declare function markText(count: number): string;
/** Tiles in each mark layer. */
export declare const MARK_TILES: number;
/** One span per word, for the mark's centred grid of whole tiles. */
export declare function markTiles(count: number, doc?: Document): HTMLSpanElement[];
export declare function wantsMark(el: { tagName: string; background: string; nomark?: boolean; optIn?: boolean }): boolean;

/** Space runs toggle(); the rail's key legend shows "Space: <label>". */
export interface DemoPrimary {
  toggle(): void;
  label: string;
}

/** A single key ("r") and what it runs; with a label it shows in the legend. */
export type DemoKey = (() => void) | { run(): void; label: string };

export interface KeyBinding { run(): void; label: string | null }

export declare function keyName(key: string): string;
export declare function keyBindings(opts: { primary?: DemoPrimary; keys?: Record<string, DemoKey> }): Map<string, KeyBinding>;
/** True when the focused element uses this key itself (fields: every key; buttons: Space). */
export declare function ownsKey(target: EventTarget | null, name: string): boolean;
export declare function routeKey(e: KeyboardEvent, bindings: Map<string, KeyBinding>): KeyBinding | null;
export declare function keyLegend(bindings: Map<string, KeyBinding>): { key: string; label: string }[];

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
  /** The demo's main action on Space (play/pause, say). */
  primary?: DemoPrimary;
  /** Extra single keys, e.g. { r: { run: record, label: 'record' } }. */
  keys?: Record<string, DemoKey>;
  /** Framed view. Default: ?embed=1 in the page URL. */
  embed?: boolean;
}

/**
 * Builds the shell inside root. Anything already inside root is moved into
 * the stage, except elements marked data-demoshell-aside, which move into
 * the aside: under the rail in the rail column, after the rail on phones,
 * and hidden while empty. In embed mode a ResizeObserver posts
 * { type: 'demo-height', height } to window.parent on every size change.
 * A faint "DEMO" mark lies behind the stage and behind the content of each
 * stage child with its own background (opt out: data-demoshell-nomark; opt
 * in deeper: data-demoshell-mark; none at all: data-demoshell-nomark on root).
 * primary and keys bind Space and single keys on the document, skipping
 * fields, and buttons for Space.
 */
export declare function demoShell(
  root: HTMLElement,
  opts: DemoShellOptions,
): {
  stage: HTMLElement;
  aside: HTMLElement;
  rail: { readonly current: string | null; done(id: string): void; reset(): void };
};
