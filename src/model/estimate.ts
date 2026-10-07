// The estimator: token counts in, a CO2e footprint out. A likely range, a middle estimate, an extreme
// range and the 100 values for the dot chart. It uses no random numbers, so the same input always gives
// the same output.
//
// The method in short:
//   1. Every assumption has a low, a typical and a high value. Low and high are hard limits.
//   2. Typical is the middle: half of the chance lies below it and half above.
//   3. Between the limits the chance is a tent over the slider track: highest at typical, falling in a
//      straight line to nothing at low and at high.
//   4. The footprint is worked out 10,000 times ("runs"). Each run uses a different combination of
//      values. The combinations come from a fixed pattern that spreads them evenly (pattern.ts).
//   5. The energy values of the model sizes share one dial, so they move together. Every other
//      assumption has its own dial.
//   6. The 10,000 results are sorted and cut into 100 groups of 100. Each dot is the middle of one group.
//      The middle estimate is the border between groups 50 and 51. The likely range runs from the border
//      between groups 5 and 6 to the border between groups 95 and 96.
//
// fixtures/vectors.json holds the numbers this file must give. estimate.test.ts compares them.
//
// Reading a typed array by index is written with "!" in this file: every index is a run below RUNS,
// and a check on each read would only slow the loops down.

import type { Spread } from '../contracts/usage';
import { fail, isPlain, isRecord, onlyKeys, reasonOf } from './guard';
import { AT_HIGH, AT_LOW, AT_TYPICAL, fillRuns, formulaOnce, prepare, runValues, sumTokens, workArray } from './formula';
import type { Block, Setup } from './formula';
import { readCall, readUsage } from './input';
import type { Call } from './input';
import { CAR_KG_PER_KM, DOTS, ROUNDING, RUNS, RUNS_PER_DOT } from './table';
import type {
  DotScenario,
  Estimate,
  EstimateInput,
  EstimateOptions,
  HiddenShare,
  RowShare,
  Tip,
  TokenUsage,
  Unknown,
} from './types';

export { positionOf, valueAt } from '../track';
export { HIDDEN_SLOTS, patternSlices, patternValues } from './pattern';
export { fitScale, nextScale } from './scale';
export type { ChartScale } from './scale';
export { CAR_KG_PER_KM, DOTS, RUNS, SLIDER_IDS, TABLE, TOKEN_TYPES } from './table';
export type { FixedSliderId } from './table';
export { moveShare, scaleTokens } from './whatif';
export type * from './types';

// ---------- reading the sorted results ----------

/** Copies `values` into the working array `name` and sorts it, lowest first. */
function sortedCopy(values: Float64Array, name: string): Float64Array {
  const sorted = workArray(name);
  sorted.set(values);
  return sorted.sort(); // a Float64Array sorts by number
}

/** The value between two neighbouring groups of 100: `groupsBelow` whole groups lie under it. */
function border(sorted: Float64Array, groupsBelow: number): number {
  const first = groupsBelow * RUNS_PER_DOT;
  return (sorted[first - 1]! + sorted[first]!) / 2;
}

/** The low end, the middle and the high end of a sorted list of RUNS results. */
function spreadOf(sorted: Float64Array): Spread {
  return { p5: border(sorted, 5), mid: border(sorted, 50), p95: border(sorted, 95) };
}

/** The 100 dots, lowest first: the middle of each group of 100. */
function dotsOf(sorted: Float64Array): number[] {
  const dots = new Array<number>(DOTS);
  for (let g = 0; g < DOTS; g++) {
    const middle = g * RUNS_PER_DOT + RUNS_PER_DOT / 2;
    dots[g] = (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return dots;
}

/** How many of the sorted results lie above `value`. */
function countAbove(sorted: Float64Array, value: number): number {
  let low = 0;
  let high = RUNS;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle]! > value) high = middle;
    else low = middle + 1;
  }
  return RUNS - low;
}

/**
 * Carries a range through a rule that turns kilograms into something else: kilometres, euros.
 * This is only right for a rule that never goes down when the kilograms go up. Then the low end, the
 * middle and the high end of the result are the rule applied to the low end, the middle and the high
 * end. A price with a minimum or with whole-euro steps is such a rule.
 *
 * The function cannot prove that a rule never goes down. It tests the rule at the points it is given:
 * the three ends, and the 100 dots when they are handed over too. Hand them over for every price rule.
 */
export function carryThrough(spread: Spread, rule: (kg: number) => number, dots?: readonly number[]): Spread {
  const out = { p5: rule(spread.p5), mid: rule(spread.mid), p95: rule(spread.p95) };
  let rising = out.p5 <= out.mid && out.mid <= out.p95;
  if (rising && dots !== undefined) {
    let before = -Infinity;
    for (const dot of dots) {
      const now = rule(dot);
      if (!(now >= before)) rising = false;
      before = now;
    }
  }
  if (!rising) fail('carryThrough needs a rule that never goes down when the kilograms go up');
  return out;
}

