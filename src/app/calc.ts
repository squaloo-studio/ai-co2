// What the estimator answers for the state that is on screen. The one place in the store that calls it.
//
// A full call costs a few milliseconds, a call without tips well under one. So while a slider moves
// only the fast form runs, and the tips and the notes of the last full call stay as they were.

import type { Spread } from '../contracts/usage';
import type { MassUnit } from '../contracts/view';
import { ENERGY_ORDER, MARKET_GRID, leadSize } from '../model/assumptions';
import type { EnergyClass } from '../model/assumptions';
import { estimate, nextScale } from '../model/estimate';
import type { ChartScale, Estimate } from '../model/estimate';
import { pickTips } from '../model/tips';
import type { PickedTips } from '../model/tips';
import type { State } from './state';
import { estimateInput, historyInput, leadInput } from './usage';
import type { Counted } from './usage';

/** full: any change that is not a drag. drag: a slider is moving. rest: the pointer has rested, the slider is still held. */
export type CalcMode = 'full' | 'drag' | 'rest';

/** Everything `estimate` has answered for the state that is on screen. */
export interface Calc {
  /** The newest answer for the 30 days: a full call, or the fast form while a slider moves. */
  readonly shown: Estimate;
  /** The last full call. The tips and the method notes are built from it and kept while a slider moves. */
  readonly full: Estimate;
  /** The tips picked from `full`. */
  readonly tips: PickedTips;
  /** The unit the result had when `full` was worked out. The tips and the method notes are worded in it. */
  readonly fullUnit: MassUnit;
  /** ChatGPT: the range of the whole-history call. null for Claude Code. */
  readonly history: Spread | null;
  readonly scale: ChartScale;
  /** The size the energy slider shows, and the sizes the person used (the lead first, then the others in their fixed order). */
  readonly lead: EnergyClass;
  readonly used: readonly EnergyClass[];
}

/** The two passes a moving slider does without: each tip's own saving, and the biggest unknown. */
const FAST = { tips: false, biggestUnknown: false } as const;

const isEnergyClass = (size: string): size is EnergyClass => ENERGY_ORDER.some((known) => known === size);

/**
 * The size the energy slider shows, and the sizes in use. They are picked from a call of its own with
 * no slider set, because "the most kilograms" is meant with every assumption at typical, and the
 * shares of the main call hold the person's own values.
 */
function leadOf(state: State, counted: Counted): Pick<Calc, 'lead' | 'used'> {
  const kg = new Map<EnergyClass, number>();
  for (const share of estimate(leadInput(counted, state), FAST).shares.models) {
    if (isEnergyClass(share.sizeClass)) kg.set(share.sizeClass, (kg.get(share.sizeClass) ?? 0) + share.kg);
  }
  const lead = leadSize(state.lead, state.pins.energy !== undefined, kg);
  const inUse = (size: EnergyClass): boolean => (kg.get(size) ?? 0) > 0;
  return { lead, used: [...(inUse(lead) ? [lead] : []), ...ENERGY_ORDER.filter((size) => size !== lead && inUse(size))] };
}

/** Pure. `previous` is the Calc that is on screen, or null when the data or the plan has changed. */
export function recalc(state: State, counted: Counted, previous: Calc | null, mode: CalcMode): Calc {
  const input = estimateInput(counted, state);
  const whole = historyInput(counted, state);
  const history = whole === null ? null : estimate(whole, FAST).range;

  if (previous !== null && mode === 'drag') {
    const shown = estimate(input, FAST);
    // The scale and the unit only go up until the slider is let go.
    return { ...previous, shown, history, scale: nextScale(previous.scale, shown.range, shown.baseline, true) };
  }

  const full = estimate(input, { marketGrid: MARKET_GRID });
  // A rest is not a release: the tips are new, and the scale still does not step down.
  const held = previous !== null && mode === 'rest';
  const scale = held ? nextScale(previous.scale, full.range, full.baseline, true) : nextScale(null, full.range, full.baseline, false);
  const { lead, used } = held ? previous : leadOf(state, counted);
  const tips = pickTips({ source: counted.source, built: counted.built, result: full, unit: scale.unit, coveredDays: counted.covered.days });
  return { shown: full, full, tips, fullUnit: scale.unit, history, scale, lead, used };
}
