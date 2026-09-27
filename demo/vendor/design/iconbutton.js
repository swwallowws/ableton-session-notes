// Icon buttons: a square button that shows a symbol instead of a word, with
// the word kept as its accessible name (aria-label) and as a hover tooltip
// (title). Icons are drawn on a 16 by 16 grid in currentColor strokes, so they
// take the button's ink or accent. A toggle carries aria-pressed; a play
// toggle shows pause while pressed. Styles are in iconbutton.css.

/** Shape markup per icon, inside a 16 by 16 viewBox. */
export const ICONS = {
  play: '<path d="M5 3.5v9l7-4.5z"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  stop: '<rect x="4" y="4" width="8" height="8"/>',
  record: '<circle cx="8" cy="8" r="4" fill="currentColor"/>',
  reset: '<path d="M3.5 8a4.5 4.5 0 1 0 1.32-3.18"/><path d="M4.8 2v2.8h2.8"/>',
  download: '<path d="M8 2.5v8M4.5 7l3.5 3.5L11.5 7M3 13.5h10"/>',
  search: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  minus: '<path d="M3 8h10"/>',
  chevron: '<path d="M4 6l4 4 4-4"/>',
  loop: '<path d="M2.5 7.5V6.5a2 2 0 0 1 2-2h8M10.5 2.5l2 2-2 2M13.5 8.5v1a2 2 0 0 1-2 2h-8M5.5 13.5l-2-2 2-2"/>',
};

export const ICON_NAMES = Object.keys(ICONS);

const LABELS = {
  play: 'Play', pause: 'Pause', stop: 'Stop', record: 'Record', reset: 'Start over',
  download: 'Download', search: 'Search', close: 'Close', plus: 'Add', minus: 'Remove',
  chevron: 'More', loop: 'Loop',
};

// What a toggle shows while pressed, when the icon has a natural pair.
const PAIRS = { play: 'pause' };

const TURN = { down: 0, up: 180, right: -90, left: 90 };

function known(name) {
  if (!Object.hasOwn(ICONS, name)) {
    throw new Error(`unknown icon "${name}"; known: ${ICON_NAMES.join(', ')}`);
  }
  return name;
}

/** The plain word for an icon, used when no label is given. */
export function defaultLabel(name) {
  return LABELS[known(name)];
}

/** The icon as an svg string. The chevron takes { dir: 'down'|'up'|'left'|'right' }. */
export function iconSvg(name, { dir } = {}) {
  const shapes = ICONS[known(name)];
  const turn = name === 'chevron' && TURN[dir] ? `<g transform="rotate(${TURN[dir]} 8 8)">${shapes}</g>` : shapes;
  return '<svg class="ds-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"'
    + ' stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">'
    + `${turn}</svg>`;
}

/** Tooltip text: the label, plus the key that does the same, if any. */
export function titleFor(label, key) {
  if (!key) return label;
  const shown = key.length === 1 ? key.toUpperCase() : key;
  return `${label} (${shown})`;
}

/**
 * What the button shows for a pressed state. The accessible name (label)
 * never changes with the state, as a toggle's name should not; the icon and
 * the tooltip show what a press does next (a pressed play toggle shows pause).
 * A button that is not a toggle has pressed: null (no aria-pressed at all).
 */
export function buttonState({ icon, label, toggle = false, pressedIcon, pressedLabel }, pressed) {
  known(icon);
  const name = label ?? defaultLabel(icon);
  if (!toggle) return { icon, label: name, title: name, pressed: null };
  if (!pressed) return { icon, label: name, title: name, pressed: false };
  const onIcon = known(pressedIcon ?? PAIRS[icon] ?? icon);
  const onTitle = pressedLabel ?? (onIcon === icon ? name : defaultLabel(onIcon));
  return { icon: onIcon, label: name, title: onTitle, pressed: true };
}

function readOpts(el) {
  const d = el.dataset;
  return {
    icon: d.icon,
    label: d.label || el.getAttribute('aria-label') || el.textContent.trim() || undefined,
    toggle: 'toggle' in d || el.hasAttribute('aria-pressed'),
    pressed: el.getAttribute('aria-pressed') === 'true',
    pressedIcon: d.pressedIcon,
    pressedLabel: d.pressedLabel,
    size: d.size,
    key: d.key,
    dir: d.dir,
  };
}

/**
 * Makes an icon button. Pass options to create a new <button>, or an existing
 * button (options from data-icon, data-label or its text, data-toggle or
 * aria-pressed, data-size, data-key) with optional overrides.
 * Returns { el, pressed, setPressed(v), toggle() }. A click on a toggle flips
 * it, then calls onPress(pressed); setPressed only repaints (for state that
 * changes elsewhere, such as playback reaching its end). toggle() clicks it.
 */
export function iconButton(elOrOpts, overrides) {
  const isEl = elOrOpts && typeof elOrOpts === 'object' && elOrOpts.nodeType === 1;
  const el = isEl ? elOrOpts : document.createElement('button');
  const opts = { ...(isEl ? readOpts(el) : {}), ...(isEl ? overrides : elOrOpts) };
  let pressed = Boolean(opts.pressed);

  if (el.tagName === 'BUTTON' && !el.getAttribute('type')) el.type = 'button';
  el.classList.add('iconbutton');
  el.dataset.size = opts.size === 's' ? 's' : 'm';
  if (opts.key) el.setAttribute('aria-keyshortcuts', opts.key === ' ' ? 'Space' : opts.key);

  const paint = () => {
    const s = buttonState(opts, pressed);
    el.innerHTML = iconSvg(s.icon, { dir: opts.dir });
    el.dataset.icon = s.icon;
    el.setAttribute('aria-label', s.label);
    el.title = titleFor(s.title, opts.key);
    if (s.pressed === null) el.removeAttribute('aria-pressed');
    else el.setAttribute('aria-pressed', String(s.pressed));
  };

  el.addEventListener('click', () => {
    if (opts.toggle) { pressed = !pressed; paint(); opts.onPress?.(pressed); }
    else opts.onPress?.();
  });
  paint();

  return {
    el,
    get pressed() { return pressed; },
    setPressed(v) { pressed = Boolean(v); paint(); },
    toggle() { if (!el.disabled) el.click(); },
  };
}
