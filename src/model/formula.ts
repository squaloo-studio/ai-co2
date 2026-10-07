// The formula.
//
//   kg CO2e = tokens × weight × energy per token × overhead × grid × hardware
//             added up over models and token types
//
// An output token has weight 1. Tokens × Wh per 1,000 tokens × g per kWh comes out in billionths of a
// kilogram, hence the 1e-9.
//
// The formula is written twice: once for a single combination (formulaOnce) and once for all 10,000
// runs (fillRuns). Both add and multiply in the same order, so they agree to the last digit. Keep that
// order: the test vectors hold every number to nine digits and every "no saving" to an exact zero.
//
// Reading an array by index is written with "!" in this file: every index is a run below RUNS, a
// token slot or a size class that was checked on the way in, and a check on each read would only slow
// the loops down.

import { valueAt } from '../track';
import type { Triple } from '../track';
import type { Positions } from './input';
import { baseOfDial, baseOfSlot, column } from './pattern';
import { RUNS, TOKEN_TYPES } from './table';
import type { AssumptionTable, Row, TokenUsage } from './types';

const FRESH = 0;
const WRITE = 1;
const READ = 2;
const OUTPUT = 3;

/**
 * Something that varies on its own: one column of the pattern. The energy dial carries one triple per
 * size class, because the sizes move together. Every other dial carries one triple.
 */
export interface Dial {
  readonly id: string;
  readonly base: number;
  readonly triples: readonly Triple[];
  /** The track position the person has set, or null. */
  readonly pin: number | null;
}

/**
 * A set of tokens that is counted a number of times. The visible tokens are counted once. A piece of
 * hidden work is counted `amount` times, and `amount` has its own dial.
 */
export interface Block {
  /** For size class c: [c*4] fresh input, [c*4 + 1] cache write, [c*4 + 2] cache read, [c*4 + 3] output. */
  readonly tokens: Float64Array;
  readonly amount: Dial | null;
}

export interface UsageBlock extends Block {
  readonly id: string;
  readonly rows: readonly Row[];
}

/** A checked usage, turned into what the maths needs. */
export interface Setup {
  readonly classNames: readonly string[];
  readonly energy: Dial;
  readonly freshInput: Dial;
  readonly cacheWrite: Dial;
  readonly cacheRead: Dial;
  readonly pue: Dial;
  readonly grid: Dial;
  readonly hardware: Dial;
  /** Every dial, the fixed seven first, then one per piece of hidden work that is switched on. */
  readonly dials: readonly Dial[];
  /** The visible tokens first, then the pieces of hidden work that are switched on. */
  readonly blocks: readonly UsageBlock[];
}

/** Adds token rows up by size class. The rows have been checked. */
export function sumTokens(rows: readonly Row[], classNames: readonly string[]): Float64Array {
  const tokens = new Float64Array(classNames.length * 4);
  for (const row of rows) {
    const c = classNames.indexOf(row.sizeClass);
    for (let t = 0; t < 4; t++) {
      const count = row[TOKEN_TYPES[t]!];
      if (count !== undefined) tokens[c * 4 + t]! += count;
    }
  }
  return tokens;
}

export function prepare(table: AssumptionTable, positions: Positions, usage: TokenUsage): Setup {
  const classNames = Object.keys(table.energy);
  const dial = (id: string, base: number, triples: readonly Triple[]): Dial => {
    const pin = positions[id];
    return { id, base, triples, pin: pin === undefined ? null : pin };
  };
  const energy = dial('energy', baseOfDial('energy'), Object.values(table.energy));
  const freshInput = dial('freshInput', baseOfDial('freshInput'), [table.freshInput]);
  const cacheWrite = dial('cacheWrite', baseOfDial('cacheWrite'), [table.cacheWrite]);
  const cacheRead = dial('cacheRead', baseOfDial('cacheRead'), [table.cacheRead]);
  const pue = dial('pue', baseOfDial('pue'), [table.pue]);
  const grid = dial('grid', baseOfDial('grid'), [table.grid]);
  const hardware = dial('hardware', baseOfDial('hardware'), [table.hardware]);
  const dials = [energy, freshInput, cacheWrite, cacheRead, pue, grid, hardware];
  const blocks: UsageBlock[] = [{ id: 'visible', rows: usage.rows, tokens: sumTokens(usage.rows, classNames), amount: null }];

  // The pieces that are switched on, in the order of their slots. A piece that is off is no block at all.
  // Its slot stays its own, so switching a piece off never changes which combinations the others use.
  const pieces = usage.hidden.filter((item) => item.on !== false).sort((a, b) => a.slot - b.slot);
  for (const item of pieces) {
    const amount = dial(`hidden:${item.id}`, baseOfSlot(item.slot), [item.amount]);
    dials.push(amount);
    blocks.push({ id: item.id, rows: item.rows, tokens: sumTokens(item.rows, classNames), amount });
  }
  return { classNames, energy, freshInput, cacheWrite, cacheRead, pue, grid, hardware, dials, blocks };
}

