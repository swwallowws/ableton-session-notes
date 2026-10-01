/** Types for playhead.js, for TypeScript projects. */

export declare function clampTime(t: number, duration: number): number;

export declare function timeAt(clientX: number, left: number, width: number, duration: number): number;

/** The output's delay in seconds (outputLatency + baseLatency); 0 without a context. */
export declare function outputDelay(ctx: BaseAudioContext | null | undefined): number;

/** A playing head's time as heard: `t` less the output's delay, never before `since` (the last start or seek). */
export declare function heardTime(t: number, since: number, ctx: BaseAudioContext | null | undefined): number;

export interface SeekableOptions {
  /** Seconds mapped across the element's width; a function is read on each press. */
  duration?: number | (() => number);
  /** Your own mapping from a pointer's clientX to a time, for a zoomed or scrolled view. */
  toTime?: (clientX: number, rect: DOMRect) => number;
  /** The head is at `t` while pressed or dragged (also called on the press). */
  onScrub?: (t: number) => void;
  /** The pointer was let go at `t`, or a mouse or pen drag was cancelled there. Once per gesture. */
  onSeek?: (t: number) => void;
  /** A touch was taken over (a scroll) or cancelled: put the head back. */
  onCancel?: () => void;
  /** False ignores presses. */
  enabled?: () => boolean;
}

/** Make `el` seekable by click or drag. Returns a function that removes the listeners. */
export declare function seekable(el: HTMLElement, opts: SeekableOptions): () => void;
