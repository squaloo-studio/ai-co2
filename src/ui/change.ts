// What a change of the View leaves on screen: how things move, the ghost of where the range was,
// and the chip that says how far the middle estimate went.

import type { Spread } from '../contracts/usage';
import type { MassUnit, ResultView } from '../contracts/view';
import { mass, massChange, printsSame } from '../format';
import { beyondScale } from './dots';

/**
 * none  placed at once: the first paint, a new result, a resize
 * fast  a slider is being dragged: the chart keeps up (no wave, a short slide) and leaves no trace
 * full  a settled change: everything slides and counts across
 */
export type Motion = 'none' | 'fast' | 'full';

export interface Trace {
  /** Where the range was, when it moved. Drawn as a ghost that fades. */
  was: Spread | null;
  /** The change chip's text, or null when the printed middle estimate did not change. */
  chip: string | null;
}

export const NO_TRACE: Trace = { was: null, chip: null };

/**
 * The trace a settled change leaves. `from` is the result the reader saw before it.
 * The chip is worked out from the two middle estimates as they were printed, each in the unit it was
 * shown in, so it always equals the difference the reader can see.
 */
export function traceBetween(from: ResultView | null, to: ResultView | null): Trace {
  if (!from || !to || from.sourceName !== to.sourceName) return NO_TRACE;
  const moved = (['p5', 'mid', 'p95'] as const).some(k => Math.abs(from.range[k] - to.range[k]) > to.scaleMax / 2000);
  return { was: moved ? from.range : null, chip: massChange(from.range.mid, to.range.mid, to.unit, from.unit) };
}

/** true when the range is shown as one number ("about 8.6 kg"): one outcome, or two ends that print the same. */
export function oneNumber(result: Pick<ResultView, 'single' | 'range' | 'unit'>): boolean {
  return result.single || printsSame(result.range.p5, result.range.p95, result.unit);
}

/** The scale's lowest step is 1 mg. A range that ends below it is not drawn: the page says "under 1 mg". */
export function underOneMilligram(result: Pick<ResultView, 'range'>): boolean {
  return result.range.p95 < 0.000001;
}

const UNIT_WORDS: Record<MassUnit, string> = { kg: 'kilograms', g: 'grams', mg: 'milligrams' };

/**
 * The result in spoken words: the chart's text alternative, and what the live region announces.
 * While a tip is applied the numbers are a what-if, so the tag that says so on screen is spoken with them.
 */
export function describe(result: ResultView): string {
  const applied = result.appliedLabel ? ` ${result.appliedLabel}.` : '';
  return `${describeRange(result)}${applied}`;
}

function describeRange(result: ResultView): string {
  const words = UNIT_WORDS[result.unit];
  const print = (kg: number) => mass(kg, result.unit);
  if (underOneMilligram(result)) return 'Under 1 milligram of CO2e.';
  if (oneNumber(result)) return `About ${print(result.range.mid)} ${words} of CO2e.`;
  return `Likely range ${print(result.range.p5)} to ${print(result.range.p95)} ${words} of CO2e, middle estimate ${print(result.range.mid)}.`;
}

/**
 * The chart's text alternative: the result, and what a reader of the picture also sees, the dots that
 * lie past the end of the scale. `scaleMax` is the top of the scale as it is drawn.
 */
export function describeChart(result: ResultView, scaleMax: number): string {
  const { count, highest } = beyondScale(result.quantiles, scaleMax);
  if (!count || underOneMilligram(result)) return describe(result);
  const words = UNIT_WORDS[result.unit];
  const print = (kg: number) => mass(kg, result.unit);
  const dots = count === 1 ? '1 of the 100 dots lies' : `${count} of the 100 dots lie`;
  return `${describe(result)} ${dots} past the end of the scale at ${print(scaleMax)} ${words}, the highest at ${print(highest)}.`;
}

/** A range in spoken words: "3.7 to 34 kilograms", or "about 8.6 kilograms" when both ends print the same. */
/**
 * A sentence from the View, as it is spoken: a range written with a dash ("roughly 0.75–7.6 kg") is
 * read out as "0.75 7.6" or "0.75 dash 7.6", so the dash between two numbers becomes "to".
 */
export function spokenRange(text: string): string {
  return text.replace(/(\d)–(?=[\d.])/g, '$1 to ');
}

export function rangeWords(range: Pick<Spread, 'p5' | 'p95'>, unit: MassUnit): string {
  const words = UNIT_WORDS[unit];
  if (printsSame(range.p5, range.p95, unit)) return `about ${mass(range.p95, unit)} ${words}`;
  return `${mass(range.p5, unit)} to ${mass(range.p95, unit)} ${words}`;
}
