// Chapter "Your result": the navy panel with the range, the switches and the dot chart.

import type { Action } from '../contracts/store';
import type { Spread } from '../contracts/usage';
import type { ResultView, SwitchView, View } from '../contracts/view';
import { distance, distanceUnitFor, mass, massRange, massSpan, printsSame, unitFor } from '../format';
import { describeChart, oneNumber, rangeWords, spokenRange, underOneMilligram, type Motion, type Trace } from './change';
import { all, el, icon, need, nextId, setSeenAndSpoken, setText, show, syncList } from './dom';
import { createDots, drawAxis } from './dots';
import { createChip, type Scope } from './motion';
import { renderRich } from './rich';

export interface ResultPart {
  /** Everything but the chart: words, tags, switches and which form the range takes. */
  update(view: View): void;
  /** The numbers this chapter counts across, added to `into`. */
  targets(view: View, into: Map<string, number>): void;
  /**
   * The chart, the ghost and the chip. Runs while the numbers show their final values, because it measures their labels.
   * `scaleMax` is the top of the scale to draw on. It can lag behind the View's (see index.ts).
   */
  draw(view: View, motion: Motion, trace: Trace, scaleMax: number): void;
  /** The chart alone, sliding onto another scale. The chip and a fading ghost are left as they are. */
  rescale(view: View, scaleMax: number): void;
  panel: HTMLElement;
}

