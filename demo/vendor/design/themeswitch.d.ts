/** Types for themeswitch.js, for TypeScript projects. */

export type Mode = '' | 'paper' | 'night';

export declare const MODES: Mode[];

export declare function initialMode(search: string, saved: string | null): Mode;

export interface ThemeSwitchOptions {
  storageKey?: string;
  onChange?: (mode: Mode) => void;
  root?: HTMLElement;
}

export declare function themeSwitch(
  el: HTMLElement,
  opts?: ThemeSwitchOptions,
): { readonly mode: Mode; set(mode: Mode): void };
