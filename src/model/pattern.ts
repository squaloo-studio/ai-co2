// The fixed pattern of 10,000 combinations. It fixes every number the page shows: change nothing here.
//
// A dial's range is cut into 10,000 slices that are equally likely. Every slice is used in exactly one
// run. Which slices of different dials meet in the same run follows the Halton pattern: the run number
// is written in the dial's prime base and its digits are mirrored. Runs are then ranked by that mirrored
// number. The pattern is the same on every visit and on every machine.
//
// Reading a typed array by index is written with "!" in this file: every index is a run or a slice
// below the array's length, and a check on each read would only slow the loops down.

import { valueAt } from '../track';
import type { Triple } from '../track';
import { checkTriple, fail } from './guard';
import { RUNS } from './table';

// Each dial has its own prime number. The dials that usually matter most have the smallest.
const DIAL_BASE = Object.freeze({ energy: 2, cacheRead: 3, grid: 5, cacheWrite: 7, freshInput: 11, pue: 23, hardware: 29 });
// Hidden work takes these primes, by slot.
const HIDDEN_BASE: readonly number[] = Object.freeze([13, 17, 19, 31, 37, 41]);
/** How many pieces of hidden work the pattern has room for. */
export const HIDDEN_SLOTS = HIDDEN_BASE.length;

export type FixedDial = keyof typeof DIAL_BASE;

const isFixedDial = (name: string): name is FixedDial => Object.prototype.hasOwnProperty.call(DIAL_BASE, name);

/** The prime base of one of the seven dials that every source has. */
export function baseOfDial(dial: FixedDial): number {
  return DIAL_BASE[dial];
}

/** The prime base of a piece of hidden work, by its slot. */
export function baseOfSlot(slot: number): number {
  const base = HIDDEN_BASE[slot];
  return base === undefined ? fail(`no dial called "hidden${slot}"`) : base;
}

const sliceOrders = new Map<number, Uint16Array>();

/** For one prime base: the slice (0 to RUNS - 1) that each run uses. Every slice appears exactly once. */
function sliceOrder(base: number): Uint16Array {
  const cached = sliceOrders.get(base);
  if (cached) return cached;

  // How many digits the largest run number has in this base.
  let digits = 1;
  let reach = base;
  while (reach <= RUNS) {
    reach *= base;
    digits += 1;
  }

  // Write each run number (1 to RUNS) in this base and mirror its digits. No two runs get the same
  // mirrored number. Note which run has which mirrored number.
  const runWithMirror = new Int32Array(reach).fill(-1);
  for (let run = 0; run < RUNS; run++) {
    let n = run + 1;
    let mirrored = 0;
    for (let d = 0; d < digits; d++) {
      mirrored = mirrored * base + (n % base);
      n = Math.floor(n / base);
    }
    runWithMirror[mirrored] = run;
  }

  // Rank the runs by their mirrored number: the run with the smallest one uses slice 0, the next slice 1.
  const order = new Uint16Array(RUNS);
  let slice = 0;
  for (let mirrored = 0; mirrored < reach; mirrored++) {
    const run = runWithMirror[mirrored]!;
    if (run < 0) continue;
    order[run] = slice;
    slice += 1;
  }

  sliceOrders.set(base, order);
  return order;
}

let slicePositions: Float64Array | null = null;

/**
 * The track position of each slice. Slice k covers the chances from k / RUNS to (k + 1) / RUNS. Its
 * position is taken at the middle of that step. Positions follow a tent: most of them near 0.5, few
 * near 0 and 1, and exactly half of them below 0.5.
 */
function tentPositions(): Float64Array {
  if (slicePositions) return slicePositions;
  const positions = new Float64Array(RUNS);
  for (let slice = 0; slice < RUNS; slice++) {
    const chance = (slice + 0.5) / RUNS;
    positions[slice] = chance < 0.5
      ? Math.sqrt(chance / 2)
      : 1 - Math.sqrt((1 - chance) / 2);
  }
  slicePositions = positions;
  return positions;
}

const columns = new Map<string, Float64Array>();

/**
 * The value of one assumption in each of the 10,000 runs, indexed by run. Built once and kept.
 * Do not write to what it returns.
 */
export function column(base: number, triple: Triple): Float64Array {
  const key = `${base}|${triple[0]}|${triple[1]}|${triple[2]}`;
  const cached = columns.get(key);
  if (cached) return cached;
  const order = sliceOrder(base);
  const positions = tentPositions();
  const values = new Float64Array(RUNS);
  for (let run = 0; run < RUNS; run++) values[run] = valueAt(triple, positions[order[run]!]!);
  // Custom tables and hidden-work amounts add columns. The cap keeps them from filling the memory.
  if (columns.size >= 400) columns.clear();
  columns.set(key, values);
  return values;
}

function baseOfDialName(dialName: string): number {
  const name = String(dialName);
  if (isFixedDial(name)) return DIAL_BASE[name];
  const match = /^hidden([0-9])$/.exec(name);
  const base = match ? HIDDEN_BASE[Number(match[1])] : undefined;
  return base === undefined ? fail(`no dial called "${name}"`) : base;
}

/**
 * For tests: the slice that each run uses on one dial of the pattern, indexed by run.
 * `dialName` is "energy", "cacheRead", "grid", "cacheWrite", "freshInput", "pue", "hardware",
 * or "hidden0" to "hidden5".
 */
export function patternSlices(dialName: string): number[] {
  return Array.from(sliceOrder(baseOfDialName(dialName)));
}

/**
 * For tests, and for drawing how often each slider position is used: the 10,000 values the page uses
 * for one dial and one [low, typical, high], in run order.
 */
export function patternValues(dialName: string, triple: Triple): number[] {
  checkTriple(triple, dialName);
  return Array.from(column(baseOfDialName(dialName), triple));
}