export function createResult(root: ParentNode, scope: Scope, send: (action: Action) => void): ResultPart {
  const panel = need(root, '[data-result]');
  const empty = need(panel, '[data-result-empty]');
  const emptyText = need(panel, '[data-empty-text]');
  const emptyAxis = need(panel, '[data-empty-axis]');
  const top = need(panel, '[data-result-top]');
  const range = need(panel, '[data-range]');
  const rangeWord = need(panel, '[data-range-word]');
  const rangeAbout = need(panel, '[data-range-about]');
  const rangeRest = need(panel, '[data-range-rest]');
  const rangeSeen = need(panel, '[data-range-seen]');
  const rangeUnit = need(panel, '[data-range-unit]');
  const rangeUnder = need(panel, '[data-range-under]');
  const oneNote = need(panel, '[data-one-note]');
  const car = need(panel, '[data-car]');
  const summary = need(panel, '[data-summary-line]');
  const tags = need(panel, '[data-tags]');
  const tagApplied = need(panel, '[data-tag-applied]');
  const tagSet = need(panel, '[data-tag-set]');
  const likely = need(panel, '[data-likely]');
  const carRange = need(panel, '[data-car-range]');
  const carPlace = need(panel, '[data-car-place]');
  const road = need(panel, '[data-road]');
  const roadDone = need(road, '[data-road-done]');
  const roadEnd = need(road, '[data-road-end]');
  const roadFrom = need(road, '[data-road-from]');
  const roadTo = need(road, '[data-road-to]');
  const roadCar = need(road, '[data-road-car]');
  // Which road is drawn now. A new road makes the car drive from its start again.
  let roadKey = '';
  const history = need(panel, '[data-history]');
  const historyLead = need(panel, '[data-history-lead]');
  const historyValue = need(panel, '[data-history-value]');
  const historyWord = need(panel, '[data-history-word]');
  const switches = need(panel, '[data-switches]');
  const switchesTitle = need(panel, '[data-switches-title]');
  const switchesNote = need(panel, '[data-switches-note]');
  const switchesList = need(panel, '[data-switches-list]');
  const chartSlot = need(panel, '[data-chart]');
  const caption = need(root, '[data-chart-caption]');
  const captionRange = need(caption, '[data-caption-range]');
  const captionOne = need(caption, '[data-caption-one]');

  // The chart is built here, so its labels can carry the same number hooks as the rest of the page.
  const chartHost = el('div');
  chartHost.setAttribute('role', 'img');
  chartSlot.append(chartHost);
  const chart = createDots(chartHost, scope);
  const midWord = el('span');
  const midNumber = el('b');
  midNumber.setAttribute('data-num', 'm:mid');
  const midUnit = el('span');
  midUnit.setAttribute('data-unit', '');
  const chipNode = el('span', 'delta');
  chart.midLabel.append(midWord, ' ', midNumber, ' ', midUnit, chipNode);
  const chip = createChip(scope, chipNode);

  // "90 of 100 land here: 3.7–34 kg", with the two numbers in the mono face.
  const bracketAbout = el('span', '', 'about ');
  const bracketLow = el('b');
  bracketLow.setAttribute('data-num', 'm:p5');
  const bracketRest = el('span');
  const bracketHigh = el('b');
  bracketHigh.setAttribute('data-num', 'm:p95');
  bracketRest.append('–', bracketHigh);
  const bracketUnit = el('span');
  bracketUnit.setAttribute('data-unit', '');
  chart.bracketLabel.append('90 of 100 land here: ', bracketAbout, bracketLow, bracketRest, ' ', bracketUnit);

  scope.listen<MouseEvent>(switchesList, 'click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-switch]') : null;
    if (button) send({ type: 'toggle-switch', id: button.getAttribute('data-switch') ?? '' });
  });

  function createSwitch(): HTMLLIElement {
    const row = el('li', 'tg');
    const text = el('div', 'tg-text');
    const label = el('span', 'tg-label');
    label.id = nextId('switch');
    const note = el('span', 'tg-src');
    note.id = nextId('switch-note');
    note.append(el('span'));
    text.append(label, note);
    const button = el('button', 'switch');
    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-labelledby', label.id);
    button.setAttribute('aria-describedby', note.id);
    button.append(el('span', 'knob'));
    row.append(text, button);
    return row;
  }

  function updateSwitch(row: HTMLLIElement, item: SwitchView): void {
    const label = need(row, '.tg-label');
    const note = need(row, '.tg-src');
    const button = need(row, '.switch');
    setText(label, item.label);
    // The note is the switch's description. A saving in it is spoken as "0.75 to 7.6", not as a dash.
    setSeenAndSpoken(need(note, 'span'), item.note, spokenRange(item.note));
    const wanted = item.noteIcon ?? '';
    if (note.getAttribute('data-icon') !== wanted) {
      note.setAttribute('data-icon', wanted);
      note.querySelector('svg')?.remove();
      if (wanted) note.prepend(icon(wanted, true));
    }
    button.setAttribute('data-switch', item.id);
    button.setAttribute('aria-checked', String(item.on));
  }

  function drawChart(result: ResultView, scaleMax: number, ghost: Spread | null, held: boolean, slide: boolean): void {
    // The ticks follow the scale that is drawn, in the unit every other number is printed in.
    const ticks = [0, 1, 2, 3, 4, 5].map(i => `${mass((scaleMax * i) / 5, result.unit)}${i === 5 ? ` ${result.unit}` : ''}`);
    chart.update({ values: result.quantiles, range: result.range, scaleMax, single: result.single, ticks }, ghost, held, slide);
    chartHost.setAttribute('aria-label', describeChart(result, scaleMax));
  }

  function fitRange(result: ResultView, one: boolean): void {
    // Milligram ranges can run to "12,000–340,000". The type steps down by the length of what is printed.
    const printed = one ? `about ${mass(result.range.mid, result.unit)}` : `${mass(result.range.p5, result.unit)}–${mass(result.range.p95, result.unit)}`;
    const length = printed.length + result.unit.length;
    range.classList.toggle('is-long', length > 9 && length <= 13);
    range.classList.toggle('is-longer', length > 13);
  }

  /** The road under the car figure: from the place's start to its end, with the car at the person's distance. */
  function drawRoad(result: ResultView): void {
    const place = result.carPlace;
    const on = !!place && result.car.p95 >= 0.001;
    show(road, on);
    if (!place || !on) {
      roadKey = '';
      return;
    }
    const { from, to, km } = place.road;
    // Past the longest place, the road is that place and the car waits at its end.
    const max = place.beyond ? km * 1.06 : Math.max(km, result.car.mid) * 1.06;
    const at = place.beyond ? km : result.car.mid;
    const pct = (x: number) => `${(Math.max(0, Math.min(1, x / max)) * 100).toFixed(2)}%`;
    setText(roadFrom, from ?? 'start');
    setText(roadTo, to);
    roadTo.style.left = pct(km);
    roadEnd.style.left = pct(km);
    roadTo.classList.toggle('is-end', km / max > 0.85);
    const key = `${from ?? ''}|${to}`;
    if (key !== roadKey) {
      // A new road: put the car at the start without motion, then let it drive to its place.
      roadKey = key;
      road.classList.add('no-anim');
      roadCar.style.left = '0%';
      roadDone.style.width = '0%';
      roadCar.classList.remove('is-driving');
      void road.offsetWidth;
      road.classList.remove('no-anim');
      roadCar.classList.add('is-driving');
    }
    roadCar.style.left = pct(at);
    roadDone.style.width = pct(at);
  }

  return {
    panel,

    update(view) {
      const result = view.result;
      show(empty, !result);
      show(top, !!result);
      // Below the scale's smallest step there is nothing to draw: words take the place of the number and the chart.
      const under = !!result && underOneMilligram(result);
      show(chartSlot, !!result && !under);
      show(caption, !!result && !under);
      if (!result) {
        setText(
          emptyText,
          view.stage === 'choose'
            ? 'Choose Claude Code or ChatGPT above. As soon as your data is in, your result appears here as a range.'
            : 'As soon as your data is in, your result appears here as a range.',
        );
        // No numbers yet: the scale shows its start and its unit, and nothing in between.
        drawAxis(emptyAxis, ['0', '', '', '', '', view.method.unit]);
        return;
      }

      const one = oneNumber(result);
      show(rangeUnder, under);
      show(rangeUnit, !under);
      show(rangeSeen, !under);
      // A range is spoken from its own words ("3.7 to 34"). One number is spoken as it is seen ("about 8.6").
      show(rangeWord, !one && !under);
      rangeSeen.setAttribute('aria-hidden', String(!one));
      show(rangeAbout, one);
      show(rangeRest, !one);
      fitRange(result, one);
      setText(summary, result.summary);

      show(tagApplied, !!result.appliedLabel);
      setText(need(tagApplied, 'span'), result.appliedLabel ?? '');
      show(tagSet, !!result.setLabel);
      setText(need(tagSet, 'span'), result.setLabel ?? '');
      // The row itself is never hidden: on a narrow screen it keeps its room, so nothing jumps when a tag comes.
      tags.classList.toggle('is-empty', !tags.querySelector('.tag:not([hidden])'));

      // One outcome has no middle: the single number above already says it, and a sentence says why.
      show(likely, !result.single && !under);
      show(oneNote, result.single);
      setText(midWord, result.single ? 'your estimate' : 'middle estimate');

      const carUnit = distanceUnitFor(result.car);
      const carIsOne = result.single || distance(result.car.p5, carUnit) === distance(result.car.p95, carUnit);
      // Under one metre the comparison says nothing, so the line is left out.
      show(car, result.car.p95 >= 0.001);
      show(carRange, !carIsOne);
      for (const node of all(panel, '[data-car-unit]')) setText(node, carUnit);
      show(carPlace, !!result.carPlace);
      if (result.carPlace) renderRich(carPlace, result.carPlace.text);
      drawRoad(result);

      show(history, !!result.history);
      if (result.history) {
        // Years of use next to one month: the two can need different units, so this line picks its own,
        // the way the readout above picks its: one unit for both ends, from the high end.
        const whole = result.history.range;
        const unit = unitFor(whole);
        setText(historyLead, `Your whole ${result.sourceName} history, since ${result.history.since}:`);
        // "about" only when this range's own two ends print the same. That every slider on the page is
        // set does not make the history one number: a slider the 30 days do not show can still vary there.
        const one = printsSame(whole.p5, whole.p95, unit);
        // A low end above zero never prints as "0": then each end gets the unit that suits it.
        const apart = !one && whole.p5 > 0 && mass(whole.p5, unit) === '0';
        const seen = one ? `about ${mass(whole.mid, unit)} ${unit}` : apart ? massSpan(whole.p5, whole.p95) : massRange(whole, unit);
        const spoken = one || apart ? spokenRange(seen) : rangeWords(whole, unit);
        setText(historyValue, seen);
        historyValue.setAttribute('aria-hidden', String(spoken !== seen));
        show(historyWord, spoken !== seen);
        setText(historyWord, spoken);
      }

      const items = result.switches.items;
      show(switches, items.length > 0);
      top.classList.toggle('is-alone', items.length === 0);
      setText(switchesTitle, result.switches.title);
      setText(switchesNote, result.switches.note);
      syncList(switchesList, items, item => item.id, createSwitch, updateSwitch);

      show(bracketAbout, one);
      show(bracketRest, !one);
      show(captionRange, !result.single);
      show(captionOne, result.single);
    },

    targets(view, into) {
      const result = view.result;
      if (!result) return;
      into.set('m:p5', result.range.p5).set('m:mid', result.range.mid).set('m:p95', result.range.p95);
      into.set('d:p5', result.car.p5).set('d:mid', result.car.mid).set('d:p95', result.car.p95);
    },

    draw(view, motion, trace, scaleMax) {
      const result = view.result;
      if (!result) {
        chip.show(null);
        return;
      }
      // The chip's words go in first: the label beside the line is measured with them, so the chip
      // never reaches past the chart's edge.
      chip.show(motion === 'full' ? trace.chip : null);
      // While a tip is applied the ghost marks the range without it, and stays.
      const ghost = result.baseline ?? (motion === 'full' ? trace.was : null);
      drawChart(result, scaleMax, ghost, !!result.baseline, motion !== 'none');
    },

    rescale(view, scaleMax) {
      const result = view.result;
      if (result) drawChart(result, scaleMax, result.baseline, !!result.baseline, true);
    },
  };
}
