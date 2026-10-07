// What the estimator takes and what it returns.
//
// Units: tokens are plain counts. Energy is Wh per 1,000 output tokens. Grid is g CO2e per kWh.
// Every mass is in kg CO2e.

import type { Spread } from '../contracts/usage';
import type { Triple } from '../track';
import type { FixedSliderId } from './table';

export type { Spread, Triple };

export type TokenType = 'freshInput' | 'cacheWrite' | 'cacheRead' | 'output';

/** Token counts of one model. A row may carry other keys, a display name say. They are ignored. */
export interface Row {
  /** The model's name, exactly as the person's data spells it. */
  readonly model: string;
  /**
   * A key of the table's `energy`: "small", "medium", "large" or "fable" in the built-in table.
   * A class the table does not have is refused, so a model that fits no size needs a row of its own
   * in `table.energy`.
   */
  readonly sizeClass: string;
  readonly freshInput?: number;
  readonly cacheWrite?: number;
  readonly cacheRead?: number;
  readonly output?: number;
}

/** ChatGPT only: work the export does not show. */
export interface HiddenWork {
  /** For example "thinking". Its slider is called "hidden:thinking". */
  readonly id: string;
  /** Its place in the pattern, 0 to 5. Fixed once per kind of hidden work, never taken from the list order. */
  readonly slot: number;
  /** false: these tokens are not counted at all. Left out: counted. */
  readonly on?: boolean;
  /** How many times the rows are counted: low, typical, high. */
  readonly amount: Triple;
  /** What one unit of `amount` stands for, by model and token type. */
  readonly rows: readonly Row[];
}

/** What is counted: the visible rows and every piece of hidden work, switched on or off. */
export interface TokenUsage {
  readonly rows: readonly Row[];
  readonly hidden: readonly HiddenWork[];
}

/** A slider's id: one of the seven in SLIDER_IDS, or "hidden:<id>" for a piece of hidden work. */
export type SliderId = FixedSliderId | `hidden:${string}`;

/**
 * A slider the person has set. A number is a track position from 0 to 1, never the assumption's own
 * value: a bare 0.015 is read as a position near low, and a bare 350 is refused. A value is handed
 * over as `{ value }`, and must lie between the assumption's low and high. For "energy", `sizeClass`
 * says which model size the value is for.
 */
export type Pin = number | { readonly value: number; readonly sizeClass?: string };

/**
 * The sliders the person has set, by slider id. A slider that is left out or null is not set: its
 * assumption varies between low and high. That is not the same as a slider set to typical.
 */
export type Pins = Readonly<Partial<Record<SliderId, Pin | null>>>;

/** An explicit what-if. `change` returns a new usage and never edits the one it is given. */
export interface Tip {
  readonly id: string;
  readonly change: (usage: TokenUsage) => TokenUsage;
}

/** The assumption table. Every entry is [low, typical, high]. */
export interface AssumptionTable {
  /** Wh per 1,000 output tokens at the data centre's IT load, by model size. */
  readonly energy: Readonly<Record<string, Triple>>;
  /** Weight of the other token types, relative to one output token. */
  readonly freshInput: Triple;
  readonly cacheWrite: Triple;
  readonly cacheRead: Triple;
  /** Data-centre overhead (PUE). */
  readonly pue: Triple;
  /** Grid, location-based, in g CO2e per kWh. */
  readonly grid: Triple;
  /** Hardware manufacturing, as a factor on top. */
  readonly hardware: Triple;
}

export interface EstimateInput {
  /** The person's token counts by model. An empty list means no tokens. */
  readonly rows: readonly Row[];
  /** ChatGPT only. Every piece, switched on or off, each with its slot. */
  readonly hidden?: readonly HiddenWork[] | null;
  readonly pins?: Pins | null;
  /**
   * Every tip the page offers for this usage, always in the same order, never in the order they are
   * shown: with two tips applied, the order of this list can decide the result.
   */
  readonly tips?: readonly Tip[] | null;
  /** Ids of the tips that are switched on. They are applied in the order of `tips`. */
  readonly applied?: readonly string[] | null;
  /** Another assumption table. Default: TABLE. */
  readonly table?: AssumptionTable | null;
}

export interface EstimateOptions {
  /**
   * false leaves out each tip's own saving range, for example while a slider is dragged. The result
   * then has an empty `tips`, so the page keeps the savings of the last full call.
   */
  readonly tips?: boolean;
  /** false leaves out the two extra passes for the biggest unknown. */
  readonly biggestUnknown?: boolean;
  /** g per kWh, for example 70: also work out the market-based line. */
  readonly marketGrid?: number | null;
}

/** Every assumption that is not pinned at its low, and at its high. No run can fall outside. */
export interface ExtremeRange {
  low: number;
  high: number;
}

