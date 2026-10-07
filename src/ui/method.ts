// Chapter "How it's calculated": the formula, what is counted, and a slider for every assumption.

import type { AssumptionView, View } from '../contracts/view';
import { assumptionValue, longDate, massSpan, massWithUnit } from '../format';
import { positionOf, valueAt, type Triple } from '../track';
import { all, el, need, nextId, outLink, setLines, setText, show, syncList } from './dom';
import type { Scope } from './motion';

export interface MethodPart {
  update(view: View): void;
}

/** Called when a slider moves. `settled` is false while it is being dragged. */
export type OnSlide = (id: string, value: number, settled: boolean) => void;

/** How finely the track is cut. 100 is the typical value, exactly. */
const STEPS = 200;

type Item = { kind: 'group'; name: string; key: string } | { kind: 'slider'; assumption: AssumptionView; key: string; lone: boolean };

const tripleOf = (a: AssumptionView): Triple => [a.low, a.typical, a.high];

export function printValue(a: Pick<AssumptionView, 'decimals' | 'unit'>, value: number): string {
  return `${assumptionValue(value, a.decimals)}${a.unit}`;
}

/**
 * What a slider's readout says. `at` is the thumb's place on the track while the person moves it, and
 * null when the values come from the View. A slider that stands for several values prints each one.
 */
function readout(a: AssumptionView, at: number | null): string[] {
  if (!a.parts?.length) return [printValue(a, at === null ? a.value : valueAt(tripleOf(a), at))];
  return a.parts.map(part => {
    const value = at === null ? part.value : valueAt([part.low, part.typical, part.high], at);
    return `${part.label} ${printValue({ decimals: part.decimals, unit: a.unit }, value)}`;
  });
}

/** Writes the readout: "1.0 Wh", or "large 1.0 Wh · mid-size 0.60 Wh". A line only breaks between two parts. */
function setReadout(output: Element, parts: readonly string[]): void {
  const cells = Array.from(output.children);
  if (cells.length !== parts.length) {
    output.replaceChildren();
    parts.forEach((part, i) => {
      if (i > 0) output.append(' · ');
      output.append(el('span', 'sl-part', part));
    });
    return;
  }
  parts.forEach((part, i) => {
    const cell = cells[i];
    if (cell) setText(cell, part);
  });
}

/**
 * What the slider says of itself. The sizes are joined with commas, which a screen reader pauses at.
 * The range from low to high is the first size's, so it is named: the other sizes move with it.
 */
function valueText(a: AssumptionView, parts: readonly string[], pinned: boolean): string {
  const printed = parts.join(', ');
  if (pinned) return `${printed}, set by you`;
  const lead = a.parts?.length ? a.parts[0]?.label : undefined;
  const span = `from ${printValue(a, a.low)} to ${printValue(a, a.high)}`;
  if (lead && (a.parts?.length ?? 0) > 1) return `${printed}, the typical values. Not set: ${lead} varies ${span}, the others move with it`;
  return `${printed}, the typical value. Not set: it varies ${span}`;
}

