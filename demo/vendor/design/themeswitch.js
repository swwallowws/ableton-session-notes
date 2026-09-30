// The colour mode switch: three small icon buttons, System (half dark),
// Paper (a sun) and Night (a moon), the word kept as each one's accessible
// name and tooltip. It stamps data-theme on :root (tokens.css flips from it),
// seeded from ?theme=paper|night, else the visitor's saved choice, else System.
// Link iconbutton.css and themeswitch.css after tokens.css.

import { iconButton } from './iconbutton.js';

export const MODES = ['', 'paper', 'night'];
const ICON = { '': 'system', paper: 'paper', night: 'night' };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) {
    try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: not remembered */ }
  },
};

/** The mode to start in: ?theme= wins, then the saved choice, else System (''). */
export function initialMode(search, saved) {
  const param = new URLSearchParams(search).get('theme');
  if (param === 'paper' || param === 'night') return param;
  if (saved === 'paper' || saved === 'night') return saved;
  return '';
}

/**
 * Fills `el` with the switch. `storageKey` names where the choice is saved
 * (one per site). `onChange(mode)` runs after every change, including the
 * first, with '' for System. Returns { mode, set(mode) }.
 */
export function themeSwitch(el, { storageKey, onChange, root = document.documentElement } = {}) {
  el.classList.add('themeswitch');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Colour mode');
  el.replaceChildren();
  let mode = '';

  const buttons = MODES.map((m) => {
    const b = iconButton({ icon: ICON[m], toggle: true, size: 's', onPress: () => set(m, true) });
    b.el.dataset.mode = m;
    el.append(b.el);
    return b;
  });

  function set(m, save) {
    mode = MODES.includes(m) ? m : '';
    if (mode) root.dataset.theme = mode;
    else delete root.dataset.theme;
    // A press flips the pressed button; repaint all three so exactly one is on.
    for (const b of buttons) b.setPressed(b.el.dataset.mode === mode);
    if (save && storageKey) store.set(storageKey, mode || null);
    onChange?.(mode);
  }

  set(initialMode(location.search, storageKey ? store.get(storageKey) : null), false);
  return { get mode() { return mode; }, set: (m) => set(m, true) };
}