// ---------- tips ----------

/** Runs one tip on a frozen usage, checks what comes back and returns a frozen copy of it. */
function runTip(tip: Tip, usage: TokenUsage, classNames: readonly string[]): TokenUsage {
  let changed: unknown;
  try {
    changed = tip.change(usage);
  } catch (error) {
    // An edit of the frozen usage shows up here as a TypeError.
    const hint = error instanceof TypeError ? ' A tip must not edit the usage it is given. It returns a new one.' : '';
    return fail(`tip "${tip.id}" failed: ${reasonOf(error)}.${hint}`);
  }
  if (isRecord(changed) && typeof changed.then === 'function') fail(`tip "${tip.id}" returned a promise. A tip must not be async.`);
  if (!isRecord(changed) || !Array.isArray(changed.rows) || !Array.isArray(changed.hidden)) {
    return fail(`tip "${tip.id}" must return a usage: { rows, hidden }`);
  }
  let read: TokenUsage;
  try {
    read = readUsage({ rows: changed.rows, hidden: changed.hidden }, classNames);
  } catch (error) {
    return fail(`tip "${tip.id}" returned a usage that cannot be counted: ${reasonOf(error)}`);
  }
  const samePieces = read.hidden.length === usage.hidden.length && read.hidden.every((item, index) => {
    const before = usage.hidden[index];
    return before !== undefined && item.id === before.id && item.slot === before.slot
      && item.amount[0] === before.amount[0] && item.amount[1] === before.amount[1] && item.amount[2] === before.amount[2];
  });
  if (!samePieces) {
    fail(`tip "${tip.id}" must keep every piece of hidden work, in the same order, with its slot and its amount. It may change a piece's rows or switch it off.`);
  }
  return read;
}

/**
 * The usage the page shows now: the usage as counted, with the applied tips one after the other, in the
 * order of the tip list. null when no tip is applied.
 */
function shownUsageOf(call: Call): TokenUsage | null {
  let usage = call.usage;
  let anyApplied = false;
  for (const tip of call.tips) {
    if (!call.appliedIds.has(tip.id)) continue;
    usage = runTip(tip, usage, call.classNames);
    anyApplied = true;
  }
  return anyApplied ? usage : null;
}

// ---------- the estimate ----------

function readOptions(options: unknown): { tips: boolean; biggestUnknown: boolean; marketGrid: number | null } {
  const settings = options === undefined || options === null ? {} : options;
  if (!isPlain(settings)) return fail('the options must be a plain object such as { marketGrid: 70 }');
  onlyKeys(settings, ['tips', 'biggestUnknown', 'marketGrid'], 'estimate, in its options,');
  for (const key of ['tips', 'biggestUnknown']) {
    if (settings[key] !== undefined && typeof settings[key] !== 'boolean') fail(`the option "${key}" must be true or false`);
  }
  const marketGrid = settings.marketGrid === undefined ? null : settings.marketGrid;
  if (marketGrid !== null && !(typeof marketGrid === 'number' && Number.isFinite(marketGrid) && marketGrid >= 0)) {
    return fail('marketGrid must be a number of g per kWh, or null');
  }
  return { tips: settings.tips !== false, biggestUnknown: settings.biggestUnknown !== false, marketGrid };
}

/**
 * The footprint of one usage. `pins` are the sliders the person has set; every other assumption varies.
 * `tips` are worked out each on its own; those named in `applied` also change what is shown.
 *
 * Input that cannot be counted is refused, never guessed at: the call throws an Error whose message
 * starts with "ai-co2:" and says what is wrong.
 */
