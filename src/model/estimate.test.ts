import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Spread } from '../contracts/usage';
import { mass, unitFor } from '../format';
import * as track from '../track';
import {
  CAR_KG_PER_KM,
  DOTS,
  HIDDEN_SLOTS,
  RUNS,
  SLIDER_IDS,
  TABLE,
  TOKEN_TYPES,
  carryThrough,
  estimate,
  fitScale,
  moveShare,
  nextScale,
  patternSlices,
  patternValues,
  positionOf,
  scaleTokens,
  scenarioOfDot,
  valueAt,
} from './estimate';
import type {
  AssumptionTable,
  ChartScale,
  Estimate,
  EstimateInput,
  EstimateOptions,
  HiddenWork,
  MoveShareSpec,
  Pins,
  Row,
  ScaleTokensSpec,
  Tip,
  TokenUsage,
  Triple,
} from './estimate';

// ---------- the fixture ----------
//
// fixtures/vectors.json was written by the reference version of the estimator. It holds inputs with the
// numbers they must give, inputs that must be refused, and fixed points of the pattern.

interface Tolerance {
  relative: number;
  absolute: number;
}
interface Vector {
  name: string;
  title: string;
  input: unknown;
  options: unknown;
  expected: unknown;
  tolerance: Tolerance;
}
interface Refusal {
  name: string;
  why: string;
  says: string[];
  input: unknown;
  options: unknown;
}
interface CarryRule {
  perKg: number;
  from?: number;
  perKgFrom?: number;
  minimum?: number;
}
interface VectorFile {
  table: AssumptionTable;
  tokenTypes: string[];
  sliderIds: string[];
  carKgPerKm: number;
  pattern: {
    runs: number;
    dots: number;
    slices: Record<string, { firstTwelve: number[]; last: number; checksum: number }>;
    valueAt: Array<{ triple: Triple; position: number; value: number }>;
    positionOf: Array<{ triple: Triple; value: number; position: number }>;
    firstRuns: Record<string, { triple: Triple; values: number[] }>;
  };
  vectors: Vector[];
  mustThrow: Refusal[];
  scenarios: Array<{ name: string; input: unknown; dot: number; expected: unknown }>;
  carry: Array<{ name: string; spread: Spread; rule: CarryRule; dots: number[] | null; expected?: Spread; refused?: boolean }>;
  scale: {
    fit: Array<{ top: number; scaleMax: number }>;
    next: Array<{ name: string; previous: ChartScale | null; range: Spread; baseline: Spread | null; dragging: boolean; expected: ChartScale }>;
  };
}

// Read from disk and not imported: the type of a 400 kB import would be worked out on every typecheck.
const file = JSON.parse(readFileSync(new URL('./fixtures/vectors.json', import.meta.url), 'utf8')) as VectorFile;

const isRecord = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);

// The tests hand over what a caller could get wrong, so they go around the types.
const call = (input: unknown, options?: unknown): Estimate => estimate(input as EstimateInput, options as EstimateOptions);

// JSON cannot hold "not a number" or infinity. In the stored inputs these three texts stand for them.
const SPECIAL = new Map<string, number>([['@NaN', Number.NaN], ['@Infinity', Infinity], ['@-Infinity', -Infinity]]);
function revive(value: unknown): unknown {
  if (typeof value === 'string') return SPECIAL.has(value) ? SPECIAL.get(value) : value;
  if (Array.isArray(value)) return value.map(revive);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, revive(entry)]));
  return value;
}

type Change = Tip['change'];

// Tips that break one rule on purpose. The estimator must refuse each of them.
const BROKEN: Record<string, unknown> = {
  'edits-its-input': (usage: { rows: Array<{ output: number }> }) => {
    const first = usage.rows[0];
    if (first) first.output = 0;
    return usage;
  },
  'returns-nothing': () => undefined,
  'is-async': async (usage: TokenUsage) => usage,
  'rows-not-a-list': (usage: TokenUsage) => ({ rows: null, hidden: usage.hidden }),
  'forgets-hidden': (usage: TokenUsage) => ({ rows: usage.rows }),
  'drops-a-piece': (usage: TokenUsage) => ({ rows: usage.rows, hidden: usage.hidden.slice(1) }),
  'reorders-pieces': (usage: TokenUsage) => ({ rows: usage.rows, hidden: usage.hidden.slice().reverse() }),
  'changes-a-slot': (usage: TokenUsage) => ({ rows: usage.rows, hidden: usage.hidden.map((piece, index) => (index === 0 ? { ...piece, slot: 5 } : piece)) }),
  'changes-an-amount': (usage: TokenUsage) => ({ rows: usage.rows, hidden: usage.hidden.map((piece, index) => (index === 0 ? { ...piece, amount: [0.5, 1, 8] } : piece)) }),
  'negative-count': (usage: TokenUsage) => ({ rows: usage.rows.map((row) => ({ ...row, output: -1 })), hidden: usage.hidden }),
  'no-function': 'not a function',
};

/** The file stores tips as data: { id, whatIf, spec }. This turns one into the function the estimator wants. */
function changeOf(whatIf: unknown, spec: unknown): unknown {
  if (whatIf === 'moveShare') return moveShare(spec as MoveShareSpec);
  if (whatIf === 'scaleTokens') return scaleTokens(spec as ScaleTokensSpec);
  if (whatIf === 'broken' && isRecord(spec)) return BROKEN[String(spec.how)];
  if (whatIf === 'callsEstimate' && isRecord(spec)) {
    // A tip that first asks for an estimate of its own, with a tip applied and a slider set. That inner
    // call uses every working array the outer call uses.
    const inner = changeOf(spec.whatIf, spec.spec) as Change;
    return (usage: TokenUsage) => {
      estimate({ rows: usage.rows, hidden: usage.hidden, tips: [{ id: 'inner', change: inner }], applied: ['inner'], pins: { energy: 1 } }, { tips: false, biggestUnknown: false });
      return inner(usage);
    };
  }
  throw new Error(`no what-if called "${String(whatIf)}"`);
}

function inputOf(stored: unknown): unknown {
  const input = revive(stored);
  if (!isRecord(input) || !Array.isArray(input.tips)) return input;
  const tips = input.tips.map((tip: unknown) => (isRecord(tip) ? { id: tip.id, change: changeOf(tip.whatIf, tip.spec) } : tip));
  return { ...input, tips };
}

