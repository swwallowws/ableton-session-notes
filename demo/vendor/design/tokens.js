/** Resolve a colour token to a concrete colour string for canvas or WebGL,
 *  which cannot read var() or light-dark(). The token is resolved as `el`
 *  sees it, so its theme and data-category apply. */
export function cssColor(name, el = document.documentElement) {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${name})`;
  el.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}