export function createMethod(root: ParentNode, scope: Scope, send: { reset(): void; slide: OnSlide }): MethodPart {
  const section = need(root, '[data-chapter="method"]');
  const formula = need(section, '[data-formula]');
  const counted = need(section, '[data-counted]');
  const leftOut = need(section, '[data-left-out]');
  const notes = need(section, '[data-method-notes]');
  const notesList = need(section, '[data-method-notes-list]');
  const sliderNote = need(section, '[data-slider-note]');
  const sliders = need(section, '[data-sliders]');
  const extreme = need(section, '[data-extreme]');
  const extremeLabel = need(section, '[data-extreme-label]');
  const extremeValue = need(section, '[data-extreme-value]');
  const reset = need<HTMLButtonElement>(section, '[data-reset]');
  const byId = new Map<string, AssumptionView>();
  /** The slider under the pointer or the keys right now. The View does not move its thumb. */
  let held: { id: string; input: HTMLInputElement } | null = null;
  let stopLetGo: (() => void) | null = null;

  const paint = (wrap: Element, a: AssumptionView, pinned: boolean, at: number | null) => {
    const input = need<HTMLInputElement>(wrap, 'input');
    const printed = readout(a, at);
    setReadout(need(wrap, 'output'), printed);
    wrap.classList.toggle('is-set', pinned);
    input.style.setProperty('--p', `${((at ?? positionOf(tripleOf(a), a.value)) * 100).toFixed(2)}%`);
    input.setAttribute('aria-valuetext', valueText(a, printed, pinned));
  };

  const moved = (input: HTMLInputElement, settled: boolean) => {
    const wrap = input.closest('.sl');
    const a = byId.get(wrap?.getAttribute('data-assumption') ?? '');
    if (!wrap || !a) return;
    stopLetGo?.();
    stopLetGo = null;
    const at = Number(input.value) / STEPS;
    held = settled ? null : { id: a.id, input };
    // The thumb's own value is shown at once, so the readout never lags behind the finger.
    paint(wrap, a, true, at);
    send.slide(a.id, valueAt(tripleOf(a), at), settled);
  };
  const sliderOf = (event: Event): HTMLInputElement | null =>
    event.target instanceof HTMLInputElement && event.target.type === 'range' ? event.target : null;
  scope.listen(sliders, 'input', event => {
    const input = sliderOf(event);
    if (input) moved(input, false);
  });
  scope.listen(sliders, 'change', event => {
    const input = sliderOf(event);
    if (input) moved(input, true);
  });
  // A thumb that is let go where the drag began sends no change event, and neither does a slider that
  // loses the pointer or the focus half-way. The move still has to end, so it is ended here, one turn
  // later: when a change event does come, it comes first and nothing is left to do.
  for (const type of ['pointerup', 'pointercancel', 'focusout']) {
    scope.listen(sliders, type, event => {
      const input = held?.input;
      if (!input || event.target !== input) return;
      stopLetGo?.();
      stopLetGo = scope.timer(() => {
        stopLetGo = null;
        if (held?.input === input) moved(input, true);
      }, 0);
    });
  }
  // The sliders the person has set, as far as the page has seen them. One that the data no longer shows
  // is still set in the store and comes back with later data, so "Reset sliders" must stay usable for it.
  const known = new Set<string>();
  let source: View['source'] = null;
  scope.listen(reset, 'click', () => {
    if (reset.getAttribute('aria-disabled') === 'true') return;
    known.clear();
    send.reset();
  });

  function createItem(item: Item): HTMLElement {
    if (item.kind === 'group') return el('h4', 'sl-group');
    const wrap = el('div', 'sl');
    const id = nextId('assume');
    const top = el('div', 'sl-top');
    const label = el('label');
    label.htmlFor = id;
    const output = el('output', 'num');
    output.setAttribute('for', id);
    // An output is a live region by default. The slider already speaks its value, so this one stays quiet.
    output.setAttribute('aria-live', 'off');
    top.append(label, output);
    const input = el('input');
    input.type = 'range';
    input.id = id;
    input.min = '0';
    input.max = String(STEPS);
    input.step = '1';
    const scale = el('div', 'sl-scale');
    scale.setAttribute('aria-hidden', 'true');
    scale.append(el('span'), el('span', '', 'typical'), el('span'));
    const what = el('p', 'sl-what');
    what.id = `${id}-what`;
    const note = el('p', 'sl-note');
    note.id = `${id}-note`;
    const src = el('p', 'sl-src');
    src.id = `${id}-src`;
    input.setAttribute('aria-describedby', `${what.id} ${note.id} ${src.id}`);
    // The sentence and the remark share one line of the row's grid, so a slider without a remark leaves no gap.
    const words = el('div', 'sl-words');
    words.append(what, note);
    wrap.append(top, input, scale, words, src);
    return wrap;
  }

  function drawSource(target: Element, a: AssumptionView): void {
    const key = JSON.stringify([a.source, a.sourceUrl, a.checked, a.soft]);
    if (target.getAttribute('data-for') === key) return;
    target.setAttribute('data-for', key);
    const link = outLink(a.sourceUrl);
    if (link) link.append(a.source, el('span', 'sr', ' (opens in a new tab)'));
    // No date, no claim that anything was checked.
    target.replaceChildren('Source: ', link ?? a.source, a.checked ? `. Checked ${longDate(a.checked)}.` : '.');
    if (a.soft) target.append(' ', el('b', '', 'Soft:'), ' there is little evidence behind this number so far.');
  }

  function updateItem(node: HTMLElement, item: Item): void {
    if (item.kind === 'group') {
      setText(node, item.name);
      return;
    }
    const a = item.assumption;
    const input = need<HTMLInputElement>(node, 'input');
    node.setAttribute('data-assumption', a.id);
    // The only slider of its group gets the whole row: its name and values on one line, the track
    // under them, and its text beside the track.
    node.classList.toggle('is-lone', item.lone);
    setText(need(node, 'label'), a.label);
    const ends = need(node, '.sl-scale');
    if (ends.firstElementChild) setText(ends.firstElementChild, printValue(a, a.low));
    if (ends.lastElementChild) setText(ends.lastElementChild, printValue(a, a.high));
    setText(need(node, '.sl-what'), a.explanation);
    const note = need(node, '.sl-note');
    show(note, !!a.note);
    setText(note, a.note ?? '');
    drawSource(need(node, '.sl-src'), a);
    if (held?.id === a.id) return;
    const at = String(Math.round(positionOf(tripleOf(a), a.value) * STEPS));
    if (input.value !== at) input.value = at;
    paint(node, a, a.pinned, null);
  }

  return {
    update(view) {
      const method = view.method;
      setText(formula, method.formula);
      setLines(counted, method.counted);
      setLines(leftOut, method.leftOut);
      show(notes, method.notes.length > 0);
      setLines(notesList, method.notes);
      setText(sliderNote, method.sliderNote);

      // "Your tokens are counted" is not the whole truth for ChatGPT, where hidden work is estimated on top.
      for (const words of all(section, '[data-counted-words]')) {
        show(words, words.getAttribute('data-counted-words') === (view.source === 'chatgpt' ? 'chatgpt' : 'claude-code'));
      }

      byId.clear();
      const items: Item[] = [];
      let group: string | null = null;
      method.assumptions.forEach((assumption, i) => {
        byId.set(assumption.id, assumption);
        // Sliders arrive grouped. A heading goes in wherever the group's name changes.
        if (assumption.group !== group) {
          group = assumption.group;
          items.push({ kind: 'group', name: group, key: `g:${group}:${items.length}` });
        }
        const lone = method.assumptions[i - 1]?.group !== group && method.assumptions[i + 1]?.group !== group;
        items.push({ kind: 'slider', assumption, key: `s:${assumption.id}`, lone });
      });

      // A tool that was just chosen shows every slider that is still set, so what was seen before is dropped.
      if (view.source !== source) known.clear();
      source = view.source;
      for (const assumption of method.assumptions) {
        if (assumption.pinned) known.add(assumption.id);
        else known.delete(assumption.id);
      }
      // A slider that is no longer in the View cannot be held any more.
      if (held && !byId.has(held.id)) held = null;
      syncList(sliders, items, item => item.key, createItem, updateItem);

      show(extreme, !!method.extreme);
      setText(extremeLabel, method.extremeLabel);
      if (method.extreme) {
        const { low, high } = method.extreme;
        // The two ends lie far apart, so each is printed in the unit that suits it.
        setText(extremeValue, massWithUnit(low) === massWithUnit(high) ? `about ${massWithUnit(low)}` : massSpan(low, high));
      }
      // Nothing to reset while every assumption still varies. The button stays in place, so focus is not lost.
      reset.setAttribute('aria-disabled', String(known.size === 0));
    },
  };
}
