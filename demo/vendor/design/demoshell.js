// Demo shell: one page layout for every guided demo. A header (product,
// title, intro, and a note that this is a demo), then the step rail beside
// the stage, both starting at the same top line. An optional aside sits under
// the rail in the rail column (controls, say), and follows the rail on
// phones. With ?embed=1 the page is
// transparent, the header goes, the note stays as one small line under the
// stage, and the page reports its height to the frame around it. In both
// views a faint, still "DEMO" mark lies over the stage, and Space (plus any
// single keys the demo names) runs the demo's main action, with a key legend
// under the rail.

import { stepRail } from './steprail.js';

const LEAD = 'A demo with limited features.';

/** The demo note as plain text, plus the linked words at its end (or null). */
export function demoNote(full) {
  if (!full || full.coming) {
    return { text: `${LEAD} The full version is coming.`, link: null };
  }
  const where = full.where || 'here';
  return {
    text: `${LEAD} The full ${full.label} is ${where}.`,
    link: { text: where, href: full.href },
  };
}

/** True when the search string asks for the framed view (?embed=1). */
export function isEmbed(search) {
  return new URLSearchParams(search).get('embed') === '1';
}

/** Wraps a post function: whole pixels, and nothing sent twice in a row. */
export function heightReporter(post) {
  let last = null;
  return (height) => {
    const h = Math.ceil(height);
    if (h === last) return;
    last = h;
    post({ type: 'demo-height', height: h });
  };
}

/** The attribute that sends a child of root to the aside instead of the stage. */
export const ASIDE_ATTR = 'data-demoshell-aside';

/**
 * Splits root's existing children: elements marked with ASIDE_ATTR go to the
 * aside (under the rail), everything else to the stage, order kept.
 */
export function splitContent(nodes) {
  const stage = [];
  const aside = [];
  for (const n of nodes) {
    const toAside = n && n.nodeType === 1 && typeof n.hasAttribute === 'function' && n.hasAttribute(ASIDE_ATTR);
    (toAside ? aside : stage).push(n);
  }
  return { stage, aside };
}

// ---- keyboard: Space for the demo's main action, single keys for others ----

/** The name a binding uses: "Space" for the space bar, letters in lower case. */
export function keyName(key) {
  if (key === ' ' || key === 'Spacebar' || key === 'Space') return 'Space';
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * The bindings for demoShell's primary and keys options, as a Map from key
 * name to { run, label }. Space is the primary's toggle. A key given as a bare
 * function works but has no label, so it stays out of the legend.
 */
export function keyBindings({ primary, keys } = {}) {
  const map = new Map();
  if (primary) map.set('Space', { run: () => primary.toggle(), label: primary.label });
  for (const [k, v] of Object.entries(keys ?? {})) {
    const b = typeof v === 'function' ? { run: v, label: null } : { run: () => v.run(), label: v.label };
    map.set(keyName(k), b);
  }
  return map;
}

const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox']);
const SPACE_ROLES = new Set(['button', 'checkbox', 'switch', 'radio', 'tab', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio']);
const SPACE_INPUTS = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'color', 'file', 'range']);

/**
 * True when the focused element uses this key itself: fields take every key,
 * buttons and other Space-pressable controls take Space.
 */
export function ownsKey(target, name) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName || '').toUpperCase();
  const role = typeof target.getAttribute === 'function' ? target.getAttribute('role') : null;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || TEXT_ROLES.has(role)) return true;
  if (tag === 'INPUT') {
    const type = String(target.type || 'text').toLowerCase();
    return SPACE_INPUTS.has(type) ? name === 'Space' : true;
  }
  if (tag === 'BUTTON' || tag === 'SUMMARY' || SPACE_ROLES.has(role)) return name === 'Space';
  return false;
}

/** The binding a keydown should run, or null when the page should leave it be. */
export function routeKey(e, bindings) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return null;
  const name = keyName(e.key);
  const b = bindings.get(name);
  if (!b || ownsKey(e.target, name)) return null;
  return b;
}

/** Legend entries for the rail: [{ key: 'Space', label: 'play' }, { key: 'R', ... }]. */
export function keyLegend(bindings) {
  const out = [];
  for (const [name, b] of bindings) {
    if (!b.label) continue;
    out.push({ key: name.length === 1 ? name.toUpperCase() : name, label: b.label });
  }
  return out;
}

// ---- the demo mark: a faint, still "DEMO" over the demo ----

/** No mark on this element: it rises above the stage's mark, on a ground unless it has its own. */
export const NOMARK_ATTR = 'data-demoshell-nomark';
/**
 * A mark of its own for an element inside an opted-out one. Anywhere else the
 * stage's mark already lies over it, so the attribute changes nothing there.
 */
export const MARK_ATTR = 'data-demoshell-mark';
export const MARK_WORD = 'DEMO';

/** The mark's text: the word, count times, space separated. */
export function markText(count) {
  return Array.from({ length: count }, () => MARK_WORD).join(' ');
}

/** Tiles in each mark: enough to fill a 2560px-wide, 3000px-tall box. */
export const MARK_TILES = 1800;

/** The mark's tiles: one span per word; CSS centres them on a grid of whole tiles. */
export function markTiles(count, doc = document) {
  return Array.from({ length: count }, () => {
    const s = doc.createElement('span');
    s.textContent = MARK_WORD;
    return s;
  });
}

