// Chapter "Your result": the range, what it is a range of, and the switches inside the card.

import type { ResultView } from '../contracts/view';
import type { Estimate } from '../model/estimate';
import { SWITCH_GROUP, switchViews } from '../model/hidden';
import { carPlace } from '../model/places';
import { RULES, SAVES_NOTHING_NOTE, TRY_A_CHANGE, tipSwitches } from '../model/tips';
import type { ShownTip } from '../model/tips';
import type { Calc } from './calc';
import { daysBetween } from './days';
import type { State } from './state';
import type { Counted } from './usage';
import { SOURCE_NAMES, appliedLabel, setLabel, summaryWords } from './words';
import type { ExportGap } from './words';

/** From this many covered days the page says "the last 30 days", as the tips say "a month": one number for both. */
const FULL_MONTH_DAYS = RULES.monthDays[0];

/**
 * The line under the big range: which tool, which days, with one outcome why there is no range, and
 * with `tipsApplied` tips that change the result that the range is a what-if.
 */
export function summary(counted: Counted, single: boolean, today: string, tipsApplied = 0): string {
  const { window, covered, source } = counted;
  if (covered.days >= FULL_MONTH_DAYS) {
    // An export is always counted back from today. A pasted answer can be older than that.
    const recent = source === 'chatgpt' || Math.abs(daysBetween(window.to, today)) <= 1;
    return summaryWords(source, recent ? 'last-30' : 'older-30', window.from, window.to, covered.days, single, 'end', tipsApplied);
  }
  // An export can start inside the 30 days, end before today, or both.
  const late = daysBetween(window.from, covered.first) > 0;
  const early = daysBetween(covered.last, window.to) > 0;
  const gap: ExportGap = late && early ? 'both' : late ? 'start' : 'end';
  return summaryWords(source, covered.days === 1 ? 'one-day' : 'days', covered.first, covered.last, covered.days, single, gap, tipsApplied);
}

/** How many set sliders can change the result. A slider that changes nothing for this data is not counted. */
export function setCount(result: Estimate): number {
  return Object.keys(result.pins).filter((id) => !result.inert.includes(id)).length;
}

/**
 * The applied tips that change the result. A tip stays switched on when a switch or a slider takes
 * its saving away (half as much thinking, with thinking switched off), and is then not named as a change.
 */
export function tipsInEffect(calc: Calc): ShownTip[] {
  return calc.tips.shown.filter((tip) => tip.view.applied && tip.note !== SAVES_NOTHING_NOTE);
}

export function resultView(state: State, counted: Counted, calc: Calc): ResultView {
  const shown = calc.shown;
  const inEffect = tipsInEffect(calc);
  return {
    sourceName: SOURCE_NAMES[counted.source],
    period: { from: counted.window.from, to: counted.window.to },
    summary: summary(counted, shown.single, state.today, shown.baseline === null ? 0 : inEffect.length),
    unit: calc.scale.unit,
    range: shown.range,
    single: shown.single,
    quantiles: shown.dots,
    scaleMax: calc.scale.scaleMax,
    car: shown.car,
    carPlace: carPlace(shown.car),
    history: calc.history !== null && counted.history !== null ? { range: calc.history, since: counted.history.since } : null,
    baseline: shown.baseline,
    appliedLabel: appliedLabel(inEffect.map((tip) => tip.label)),
    setLabel: setLabel(setCount(shown)),
    switches: counted.source === 'chatgpt'
      ? { ...SWITCH_GROUP, items: switchViews(counted.switches, state.flipped) }
      : { ...TRY_A_CHANGE, items: tipSwitches(calc.tips) },
  };
}
