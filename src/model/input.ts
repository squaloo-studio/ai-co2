// Reading the input. Everything the caller hands over is checked here, before any number is worked
// out. What passes is copied and frozen. So the estimator never changes the caller's data, and neither
// can a tip.
//
// The checks take `unknown` on purpose: the types say what a caller should hand over, and these
// functions find out what was handed over. The words of each message are part of the test vectors.

import { positionOf } from '../track';
import type { Triple } from '../track';
import { checkTriple, describe, fail, isList, isPlain, isRecord, onlyKeys } from './guard';
import { HIDDEN_SLOTS } from './pattern';
import { ROUNDING, SLIDER_IDS, TABLE, isTokenType } from './table';
import type { AssumptionTable, HiddenWork, Row, Tip, TokenUsage } from './types';

function checkTable(table: Record<string, unknown>): asserts table is Record<string, unknown> & AssumptionTable {
  const energy = table.energy;
  if (!isRecord(energy) || Object.keys(energy).length === 0) {
    return fail('the table needs "energy": [low, typical, high] for at least one model size');
  }
  for (const name of Object.keys(energy)) checkTriple(energy[name], `energy.${name}`);
  for (const id of ['freshInput', 'cacheWrite', 'cacheRead', 'pue', 'grid', 'hardware']) checkTriple(table[id], id);
  // Overhead and hardware are factors on top. Below 1 they would take emissions away.
  for (const id of ['pue', 'hardware']) {
    const triple = table[id];
    checkTriple(triple, id);
    if (triple[0] < 1) fail(`"${id}" is a factor on top, so its low value must be 1 or more`);
  }
}

/** The table to use: the caller's, checked, or TABLE. */
function readTable(table: unknown): AssumptionTable {
  if (table === undefined || table === null || table === TABLE) return TABLE;
  if (!isRecord(table)) return fail('the table needs "energy": [low, typical, high] for at least one model size');
  checkTable(table);
  return table;
}

// A count under a name that only looks like a token type would be counted as zero without a word.
// So such a name is refused. "cache_read", "cacheReads" and "output_tokens" are caught this way.
const plainName = (key: string): string => key.toLowerCase().replace(/[^a-z]/g, '').replace(/tokens?$/, '').replace(/s$/, '');
const LOOKALIKES = new Map<string, string>([
  ['freshinput', 'freshInput'], ['input', 'freshInput'],
  ['cachewrite', 'cacheWrite'], ['cachecreation', 'cacheWrite'], ['cachecreationinput', 'cacheWrite'],
  ['cacheread', 'cacheRead'], ['cachereadinput', 'cacheRead'],
  ['output', 'output'],
]);

/**
 * Checks a list of rows and returns a frozen copy.
 * `where` is for the message: '"rows"' or 'hidden work "thinking"'.
 */
function readRows(rows: unknown, classNames: readonly string[], where: string): readonly Row[] {
  if (!isList(rows)) return fail(`${where} must be a list of token counts by model`);
  // Array.from and not map: map would keep a hole in the list, and a hole is no row.
  return Object.freeze(Array.from(rows, (row): Row => {
    if (!isRecord(row)) return fail(`${where}: every row must be an object with "model", "sizeClass" and token counts`);
    const { model, sizeClass } = row;
    if (typeof model !== 'string' || model === '') return fail(`${where}: every row needs the model's name ("model")`);
    if (typeof sizeClass !== 'string' || !classNames.includes(sizeClass)) {
      return fail(`no energy values for size class "${sizeClass}" (model "${model}")`);
    }
    for (const key of Object.keys(row)) {
      if (isTokenType(key)) {
        const count = row[key];
        if (count !== undefined && (typeof count !== 'number' || !Number.isFinite(count) || count < 0)) {
          fail(`bad ${key} count for model "${model}"`);
        }
      } else {
        const meant = LOOKALIKES.get(plainName(key));
        if (meant !== undefined) fail(`model "${model}" has a count called "${key}". The module reads "${meant}".`);
      }
    }
    // The loop above has checked the counts, which the compiler cannot follow through a copy.
    return Object.freeze({ ...row, model, sizeClass }) as Row;
  }));
}

/** Checks the pieces of hidden work, whether they are switched on or off, and returns a frozen copy. */
function readHidden(hidden: unknown, classNames: readonly string[]): readonly HiddenWork[] {
  if (!isList(hidden)) return fail('"hidden" must be a list of pieces of hidden work');
  const ids = new Set<string>();
  const slots = new Set<number>();
  // Array.from, as in readRows: a hole in the list is refused, not skipped.
  return Object.freeze(Array.from(hidden, (item): HiddenWork => {
    if (!isRecord(item)) return fail('every piece of hidden work needs an id');
    const { id, slot, on, amount } = item;
    if (typeof id !== 'string' || id === '') return fail('every piece of hidden work needs an id');
    if (ids.has(id)) fail(`two pieces of hidden work are called "${id}"`);
    ids.add(id);
    // The slot decides which column of the pattern a piece uses. It is given, never taken from the place
    // in the list. So leaving a piece out, or another order of the list, cannot move a piece to other
    // combinations.
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= HIDDEN_SLOTS || slots.has(slot)) {
      return fail(`hidden work "${id}" needs its own slot from 0 to ${HIDDEN_SLOTS - 1}`);
    }
    slots.add(slot);
    if (on !== undefined && on !== true && on !== false) {
      return fail(`hidden work "${id}": "on" must be true or false`);
    }
    checkTriple(amount, `hidden.${id}.amount`);
    return Object.freeze({
      ...item,
      id,
      slot,
      amount: Object.freeze([amount[0], amount[1], amount[2]] as const),
      rows: readRows(item.rows, classNames, `hidden work "${id}"`),
    });
  }));
}

