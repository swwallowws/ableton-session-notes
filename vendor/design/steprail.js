// Step rail: a short numbered list that walks a visitor through a demo.
// The page says when a step is done; the rail never guesses.

import { iconSvg } from './iconbutton.js';

export function createRail(ids) {
  let i = 0;
  return {
    get current() { return i < ids.length ? ids[i] : null; },
    get finished() { return i >= ids.length; },
    isDone(id) { const k = ids.indexOf(id); return k !== -1 && k < i; },
    done(id) {
      if (i >= ids.length || ids[i] !== id) return false;
      i += 1;
      return true;
    },
    reset() { i = 0; },
  };
}

export function stepRail(el, { steps, onDone, onReset, endText = 'That’s it. Everything is yours to play with now.' }) {
  const state = createRail(steps.map((s) => s.id));
  el.classList.add('steprail');
  el.innerHTML = '';
  // A head row: a page may put a title in it (the demo shell does); Start over
  // sits at its end as an icon, its word kept as name and tooltip.
  const head = document.createElement('div');
  head.className = 'steprail-head';
  const list = document.createElement('ol');
  const items = steps.map((s) => {
    const li = document.createElement('li');
    li.className = 'steprail-step';
    li.dataset.id = s.id;
    li.innerHTML = `<span class="steprail-label"></span>${s.hint ? '<span class="steprail-hint"></span>' : ''}`;
    li.querySelector('.steprail-label').textContent = s.label;
    if (s.hint) li.querySelector('.steprail-hint').textContent = s.hint;
    list.append(li);
    return li;
  });
  const end = document.createElement('p');
  end.className = 'steprail-end';
  end.textContent = endText;
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'steprail-reset';
  again.innerHTML = iconSvg('reset');
  again.setAttribute('aria-label', 'Start over');
  again.title = 'Start over';
  head.append(again);
  el.append(head, list, end);

  function paint() {
    items.forEach((li) => {
      const id = li.dataset.id;
      li.dataset.state = state.isDone(id) ? 'done' : id === state.current ? 'current' : 'todo';
      li.toggleAttribute('aria-current', id === state.current);
    });
    end.hidden = !state.finished;
  }
  again.addEventListener('click', () => { state.reset(); paint(); onReset?.(); });
  paint();

  return {
    get current() { return state.current; },
    done(id) {
      if (!state.done(id)) return;
      paint();
      if (state.finished) onDone?.();
    },
    reset() { state.reset(); paint(); },
  };
}