/** One tip, worked out on its own against the usage without any tip. */
export interface TipResult {
  id: string;
  applied: boolean;
  /** In 90 of 100 possible outcomes the footprint would have been p5 to p95 kg lower. */
  saving: Spread;
  /** The smallest and the biggest saving in any run. A negative smallest saving means the tip can cost more. */
  lowestSaving: number;
  highestSaving: number;
  /** The likely range and the middle estimate with this tip alone. */
  after: Spread;
}

/** A share of the result with every assumption at typical, pinned sliders at their pinned value. */
export interface RowShare {
  model: string;
  sizeClass: string;
  kg: number;
  /** 0 to 1. */
  share: number;
}

export interface HiddenShare {
  id: string;
  kg: number;
  /** 0 to 1. A share of 0 means there is nothing to count for that piece. */
  share: number;
}

export interface Shares {
  /**
   * By visible row of the usage the page shows now, with the applied tips. A tip can split a row in
   * two, and a row's hidden work is not in it. For the page's list of models use `models`.
   */
  rows: RowShare[];
  /** By piece of hidden work that is switched on, for the usage the page shows now. */
  hidden: HiddenShare[];
  /** By model of the usage as counted, with no tip. Each model includes its part of the hidden work. */
  models: RowShare[];
}

/** One slider that is not set and changes the result: the result with it at low and at high, the rest at typical. */
export interface Unknown {
  id: string;
  low: number;
  high: number;
  /** high − low, in kg. */
  swing: number;
  /** high ÷ low. */
  ratio: number;
}

export interface BiggestUnknown {
  id: string;
  /** The middle estimate with that one slider set to low, and to high. */
  middleAtLow: number;
  middleAtHigh: number;
}

/** Everything in kg CO2e, except `car` and `carExtreme` in km, shares as fractions, `pins` as track positions, and counts. */
export interface Estimate {
  runs: number;
  /** The likely range and the middle estimate, with the applied tips. */
  range: Spread;
  /** 100 values, lowest first. Dots 0 to 4 and 95 to 99 lie outside the likely range. */
  dots: number[];
  lowestRun: number;
  highestRun: number;
  extreme: ExtremeRange;
  /** Every assumption that is not pinned at its typical value. */
  allTypical: number;
  /** How many of the 10,000 results lie above `allTypical`. With one outcome, none does. */
  runsAboveAllTypical: number;
  /** true when nothing varies any more: every assumption that matters is pinned, or there are no tokens. */
  single: boolean;
  /** The same range as kilometres in a new petrol car. */
  car: Spread;
  carExtreme: ExtremeRange;
  /** The range without the applied tips, while at least one tip is applied. Otherwise null. */
  baseline: Spread | null;
  /** The market-based line, when `marketGrid` is given. Otherwise null. */
  market: Spread | null;
  /** One entry per tip, in the order of the tip list. Empty when the option `tips` is false. */
  tips: TipResult[];
  shares: Shares;
  /** The sliders the person has set, as track positions. */
  pins: Record<string, number>;
  /** What moves the result most, biggest swing first. One entry per slider that is not set and changes the result. */
  unknowns: Unknown[];
  /** Every slider, set or not, that cannot change this result. For example cacheWrite without cache writes. */
  inert: string[];
  /** For the first entry of `unknowns`. null when there is none, or when the option `biggestUnknown` is false. */
  biggestUnknown: BiggestUnknown | null;
}

/** The assumption values behind one dot: one way this outcome can come about. Many other combinations give the same total. */
export interface DotScenario {
  /** Which of the 10,000 runs, 0 to 9,999. */
  run: number;
  kg: number;
  /** By slider id. `energy` holds one value per model size. */
  values: Record<string, number | Record<string, number>>;
}

/** Which rows a what-if is meant for. Left out: all of them. */
export interface RowFilter {
  /** The exact names the person used. Prefer this. */
  readonly models?: readonly string[];
  readonly sizeClass?: string;
  /**
   * A text search that ignores capitals. It also finds rows that another tip has moved and renamed,
   * so two tips that use it can give another result when their order changes.
   */
  readonly modelIncludes?: string;
}

export interface MoveShareSpec {
  readonly where?: RowFilter;
  /** The size class the tokens move to. */
  readonly toClass: string;
  /** 0 to 1. */
  readonly share: number;
  /** A name for the moved rows. */
  readonly toModel?: string;
  /** true: the rows of every piece of hidden work move too. A model tip for ChatGPT needs this. */
  readonly hidden?: boolean;
}

export interface ScaleTokensSpec {
  readonly where?: RowFilter;
  readonly types: readonly TokenType[];
  /** 0 to 1 to cut tokens. */
  readonly factor: number;
  /** Apply it to the rows of this piece of hidden work, not to the visible rows. */
  readonly hiddenId?: string;
}
