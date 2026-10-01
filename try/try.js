"use strict";
(() => {
  // demo/vendor/design/iconbutton.js
  var ICONS = {
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
    // Colour modes: follow the system (half dark), Paper (a sun), Night (a moon).
    system: '<circle cx="8" cy="8" r="5"/><path d="M8 3a5 5 0 0 0 0 10z" fill="currentColor"/>',
    paper: '<circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>',
    night: '<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z"/>'
  };
  var ICON_NAMES = Object.keys(ICONS);
  var TURN = { down: 0, up: 180, right: -90, left: 90 };
  function known(name) {
    if (!Object.hasOwn(ICONS, name)) {
      throw new Error(`unknown icon "${name}"; known: ${ICON_NAMES.join(", ")}`);
    }
    return name;
  }
  function iconSvg(name, { dir } = {}) {
    const shapes = ICONS[known(name)];
    const turn = name === "chevron" && TURN[dir] ? `<g transform="rotate(${TURN[dir]} 8 8)">${shapes}</g>` : shapes;
    return `<svg class="ds-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${turn}</svg>`;
  }

  // demo/vendor/design/steprail.js
  function createRail(ids) {
    let i = 0;
    return {
      get current() {
        return i < ids.length ? ids[i] : null;
      },
      get finished() {
        return i >= ids.length;
      },
      isDone(id) {
        const k = ids.indexOf(id);
        return k !== -1 && k < i;
      },
      done(id) {
        if (i >= ids.length || ids[i] !== id) return false;
        i += 1;
        return true;
      },
      reset() {
        i = 0;
      }
    };
  }
  function stepRail(el2, { steps, onDone, onReset, endText = "That\u2019s it. Everything is yours to play with now." }) {
    const state = createRail(steps.map((s) => s.id));
    el2.classList.add("steprail");
    el2.innerHTML = "";
    const head = document.createElement("div");
    head.className = "steprail-head";
    const list = document.createElement("ol");
    const items = steps.map((s) => {
      const li = document.createElement("li");
      li.className = "steprail-step";
      li.dataset.id = s.id;
      li.innerHTML = `<span class="steprail-label"></span>${s.hint ? '<span class="steprail-hint"></span>' : ""}`;
      li.querySelector(".steprail-label").textContent = s.label;
      if (s.hint) li.querySelector(".steprail-hint").textContent = s.hint;
      list.append(li);
      return li;
    });
    const end = document.createElement("p");
    end.className = "steprail-end";
    end.textContent = endText;
    const again = document.createElement("button");
    again.type = "button";
    again.className = "steprail-reset";
    again.innerHTML = iconSvg("reset");
    again.setAttribute("aria-label", "Start over");
    again.title = "Start over";
    head.append(again);
    el2.append(head, list, end);
    function paint() {
      items.forEach((li) => {
        const id = li.dataset.id;
        li.dataset.state = state.isDone(id) ? "done" : id === state.current ? "current" : "todo";
        li.toggleAttribute("aria-current", id === state.current);
      });
      end.hidden = !state.finished;
    }
    again.addEventListener("click", () => {
      state.reset();
      paint();
      onReset?.();
    });
    paint();
    return {
      get current() {
        return state.current;
      },
      done(id) {
        if (!state.done(id)) return;
        paint();
        if (state.finished) onDone?.();
      },
      reset() {
        state.reset();
        paint();
      }
    };
  }

  // demo/vendor/design/demoshell.js
  function railTitle(full) {
    if (!full || full.coming) return { text: "Try it out!", link: null };
    return { text: "Try it out! Or ", link: { text: "open the full version \u2192", href: full.href } };
  }
  function isEmbed(search) {
    return new URLSearchParams(search).get("embed") === "1";
  }
  function heightReporter(post) {
    let last = null;
    return (height) => {
      const h = Math.ceil(height);
      if (h === last) return;
      last = h;
      post({ type: "demo-height", height: h });
    };
  }
  var ASIDE_ATTR = "data-demoshell-aside";
  function splitContent(nodes) {
    const stage = [];
    const aside = [];
    for (const n of nodes) {
      const toAside = n && n.nodeType === 1 && typeof n.hasAttribute === "function" && n.hasAttribute(ASIDE_ATTR);
      (toAside ? aside : stage).push(n);
    }
    return { stage, aside };
  }
  function keyName(key) {
    if (key === " " || key === "Spacebar" || key === "Space") return "Space";
    return key.length === 1 ? key.toLowerCase() : key;
  }
  function keyBindings({ primary, keys } = {}) {
    const map = /* @__PURE__ */ new Map();
    if (primary) map.set("Space", { run: () => primary.toggle(), label: primary.label });
    for (const [k, v] of Object.entries(keys ?? {})) {
      const b = typeof v === "function" ? { run: v, label: null } : { run: () => v.run(), label: v.label };
      map.set(keyName(k), b);
    }
    return map;
  }
  var TEXT_ROLES = /* @__PURE__ */ new Set(["textbox", "searchbox", "combobox"]);
  var SPACE_ROLES = /* @__PURE__ */ new Set(["button", "checkbox", "switch", "radio", "tab", "option", "menuitem", "menuitemcheckbox", "menuitemradio"]);
  var SPACE_INPUTS = /* @__PURE__ */ new Set(["button", "submit", "reset", "checkbox", "radio", "image", "color", "file", "range"]);
  function ownsKey(target, name) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = String(target.tagName || "").toUpperCase();
    const role = typeof target.getAttribute === "function" ? target.getAttribute("role") : null;
    if (tag === "TEXTAREA" || tag === "SELECT" || TEXT_ROLES.has(role)) return true;
    if (tag === "INPUT") {
      const type = String(target.type || "text").toLowerCase();
      return SPACE_INPUTS.has(type) ? name === "Space" : true;
    }
    if (tag === "BUTTON" || tag === "SUMMARY" || SPACE_ROLES.has(role)) return name === "Space";
    return false;
  }
  function routeKey(e, bindings) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return null;
    const name = keyName(e.key);
    const b = bindings.get(name);
    if (!b || ownsKey(e.target, name)) return null;
    return b;
  }
  function keyLegend(bindings) {
    const out = [];
    for (const [name, b] of bindings) {
      if (!b.label) continue;
      out.push({ key: name.length === 1 ? name.toUpperCase() : name, label: b.label });
    }
    return out;
  }
  var NOMARK_ATTR = "data-demoshell-nomark";
  var MARK_ATTR = "data-demoshell-mark";
  var MARK_WORD = "DEMO";
  var MARK_TILES = 1800;
  function markTiles(count, doc = document) {
    return Array.from({ length: count }, () => {
      const s = doc.createElement("span");
      s.textContent = MARK_WORD;
      return s;
    });
  }
  var NO_LAYER = /* @__PURE__ */ new Set(["CANVAS", "IMG", "VIDEO", "AUDIO", "IFRAME", "OBJECT", "EMBED", "TEXTAREA", "INPUT", "SELECT", "BUTTON", "SVG", "PICTURE"]);
  function ownsMark({ tagName, optIn = false, nomark = false, insideNomark = false }) {
    if (NO_LAYER.has(String(tagName).toUpperCase())) return false;
    return optIn && !nomark && insideNomark;
  }
  function markEl() {
    const mark = el("div", "demoshell-mark");
    mark.append(...markTiles(MARK_TILES));
    mark.setAttribute("aria-hidden", "true");
    return mark;
  }
  function markSurfaces(stage) {
    for (const s of stage.querySelectorAll(`[${MARK_ATTR}]`)) {
      const off = s.parentElement?.closest(`[${NOMARK_ATTR}]`);
      const want = ownsMark({
        tagName: s.tagName,
        optIn: true,
        nomark: s.hasAttribute(NOMARK_ATTR),
        insideNomark: !!off && stage.contains(off)
      });
      if (!want) continue;
      s.classList.add("demoshell-marked");
      s.append(markEl());
    }
  }
  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }
  function titleEl(full, embed) {
    const { text, link } = railTitle(full);
    const p = el("p", "demoshell-go", text);
    if (link) {
      const a = el("a", null, link.text);
      a.href = link.href;
      if (embed) {
        a.target = "_blank";
        a.rel = "noopener";
      }
      p.append(a);
    }
    return p;
  }
  function demoShell(root, {
    product,
    title,
    intro,
    steps,
    full,
    onDone,
    onReset,
    endText,
    primary,
    keys,
    embed = isEmbed(location.search)
  }) {
    const parts = splitContent([...root.childNodes]);
    root.classList.add("demoshell");
    root.toggleAttribute("data-embed", embed);
    document.documentElement.classList.toggle("demoshell-embed", embed);
    const head = el("header", "demoshell-head");
    head.append(el("p", "demoshell-eyebrow", `${product} \xB7 demo`), el("h1", "demoshell-title", title));
    if (intro) head.append(el("p", "demoshell-intro", intro));
    const body = el("div", "demoshell-body");
    const railCol = el("aside", "demoshell-rail");
    railCol.setAttribute("aria-label", "Steps");
    const railEl = el("div");
    const aside = el("div", "demoshell-aside");
    aside.append(...parts.aside);
    const bindings = keyBindings({ primary, keys });
    const legend = el("p", "demoshell-keys");
    for (const { key, label } of keyLegend(bindings)) {
      const line = el("span", "demoshell-key");
      line.append(el("kbd", null, key), `: ${label}`);
      legend.append(line);
    }
    railCol.append(railEl, legend, aside);
    const stage = el("div", "demoshell-stage");
    stage.append(...parts.stage);
    body.append(railCol, stage);
    if (embed) root.replaceChildren(body);
    else root.replaceChildren(head, body);
    if (!root.hasAttribute(NOMARK_ATTR)) {
      markSurfaces(stage);
      stage.append(markEl());
    }
    const railOpts = { steps, onDone, onReset };
    if (endText != null) railOpts.endText = endText;
    const rail2 = stepRail(railEl, railOpts);
    railEl.querySelector(".steprail-head")?.prepend(titleEl(full, embed));
    if (bindings.size) {
      document.addEventListener("keydown", (e) => {
        const b = routeKey(e, bindings);
        if (!b) return;
        e.preventDefault();
        if (e.repeat) return;
        b.run();
      });
    }
    if (embed && window.parent !== window && typeof ResizeObserver === "function") {
      const report = heightReporter((m) => window.parent.postMessage(m, "*"));
      const measure = () => report(root.getBoundingClientRect().bottom + window.scrollY);
      new ResizeObserver(measure).observe(root);
      measure();
    }
    return { stage, rail: rail2, aside };
  }

  // src/timeline.ts
  var POSITION_TAG = /^\[(?:=[^\]]+|\d+(?:\.\d+){0,2}|\d+:\d{1,2}(?:\.\d+)?)\]/;
  var hasPositionTag = (line) => POSITION_TAG.test(line.trim());
  var cleanLyricLine = (raw) => {
    let line = raw.trim();
    if (!line) return null;
    if (/^#{1,6}\s/.test(line)) return null;
    if (/^(---|\*\*\*|___)$/.test(line)) return null;
    if (line === "\u266A") return null;
    line = line.replace(/^[-*+]\s+(\[[ xX]?\]\s*)?/, "").trim();
    return line || null;
  };
  var extractLyricLines = (md2) => {
    const cleaned = (md2 || "").replace(/\r\n?/g, "\n").split("\n").map(cleanLyricLine);
    const out = [];
    let inBlock = false;
    for (const line of cleaned) {
      if (line == null) {
        inBlock = false;
        continue;
      }
      if (hasPositionTag(line)) {
        inBlock = true;
        out.push(line);
      } else if (inBlock) {
        out.push(line);
      }
    }
    return out;
  };
  var MIN_CLIP_BEATS = 0.25;
  var planClips = (lines, opts = {}) => {
    const start = opts.startBeat ?? 0;
    const min = opts.minBeats && opts.minBeats > 0 ? opts.minBeats : MIN_CLIP_BEATS;
    const total = opts.totalBeats && opts.totalBeats > 0 ? opts.totalBeats : lines.length * 4;
    const weightOf = (l) => Math.max((l || "").length, 1);
    const sum = lines.reduce((a, l) => a + weightOf(l), 0) || 1;
    const plans = [];
    let t = start;
    for (const name of lines) {
      const duration = Math.max(weightOf(name) / sum * total, min);
      plans.push({ startTime: t, duration, name });
      t += duration;
    }
    return plans;
  };
  var evalExpr = (src, vars = {}) => {
    const tokens = src.match(/\d*\.?\d+|[a-zA-Z_]+|[+\-*/()]/g);
    if (!tokens) return null;
    if (tokens.join("") !== src.replace(/\s+/g, "")) return null;
    let i = 0;
    let ok = true;
    const peek = () => tokens[i];
    const eat = () => tokens[i++];
    const factor = () => {
      const t = peek();
      if (t === "-") return eat(), -factor();
      if (t === "+") return eat(), factor();
      if (t === "(") {
        eat();
        const v = expr();
        if (peek() === ")") eat();
        else ok = false;
        return v;
      }
      if (t === void 0) return ok = false, 0;
      if (/^\d*\.?\d+$/.test(t)) return eat(), parseFloat(t);
      if (/^[a-zA-Z_]+$/.test(t)) {
        eat();
        const v = vars[t];
        if (v === void 0) return ok = false, 0;
        return v;
      }
      return ok = false, eat(), 0;
    };
    const term = () => {
      let v = factor();
      for (let op = peek(); op === "*" || op === "/"; op = peek()) {
        eat();
        const r = factor();
        v = op === "*" ? v * r : v / r;
      }
      return v;
    };
    const expr = () => {
      let v = term();
      for (let op = peek(); op === "+" || op === "-"; op = peek()) {
        eat();
        const r = term();
        v = op === "+" ? v + r : v - r;
      }
      return v;
    };
    const result = expr();
    if (!ok || i !== tokens.length || !isFinite(result)) return null;
    return result;
  };
  var parseTimingTag = (line, opts = {}) => {
    const bpb = opts.beatsPerBar && opts.beatsPerBar > 0 ? opts.beatsPerBar : 4;
    const m = line.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
    if (!m) return { beat: null, name: line.trim() };
    const tag = (m[1] ?? "").trim();
    const name = (m[2] ?? "").trim();
    if (tag.startsWith("=")) {
      const vars = {};
      if (opts.bpm && opts.bpm > 0) vars.bpm = opts.bpm;
      const v = evalExpr(tag.slice(1), vars);
      return { beat: v == null ? null : Math.max(v, 0), name };
    }
    const clock = tag.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
    if (clock) {
      const bpm = opts.bpm;
      if (!bpm || bpm <= 0) return { beat: null, name };
      const seconds = parseInt(clock[1] ?? "0", 10) * 60 + parseFloat(clock[2] ?? "0");
      return { beat: seconds * bpm / 60, name };
    }
    const mus = tag.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    if (mus) {
      const bar = parseInt(mus[1] ?? "1", 10);
      const beat = mus[2] ? parseInt(mus[2], 10) : 1;
      const six = mus[3] ? parseInt(mus[3], 10) : 1;
      return { beat: Math.max((bar - 1) * bpb + (beat - 1) + (six - 1) / 4, 0), name };
    }
    return { beat: null, name };
  };
  var hasTimingTags = (lines, opts = {}) => lines.some((l) => parseTimingTag(l, opts).beat !== null);
  var resolveTimeline = (lines, opts = {}) => {
    const bpb = opts.beatsPerBar && opts.beatsPerBar > 0 ? opts.beatsPerBar : 4;
    const spacing = opts.spacingBeats && opts.spacingBeats > 0 ? opts.spacingBeats : 4;
    const start = opts.startBeat ?? 0;
    const tagOpts = { beatsPerBar: bpb };
    if (opts.bpm != null) tagOpts.bpm = opts.bpm;
    const out = [];
    let prev = null;
    for (const line of lines) {
      const { beat, name } = parseTimingTag(line, tagOpts);
      const pos = beat != null ? beat : prev == null ? start : prev + spacing;
      out.push({ name, beat: pos });
      prev = pos;
    }
    return out;
  };
  var buildLocators = (lines, opts = {}) => resolveTimeline(lines, opts).map((t) => ({ time: t.beat, name: t.name }));
  var buildClips = (lines, opts = {}) => {
    const min = opts.minBeats && opts.minBeats > 0 ? opts.minBeats : MIN_CLIP_BEATS;
    const tail = opts.tailBeats && opts.tailBeats > 0 ? opts.tailBeats : 4;
    const timed = resolveTimeline(lines, opts);
    if (!hasTimingTags(lines, opts)) {
      return planClips(timed.map((t) => t.name), {
        ...opts.startBeat != null ? { startBeat: opts.startBeat } : {},
        minBeats: min
      });
    }
    const sorted = [...timed].sort((a, b) => a.beat - b.beat);
    const clips = [];
    let prevEnd = -Infinity;
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      if (!cur) continue;
      const next = sorted[i + 1];
      const startTime = Math.max(cur.beat, prevEnd);
      const duration = next ? Math.max(next.beat - startTime, min) : tail;
      clips.push({ startTime, duration, name: cur.name });
      prevEnd = startTime + duration;
    }
    return clips;
  };
  var NUDGE_BEATS = 1 / 32;
  var placeWithoutCollision = (beats, occupied = [], opts = {}) => {
    const tol = opts.tolerance && opts.tolerance > 0 ? opts.tolerance : 1e-6;
    const rawEps = opts.epsilon && opts.epsilon > 0 ? opts.epsilon : NUDGE_BEATS;
    const eps = Math.max(rawEps, tol * 2);
    const taken = occupied.slice();
    const isTaken = (b) => taken.some((t) => Math.abs(t - b) < tol);
    const out = [];
    for (const beat of beats) {
      let b = beat;
      while (isTaken(b)) b += eps;
      taken.push(b);
      out.push(b);
    }
    return out;
  };

  // demo/view.ts
  var BEATS_PER_BAR = 4;
  var secondsLabel = (beat, bpm) => {
    const s = Math.round(beat * 60 / bpm);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  var barBeat = (beat, beatsPerBar = BEATS_PER_BAR) => {
    const bar = Math.floor(beat / beatsPerBar) + 1;
    const b = Math.floor(beat % beatsPerBar) + 1;
    return `${bar}.${b}`;
  };
  var clockText = (beat, bpm) => {
    const s = beat * 60 / bpm;
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
  };
  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function render(els, opts) {
    const beatsPerBar = opts.beatsPerBar ?? BEATS_PER_BAR;
    const lines = extractLyricLines(els.md.value);
    const timingOpts = { beatsPerBar, bpm: opts.bpm };
    els.linesEl.replaceChildren();
    const locators = buildLocators(lines, timingOpts);
    const placed = placeWithoutCollision(locators.map((l) => l.time));
    locators.forEach((loc, i) => {
      const tagged = parseTimingTag(lines[i] ?? "", timingOpts).beat !== null;
      const li = node("li", tagged ? "tagged" : "flowed");
      li.append(
        node("span", "pos", barBeat(loc.time, beatsPerBar)),
        node("span", "name", loc.name || "(empty line)"),
        node("span", "how mut", tagged ? clockText(loc.time, opts.bpm) : "flows")
      );
      els.linesEl.append(li);
    });
    els.countEl.textContent = lines.length === 1 ? "1 line" : `${lines.length} lines`;
    if (lines.length === 0) {
      els.linesEl.append(node("li", "empty mut", "No tagged lines yet. Start a line with [1]."));
    }
    const clips = buildClips(lines, timingOpts);
    drawTimeline(
      els.timeline,
      opts.mode,
      locators.map((l, i) => ({ ...l, time: placed[i] ?? l.time })),
      clips,
      beatsPerBar,
      opts.scales ? { bpm: opts.bpm, ...opts.scales } : void 0
    );
  }
  function drawTimeline(timeline2, mode2, locators, clips, beatsPerBar = BEATS_PER_BAR, scales) {
    const lastBeat = Math.max(
      16,
      ...locators.map((l) => l.time + 4),
      ...clips.map((c) => c.startTime + c.duration)
    );
    const bars = Math.max(Math.ceil(lastBeat / beatsPerBar) + 1, scales?.minBars ?? 0);
    const pct = (beat) => `${beat / (bars * beatsPerBar) * 100}%`;
    timeline2.dataset["bars"] = String(bars);
    timeline2.style.setProperty("--bars", String(bars));
    timeline2.replaceChildren();
    const track = node("div", "track");
    const ruler = node("div", "ruler");
    const mark = scales?.mark ?? null;
    const markBar = mark && mark.beat % beatsPerBar === 0 ? mark.beat / beatsPerBar : -1;
    if (scales) {
      ruler.classList.add("scales");
      if (mark) ruler.dataset["scale"] = mark.scale;
    }
    for (let b = 0; b < bars; b++) {
      const tick = node("span", "bar", String(b + 1));
      tick.style.left = pct(b * beatsPerBar);
      if (mark?.scale === "bars" && b === markBar) tick.classList.add("on");
      ruler.append(tick);
      if (scales) {
        const sec = node("span", b % 2 ? "sec odd" : "sec", secondsLabel(b * beatsPerBar, scales.bpm));
        sec.style.left = pct(b * beatsPerBar);
        if (mark?.scale === "seconds" && b === markBar) sec.classList.add("on");
        ruler.append(sec);
      }
    }
    track.append(ruler);
    const lane = node("div", "lane");
    lane.append(node("span", "lane-name", "Lyrics"));
    if (mode2 === "locators") {
      for (const loc of locators) {
        const flag = node("div", "locator");
        flag.style.left = pct(loc.time);
        flag.append(node("span", "flag", loc.name));
        flag.title = `${barBeat(loc.time, beatsPerBar)}  ${loc.name}`;
        ruler.append(flag);
      }
    } else {
      for (const c of clips) {
        const clip = node("div", "clip", c.name);
        clip.style.left = pct(c.startTime);
        clip.style.width = pct(c.duration);
        clip.title = `${barBeat(c.startTime, beatsPerBar)}  ${c.name}`;
        lane.append(clip);
      }
    }
    track.append(lane);
    timeline2.append(track);
  }

  // demo/try/steps.ts
  var VERSE = `Low tide at noon
Gulls count the boats
I hum it back
The pier keeps time
`;
  var BEATS_PER_BAR2 = 4;
  var BRACKET = /^\s*\[([^\]]+)\]/;
  var CLOCK_SHAPE = /^\d+:\d{1,2}(?:\.\d+)?$/;
  var firstLyricLine = (text) => extractLyricLines(text)[0] ?? null;
  var tagOf = (line) => line.match(BRACKET)?.[1]?.trim() ?? "";
  var isBar9 = (line) => !CLOCK_SHAPE.test(tagOf(line)) && parseTimingTag(line, { beatsPerBar: BEATS_PER_BAR2 }).beat === 32;
  var isEightSeconds = (line) => CLOCK_SHAPE.test(tagOf(line)) && parseTimingTag(line, { beatsPerBar: BEATS_PER_BAR2, bpm: 60 }).beat === 8;
  function stepFor(text, mode2, done) {
    const line = firstLyricLine(text);
    if (!done.has("tag")) {
      return line != null && isBar9(line) ? "tag" : null;
    }
    if (!done.has("time")) {
      return line != null && isEightSeconds(line) ? "time" : null;
    }
    if (!done.has("mode")) {
      return mode2 === "clips" ? "mode" : null;
    }
    return null;
  }
  function activeTag(text, bpm) {
    const line = firstLyricLine(text);
    if (line == null) return null;
    const { beat } = parseTimingTag(line, { beatsPerBar: BEATS_PER_BAR2, bpm });
    if (beat == null) return null;
    return { scale: CLOCK_SHAPE.test(tagOf(line)) ? "seconds" : "bars", beat };
  }

  // demo/try/try.ts
  var BPM = 120;
  var RULER_BARS = 13;
  var $ = (id) => {
    const el2 = document.getElementById(id);
    if (!el2) throw new Error(`#${id} missing`);
    return el2;
  };
  var md = $("md");
  var linesEl = $("lines");
  var countEl = $("count");
  var timeline = $("timeline");
  var modeButtons = [...document.querySelectorAll("[data-mode]")];
  var mode = "locators";
  var doneSteps = /* @__PURE__ */ new Set();
  function render2() {
    render(
      { md, linesEl, countEl, timeline },
      { bpm: BPM, mode, scales: { mark: activeTag(md.value, BPM), minBars: RULER_BARS } }
    );
  }
  function checkStep() {
    const id = stepFor(md.value, mode, doneSteps);
    if (id) {
      doneSteps.add(id);
      rail.done(id);
    }
  }
  function setMode(next) {
    mode = next;
    for (const b of modeButtons) b.setAttribute("aria-pressed", String(b.dataset["mode"] === next));
    render2();
    checkStep();
  }
  var fit = () => {
    md.style.height = "auto";
    md.style.height = `${md.scrollHeight + 2}px`;
  };
  var { rail } = demoShell($("demo"), {
    product: "Session Notes",
    title: "Place lyrics in Ableton Live's arrangement.",
    intro: "A bracket at the start of a line sets where it lands. Tempo is 120 BPM, so a bar lasts two seconds.",
    steps: [
      { id: "tag", label: "Type [9] before the first line", hint: "A plain number means a bar." },
      { id: "time", label: "Change it to [0:08]", hint: "A colon means minutes and seconds: 0:08 is bar 5." },
      { id: "mode", label: "Switch to Clips" }
    ],
    // The rail's title stays a plain "Try it out!"; the way to the full version (the
    // extension's releases) comes at the end of the tour, as in every demo.
    endText: "That was the first step. ",
    onReset: () => {
      doneSteps.clear();
      mode = "locators";
      for (const b of modeButtons) b.setAttribute("aria-pressed", String(b.dataset["mode"] === "locators"));
      md.value = VERSE;
      fit();
      render2();
    }
  });
  {
    const full = Object.assign(document.createElement("a"), {
      className: "full-link",
      href: "https://github.com/swwallowws/ableton-session-notes/releases",
      target: "_blank",
      rel: "noopener",
      textContent: "Full version \u2197"
    });
    document.querySelector(".steprail-end")?.append(full);
  }
  md.value = VERSE;
  md.addEventListener("input", () => {
    fit();
    render2();
    checkStep();
  });
  window.addEventListener("resize", fit);
  for (const b of modeButtons) {
    b.addEventListener("click", () => setMode(b.dataset["mode"] === "clips" ? "clips" : "locators"));
  }
  fit();
  render2();
})();
//# sourceMappingURL=try.js.map