/** Walks two values side by side and lists every place where they differ by more than the tolerance. */
function differences(got: unknown, want: unknown, tolerance: Tolerance, path: string, out: string[] = []): string[] {
  if (typeof want === 'number') {
    // An expected 0 must be exactly 0: a saving that is only rounding counts as nothing.
    const ok = typeof got === 'number' && (want === 0 ? got === 0 : Math.abs(got - want) <= tolerance.relative * Math.abs(want) + tolerance.absolute);
    if (!ok) out.push(`${path}: got ${String(got)}, expected ${want}`);
  } else if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) out.push(`${path}: lists differ in length`);
    else want.forEach((entry: unknown, i) => differences(got[i], entry, tolerance, `${path}[${i}]`, out));
  } else if (isRecord(want)) {
    if (!isRecord(got)) out.push(`${path}: got ${String(got)}, expected an object`);
    else for (const key of Object.keys(want)) differences(got[key], want[key], tolerance, `${path}.${key}`, out);
  } else if (got !== want) {
    out.push(`${path}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  }
  return out;
}

const EXACT: Tolerance = { relative: 0, absolute: 0 };

const vector = (name: string): Vector => {
  const found = file.vectors.find((v) => v.name === name);
  if (!found) throw new Error(`no vector called "${name}"`);
  return found;
};
const rowsOf = (name: string): Row[] => (vector(name).input as { rows: Row[] }).rows;
const hiddenOf = (name: string): HiddenWork[] => (vector(name).input as { hidden: HiddenWork[] }).hidden;

const A = rowsOf('A');
const B = rowsOf('B');
const HIDDEN = hiddenOf('hidden-work');

// Example what-ifs. The shares are examples for testing only.
const SONNET: Tip = { id: 'sonnet', change: moveShare({ where: { models: ['claude-opus-5-5'] }, toClass: 'medium', share: 0.5, toModel: 'claude-sonnet (moved from Opus)' }) };
const CLEAR: Tip = { id: 'clear', change: scaleTokens({ types: ['cacheRead'], factor: 0.6 }) };

// ---------- the vectors ----------

describe('the test vectors', () => {
  it('are all there', () => {
    expect(file.vectors).toHaveLength(46);
    expect(file.mustThrow).toHaveLength(70);
    expect(file.scenarios).toHaveLength(3);
    expect(file.carry).toHaveLength(5);
    expect(file.scale.fit.length + file.scale.next.length).toBe(31);
  });

  it.each(file.vectors.map((v) => [v.name, v] as const))('vector %s gives its numbers', (_name, v) => {
    const result = call(inputOf(v.input), revive(v.options));
    expect(differences(result, v.expected, v.tolerance, v.name)).toEqual([]);
    expect(result.runs).toBe(RUNS);
  });

  it.each(file.mustThrow.map((m) => [m.name, m] as const))('refuses %s', (_name, m) => {
    let message: string | null = null;
    try {
      call(inputOf(m.input), revive(m.options));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message, `${m.why} It was not refused.`).not.toBeNull();
    for (const text of m.says) expect(message).toContain(text);
    expect(message).toMatch(/^ai-co2: /);
  });

  it.each(file.scenarios.map((s) => [s.name, s] as const))('dot %s shows its run', (_name, s) => {
    const scenario = scenarioOfDot(inputOf(s.input) as EstimateInput, s.dot);
    expect(differences(scenario, s.expected, { relative: 1e-9, absolute: 0 }, s.name)).toEqual([]);
  });

  it.each(file.carry.map((c) => [c.name, c] as const))('carries a range through the rule %s', (_name, c) => {
    const rule = (kg: number): number => {
      const cost = (c.rule.from !== undefined && c.rule.perKgFrom !== undefined && kg >= c.rule.from ? c.rule.perKgFrom : c.rule.perKg) * kg;
      return c.rule.minimum === undefined ? cost : Math.max(c.rule.minimum, cost);
    };
    const carry = (): Spread => carryThrough(c.spread, rule, c.dots === null ? undefined : c.dots);
    if (c.refused) expect(carry).toThrow('never goes down');
    else expect(differences(carry(), c.expected, { relative: 1e-12, absolute: 0 }, c.name)).toEqual([]);
  });

  it('holds the constants of this estimator', () => {
    expect(JSON.stringify(TABLE)).toBe(JSON.stringify(file.table));
    expect([...TOKEN_TYPES]).toEqual(file.tokenTypes);
    expect([...SLIDER_IDS]).toEqual(file.sliderIds);
    expect(CAR_KG_PER_KM).toBe(file.carKgPerKm);
    expect(RUNS).toBe(file.pattern.runs);
    expect(DOTS).toBe(file.pattern.dots);
  });
});

describe('the constants', () => {
  it('cannot be changed by whoever imports them', () => {
    const before = JSON.stringify([TABLE, TOKEN_TYPES, SLIDER_IDS]);
    const tokenTypes = TOKEN_TYPES as unknown as string[];
    const sliderIds = SLIDER_IDS as unknown as string[];
    const table = TABLE as unknown as { hardware: number[]; grid: number[]; energy: Record<string, number[]> };
    const changes = [
      () => tokenTypes.sort(),
      () => tokenTypes.reverse(),
      () => sliderIds.push('hidden:thinking'),
      () => { table.hardware[1] = 1.12; },
      () => table.grid.reverse(),
      () => { table.energy.large = [1, 2, 3]; },
      () => { table.energy.extra = [1, 2, 3]; },
    ];
    for (const change of changes) expect(change).toThrow(TypeError);
    expect(JSON.stringify([TABLE, TOKEN_TYPES, SLIDER_IDS])).toBe(before);
  });
});

// ---------- the pattern and the track ----------

const DIAL_PRIMES: Record<string, number> = { energy: 2, cacheRead: 3, grid: 5, cacheWrite: 7, freshInput: 11, hidden0: 13, hidden1: 17, hidden2: 19, pue: 23, hardware: 29, hidden3: 31, hidden4: 37, hidden5: 41 };
const DIAL_NAMES = Object.keys(DIAL_PRIMES);

/** The run number, written in a prime base with its digits mirrored behind the point: the Halton value. */
function mirroredFraction(n: number, base: number): number {
  let fraction = 0;
  let step = 1 / base;
  for (let rest = n; rest > 0; rest = Math.floor(rest / base)) {
    fraction += (rest % base) * step;
    step /= base;
  }
  return fraction;
}

describe('the fixed pattern', () => {
  it('has a dial for every slider and one for each of the six slots of hidden work', () => {
    expect(HIDDEN_SLOTS).toBe(6);
    expect(Object.keys(file.pattern.slices).sort()).toEqual([...DIAL_NAMES].sort());
    expect(() => patternSlices('hidden6')).toThrow('no dial called "hidden6"');
    expect(() => patternSlices('constructor')).toThrow('no dial called');
  });

  it.each(DIAL_NAMES)('%s: every slice is used in exactly one run', (dial) => {
    const slices = patternSlices(dial);
    expect(slices).toHaveLength(RUNS);
    const seen = new Uint8Array(RUNS);
    for (const slice of slices) seen[slice] = 1;
    expect(seen.every((flag) => flag === 1)).toBe(true);
  });

  it.each(DIAL_NAMES)('%s: matches the stored first runs, last run and checksum', (dial) => {
    const slices = patternSlices(dial);
    const stored = file.pattern.slices[dial];
    let checksum = 0;
    slices.forEach((slice, run) => { checksum += (run + 1) * slice; });
    expect({ firstTwelve: slices.slice(0, 12), last: slices[RUNS - 1], checksum }).toEqual(stored);
  });

  it.each(DIAL_NAMES)('%s: runs are ranked by their mirrored run number in the dial\'s prime base', (dial) => {
    const base = DIAL_PRIMES[dial] ?? 0;
    const fractions = Array.from({ length: RUNS }, (_, run) => mirroredFraction(run + 1, base));
    const ranked = fractions.map((_, run) => run).sort((a, b) => (fractions[a] ?? 0) - (fractions[b] ?? 0));
    const rebuilt = new Array<number>(RUNS);
    ranked.forEach((run, slice) => { rebuilt[run] = slice; });
    expect(patternSlices(dial)).toEqual(rebuilt);
  });

  it('gives each slice the track position at the middle of its step under the tent', () => {
    // On the track of [1, e, e²] the value at position p is e^(2p). So the positions can be read back.
    const triple: Triple = [1, Math.E, Math.E * Math.E];
    const values = patternValues('grid', triple);
    const slices = patternSlices('grid');
    for (let run = 0; run < RUNS; run++) {
      const chance = ((slices[run] ?? 0) + 0.5) / RUNS;
      const position = chance < 0.5 ? Math.sqrt(chance / 2) : 1 - Math.sqrt((1 - chance) / 2);
      expect(Math.log(values[run] ?? 0) / 2).toBeCloseTo(position, 12);
    }
  });

  it.each(DIAL_NAMES)('%s: exactly half of the runs use a value below typical, and none reaches low or high', (dial) => {
    const triple = TABLE.cacheRead;
    const values = patternValues(dial, triple);
    expect(values.filter((value) => value < triple[1])).toHaveLength(RUNS / 2);
    expect(values.filter((value) => value > triple[1])).toHaveLength(RUNS / 2);
    expect(Math.min(...values)).toBeGreaterThan(triple[0]);
    expect(Math.max(...values)).toBeLessThan(triple[2]);
  });

  it('gives the stored assumption values for the first runs', () => {
    for (const [dial, stored] of Object.entries(file.pattern.firstRuns)) {
      const got = patternValues(dial, stored.triple).slice(0, stored.values.length);
      expect(differences(got, stored.values, { relative: 1e-12, absolute: 0 }, dial)).toEqual([]);
    }
  });

  it('refuses a row of the table that is not three rising numbers', () => {
    expect(() => patternValues('grid', [1, 1, 2])).toThrow('0 < low < typical < high');
    expect(() => patternValues('grid', [0, 1, 2])).toThrow('0 < low < typical < high');
  });
});

describe('the slider track', () => {
  it('is the one the page uses', () => {
    expect(valueAt).toBe(track.valueAt);
    expect(positionOf).toBe(track.positionOf);
  });

  it('hits low, typical and high exactly', () => {
    const triples: Triple[] = [TABLE.cacheRead, TABLE.grid, TABLE.freshInput, TABLE.pue, TABLE.hardware, ...Object.values(TABLE.energy)];
    for (const triple of triples) {
      expect([valueAt(triple, 0), valueAt(triple, 0.5), valueAt(triple, 1)]).toEqual([...triple]);
      expect([positionOf(triple, triple[0]), positionOf(triple, triple[1]), positionOf(triple, triple[2])]).toEqual([0, 0.5, 1]);
    }
  });

  it('gives the stored points', () => {
    expect(file.pattern.valueAt).toHaveLength(28);
    expect(file.pattern.positionOf).toHaveLength(48);
    const tolerance = { relative: 1e-12, absolute: 0 };
    for (const point of file.pattern.valueAt) {
      expect(differences(valueAt(point.triple, point.position), point.value, tolerance, 'valueAt')).toEqual([]);
    }
    for (const point of file.pattern.positionOf) {
      expect(differences(positionOf(point.triple, point.value), point.position, tolerance, 'positionOf')).toEqual([]);
    }
  });
});

// ---------- the page's sentences, by counting ----------

/** The 10,000 results, built again here row by row from the columns of the pattern. */
function rebuiltRuns(rows: readonly Row[], hidden: readonly HiddenWork[] = [], pins: Record<string, number> = {}): Float64Array {
  const col = (id: string, dial: string, triple: Triple): number[] => {
    const pin = pins[id];
    return pin === undefined ? patternValues(dial, triple) : new Array<number>(RUNS).fill(valueAt(triple, pin));
  };
  const energy = new Map(Object.entries(TABLE.energy).map(([name, triple]) => [name, col('energy', 'energy', triple)]));
  const weights: Record<string, number[]> = {
    freshInput: col('freshInput', 'freshInput', TABLE.freshInput),
    cacheWrite: col('cacheWrite', 'cacheWrite', TABLE.cacheWrite),
    cacheRead: col('cacheRead', 'cacheRead', TABLE.cacheRead),
  };
  const pue = col('pue', 'pue', TABLE.pue);
  const grid = col('grid', 'grid', TABLE.grid);
  const hardware = col('hardware', 'hardware', TABLE.hardware);
  const pieces = hidden.filter((piece) => piece.on !== false).map((piece) => ({ rows: piece.rows, amount: col(`hidden:${piece.id}`, `hidden${piece.slot}`, piece.amount) }));
  const at = (values: number[] | undefined, run: number): number => values?.[run] ?? Number.NaN;
  const wattHours = (row: Row, run: number): number =>
    at(energy.get(row.sizeClass), run) * ((row.output ?? 0) + at(weights.freshInput, run) * (row.freshInput ?? 0) + at(weights.cacheWrite, run) * (row.cacheWrite ?? 0) + at(weights.cacheRead, run) * (row.cacheRead ?? 0)) / 1000;
  const kg = new Float64Array(RUNS);
  for (let run = 0; run < RUNS; run++) {
    let total = 0;
    for (const row of rows) total += wattHours(row, run);
    for (const piece of pieces) for (const row of piece.rows) total += at(piece.amount, run) * wattHours(row, run);
    kg[run] = total / 1000 * at(pue, run) * at(grid, run) * at(hardware, run) / 1000; // Wh -> kWh -> g -> kg
  }
  return kg;
}

const count = (values: ArrayLike<number>, test: (value: number) => boolean): number => Array.from(values).filter(test).length;

const hiddenWith = (change: Record<string, Partial<HiddenWork>>): HiddenWork[] => HIDDEN.map((piece) => ({ ...piece, ...change[piece.id] }));

const COUNTED: Array<[name: string, rows: Row[], hidden: HiddenWork[], pins: Record<string, number>]> = [
  ['A', A, [], {}],
  ['B', B, [], {}],
  ['C', rowsOf('C'), [], {}],
  ['D', rowsOf('D'), [], {}],
  ['pinned-energy-high', A, [], { energy: 0.9 }],
  ['hidden-work', B, HIDDEN, {}],
  ['hidden-off-and-pinned', B, hiddenWith({ search: { on: false } }), { 'hidden:thinking': 0.3 }],
  ['hidden-first-off', B, hiddenWith({ thinking: { on: false } }), {}],
  ['hidden-six', B, hiddenOf('hidden-six'), {}],
];

describe.each(COUNTED)('the sentences of the page, counted for %s', (name, rows, hidden, pins) => {
  const result = estimate({ rows, hidden, pins });
  const { range, dots } = result;
  const runs = rebuiltRuns(rows, hidden, pins);
  const sorted = Float64Array.from(runs).sort();

  it('is the input of the vector of that name', () => {
    expect(differences(result, vector(name).expected, vector(name).tolerance, name)).toEqual([]);
  });

  it('has exactly 5,000 of 10,000 results below the middle estimate and 5,000 above', () => {
    expect(count(runs, (x) => x < range.mid)).toBe(5000);
    expect(count(runs, (x) => x > range.mid)).toBe(5000);
  });

  it('has exactly 9,000 results inside the likely range, 500 below and 500 above', () => {
    expect(count(runs, (x) => x > range.p5 && x < range.p95)).toBe(9000);
    expect(count(runs, (x) => x < range.p5)).toBe(500);
    expect(count(runs, (x) => x > range.p95)).toBe(500);
  });

  it('has exactly 90 dots inside the likely range, 5 below and 5 above', () => {
    expect(dots).toHaveLength(DOTS);
    expect(count(dots, (d) => d > range.p5 && d < range.p95)).toBe(90);
    expect(count(dots, (d) => d < range.p5)).toBe(5);
    expect(count(dots, (d) => d > range.p95)).toBe(5);
  });

  it('has 50 dots below the middle estimate and 50 above, rising without ties', () => {
    expect(count(dots, (d) => d < range.mid)).toBe(50);
    expect(count(dots, (d) => d > range.mid)).toBe(50);
    expect(dots.every((d, i) => i === 0 || d > (dots[i - 1] ?? Infinity))).toBe(true);
  });

  it('puts each dot in the middle of its group of 100 results', () => {
    dots.forEach((dot, g) => {
      expect(dot).toBeGreaterThan(sorted[g * 100 + 49] ?? Infinity);
      expect(dot).toBeLessThan(sorted[g * 100 + 50] ?? -Infinity);
    });
  });

  it('keeps every result inside the extreme range', () => {
    expect(count(runs, (x) => x < result.extreme.low || x > result.extreme.high)).toBe(0);
    expect(result.lowestRun).toBeCloseTo(sorted[0] ?? Number.NaN, 12);
    expect(result.highestRun / (sorted[RUNS - 1] ?? Number.NaN)).toBeCloseTo(1, 12);
  });

  it('counts the results above the all-typical value', () => {
    expect(count(runs, (x) => x > result.allTypical)).toBe(result.runsAboveAllTypical);
  });

  it('gives the car range as the kg range divided by 0.16', () => {
    expect(result.car).toEqual({ p5: range.p5 / 0.16, mid: range.mid / 0.16, p95: range.p95 / 0.16 });
  });

  it('gives exactly the same output for the same input', () => {
    expect(estimate({ rows, hidden, pins })).toStrictEqual(result);
  });
});

describe('the formula', () => {
  it('gives 8.575 kg for fixture A with every assumption at typical, as worked out by hand', () => {
    const opusWh = (4106552 + 0.15 * 2184390 + 0.15 * 21662104 + 0.015 * 548310227) / 1000 * 1.0;
    const sonnetWh = (1380961 + 0.15 * 911204 + 0.15 * 8904117 + 0.015 * 172556093) / 1000 * 0.6;
    const haikuWh = (402113 + 0.15 * 1002387 + 0.15 * 1240008 + 0.015 * 18771460) / 1000 * 0.1;
    const byHand = (opusWh + sonnetWh + haikuWh) / 1000 * 1.14 * 350 * 1.115 / 1000;
    expect(byHand).toBeCloseTo(8.575, 3);
    expect(estimate({ rows: A }).allTypical / byHand).toBeCloseTo(1, 12);
  });

  it('gives one outcome, the all-typical value to the last digit, with every slider at typical', () => {
    const open = estimate({ rows: A });
    const typical = estimate({ rows: A, pins: Object.fromEntries(SLIDER_IDS.map((id) => [id, 0.5])) });
    expect(typical.single).toBe(true);
    expect(typical.range).toEqual({ p5: open.allTypical, mid: open.allTypical, p95: open.allTypical });
    expect(typical.extreme).toEqual({ low: open.allTypical, high: open.allTypical });
    expect(typical.unknowns).toEqual([]);
    expect(typical.runsAboveAllTypical).toBe(0);
  });

  it('gives the extreme low with every slider at low, and the extreme high with every slider at high', () => {
    const open = estimate({ rows: A });
    const at = (position: number): Estimate => estimate({ rows: A, pins: Object.fromEntries(SLIDER_IDS.map((id) => [id, position])) });
    expect(at(0).range.mid).toBe(open.extreme.low);
    expect(at(1).range.mid).toBe(open.extreme.high);
  });

  it('reads a slider handed over as { value } like the same slider as a track position', () => {
    const asValues = estimate({ rows: A, pins: { grid: { value: 350 }, energy: { value: 1, sizeClass: 'large' }, hardware: { value: 1.12 } } });
    const asPositions = estimate({ rows: A, pins: { grid: 0.5, energy: 0.5, hardware: positionOf(TABLE.hardware, 1.12) } });
    expect(asValues).toStrictEqual(asPositions);
  });
});

// ---------- switching off gives the earlier numbers back ----------

describe('a tip', () => {
  const tips = [SONNET, CLEAR];
  const off = estimate({ rows: A, tips });
  const on = estimate({ rows: A, tips, applied: ['sonnet'] });

  it('changes what is shown to its own "after" range, number for number', () => {
    expect(off.baseline).toBeNull();
    expect(on.range).toEqual(off.tips[0]?.after);
    expect(on.range.mid).toBeLessThan(off.range.mid);
  });

  it('keeps the range without it as the baseline, and every saving as it was', () => {
    expect(on.baseline).toEqual(off.range);
    expect(on.tips.map((tip) => ({ ...tip, applied: false }))).toEqual(off.tips);
    expect(on.tips.map((tip) => tip.applied)).toEqual([true, false]);
    expect(on.shares.models).toEqual(off.shares.models);
  });

  it('returns the exact earlier numbers when it is switched off again', () => {
    expect(estimate({ rows: A, tips })).toStrictEqual(off);
    expect(estimate({ rows: A, tips, applied: [] })).toStrictEqual(off);
  });

  it('leaves the numbers of a page without tips untouched', () => {
    const { tips: _savings, ...withTips } = off;
    const { tips: _none, ...without } = estimate({ rows: A });
    expect(withTips).toStrictEqual(without);
  });

  it('saves A to B kg in 9,000 of 10,000 results, less in 500 and more in 500', () => {
    const before = rebuiltRuns(A);
    tips.forEach((tip, index) => {
      const after = rebuiltRuns(tip.change({ rows: A, hidden: [] }).rows);
      const savings = before.map((kg, run) => kg - (after[run] ?? Number.NaN));
      const saving = off.tips[index]?.saving ?? { p5: Number.NaN, mid: Number.NaN, p95: Number.NaN };
      expect(count(savings, (x) => x > saving.p5 && x < saving.p95)).toBe(9000);
      expect(count(savings, (x) => x < saving.p5)).toBe(500);
      expect(count(savings, (x) => x > saving.p95)).toBe(500);
    });
  });

  it('gets a frozen copy, so the caller\'s rows cannot be edited', () => {
    const rows = A.map((row) => ({ ...row }));
    const before = JSON.stringify(rows);
    const edits: Tip = {
      id: 'edits',
      change: (usage) => {
        (usage.rows[0] as { output?: number }).output = 0;
        return usage;
      },
    };
    expect(() => estimate({ rows, tips: [edits] })).toThrow('A tip must not edit the usage it is given');
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('a piece of hidden work', () => {
  const allOn = estimate({ rows: B, hidden: HIDDEN });
  const searchOff = estimate({ rows: B, hidden: hiddenWith({ search: { on: false } }) });

  it('adds to the result while it is switched on', () => {
    expect(allOn.range.mid).toBeGreaterThan(searchOff.range.mid);
    expect(searchOff.range.mid).toBeGreaterThan(estimate({ rows: B }).range.mid);
    expect(searchOff.inert).toContain('hidden:search');
  });

  it('returns the exact earlier numbers when it is switched on again', () => {
    expect(estimate({ rows: B, hidden: hiddenWith({ search: { on: true } }) })).toStrictEqual(allOn);
    expect(estimate({ rows: B, hidden: HIDDEN })).toStrictEqual(allOn);
  });

  it('counts for nothing when it is switched off: the numbers are those of a list without it', () => {
    const leftOut = estimate({ rows: B, hidden: HIDDEN.filter((piece) => piece.id !== 'search') });
    expect({ ...searchOff, inert: [] }).toStrictEqual({ ...leftOut, inert: [] });
  });

  it('keeps its own combinations whatever the order of the list', () => {
    expect(estimate({ rows: B, hidden: HIDDEN.slice().reverse() })).toStrictEqual(allOn);
  });

  it('switched off with every piece gives the numbers of the visible rows alone', () => {
    const noneOn = estimate({ rows: B, hidden: HIDDEN.map((piece) => ({ ...piece, on: false })) });
    const visible = estimate({ rows: B });
    expect({ ...noneOn, inert: [] }).toStrictEqual({ ...visible, inert: [] });
  });
});

describe('the chart\'s scale', () => {
  it('gives every stored step', () => {
    for (const sample of file.scale.fit) expect(fitScale(sample.top), `fitScale(${sample.top})`).toBe(sample.scaleMax);
  });

  it.each(file.scale.next.map((s) => [s.name, s] as const))('%s', (_name, s) => {
    expect(differences(nextScale(s.previous, s.range, s.baseline, s.dragging), s.expected, EXACT, s.name)).toEqual([]);
  });

  it('uses steps of 1, 2 and 5 times a power of ten, and never 0.19999999999999998', () => {
    expect(fitScale(0.15)).toBe(0.2);
    expect(fitScale(0)).toBe(0.000001);
    expect(() => fitScale(-1)).toThrow('fitScale needs a mass');
  });
});

// ---------- what the stored vectors cannot hold, or do not pin down ----------
//
// JSON has no Map, no minus zero, no hole in a list and no object without a prototype, and the file
// stores one example of each refusal. These tests cover the rest of what the estimator promises.

/** The message of the error that `run` throws. */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '(not refused)';
}

// Checked by the compiler, not at run time: a slider id that does not exist is no key of Pins.
type Holds<T extends true> = T;
type _PinsTakeSliderIdsOnly = Holds<'gird' extends keyof Pins ? false : true> & Holds<'grid' | 'hidden:thinking' extends keyof Pins ? true : false>;

describe('null in place of a part of the input', () => {
  const plain = estimate({ rows: A });

  it('means "none" for hidden, pins, tips, applied, table and the options', () => {
    expect(estimate({ rows: A, hidden: null, pins: null, tips: null, applied: null, table: null }, null)).toStrictEqual(plain);
  });

  it('means "not set" for one slider', () => {
    expect(estimate({ rows: A, pins: { grid: null, energy: undefined } })).toStrictEqual(plain);
    expect(estimate({ rows: A, pins: { grid: null, energy: 0.9 } })).toStrictEqual(estimate({ rows: A, pins: { energy: 0.9 } }));
  });
});

describe('a slider the person has set', () => {
  it('comes back at position 0.5 when it is set to its typical value', () => {
    for (const id of SLIDER_IDS) {
      if (id === 'energy') continue;
      expect(estimate({ rows: A, pins: { [id]: { value: TABLE[id][1] } } }).pins, id).toEqual({ [id]: 0.5 });
    }
    for (const [sizeClass, triple] of Object.entries(TABLE.energy)) {
      expect(estimate({ rows: A, pins: { energy: { value: triple[1], sizeClass } } }).pins, sizeClass).toEqual({ energy: 0.5 });
    }
    for (const piece of HIDDEN) {
      const id = `hidden:${piece.id}`;
      expect(estimate({ rows: B, hidden: HIDDEN, pins: { [id]: { value: piece.amount[1] } } }).pins, id).toEqual({ [id]: 0.5 });
    }
  });

  it('reads a position of minus zero as zero', () => {
    const result = estimate({ rows: A, pins: { grid: -0 } });
    expect(Object.is(result.pins.grid, 0)).toBe(true);
    expect(result).toStrictEqual(estimate({ rows: A, pins: { grid: 0 } }));
  });

  it('takes a value a hair outside low and high, which a value read back from the track can be, and nothing further out', () => {
    const [low, , high] = TABLE.grid;
    expect(estimate({ rows: A, pins: { grid: { value: low * (1 - 5e-13) } } }).pins.grid).toBe(0);
    expect(estimate({ rows: A, pins: { grid: { value: high * (1 + 5e-13) } } }).pins.grid).toBe(1);
    expect(refusal(() => estimate({ rows: A, pins: { grid: { value: low * (1 - 5e-12) } } }))).toContain('It must lie between low and high: 270 to 460.');
    expect(refusal(() => estimate({ rows: A, pins: { grid: { value: high * (1 + 5e-12) } } }))).toContain('It must lie between low and high: 270 to 460.');
  });

  it('is refused as a value with a model size, on any slider but energy', () => {
    expect(refusal(() => estimate({ rows: A, pins: { grid: { value: 350, sizeClass: 'large' } } })))
      .toBe('ai-co2: the pin for "grid" does not take "sizeClass". Only the energy pin does.');
  });

  it('is refused as a value with a key the estimator does not know', () => {
    expect(refusal(() => call({ rows: A, pins: { grid: { value: 350, unit: 'g' } } })))
      .toBe('ai-co2: the pin for "grid" does not take "unit". It takes: value, sizeClass.');
  });

  it('can come in an object without a prototype, and not in a Map, a class instance or a list', () => {
    const bare: Record<string, number> = Object.create(null);
    bare.grid = 0.8;
    expect(estimate({ rows: A, pins: bare })).toStrictEqual(estimate({ rows: A, pins: { grid: 0.8 } }));

    class Sliders {
      grid = 0.8;
    }
    for (const pins of [new Map([['grid', 0.8]]), new Sliders(), [0.8]]) {
      expect(refusal(() => call({ rows: A, pins }))).toBe('ai-co2: "pins" must be a plain object such as { grid: 0.8 }');
    }
    expect(refusal(() => call({ rows: A }, new Map([['marketGrid', 70]])))).toBe('ai-co2: the options must be a plain object such as { marketGrid: 70 }');
  });
});

describe('a list with a hole in it', () => {
  /** The same list, with one place before it that was never filled. */
  function withHole<T>(list: readonly T[]): T[] {
    const holed = new Array<T>(list.length + 1);
    list.forEach((entry, index) => { holed[index + 1] = entry; });
    return holed;
  }
  const NO_ROW = '"rows": every row must be an object with "model", "sizeClass" and token counts';

  it('is refused for rows, in the estimator\'s own words', () => {
    expect(refusal(() => estimate({ rows: withHole(A) }))).toBe(`ai-co2: ${NO_ROW}`);
    expect(refusal(() => scenarioOfDot({ rows: withHole(A) }, 50))).toBe(`ai-co2: ${NO_ROW}`);
  });

  it('is refused for hidden work, with sliders set or not, and is not counted as if the hole were not there', () => {
    const hidden = withHole(HIDDEN);
    expect(refusal(() => estimate({ rows: B, hidden }))).toBe('ai-co2: every piece of hidden work needs an id');
    expect(refusal(() => estimate({ rows: B, hidden, pins: {} }))).toBe('ai-co2: every piece of hidden work needs an id');
    const rowsOfPiece = HIDDEN.map((piece, index) => (index === 0 ? { ...piece, rows: withHole(piece.rows) } : piece));
    expect(refusal(() => estimate({ rows: B, hidden: rowsOfPiece }))).toContain('hidden work "thinking": every row must be an object');
  });

  it('is refused when a tip returns it, and the message says "ai-co2:" once', () => {
    const holes: Tip = { id: 'holes', change: (usage) => ({ rows: withHole(usage.rows), hidden: usage.hidden }) };
    expect(refusal(() => estimate({ rows: A, tips: [holes] }))).toBe(`ai-co2: tip "holes" returned a usage that cannot be counted: ${NO_ROW}`);
  });
});

describe('a count under a name that only looks like a token type', () => {
  it.each([
    ['cache_read', 'cacheRead'],
    ['cacheReads', 'cacheRead'],
    ['cache_read_input_tokens', 'cacheRead'],
    ['output_tokens', 'output'],
    ['outputTokens', 'output'],
    ['Output', 'output'],
    ['input_tokens', 'freshInput'],
    ['inputs', 'freshInput'],
    ['fresh_input', 'freshInput'],
    ['cache_write', 'cacheWrite'],
    ['cacheCreation', 'cacheWrite'],
    ['cache_creation_input_tokens', 'cacheWrite'],
  ])('is refused: "%s" would be read as nothing, where "%s" was meant', (key, meant) => {
    const rows = [{ model: 'some-model', sizeClass: 'large', output: 1000, [key]: 5000 }];
    expect(refusal(() => call({ rows }))).toBe(`ai-co2: model "some-model" has a count called "${key}". The module reads "${meant}".`);
    expect(refusal(() => call({ rows: B, hidden: [{ id: 'thinking', slot: 0, on: false, amount: [0.5, 2, 8], rows }] }))).toContain(`has a count called "${key}"`);
  });

  it('is not what a display name or another key of a row is: those are ignored', () => {
    const rows = A.map((row) => ({ ...row, displayName: 'A name to show', cost: 12.5, requests: 40 }));
    expect(estimate({ rows })).toStrictEqual(estimate({ rows: A }));
  });
});

describe('what a refusal says', () => {
  it('names what was handed over in place of an input', () => {
    const got = (input: unknown): string => refusal(() => call(input)).replace('ai-co2: estimate needs an object with "rows". It got ', '');
    expect([5, 'rows', [], null, undefined, true].map(got)).toEqual(['the number 5.', 'the text "rows".', 'a list.', 'null.', 'undefined.', 'true.']);
  });

  it('names the part that should have been a list', () => {
    expect(refusal(() => call({ rows: A, hidden: {} }))).toBe('ai-co2: "hidden" must be a list of pieces of hidden work');
    expect(refusal(() => call({ rows: A, tips: {} }))).toBe('ai-co2: "tips" must be a list of { id, change }');
    expect(refusal(() => call({ rows: A, tips: [SONNET], applied: 'sonnet' }))).toBe('ai-co2: "applied" must be a list of tip ids');
  });

  it('asks for a name where one is empty: a model, a piece of hidden work, a tip', () => {
    expect(refusal(() => estimate({ rows: [{ model: '', sizeClass: 'large', output: 1 }] }))).toBe('ai-co2: "rows": every row needs the model\'s name ("model")');
    expect(refusal(() => estimate({ rows: B, hidden: [{ id: '', slot: 0, amount: [1, 2, 3], rows: [] }] }))).toBe('ai-co2: every piece of hidden work needs an id');
    expect(refusal(() => estimate({ rows: A, tips: [{ id: '', change: SONNET.change }] }))).toBe('ai-co2: every tip needs an id and a "change" function');
  });
});

describe('an overhead or a hardware row', () => {
  const table: AssumptionTable = { ...TABLE, pue: [1, 1.14, 1.17], hardware: [1, 1.115, 1.13] };

  it('may start at exactly 1: nothing is then put on top at its low end', () => {
    // With both factors at 1 and the grid at 350, the market-based line is the result times 70 / 350.
    const result = estimate({ rows: A, table, pins: { pue: 0, hardware: 0, grid: 0.5 } }, { marketGrid: 70 });
    expect((result.market?.mid ?? Number.NaN) / result.range.mid).toBeCloseTo(70 / 350, 12);
    expect((result.market?.p95 ?? Number.NaN) / result.range.p95).toBeCloseTo(70 / 350, 12);
  });

  it('may not start below 1', () => {
    expect(refusal(() => estimate({ rows: A, table: { ...table, pue: [0.99, 1.14, 1.17] } }))).toBe('ai-co2: "pue" is a factor on top, so its low value must be 1 or more');
    expect(refusal(() => estimate({ rows: A, table: { ...table, hardware: [0.99, 1.115, 1.13] } }))).toBe('ai-co2: "hardware" is a factor on top, so its low value must be 1 or more');
  });
});

describe('a saving that is only rounding', () => {
  it('counts as nothing below one part in a million million of the footprint, and as a saving above', () => {
    const everyType = [...TOKEN_TYPES];
    const hair: Tip = { id: 'hair', change: scaleTokens({ types: everyType, factor: 1 - 5e-13 }) };
    const little: Tip = { id: 'little', change: scaleTokens({ types: everyType, factor: 1 - 4e-12 }) };
    const [hairResult, littleResult] = estimate({ rows: A, tips: [hair, little] }).tips;
    expect(hairResult).toMatchObject({ saving: { p5: 0, mid: 0, p95: 0 }, lowestSaving: 0, highestSaving: 0 });
    expect(littleResult?.lowestSaving).toBeGreaterThan(0);
    expect((littleResult?.saving.mid ?? Number.NaN) / estimate({ rows: A }).range.mid).toBeCloseTo(4e-12, 13);
  });
});

describe('the sliders that cannot change the result', () => {
  it('list the pieces that are off in the order of their slots, whatever the order of the list', () => {
    const off = HIDDEN.map((piece) => ({ ...piece, on: false }));
    const bySlot = [...off].sort((a, b) => a.slot - b.slot).map((piece) => `hidden:${piece.id}`);
    expect(bySlot).toHaveLength(3);
    expect(estimate({ rows: B, hidden: off }).inert.slice(-3)).toEqual(bySlot);
    expect(estimate({ rows: B, hidden: off.slice().reverse() }).inert.slice(-3)).toEqual(bySlot);
  });

  it('include the slider of a piece that an applied tip has switched off', () => {
    const noSearch: Tip = { id: 'no-search', change: (usage) => ({ rows: usage.rows, hidden: usage.hidden.map((piece) => (piece.id === 'search' ? { ...piece, on: false } : piece)) }) };
    expect(estimate({ rows: B, hidden: HIDDEN, tips: [noSearch] }).inert).not.toContain('hidden:search');
    const applied = estimate({ rows: B, hidden: HIDDEN, tips: [noSearch], applied: ['no-search'] });
    expect(applied.inert).toContain('hidden:search');
    expect(applied.range).toEqual(estimate({ rows: B, hidden: hiddenWith({ search: { on: false } }) }).range);
  });
});

describe('what a tip returns', () => {
  it('must hold every piece of hidden work: one less at the end, or one more, is refused', () => {
    const dropsLast: Tip = { id: 'drops-last', change: (usage) => ({ rows: usage.rows, hidden: usage.hidden.slice(0, -1) }) };
    const addsOne: Tip = { id: 'adds-one', change: (usage) => ({ rows: usage.rows, hidden: [...usage.hidden, { id: 'more', slot: 5, amount: [1, 2, 3], rows: [] }] }) };
    for (const tip of [dropsLast, addsOne]) {
      expect(refusal(() => estimate({ rows: B, hidden: HIDDEN, tips: [tip] }))).toContain(`ai-co2: tip "${tip.id}" must keep every piece of hidden work, in the same order`);
    }
  });
});

describe('two tips that touch the same tokens', () => {
  const toSmall: Tip = { id: 'to-small', change: moveShare({ where: { sizeClass: 'medium' }, toClass: 'small', share: 0.5 }) };
  const toMedium: Tip = { id: 'to-medium', change: moveShare({ where: { sizeClass: 'small' }, toClass: 'medium', share: 0.5 }) };

  it('are applied in the order of the tip list, whatever the order of "applied"', () => {
    const listed = estimate({ rows: B, tips: [toSmall, toMedium], applied: ['to-small', 'to-medium'] });
    expect(estimate({ rows: B, tips: [toSmall, toMedium], applied: ['to-medium', 'to-small'] })).toStrictEqual(listed);
    expect(estimate({ rows: B, tips: [toSmall, toMedium], applied: ['to-medium', 'to-small', 'to-medium'] })).toStrictEqual(listed);
  });

  it('give another result when the tip list itself has another order', () => {
    const one = estimate({ rows: B, tips: [toSmall, toMedium], applied: ['to-small', 'to-medium'] });
    const other = estimate({ rows: B, tips: [toMedium, toSmall], applied: ['to-small', 'to-medium'] });
    expect(other.range.mid).toBeLessThan(one.range.mid * 0.9);
    expect(other.baseline).toEqual(one.baseline);
  });
});

describe('the values behind a dot', () => {
  it('are refused for a dot that does not exist', () => {
    for (const dot of [-1, 100, 49.5, Number.NaN]) {
      expect(refusal(() => scenarioOfDot({ rows: A }, dot)), `dot ${dot}`).toBe('ai-co2: a dot index runs from 0 to 99');
    }
  });

  it('give that run\'s kg when they are put into the formula by hand, and lie inside low and high', () => {
    const { dots } = estimate({ rows: A });
    for (const dot of [0, 4, 50, 95, 99]) {
      const { run, kg, values } = scenarioOfDot({ rows: A }, dot);
      const { energy, freshInput, cacheWrite, cacheRead, pue, grid, hardware } = values;
      if (typeof energy !== 'object') throw new Error('energy holds one value per model size');
      const one = (value: number | Record<string, number> | undefined): number => (typeof value === 'number' ? value : Number.NaN);
      let wattHours = 0;
      for (const row of A) {
        wattHours += (energy[row.sizeClass] ?? Number.NaN) * ((row.output ?? 0) + one(freshInput) * (row.freshInput ?? 0) + one(cacheWrite) * (row.cacheWrite ?? 0) + one(cacheRead) * (row.cacheRead ?? 0)) / 1000;
      }
      expect(wattHours / 1000 * one(pue) * one(grid) * one(hardware) / 1000 / kg, `dot ${dot}`).toBeCloseTo(1, 12);
      expect(kg).toBeLessThan(dots[dot] ?? -Infinity);
      expect(Number.isInteger(run) && run >= 0 && run < RUNS).toBe(true);
      expect(one(grid)).toBeGreaterThan(TABLE.grid[0]);
      expect(one(grid)).toBeLessThan(TABLE.grid[2]);
      expect(energy.large).toBe(patternValues('energy', TABLE.energy.large)[run]);
    }
  });
});

describe('the ready-made what-ifs', () => {
  // A spec as a caller could misspell it, which the types would not let through.
  const moveWith = (spec: unknown): unknown => moveShare(spec as MoveShareSpec);
  const scaleWith = (spec: unknown): unknown => scaleTokens(spec as ScaleTokensSpec);

  it('refuse a misspelt option at once, before they see a usage', () => {
    expect(refusal(() => moveWith({ toClass: 'medium', share: 0.5, were: { models: ['claude-opus-5-5'] } }))).toBe('ai-co2: moveShare does not take "were". It takes: where, toClass, share, toModel, hidden.');
    expect(refusal(() => moveWith({ toClass: 'medium', share: 0.5, where: { model: 'claude-opus-5-5' } }))).toBe('ai-co2: moveShare: "where" does not take "model". It takes: models, sizeClass, modelIncludes.');
    expect(refusal(() => scaleWith({ types: ['cacheRead'], factor: 0.6, hiddenID: 'thinking' }))).toBe('ai-co2: scaleTokens does not take "hiddenID". It takes: where, types, factor, hiddenId.');
    expect(refusal(() => scaleWith({ types: ['cacheRead'], factor: 0.6, where: { size: 'large' } }))).toContain('scaleTokens: "where" does not take "size"');
  });

  it('refuse a factor below zero and an empty list of token types', () => {
    expect(refusal(() => scaleTokens({ types: ['output'], factor: -0.5 }))).toBe('ai-co2: scaleTokens needs "factor": a number, 0 or more');
    expect(refusal(() => scaleTokens({ types: [], factor: 0.5 }))).toContain('scaleTokens needs "types"');
  });

  it('refuse a spec with a value of the wrong kind', () => {
    expect(refusal(() => moveWith({ share: 0.5 }))).toBe('ai-co2: moveShare needs "toClass": the size class the tokens move to');
    expect(refusal(() => moveWith({ toClass: 'small', share: Number.NaN }))).toBe('ai-co2: moveShare needs "share": a number from 0 to 1');
    expect(refusal(() => moveWith({ toClass: 'small', share: 0.5, toModel: '' }))).toBe('ai-co2: moveShare: "toModel" must be a name');
    expect(refusal(() => moveWith({ toClass: 'small', share: 0.5, hidden: 1 }))).toBe('ai-co2: moveShare: "hidden" must be true or false');
    expect(refusal(() => moveWith({ toClass: 'small', share: 0.5, where: ['claude-opus-5-5'] }))).toBe('ai-co2: moveShare: "where" must be an object such as { models: ["claude-opus-5-5"] }');
    expect(refusal(() => moveWith({ toClass: 'small', share: 0.5, where: { models: 'claude-opus-5-5' } }))).toBe('ai-co2: moveShare: "where.models" must be a list of model names');
    expect(refusal(() => scaleWith({ types: ['output'], factor: 0.5, where: { sizeClass: 3 } }))).toBe('ai-co2: scaleTokens: "where.sizeClass" must be a size class');
    expect(refusal(() => scaleWith({ types: ['output'], factor: 0.5, where: { modelIncludes: 3 } }))).toBe('ai-co2: scaleTokens: "where.modelIncludes" must be text');
    expect(refusal(() => scaleWith({ types: ['output'], factor: 0.5, hiddenId: 0 }))).toBe('ai-co2: scaleTokens: "hiddenId" must be the id of a piece of hidden work');
  });

  it('scaleTokens with a hiddenId changes the rows of that one piece and of no other', () => {
    const halveMemory: Tip = { id: 'memory', change: scaleTokens({ types: [...TOKEN_TYPES], factor: 0.5, hiddenId: 'memory' }) };
    const byHand = HIDDEN.map((piece) => (piece.id === 'memory' ? { ...piece, rows: piece.rows.map((row) => ({ ...row, cacheRead: (row.cacheRead ?? 0) * 0.5 })) } : piece));
    const applied = estimate({ rows: B, hidden: HIDDEN, tips: [halveMemory], applied: ['memory'] });
    const wanted = estimate({ rows: B, hidden: byHand });
    expect(applied.range).toEqual(wanted.range);
    expect(applied.dots).toEqual(wanted.dots);
    expect(applied.range.mid).toBeLessThan(estimate({ rows: B, hidden: HIDDEN }).range.mid);
  });
});

describe('a carried range', () => {
  const spread: Spread = { p5: 1, mid: 2, p95: 3 };
  const dots = [0.5, 1, 1.5, 2, 2.5, 3, 3.5];

  it('is refused when the rule dips by a little between two dots, and passes without the dots', () => {
    const dips = (kg: number): number => (kg === 2.5 ? 1.999 : kg);
    expect(carryThrough(spread, dips)).toEqual(spread);
    expect(() => carryThrough(spread, dips, dots)).toThrow('never goes down');
  });

  it('is refused when the rule gives "not a number"', () => {
    expect(() => carryThrough(spread, (kg) => (kg === 2 ? Number.NaN : kg))).toThrow('never goes down');
    expect(() => carryThrough(spread, (kg) => (kg === 2.5 ? Number.NaN : kg), dots)).toThrow('never goes down');
  });

  it('passes through a rule that stays level, as a price at its minimum does', () => {
    expect(carryThrough(spread, () => 5, dots)).toEqual({ p5: 5, mid: 5, p95: 5 });
  });
});

describe('the chart\'s scale, at its borders', () => {
  const upTo = (top: number): Spread => ({ p5: top / 9, mid: top / 3, p95: top });

  it('has steps that are exactly 1, 2 and 5 times a power of ten, from 1 mg up', () => {
    for (let power = -6; power <= 6; power++) {
      for (const lead of [1, 2, 5]) {
        const step = Number(`${lead}e${power}`);
        expect(fitScale(step / 1.1), `the step of ${step} kg`).toBe(step);
      }
    }
  });

  it('keeps a step that the top with its 8% of room reaches exactly, and takes the next one a hair above', () => {
    const top = 50 / 1.08;
    expect(top * 1.08).toBe(50);
    expect(fitScale(top)).toBe(50);
    expect(fitScale(top * (1 + 1e-12))).toBe(100);
  });

  it('takes the unit from the borders of unitFor in format.ts: grams from 1 g, kilograms from 1 kg', () => {
    for (const top of [0, 0.0000004, 0.000999, 0.001, 0.001001, 0.5, 0.999999, 1, 1.000001, 34, 1200]) {
      expect(nextScale(null, upTo(top), null, false).unit, `a range up to ${top} kg`).toBe(unitFor(upTo(top)));
    }
    expect(nextScale(null, upTo(0.001), null, false).unit).toBe('g');
    expect(nextScale(null, upTo(1), null, false).unit).toBe('kg');
    expect(nextScale(null, upTo(0.0005), upTo(0.001), false).unit).toBe('g');
  });

  it('steps the unit up where the top would print as "1,000": 0.9995 kg is shown in kilograms, 0.9995 g in grams', () => {
    // Just below, at and just above the border, for kilograms and for grams.
    expect(nextScale(null, upTo(0.99949), null, false)).toEqual({ scaleMax: 2, unit: 'g' });
    expect(nextScale(null, upTo(0.9995), null, false)).toEqual({ scaleMax: 2, unit: 'kg' });
    expect(nextScale(null, upTo(0.9996), null, false)).toEqual({ scaleMax: 2, unit: 'kg' });
    expect(nextScale(null, upTo(0.00099949), null, false)).toEqual({ scaleMax: 0.002, unit: 'mg' });
    expect(nextScale(null, upTo(0.0009995), null, false)).toEqual({ scaleMax: 0.002, unit: 'g' });
    expect(nextScale(null, upTo(0.0009996), null, false)).toEqual({ scaleMax: 0.002, unit: 'g' });
    // The ghost of an applied tip counts as the top too.
    expect(nextScale(null, upTo(0.5), upTo(0.9996), false).unit).toBe('kg');
    // Whatever the top, the high end never prints as "1,000" in the unit the scale picked.
    for (let i = 0; i < 3000; i++) {
      const top = 0.998 + i * 1e-6;
      for (const kg of [top, top / 1000]) expect(mass(kg, nextScale(null, upTo(kg), null, false).unit), String(kg)).not.toBe('1,000');
    }
  });

  it('refuses a top that is not a mass, where the search for a step would end on the first one or on none', () => {
    for (const top of [Number.NaN, Infinity]) {
      expect(refusal(() => fitScale(top)), `fitScale(${top})`).toBe('ai-co2: fitScale needs a mass in kg, 0 or more');
      expect(refusal(() => nextScale(null, upTo(top), null, false)), `nextScale up to ${top}`).toBe('ai-co2: fitScale needs a mass in kg, 0 or more');
    }
    expect(refusal(() => fitScale(-0.001))).toBe('ai-co2: fitScale needs a mass in kg, 0 or more');
  });
});