export function estimate(input: EstimateInput, options?: EstimateOptions | null): Estimate {
  const settings = readOptions(options);
  const marketGrid = settings.marketGrid;

  // The usage as counted. It is checked in full before any tip sees it.
  const call = readCall(input);
  const { table, positions, tips, appliedIds } = call;
  const baseUsage = call.usage;
  const baseSetup = prepare(table, positions, baseUsage);

  // Every tip runs here, before the first working array is filled. So nothing a tip does can touch a
  // half-finished result, not even a call to estimate.
  // The usage the page shows now: with the applied tips.
  const appliedUsage = shownUsageOf(call);
  const anyApplied = appliedUsage !== null;
  const shownUsage = anyApplied ? appliedUsage : baseUsage;
  const shownSetup = anyApplied ? prepare(table, positions, shownUsage) : baseSetup;
  // Each tip on its own, against the usage without any tip.
  const wantTips = settings.tips && tips.length > 0;
  const tipSetups = wantTips ? tips.map((tip) => ({ tip, setup: prepare(table, positions, runTip(tip, baseUsage, call.classNames)) })) : [];

  // Step 1. The 10,000 possible outcomes for what the page shows now.
  const shownRuns = workArray('shown');
  const marketRuns = marketGrid !== null ? workArray('market') : null;
  fillRuns(shownSetup, shownRuns, marketGrid, marketRuns);
  const sorted = sortedCopy(shownRuns, 'sorted');
  const range = spreadOf(sorted);
  const lowestRun = sorted[0]!;
  const highestRun = sorted[RUNS - 1]!;
  const single = lowestRun === highestRun;

  // Step 2. The extreme range and the all-typical value come straight from the formula.
  // A pinned slider stays at its pinned value in all three.
  const extreme = { low: formulaOnce(shownSetup, AT_LOW), high: formulaOnce(shownSetup, AT_HIGH) };
  const allTypical = formulaOnce(shownSetup, AT_TYPICAL);
  const swings = swingsOf(shownSetup);
  const shownShares = sharesOf(shownSetup, shownUsage, allTypical);

  const result: Estimate = {
    runs: RUNS,
    range,
    dots: dotsOf(sorted),
    lowestRun,
    highestRun,
    extreme,
    allTypical,
    runsAboveAllTypical: single ? 0 : countAbove(sorted, allTypical),
    single,
    car: carryThrough(range, (kg) => kg / CAR_KG_PER_KM),
    carExtreme: { low: extreme.low / CAR_KG_PER_KM, high: extreme.high / CAR_KG_PER_KM },
    baseline: null,
    market: null,
    tips: [],
    shares: {
      rows: shownShares.rows,
      hidden: shownShares.hidden,
      models: modelSharesOf(baseSetup),
    },
    pins: { ...positions },
    unknowns: unknownsOf(swings),
    inert: inertOf(swings, shownUsage),
    biggestUnknown: null,
  };
  if (marketRuns) result.market = spreadOf(sortedCopy(marketRuns, 'sortedOther'));

  // Step 3. Tips. Each tip is worked out on its own, against the usage without any tip, run by run:
  // the same 10,000 combinations, once with the usage as it is and once with the changed usage.
  if (anyApplied || wantTips) {
    const before = workArray('before');
    if (anyApplied) {
      fillRuns(baseSetup, before, null, null);
      result.baseline = spreadOf(sortedCopy(before, 'sortedOther'));
    } else {
      before.set(shownRuns);
    }
    if (wantTips) {
      const after = workArray('after');
      const saving = workArray('saving');
      for (const { tip, setup } of tipSetups) {
        fillRuns(setup, after, null, null);
        for (let i = 0; i < RUNS; i++) {
          // Two sums of the same tokens can differ in their last digit. That is rounding, not a saving.
          const difference = before[i]! - after[i]!;
          saving[i] = Math.abs(difference) <= ROUNDING * before[i]! ? 0 : difference;
        }
        // "sortedOther" is used again for `after`, so the savings are read off first.
        const sortedSaving = sortedCopy(saving, 'sortedOther');
        const savingRange = spreadOf(sortedSaving);
        const lowestSaving = sortedSaving[0]!;
        const highestSaving = sortedSaving[RUNS - 1]!;
        const afterRange = spreadOf(sortedCopy(after, 'sortedOther'));
        result.tips.push({ id: tip.id, applied: appliedIds.has(tip.id), saving: savingRange, lowestSaving, highestSaving, after: afterRange });
      }
    }
  }

  // Step 4. The biggest unknown: where the middle estimate goes when that one slider is set to low,
  // and when it is set to high.
  const biggest = result.unknowns[0];
  if (settings.biggestUnknown && biggest !== undefined) {
    const id = biggest.id;
    const middleWithPin = (position: number): number => {
      const pinned = prepare(table, Object.assign(Object.create(null), positions, { [id]: position }), shownUsage);
      const runs = workArray('unknown');
      fillRuns(pinned, runs, null, null);
      return border(sortedCopy(runs, 'sortedOther'), 50);
    };
    result.biggestUnknown = { id, middleAtLow: middleWithPin(0), middleAtHigh: middleWithPin(1) };
  }

  checkNumbers(result, 'result');
  return result;
}

/** Every number of a result must be a finite number. Token counts beyond any real use can break that. */
function checkNumbers(value: unknown, path: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`the result is not a finite number (${path}). The token counts or the table are out of range.`);
  } else if (Array.isArray(value)) {
    value.forEach((entry: unknown, i) => checkNumbers(entry, `${path}[${i}]`));
  } else if (isRecord(value)) {
    for (const key of Object.keys(value)) checkNumbers(value[key], `${path}.${key}`);
  }
}

/**
 * Each row's and each piece of hidden work's share of the result, with every assumption at typical
 * (pinned sliders at their pinned value). For the usage the page shows now.
 */
