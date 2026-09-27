// Social and summary cards: one layout, four sizes, restyled only here.
// visuals/card.html?format=og&theme=night&data=<url-encoded JSON>
// JSON: { name, lines: string[], symbol: "<svg>...</svg>", image?: URL,
//         category?: "transcribe" | "transform" | "perceive" | "workflow" }
// When fonts and the image are in, <body data-ready="1"> says the card can be
// captured. A bad URL shows the error on the card and sets data-ready="error".

export const FORMATS = {
  thumb: [1200, 750],
  og: [1200, 630],
  square: [1080, 1080],
  story: [1080, 1920],
};

export const THEMES = ['paper', 'night'];
export const CATEGORIES = ['transcribe', 'transform', 'perceive', 'workflow'];

export function parseCard(search) {
  const q = new URLSearchParams(search);
  const format = q.get('format');
  if (!Object.hasOwn(FORMATS, format ?? '')) {
    throw new Error(`unknown format "${format}": use ${Object.keys(FORMATS).join(', ')}`);
  }
  const theme = q.get('theme') ?? 'paper';
  if (!THEMES.includes(theme)) throw new Error(`unknown theme "${theme}": use paper or night`);

  let data;
  try {
    data = JSON.parse(q.get('data') ?? '');
  } catch {
    throw new Error('data is not valid JSON');
  }
  if (!data || typeof data !== 'object' || typeof data.name !== 'string' || !data.name.trim()) {
    throw new Error('data.name is missing');
  }
  if (data.category !== undefined && !CATEGORIES.includes(data.category)) {
    throw new Error(`unknown category "${data.category}": use ${CATEGORIES.join(', ')}`);
  }
  const lines = Array.isArray(data.lines) ? data.lines.map(String) : [];
  return {
    format,
    theme,
    data: { ...data, lines, symbol: typeof data.symbol === 'string' ? data.symbol : '' },
  };
}

// The symbol arrives as markup in a URL, so it is cut down to plain shapes by
// allowlist: anything that can load, link, animate or run is dropped, with its
// whole subtree. Names compare in lowercase.
const SYMBOL_ELEMENTS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'title']);
const SYMBOL_ATTRS = new Set([
  'viewbox', 'width', 'height', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'xmlns',
]);
export const allowedElement = (name) => SYMBOL_ELEMENTS.has(String(name).toLowerCase());
export const allowedAttr = (name) => SYMBOL_ATTRS.has(String(name).toLowerCase());

// Values are checked too: a paint like url(https://...) would make the page
// fetch. Compared lowercased with whitespace and control characters removed,
// so "u r l(" or "java\tscript:" cannot slip past.
const BANNED_IN_VALUE = ['url(', 'javascript:', 'data:', '&', '\\'];
const PAINT = /^(none|currentcolor|var\(--[a-z0-9-]+\)|#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([0-9a-z.,%/+-]*\))$/;
export function allowedValue(name, value) {
  const v = String(value).toLowerCase().replace(/[\s\u0000-\u001f\u007f]/g, '');
  if (BANNED_IN_VALUE.some((b) => v.includes(b))) return false;
  const n = String(name).toLowerCase();
  if (n === 'fill' || n === 'stroke') return PAINT.test(v);
  return true;
}

function clean(el) {
  for (const a of [...el.attributes]) {
    if (!allowedAttr(a.name) || !allowedValue(a.name, a.value)) el.removeAttribute(a.name);
  }
  for (const child of [...el.children]) {
    if (allowedElement(child.localName)) clean(child);
    else child.remove();
  }
}

// A <template> parses inertly (nothing runs or loads) and gives an SVG
// without xmlns its namespace.
function safeSymbol(markup) {
  if (!markup) return null;
  const t = document.createElement('template');
  t.innerHTML = markup;
  const svg = t.content.firstElementChild;
  if (!svg || svg.localName !== 'svg') return null;
  clean(svg);
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

async function render() {
  const body = document.body;
  let card;
  try {
    card = parseCard(location.search);
  } catch (err) {
    body.querySelector('.card').remove();
    const p = document.createElement('p');
    p.className = 'card-error';
    p.textContent = `card: ${err.message}`;
    body.append(p);
    body.dataset.ready = 'error';
    return;
  }

  const { format, theme, data } = card;
  const [w, h] = FORMATS[format];
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.format = format;
  if (data.category) root.dataset.category = data.category;
  root.style.setProperty('--card-w', `${w}px`);
  root.style.setProperty('--card-h', `${h}px`);
  root.style.setProperty('--u', `${Math.min(w, h) / 100}px`);
  document.title = `${data.name} (${format})`;

  const $ = (sel) => body.querySelector(sel);
  $('.card-name').textContent = data.name;
  const symbol = safeSymbol(data.symbol);
  if (symbol) $('.card-symbol').append(symbol);
  $('.card-cat').textContent = data.category ?? 'project';
  $('.card-size').textContent = `${format} ${w}×${h}`;
  $('.card-lines').append(...data.lines.map((text) => {
    const p = document.createElement('p');
    p.textContent = text;
    return p;
  }));

  const waits = [
    document.fonts.load(`800 20px Archivo`),
    document.fonts.load(`400 20px Archivo`),
    document.fonts.load(`500 20px "JetBrains Mono"`),
  ];
  if (data.image) {
    const img = $('.card-image img');
    img.src = data.image;
    waits.push(img.decode().catch(() => { root.dataset.imageError = '1'; }));
  } else {
    root.dataset.noImage = '1';
  }
  await Promise.allSettled(waits);
  await document.fonts.ready;
  body.dataset.ready = '1';
}

if (typeof document !== 'undefined') render();
