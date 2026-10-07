// Chapter "How it's calculated": the sliders, the lists of what is counted, and the sentences worked
// out from the person's own numbers.

import type { MethodView } from '../contracts/view';
import { printsSame } from '../format';
import { assumptionViews, isSliderId, rowOf } from '../model/assumptions';
import { HIDDEN_PIECES, piecesOn } from '../model/hidden';
import type { HiddenId } from '../model/hidden';
import type { Calc } from './calc';
import { setCount, tipsInEffect } from './derive-result';
import type { State } from './state';
import { countOf } from './usage';
import type { Counted } from './usage';
import {
  COUNTED,
  COUNTED_SHARED,
  FABLE_NOTE,
  FIXED_ASSUMPTIONS,
  FORMULA,
  HISTORY_NOTE,
  LEAST_CERTAIN,
  LEAST_CERTAIN_WITH_UNKNOWN,
  LEFT_OUT,
  LEFT_OUT_SHARED,
  MATTERS_MOST_HOW,
  SHARE_NOTE,
  SLIDER_NOTE,
  UNKNOWN_SIZE_NOTE,
  allTypicalNote,
  extremeLabel,
  marketNote,
  mattersMostNote,
} from './words';

/**
 * The sentences about this person's result, then for ChatGPT the assumptions of the count that have
 * no slider. They are built from the last full call, so they stand still while a slider moves.
 */
export function methodNotes(counted: Counted, calc: Calc): string[] {
  const full = calc.full;
  const unit = calc.fullUnit;
  const anySet = setCount(full) > 0;
  const notes: string[] = [];

  const biggest = full.biggestUnknown;
  // "From 17 to 17 kg" names an assumption that moves nothing a person can see: then both sentences stay away.
  if (!full.single && biggest !== null && isSliderId(biggest.id) && !printsSame(biggest.middleAtLow, biggest.middleAtHigh, unit)) {
    // The slider's own label, as it stands on the page. For the energy slider that is the row it shows.
    notes.push(mattersMostNote(rowOf(biggest.id, calc.lead).label, biggest.middleAtLow, biggest.middleAtHigh, unit, anySet), MATTERS_MOST_HOW);
  }
  if (!full.single) {
    const typical = allTypicalNote(full.allTypical, full.range.mid, full.runsAboveAllTypical, unit, anySet);
    if (typical !== null) notes.push(typical);
  }
  notes.push(calc.used.includes('unknown') ? LEAST_CERTAIN_WITH_UNKNOWN : LEAST_CERTAIN);
  if (full.market !== null) notes.push(marketNote(full.market.p5, full.market.mid, full.market.p95, unit, full.single));
  notes.push(SHARE_NOTE);
  if (counted.source === 'chatgpt') notes.push(HISTORY_NOTE);
  // The energy slider shows one size's sentence. A second size with a range of its own gets its sentence here.
  if (calc.used.includes('fable') && calc.lead !== 'fable') notes.push(FABLE_NOTE);
  if (calc.used.includes('unknown') && calc.lead !== 'unknown') notes.push(UNKNOWN_SIZE_NOTE);
  if (counted.source === 'chatgpt') notes.push(...FIXED_ASSUMPTIONS);
  return notes;
}

/** The pieces of hidden work that are switched off, and those with nothing to count. */
function piecesOf(state: State, counted: Counted): { off: HiddenId[]; absent: HiddenId[] } {
  if (counted.source !== 'chatgpt') return { off: [], absent: [] };
  const on = piecesOn(counted.switches, state.flipped);
  const units = (id: HiddenId): number =>
    counted.bases[id].reduce((sum, row) => sum + countOf(row.freshInput) + countOf(row.cacheWrite) + countOf(row.cacheRead) + countOf(row.output), 0);
  const ids = HIDDEN_PIECES.map((piece) => piece.id);
  return { off: ids.filter((id) => !on[id]), absent: ids.filter((id) => !(units(id) > 0)) };
}

export function methodView(state: State, counted: Counted | null, calc: Calc | null): MethodView {
  const source = state.source;
  const lists = {
    formula: FORMULA,
    counted: [...(source === null ? COUNTED_SHARED : COUNTED[source])],
    leftOut: [...(source === null ? LEFT_OUT_SHARED : LEFT_OUT[source])],
    sliderNote: SLIDER_NOTE,
  };
  if (counted === null || calc === null) {
    return {
      ...lists,
      notes: [],
      assumptions: assumptionViews({ source, pins: state.pins, lead: state.lead, used: [], inert: [], off: [], absent: [] }),
      extreme: null,
      extremeLabel: extremeLabel(false, 0),
      unit: 'kg',
    };
  }
  const shown = calc.shown;
  // Counted as the tag of the result counts them: a tip that is on and saves nothing is not "applied" in words.
  const tipsOn = shown.baseline === null ? 0 : tipsInEffect(calc).length;
  return {
    ...lists,
    notes: methodNotes(counted, calc),
    assumptions: assumptionViews({ source, pins: state.pins, lead: calc.lead, used: calc.used, inert: shown.inert, ...piecesOf(state, counted) }),
    extreme: shown.single ? null : { low: shown.extreme.low, high: shown.extreme.high },
    extremeLabel: extremeLabel(setCount(shown) > 0, tipsOn),
    unit: calc.scale.unit,
  };
}