function sharesOf(setup: Setup, usage: TokenUsage, total: number): { rows: RowShare[]; hidden: HiddenShare[] } {
  const share = (kg: number): number => (total > 0 ? kg / total : 0);
  const rows = usage.rows.map((row): RowShare => {
    const block: Block = { tokens: sumTokens([row], setup.classNames), amount: null };
    const kg = formulaOnce(setup, AT_TYPICAL, [block]);
    return { model: row.model, sizeClass: row.sizeClass, kg, share: share(kg) };
  });
  const hidden: HiddenShare[] = [];
  for (const block of setup.blocks) {
    if (!block.amount) continue;
    const kg = formulaOnce(setup, AT_TYPICAL, [block]);
    hidden.push({ id: block.id, kg, share: share(kg) });
  }
  return { rows, hidden };
}

/**
 * Each model's share of the result, with every assumption at typical (pinned sliders at their pinned
 * value). One entry per model name. A model's kilograms are those of its visible rows plus those of its
 * rows inside every piece of hidden work that is switched on. So the shares add up to the whole.
 * `setup` is the setup of the usage as counted, with no tip.
 */
function modelSharesOf(setup: Setup): RowShare[] {
  const total = formulaOnce(setup, AT_TYPICAL);
  const classOf = new Map<string, string>();
  for (const block of setup.blocks) {
    for (const row of block.rows) {
      if (!classOf.has(row.model)) classOf.set(row.model, row.sizeClass);
    }
  }
  // A Map keeps the order in which the models were first seen.
  return Array.from(classOf, ([model, sizeClass]): RowShare => {
    const blocks = setup.blocks.map((block): Block => ({
      tokens: sumTokens(block.rows.filter((row) => row.model === model), setup.classNames),
      amount: block.amount,
    }));
    const kg = formulaOnce(setup, AT_TYPICAL, blocks);
    return { model, sizeClass, kg, share: total > 0 ? kg / total : 0 };
  });
}

interface Swing {
  id: string;
  pinned: boolean;
  low: number;
  high: number;
}

/**
 * For every dial: the result with that one assumption at its low and at its high, while all the others
 * sit where they are: at their pin, or at typical. The dial's own pin is left aside for this.
 */
function swingsOf(setup: Setup): Swing[] {
  return setup.dials.map((dial) => ({
    id: dial.id,
    pinned: dial.pin !== null,
    low: formulaOnce(setup, (other) => (other === dial ? 0 : 0.5), undefined, dial),
    high: formulaOnce(setup, (other) => (other === dial ? 1 : 0.5), undefined, dial),
  }));
}

/** The sliders that are not pinned and change the result. The biggest swing in kg comes first. */
function unknownsOf(swings: readonly Swing[]): Unknown[] {
  const list: Unknown[] = [];
  for (const { id, pinned, low, high } of swings) {
    if (!pinned && high > low) list.push({ id, low, high, swing: high - low, ratio: high / low });
  }
  list.sort((a, b) => b.swing - a.swing);
  return list;
}

/**
 * Every slider, pinned or not, that cannot change the result: its low and its high give the same
 * number. A piece of hidden work that is switched off is on the list too.
 */
function inertOf(swings: readonly Swing[], usage: TokenUsage): string[] {
  const inert: string[] = [];
  for (const { id, low, high } of swings) {
    if (!(high > low)) inert.push(id);
  }
  const off = usage.hidden.filter((item) => item.on === false).sort((a, b) => a.slot - b.slot);
  for (const item of off) inert.push(`hidden:${item.id}`);
  return inert;
}

/**
 * The assumption values behind one dot: the run just below the middle of that dot's group.
 * `dotIndex` runs from 0 to 99.
 */
export function scenarioOfDot(input: EstimateInput, dotIndex: number): DotScenario {
  if (!Number.isInteger(dotIndex) || dotIndex < 0 || dotIndex >= DOTS) {
    fail(`a dot index runs from 0 to ${DOTS - 1}`);
  }
  const call = readCall(input);
  const appliedUsage = shownUsageOf(call);
  const setup = prepare(call.table, call.positions, appliedUsage === null ? call.usage : appliedUsage);

  const runs = workArray('shown');
  fillRuns(setup, runs, null, null);
  const kg = sortedCopy(runs, 'sorted')[dotIndex * RUNS_PER_DOT + RUNS_PER_DOT / 2 - 1]!;
  const run = runs.indexOf(kg);

  const values: DotScenario['values'] = {};
  for (const dial of setup.dials) {
    if (dial === setup.energy) {
      const energy: Record<string, number> = {};
      setup.classNames.forEach((name, c) => { energy[name] = runValues(dial, c)[run]!; });
      values.energy = energy;
    } else {
      values[dial.id] = runValues(dial, 0)[run]!;
    }
  }
  return { run, kg, values };
}
