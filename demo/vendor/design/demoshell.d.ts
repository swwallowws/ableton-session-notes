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

/** No mark on this element: it rises above the stage's mark, on a ground unless it has its own. */
export declare const NOMARK_ATTR: 'data-demoshell-nomark';
/** A mark of its own for an element inside an opted-out one; elsewhere the stage's mark already covers it. */
export declare const MARK_ATTR: 'data-demoshell-mark';
export declare const MARK_WORD: 'DEMO';
export declare function markText(count: number): string;
/** Tiles in each mark layer. */
export declare const MARK_TILES: number;
/** One span per word, for the mark's centred grid of whole tiles. */
export declare function markTiles(count: number, doc?: Document): HTMLSpanElement[];
/** Whether an element gets a mark layer of its own: it asks, and sits inside an opted-out element. */
export declare function ownsMark(el: { tagName: string; optIn?: boolean; nomark?: boolean; insideNomark?: boolean }): boolean;
/** @deprecated Since 1.7.0 the mark lies over the whole stage; the shell no longer uses this. */
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
 * A faint, still "DEMO" mark lies over the whole stage, above its content,
 * and never takes the pointer (opt out: data-demoshell-nomark, which raises
 * the element above it; a mark again inside that: data-demoshell-mark; none
 * at all: data-demoshell-nomark on root).
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
