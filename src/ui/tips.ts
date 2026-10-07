// Chapter "Ways to cut": the tips picked from the person's numbers, each with its two small bars and its switch.

import type { Action } from '../contracts/store';
import type { Spread } from '../contracts/usage';
import type { MassUnit, TipView, View } from '../contracts/view';
import { printsSame } from '../format';
import { createBand, type Band } from './band';
import { rangeWords, type Motion } from './change';
import { el, need, nextId, setText, show, syncList } from './dom';
import type { Scope } from './motion';
import { renderRich } from './rich';

export interface TipsPart {
  update(view: View): void;
  targets(view: View, into: Map<string, number>): void;
  /** `scaleMax` is the top of the scale to draw on. It can lag behind the View's (see index.ts). */
  draw(view: View, motion: Motion, scaleMax: number): void;
  rescale(view: View, scaleMax: number): void;
}

interface Bars {
  now: Band;
  after: Band;
  /** What the two bars showed last, for the ghost of where each range was. */
  was: { now: Spread; after: Spread } | null;
}

const same = (a: Spread, b: Spread) => a.p5 === b.p5 && a.mid === b.mid && a.p95 === b.p95;

/** A range as cells that count across: "3.7–34 kg", or "about 8.6 kg" when both ends print the same. */
function rangeCells(lowKey: string, highKey: string): HTMLElement {
  const cell = el('span', 'tv-val');
  const about = el('span', '', 'about ');
  about.setAttribute('data-about', '');
  const low = el('span');
  low.setAttribute('data-num', lowKey);
  const rest = el('span');
  rest.setAttribute('data-rest', '');
  const high = el('span');
  high.setAttribute('data-num', highKey);
  rest.append('–', high);
  const unit = el('span');
  unit.setAttribute('data-unit', '');
  cell.append(about, low, rest, ' ', unit);
  return cell;
}

function setForm(cell: Element, range: Spread, unit: MassUnit): void {
  const one = printsSame(range.p5, range.p95, unit);
  show(need(cell, '[data-about]'), one);
  show(need(cell, '[data-rest]'), !one);
}

