// Demo shell: one page layout for every guided demo. A header (product,
// title, intro, and a note that this is a demo), then the step rail beside
// the stage, both starting at the same top line. With ?embed=1 the page is
// transparent, the header goes, the note stays as one small line under the
// stage, and the page reports its height to the frame around it.

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
  product, title, intro, steps, full, onDone, onReset, endText,
  embed = isEmbed(location.search),
}) {
  // Whatever the page already put inside root becomes the stage's content.
  const existing = [...root.childNodes];

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
  railCol.append(railEl);
  const stage = el('div', 'demoshell-stage');
  stage.append(...existing);
  body.append(railCol, stage);

  const note = noteEl(full, embed);
  if (embed) root.replaceChildren(body, note);
  else { head.append(note); root.replaceChildren(head, body); }

  const railOpts = { steps, onDone, onReset };
  if (endText != null) railOpts.endText = endText;
  const rail = stepRail(railEl, railOpts);

  if (embed && window.parent !== window && typeof ResizeObserver === 'function') {
    const report = heightReporter((m) => window.parent.postMessage(m, '*'));
    const measure = () => report(root.getBoundingClientRect().bottom + window.scrollY);
    new ResizeObserver(measure).observe(root);
    measure();
  }

  return { stage, rail };
}
