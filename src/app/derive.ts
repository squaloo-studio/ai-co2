// From what the store holds to what the page draws. Pure: the same state, usage and answers of the
// estimator always give the same View. The page never calculates, so every number and every sentence
// that depends on the person's data is put into the View here.

import type { View } from '../contracts/view';
import { contributeView } from '../model/contribute';
import type { Calc } from './calc';
import { dataView } from './derive-data';
import { methodView } from './derive-method';
import { resultView, tipsInEffect } from './derive-result';
import { stageOf } from './state';
import type { State } from './state';
import type { Counted } from './usage';

/** The whole View. `counted` and `calc` are both null, or both set: set exactly while there is a result. */
export function deriveView(state: State, counted: Counted | null, calc: Calc | null): View {
  const data = dataView(state, counted, calc);
  const method = methodView(state, counted, calc);
  if (counted === null || calc === null) {
    return { stage: stageOf(state), source: state.source, data, result: null, tips: [], noTipsNote: null, contribute: null, method };
  }
  return {
    stage: stageOf(state),
    source: state.source,
    data,
    result: resultView(state, counted, calc),
    // While a slider moves these are the tips of the last full call: the fast call works out no savings.
    tips: calc.tips.shown.map((tip) => tip.view),
    noTipsNote: calc.tips.noTipsNote,
    // Counted as the tag of the result counts them: a tip that is on and saves nothing changes no cost.
    contribute: contributeView(calc.shown, calc.scale.unit, calc.shown.baseline === null ? 0 : tipsInEffect(calc).length),
    method,
  };
}