/**
 * The formula for one combination of values, in kg CO2e.
 * `positionFor` gives the track position of every dial that is not pinned. `blocks` defaults to every
 * block. `freed` is one dial whose pin is left aside: `positionFor` decides for it too.
 */
export function formulaOnce(setup: Setup, positionFor: (dial: Dial) => number, blocks?: readonly Block[], freed?: Dial): number {
  const valueOf = (dial: Dial, tripleIndex: number): number => {
    const position = dial.pin !== null && dial !== freed ? dial.pin : positionFor(dial);
    return valueAt(dial.triples[tripleIndex]!, position);
  };
  const weightFresh = valueOf(setup.freshInput, 0);
  const weightWrite = valueOf(setup.cacheWrite, 0);
  const weightRead = valueOf(setup.cacheRead, 0);

  let sum = 0;
  for (const block of blocks || setup.blocks) {
    for (let c = 0; c < setup.classNames.length; c++) {
      const fresh = block.tokens[c * 4 + FRESH]!;
      const write = block.tokens[c * 4 + WRITE]!;
      const read = block.tokens[c * 4 + READ]!;
      const output = block.tokens[c * 4 + OUTPUT]!;
      if (fresh === 0 && write === 0 && read === 0 && output === 0) continue;
      const energy = valueOf(setup.energy, c);
      const outputEquivalent = output + weightFresh * fresh + weightWrite * write + weightRead * read;
      if (block.amount) sum += valueOf(block.amount, 0) * energy * outputEquivalent;
      else sum += energy * outputEquivalent;
    }
  }
  return sum * (valueOf(setup.pue, 0) * valueOf(setup.grid, 0) * valueOf(setup.hardware, 0) * 1e-9);
}

export const AT_LOW = (): number => 0;
export const AT_TYPICAL = (): number => 0.5;
export const AT_HIGH = (): number => 1;

/** Working arrays of RUNS numbers, made once and used again, so a dragged slider creates no garbage. */
const workArrays = new Map<string, Float64Array>();
export function workArray(name: string): Float64Array {
  let array = workArrays.get(name);
  if (!array) {
    array = new Float64Array(RUNS);
    workArrays.set(name, array);
  }
  return array;
}

/**
 * The value of an assumption in every run: its column of the pattern, or one fixed value when its
 * slider is pinned. Indexed by run. Do not write to what it returns.
 */
export function runValues(dial: Dial, tripleIndex: number): Float64Array {
  const triple = dial.triples[tripleIndex]!;
  if (dial.pin === null) return column(dial.base, triple);
  return workArray(`pinned|${dial.id}|${tripleIndex}`).fill(valueAt(triple, dial.pin));
}

/**
 * The formula for all 10,000 runs. `out` receives kg CO2e per run. With a `marketGrid` in g per kWh,
 * `marketOut` receives the market-based kg per run.
 */
export function fillRuns(setup: Setup, out: Float64Array, marketGrid: number | null, marketOut: Float64Array | null): void {
  const weightFresh = runValues(setup.freshInput, 0);
  const weightWrite = runValues(setup.cacheWrite, 0);
  const weightRead = runValues(setup.cacheRead, 0);
  const pue = runValues(setup.pue, 0);
  const grid = runValues(setup.grid, 0);
  const hardware = runValues(setup.hardware, 0);

  out.fill(0);
  for (const block of setup.blocks) {
    const amount = block.amount ? runValues(block.amount, 0) : null;
    for (let c = 0; c < setup.classNames.length; c++) {
      const fresh = block.tokens[c * 4 + FRESH]!;
      const write = block.tokens[c * 4 + WRITE]!;
      const read = block.tokens[c * 4 + READ]!;
      const output = block.tokens[c * 4 + OUTPUT]!;
      if (fresh === 0 && write === 0 && read === 0 && output === 0) continue;
      const energy = runValues(setup.energy, c);
      if (amount) {
        for (let i = 0; i < RUNS; i++) {
          out[i]! += amount[i]! * energy[i]! * (output + weightFresh[i]! * fresh + weightWrite[i]! * write + weightRead[i]! * read);
        }
      } else {
        for (let i = 0; i < RUNS; i++) {
          out[i]! += energy[i]! * (output + weightFresh[i]! * fresh + weightWrite[i]! * write + weightRead[i]! * read);
        }
      }
    }
  }

  if (marketOut && marketGrid !== null) {
    // The market-based line: the same energy and the same hardware emissions in kg.
    // Only the electricity is counted at the market-based figure.
    for (let i = 0; i < RUNS; i++) {
      marketOut[i] = out[i]! * pue[i]! * (marketGrid + grid[i]! * (hardware[i]! - 1)) * 1e-9;
    }
  }
  for (let i = 0; i < RUNS; i++) out[i]! *= pue[i]! * grid[i]! * hardware[i]! * 1e-9;
}
