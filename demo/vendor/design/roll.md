# Drawing music

Rules every piano roll, waveform and visualizer follows. Colours come from `tokens.css`; canvas code resolves them with `cssColor()` from `tokens.js`.

## Piano roll

- Background: key bands. Black-key rows (C#, D#, F#, G#, A#) are `--band`; white-key rows are `--ground`. No horizontal lines.
- A small `--ink-mut` octave label at each C, on the left edge.
- Time grid off by default. A tool may add faint beat lines (`--band`) when it needs them.

Key bands in CSS, for rows of height `R` with the top row a B:

```css
.roll {
  --row: 8px;
  background-image: repeating-linear-gradient(to bottom,
    transparent 0 calc(var(--row) * 1), var(--band) calc(var(--row) * 1) calc(var(--row) * 2),
    transparent calc(var(--row) * 2) calc(var(--row) * 3), var(--band) calc(var(--row) * 3) calc(var(--row) * 4),
    transparent calc(var(--row) * 4) calc(var(--row) * 5), var(--band) calc(var(--row) * 5) calc(var(--row) * 6),
    transparent calc(var(--row) * 6) calc(var(--row) * 8), var(--band) calc(var(--row) * 8) calc(var(--row) * 9),
    transparent calc(var(--row) * 9) calc(var(--row) * 10), var(--band) calc(var(--row) * 10) calc(var(--row) * 11),
    transparent calc(var(--row) * 11) calc(var(--row) * 12));
}
```

## Notes

- Sharp rectangles, one row high minus a 1px gap, tinted with the roll's category accent instead of ink: `color-mix(in oklab, var(--acc) P%, var(--ground))` where `P = 35 + 65 * velocity` (velocity 0..1), so soft notes are pale tints and loud notes are near full accent.
- Without a category, `--acc` falls back to `--ink`, so the same formula yields grey tints of ink; that is acceptable.
- The sounding note: `background: var(--acc)` at full strength, plus a 1px `--ink` outline so "now" stays distinct from a loud note. The playhead stays `--acc`.
- Canvas code resolves the tint with `cssColor()` on an element whose style sets the `color-mix()` (or computes the mix itself from the resolved accent and ground), since canvas cannot read `color-mix()` directly.
- Selection is a 1px `--ink` outline, never a colour.
- Categories of notes are shown by mark shape at the note start, not by hue. voxmpe's split causes: nothing after a gap, a slanted tick for a pitch change, an upright bar for a re-attack.
- Muted or accent text is not placed on `--band`; its contrast against `--band` is below 4.5:1. `--band` is for fills (key bands, table stripes), not for text.

## Curves and lanes

- Pitch curves: bends are 2px `--ink` lines through the note; the raw sung contour is a 1.5px `--ink-mut` line at 50% opacity, so the MIDI pitch reads first. Round line joins. A legend that shows them uses the same widths.
- Loudness and waveform lanes: `--ink-mut` fill on a `--band` strip.

## Visualizers

Full-bleed canvases (the ocean, odoroki) may use more tones, limited to tints of their category accent plus ink. The UI around them follows the system.

## Motion

The accent is what moves. With `prefers-reduced-motion: reduce`, playback shows a static position marker instead of animating. Canvas code must re-resolve colours with `cssColor()` whenever the theme, category or system colour scheme changes, not just once at load: listen for the `prefers-color-scheme` media query's `change` event, and re-draw after changing `data-theme` or `data-category`, so the canvas never shows stale colours from the previous mode.