export function createTips(root: ParentNode, scope: Scope, send: (action: Action) => void): TipsPart {
  const section = need(root, '[data-chapter="tips"]');
  const list = need(section, '[data-tips-list]');
  const caption = need(section, '[data-tips-caption]');
  const captionRange = need(caption, '[data-tips-range]');
  const captionOne = need(caption, '[data-tips-one]');
  const bars = new Map<string, Bars>();
  let unit: MassUnit = 'kg';
  /** The range the result shows, and whether a tip is applied to it. */
  let shown: Spread | null = null;
  let tipsApplied = false;

  // A tip's first bar is the range it starts from. While a tip is applied that can be the range
  // without tips, which is no longer the one on screen, so the row must not call it "Now".
  const firstLabel = (tip: TipView): string => {
    const onScreen = !!shown && printsSame(tip.now.p5, shown.p5, unit) && printsSame(tip.now.p95, shown.p95, unit);
    return tipsApplied && !onScreen ? 'Without tips' : 'Now';
  };

  scope.listen<MouseEvent>(list, 'click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-switch]') : null;
    if (button) send({ type: 'toggle-switch', id: button.getAttribute('data-switch') ?? '' });
  });

  function createTip(tip: TipView): HTMLElement {
    const article = el('article', 'tip');
    const text = el('div');
    const title = el('h3');
    title.id = nextId('tip');
    const body = el('p');
    body.setAttribute('data-body', '');
    const how = el('p', 'how');
    const howText = el('span');
    howText.setAttribute('data-how', '');
    how.append(el('b', '', 'How:'), ' ', howText);
    text.append(title, body, how);

    const side = el('div', 'tip-side');
    const compare = el('div', 'tv');
    compare.setAttribute('role', 'img');
    const rows: Array<[string, string, string]> = [
      ['now', 'band band--mini on-paper', 'n'],
      ['after', 'band band--mini band--accent on-paper', 'a'],
    ];
    const bands: Band[] = [];
    for (const [name, className, short] of rows) {
      const row = el('div', 'tv-row');
      const label = el('span', 'tv-label');
      label.setAttribute('data-label', name);
      const bandHost = el('div', className);
      bands.push(createBand(bandHost, scope));
      const values = rangeCells(`m:tip:${short}5:${tip.id}`, `m:tip:${short}95:${tip.id}`);
      values.setAttribute('data-values', name);
      row.append(label, bandHost, values);
      compare.append(row);
    }
    const [now, after] = bands;
    if (now && after) bars.set(tip.id, { now, after, was: null });

    const apply = el('div', 'pv');
    const applyLabel = el('span', '', 'Apply this tip');
    applyLabel.id = nextId('apply');
    const button = el('button', 'switch');
    button.type = 'button';
    button.setAttribute('role', 'switch');
    // "Apply this tip" alone would read the same for every tip, so the tip's heading is part of the name.
    button.setAttribute('aria-labelledby', `${applyLabel.id} ${title.id}`);
    button.append(el('span', 'knob'));
    apply.append(applyLabel, button);
    side.append(compare, apply);
    article.append(text, side);
    return article;
  }

  function updateTip(article: HTMLElement, tip: TipView): void {
    setText(need(article, 'h3'), tip.title);
    renderRich(need(article, '[data-body]'), tip.body);
    renderRich(need(article, '[data-how]'), tip.how);
    const first = firstLabel(tip);
    setText(need(article, '[data-label="now"]'), first);
    setText(need(article, '[data-label="after"]'), tip.afterLabel);
    setForm(need(article, '[data-values="now"]'), tip.now, unit);
    setForm(need(article, '[data-values="after"]'), tip.after, unit);
    // Spoken as words, in the form the two rows are printed in: "3.7 to 34 kilograms", "about 23 kilograms".
    need(article, '.tv').setAttribute('aria-label', `${first}: ${rangeWords(tip.now, unit)}. ${tip.afterLabel}: ${rangeWords(tip.after, unit)}.`);
    const button = need(article, '.switch');
    button.setAttribute('data-switch', tip.id);
    button.setAttribute('aria-checked', String(tip.applied));
  }

  return {
    update(view) {
      const result = view.result;
      const note = result && !view.tips.length ? view.noTipsNote : null;
      const on = !!result && (view.tips.length > 0 || !!note);
      show(section, on);
      if (!result || !on) {
        list.replaceChildren();
        bars.clear();
        return;
      }
      unit = result.unit;
      shown = result.range;
      tipsApplied = result.baseline !== null;
      list.querySelector('.tips-none')?.remove();
      syncList(list, view.tips, tip => tip.id, createTip, updateTip);
      for (const id of Array.from(bars.keys())) if (!view.tips.some(tip => tip.id === id)) bars.delete(id);
      // No tip applies: the card says so, and the caption about savings has nothing to explain.
      if (note) list.append(el('p', 'tips-none', note));
      show(caption, view.tips.length > 0);
      // One outcome has no range, and a saving then is one number too.
      show(captionRange, !result.single);
      show(captionOne, result.single);
    },

    targets(view, into) {
      if (!view.result) return;
      for (const tip of view.tips) {
        into.set(`m:tip:n5:${tip.id}`, tip.now.p5).set(`m:tip:n95:${tip.id}`, tip.now.p95);
        into.set(`m:tip:a5:${tip.id}`, tip.after.p5).set(`m:tip:a95:${tip.id}`, tip.after.p95);
      }
    },

    rescale(view, scaleMax) {
      if (!view.result) return;
      for (const tip of view.tips) {
        const pair = bars.get(tip.id);
        pair?.now.update(tip.now, scaleMax, null, false, true);
        pair?.after.update(tip.after, scaleMax, null, false, true);
      }
    },

    draw(view, motion, scaleMax) {
      const result = view.result;
      if (!result) return;
      for (const tip of view.tips) {
        const pair = bars.get(tip.id);
        if (!pair) continue;
        const was = motion === 'full' ? pair.was : null;
        pair.now.update(tip.now, scaleMax, was && !same(was.now, tip.now) ? was.now : null, false, motion !== 'none' && !!pair.was);
        pair.after.update(tip.after, scaleMax, was && !same(was.after, tip.after) ? was.after : null, false, motion !== 'none' && !!pair.was);
        pair.was = { now: tip.now, after: tip.after };
      }
    },
  };
}
