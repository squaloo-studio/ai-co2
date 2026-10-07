// The chart's scale and the unit.
//
// The scale's top is one of fixed steps: 1, 2 and 5 times a power of ten, from 1 mg up, with no top
// step. It fits what has to be drawn: the shown range and, while a tip is applied, the range without
// the tip (the dashed ghost). While a slider is dragged the scale and the unit only go up, so the
// chart does not jump back and forth under the pointer.

import type { Spread } from '../contracts/usage';
import type { MassUnit } from '../contracts/view';
import { unitOf } from '../format';
import { fail } from './guard';

export interface ChartScale {
  /** Top of the scale, in kg. */
  scaleMax: number;
  unit: MassUnit;
}

// Smallest first.
const MASS_UNITS: readonly MassUnit[] = ['mg', 'g', 'kg'];

/** Step number `index` of the scale, in kg. Steps 0, 1, 2, 3 are 1 mg, 2 mg, 5 mg, 10 mg. */
function scaleStep(index: number): number {
  // Whole milligrams are exact numbers. So the step is the same in every browser.
  const lead = index % 3;
  let milligrams = lead === 0 ? 1 : lead === 1 ? 2 : 5;
  for (let power = Math.floor(index / 3); power > 0; power--) milligrams *= 10;
  return milligrams / 1e6;
}

/** The smallest step of the scale that leaves 8% of room above `topKg`, the highest value that has to fit. In kg. */
export function fitScale(topKg: number): number {
  if (!(typeof topKg === 'number' && Number.isFinite(topKg) && topKg >= 0)) return fail('fitScale needs a mass in kg, 0 or more');
  let index = 0;
  while (topKg * 1.08 > scaleStep(index)) index += 1;
  return scaleStep(index);
}

/**
 * The scale and the unit for a result.
 * `previous` is what is on screen now, or null. `range` is the shown range. `baseline` is the range
 * without the applied tips, or null. `dragging` is true while a slider is being dragged.
 */
export function nextScale(previous: ChartScale | null, range: Spread, baseline: Spread | null, dragging: boolean): ChartScale {
  const top = Math.max(range.p95, baseline ? baseline.p95 : 0);
  // The unit is the one that suits the top, picked by the one rule in src/format.ts: a top that would
  // print as "1,000 g" is shown in kilograms.
  const fresh: ChartScale = { scaleMax: fitScale(top), unit: unitOf(top) };
  if (!dragging || !previous) return fresh;
  return {
    scaleMax: Math.max(previous.scaleMax, fresh.scaleMax),
    unit: MASS_UNITS.indexOf(previous.unit) > MASS_UNITS.indexOf(fresh.unit) ? previous.unit : fresh.unit,
  };
}