// Elements that cannot hold a child layer, or are controls, not surfaces.
const NO_LAYER = new Set(['CANVAS', 'IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON', 'SVG', 'PICTURE']);

/**
 * Whether an element in the stage gets a mark layer of its own, over its
 * content. The stage's mark lies over everything else, so only an element
 * that asks (data-demoshell-mark) inside an opted-out one needs its own.
 */
export function ownsMark({ tagName, optIn = false, nomark = false, insideNomark = false }) {
  if (NO_LAYER.has(String(tagName).toUpperCase())) return false;
  return optIn && !nomark && insideNomark;
}

function transparent(color) {
  const c = String(color || '').trim();
  if (!c || c === 'transparent') return true;
  const rgba = c.match(/^rgba\([^)]*,\s*([\d.]+%?)\s*\)$/);
  const slash = c.match(/\/\s*([\d.]+%?)\s*\)$/);
  const a = rgba?.[1] ?? slash?.[1];
  return a != null && parseFloat(a) === 0;
}

/**
 * @deprecated Since 1.7.0 the mark lies over the whole stage, so no surface
 * needs one behind its content; the shell no longer calls this. Kept for
 * pages that import it: a surface with its own background, or one that asks.
 */
export function wantsMark({ tagName, background, nomark = false, optIn = false }) {
  if (nomark || NO_LAYER.has(String(tagName).toUpperCase())) return false;
  return optIn || !transparent(background);
}

function markEl() {
  const mark = el('div', 'demoshell-mark');
  mark.append(...markTiles(MARK_TILES));
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

// The mark goes last in its box, so it paints over the content before it.
function markSurfaces(stage) {
  for (const s of stage.querySelectorAll(`[${MARK_ATTR}]`)) {
    const off = s.parentElement?.closest(`[${NOMARK_ATTR}]`);
    const want = ownsMark({
      tagName: s.tagName,
      optIn: true,
      nomark: s.hasAttribute(NOMARK_ATTR),
      insideNomark: !!off && stage.contains(off),
    });
    if (!want) continue;
    s.classList.add('demoshell-marked');
    s.append(markEl());
  }
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function noteEl(full, embed) {
  const { text, link } = demoNote(full);
  const p = el('p', 'demoshell-note');
  if (!link) {
    p.textContent = text;
    return p;
  }
  const a = el('a', null, link.text);
  a.href = link.href;
  // Inside a frame, a link must not replace the demo with the whole site.
  if (embed) { a.target = '_blank'; a.rel = 'noopener'; }
  p.append(text.slice(0, text.length - link.text.length - 1), a, '.');
  return p;
}

export function demoShell(root, {
  product, title, intro, steps, full, onDone, onReset, endText, primary, keys,
  embed = isEmbed(location.search),
}) {
  // Whatever the page already put inside root becomes the stage's content,
  // except elements marked data-demoshell-aside, which go under the rail.
  const parts = splitContent([...root.childNodes]);

  root.classList.add('demoshell');
  root.toggleAttribute('data-embed', embed);
  document.documentElement.classList.toggle('demoshell-embed', embed);

  const head = el('header', 'demoshell-head');
  head.append(el('p', 'demoshell-eyebrow', `${product} · demo`), el('h1', 'demoshell-title', title));
  if (intro) head.append(el('p', 'demoshell-intro', intro));

  const body = el('div', 'demoshell-body');
  const railCol = el('aside', 'demoshell-rail');
  railCol.setAttribute('aria-label', 'Steps');
  const railEl = el('div');
  // The aside: optional controls under the rail. Empty, it takes no space.
  const aside = el('div', 'demoshell-aside');
  aside.append(...parts.aside);
  // The key legend: "Space: play", one line per key. Empty, it takes no space.
  const bindings = keyBindings({ primary, keys });
  const legend = el('p', 'demoshell-keys');
  for (const { key, label } of keyLegend(bindings)) {
    const line = el('span', 'demoshell-key');
    line.append(el('kbd', null, key), `: ${label}`);
    legend.append(line);
  }
  railCol.append(railEl, legend, aside);
  const stage = el('div', 'demoshell-stage');
  stage.append(...parts.stage);
  body.append(railCol, stage);

  const note = noteEl(full, embed);
  if (embed) root.replaceChildren(body, note);
  else { head.append(note); root.replaceChildren(head, body); }

  // The mark, in both views: one layer over the whole stage, above its
  // content, so nothing in the demo covers it and a screenshot cannot pass
  // for the product. Faint, still, and out of the way of the pointer, of
  // selection and of assistive tech.
  if (!root.hasAttribute(NOMARK_ATTR)) {
    markSurfaces(stage);
    stage.append(markEl());
  }

  const railOpts = { steps, onDone, onReset };
  if (endText != null) railOpts.endText = endText;
  const rail = stepRail(railEl, railOpts);

  if (bindings.size) {
    document.addEventListener('keydown', (e) => {
      const b = routeKey(e, bindings);
      if (!b) return;
      e.preventDefault(); // Space must not scroll the page
      if (e.repeat) return; // holding a key toggles once
      b.run();
    });
  }

  if (embed && window.parent !== window && typeof ResizeObserver === 'function') {
    const report = heightReporter((m) => window.parent.postMessage(m, '*'));
    const measure = () => report(root.getBoundingClientRect().bottom + window.scrollY);
    new ResizeObserver(measure).observe(root);
    measure();
  }

  return { stage, rail, aside };
}
