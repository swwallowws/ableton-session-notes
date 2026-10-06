/** Types for themeswitch.js, for TypeScript projects. */

export type Mode = '' | 'paper' | 'night';

export declare const MODES: Mode[];

/** Where every product saves the mode: "swwallowws:mode". */
export declare const THEME_KEY: string;

export declare function initialMode(search: string, saved: string | null): Mode;

/** For a page without the switch: the mode from ?theme=, else the saved one. */
export declare function applySavedMode(root?: HTMLElement, storageKey?: string): Mode;

export interface ThemeSwitchOptions {
  /** Default THEME_KEY, shared by every product. */
  storageKey?: string;
  onChange?: (mode: Mode) => void;
  root?: HTMLElement;
}

export declare function themeSwitch(
  el: HTMLElement,
  opts?: ThemeSwitchOptions,
): { readonly mode: Mode; set(mode: Mode): void };