/** Checks a usage and returns a frozen copy of it. */
export function readUsage(usage: { rows: unknown; hidden: unknown }, classNames: readonly string[]): TokenUsage {
  return Object.freeze({
    rows: readRows(usage.rows, classNames, '"rows"'),
    hidden: readHidden(usage.hidden, classNames),
  });
}

/** Slider id -> track position. A slider that is not set is not listed. */
export type Positions = Record<string, number>;

/**
 * The sliders the person has set, as track positions.
 *
 * A pin given as a number is a track position. It must lie from 0 to 1. Anything else is refused, not
 * clamped: a grid value of 350 handed over as a pin would otherwise be read as "high".
 * A pin given as { value } is the assumption's own value. It is turned into a position here.
 */
function readPins(pins: unknown, table: AssumptionTable, usage: TokenUsage): Positions {
  // No prototype, so a slider called "constructor" cannot be found by accident.
  const positions: Positions = Object.create(null);
  if (pins === undefined || pins === null) return positions;
  if (!isPlain(pins)) return fail('"pins" must be a plain object such as { grid: 0.8 }');

  // Every slider but energy, which has one triple per model size.
  const triples = new Map<string, Triple>();
  for (const id of SLIDER_IDS) {
    if (id !== 'energy') triples.set(id, table[id]);
  }
  for (const item of usage.hidden) triples.set(`hidden:${item.id}`, item.amount);

  for (const id of Object.keys(pins)) {
    if (id !== 'energy' && !triples.has(id)) fail(`there is no slider called "${id}"`);
    const pin = pins[id];
    if (pin === undefined || pin === null) continue;
    if (typeof pin === 'number') {
      if (!(pin >= 0 && pin <= 1)) {
        fail(`the pin for "${id}" must be a track position from 0 to 1. It got ${pin}. A value is handed over as { value: ... }.`);
      }
      positions[id] = pin + 0; // + 0 turns a negative zero into zero
      continue;
    }
    if (!isPlain(pin)) return fail(`the pin for "${id}" must be a track position from 0 to 1, or { value: a number }`);
    const value = pin.value;
    if (typeof value !== 'number') return fail(`the pin for "${id}" must be a track position from 0 to 1, or { value: a number }`);
    onlyKeys(pin, ['value', 'sizeClass'], `the pin for "${id}"`);
    let triple: Triple | undefined;
    if (id === 'energy') {
      const sizeClass = String(pin.sizeClass);
      if (!Object.prototype.hasOwnProperty.call(table.energy, sizeClass)) {
        fail(`the pin for "energy" needs "sizeClass" to say which model size its value is for: ${Object.keys(table.energy).join(', ')}`);
      }
      triple = table.energy[sizeClass];
    } else {
      if (pin.sizeClass !== undefined) fail(`the pin for "${id}" does not take "sizeClass". Only the energy pin does.`);
      triple = triples.get(id);
    }
    if (triple === undefined) return fail(`there is no slider called "${id}"`);
    // A value read back from the track can be off in its last digit. Further out than that is refused.
    if (!(value >= triple[0] * (1 - ROUNDING) && value <= triple[2] * (1 + ROUNDING))) {
      fail(`the pin for "${id}" has the value ${value}. It must lie between low and high: ${triple[0]} to ${triple[2]}.`);
    }
    positions[id] = positionOf(triple, value);
  }
  return positions;
}

const isTip = (tip: unknown): tip is Tip => isRecord(tip) && typeof tip.id === 'string' && tip.id !== '' && typeof tip.change === 'function';

/** Checks the tips and the list of applied ids. */
function readTips(tips: unknown, applied: unknown): { tips: readonly Tip[]; appliedIds: Set<string> } {
  const list = tips === undefined || tips === null ? [] : tips;
  if (!isList(list)) return fail('"tips" must be a list of { id, change }');
  const checked: Tip[] = [];
  const ids = new Set<string>();
  for (const tip of list) {
    if (!isTip(tip)) return fail('every tip needs an id and a "change" function');
    if (ids.has(tip.id)) fail(`two tips are called "${tip.id}"`);
    ids.add(tip.id);
    checked.push(tip);
  }
  const on = applied === undefined || applied === null ? [] : applied;
  if (!isList(on)) return fail('"applied" must be a list of tip ids');
  const appliedIds = new Set<string>();
  for (const id of on) {
    if (typeof id !== 'string' || !ids.has(id)) return fail(`"applied" names "${String(id)}", and no tip is called that`);
    appliedIds.add(id);
  }
  return { tips: checked, appliedIds };
}

/** Everything `estimate` and `scenarioOfDot` are handed, checked. */
export interface Call {
  table: AssumptionTable;
  classNames: readonly string[];
  /** The usage as counted, frozen. */
  usage: TokenUsage;
  positions: Positions;
  tips: readonly Tip[];
  appliedIds: Set<string>;
}

export function readCall(input: unknown): Call {
  if (!isRecord(input)) return fail(`estimate needs an object with "rows". It got ${describe(input)}.`);
  onlyKeys(input, ['rows', 'hidden', 'pins', 'tips', 'applied', 'table'], 'estimate');
  const table = readTable(input.table);
  const classNames = Object.keys(table.energy);
  const usage = readUsage({ rows: input.rows, hidden: input.hidden === undefined || input.hidden === null ? [] : input.hidden }, classNames);
  const positions = readPins(input.pins, table, usage);
  const { tips, appliedIds } = readTips(input.tips, input.applied);
  return { table, classNames, usage, positions, tips, appliedIds };
}
