// The constants of the estimate. All of them are frozen: nobody who imports them can change a later result.

import type { AssumptionTable, TokenType } from './types';

/** How many possible outcomes are worked out: 100 groups of 100. */
export const RUNS = 10000;
/** How many dots the chart shows. Dots 0 to 4 and 95 to 99 are the hollow ones. */
export const DOTS = 100;
export const RUNS_PER_DOT = RUNS / DOTS;

/** A new petrol car in real driving: 160 g CO2 per km from the exhaust. A constant, not an uncertainty. */
export const CAR_KG_PER_KM = 0.16;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

/** The assumption table. Every entry is [low, typical, high]. */
export const TABLE = deepFreeze({
  // Wh per 1,000 output tokens at the data centre's IT load, by model size.
  // "fable" is a large model whose high end is twice the large high end.
  energy: {
    small: [0.05, 0.1, 0.4],
    medium: [0.2, 0.6, 2.2],
    large: [0.5, 1.0, 5.4],
    fable: [0.5, 1.0, 10.8],
  },
  // Weight of the other token types, relative to one output token.
  freshInput: [0.03, 0.15, 0.35],
  cacheWrite: [0.03, 0.15, 0.45],
  cacheRead: [0.001, 0.015, 0.1],
  // Data-centre overhead (PUE).
  pue: [1.09, 1.14, 1.17],
  // Grid, location-based, in g CO2e per kWh.
  grid: [270, 350, 460],
  // Hardware manufacturing, as a factor on top. The sources give +10% to +13% and no typical value.
  // The middle, +11.5%, is a choice made here.
  hardware: [1.10, 1.115, 1.13],
} as const satisfies AssumptionTable);

/** The token types, in the order they are stored and added up. */
export const TOKEN_TYPES = Object.freeze(['freshInput', 'cacheWrite', 'cacheRead', 'output'] as const);

export const isTokenType = (key: unknown): key is TokenType => (TOKEN_TYPES as readonly unknown[]).includes(key);

/** The sliders that every source has. Hidden work adds one more each, called "hidden:<id>". */
export const SLIDER_IDS = Object.freeze(['energy', 'freshInput', 'cacheWrite', 'cacheRead', 'pue', 'grid', 'hardware'] as const);

export type FixedSliderId = (typeof SLIDER_IDS)[number];

/** A difference between two footprints that is smaller than this share of the footprint is rounding. */
export const ROUNDING = 1e-12;
