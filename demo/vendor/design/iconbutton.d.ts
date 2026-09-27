/** Types for iconbutton.js, for TypeScript projects. */

export type IconName =
  | 'play' | 'pause' | 'stop' | 'record' | 'reset' | 'download'
  | 'search' | 'close' | 'plus' | 'minus' | 'chevron' | 'loop';

export declare const ICONS: Readonly<Record<IconName, string>>;
export declare const ICON_NAMES: readonly IconName[];

/** The plain word for an icon ("Start over" for reset, "Add" for plus). */
export declare function defaultLabel(name: IconName): string;

/** The icon as an svg string (16 by 16, currentColor strokes, aria-hidden). */
export declare function iconSvg(name: IconName, opts?: { dir?: 'down' | 'up' | 'left' | 'right' }): string;

/** "Play (Space)", "Record (R)", or just the label. */
export declare function titleFor(label: string, key?: string): string;

export interface IconButtonOptions {
  icon: IconName;
  /** Accessible name and tooltip. Default: the icon's plain word. Never changes with the state. */
  label?: string;
  /** Adds aria-pressed; a click flips it. */
  toggle?: boolean;
  pressed?: boolean;
  /** Shown while pressed. Default: pause for play, else the same icon. */
  pressedIcon?: IconName;
  /** Tooltip while pressed. Default: the pressed icon's word. */
  pressedLabel?: string;
  /** s is 24px, m is 32px. Default m. */
  size?: 's' | 'm';
  /** A key that does the same ("Space", "r"): shown in the tooltip and as aria-keyshortcuts. */
  key?: string;
  /** For the chevron. */
  dir?: 'down' | 'up' | 'left' | 'right';
  /** After a click: the new pressed state for a toggle, nothing otherwise. */
  onPress?: (pressed?: boolean) => void;
}

export declare function buttonState(
  opts: IconButtonOptions,
  pressed: boolean,
): { icon: IconName; label: string; title: string; pressed: boolean | null };

export interface IconButton {
  el: HTMLButtonElement;
  readonly pressed: boolean;
  /** Repaints without calling onPress. */
  setPressed(v: boolean): void;
  /** Same as a click (skipped while disabled). */
  toggle(): void;
}

/** Creates a new button from options, or upgrades an existing one (data-icon, data-label, data-toggle, data-size, data-key). */
export declare function iconButton(opts: IconButtonOptions): IconButton;
export declare function iconButton(el: HTMLButtonElement, overrides?: Partial<IconButtonOptions>): IconButton;
