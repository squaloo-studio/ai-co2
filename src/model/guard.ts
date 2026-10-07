// The small checks behind every refusal. The estimator refuses what it cannot count, with an error
// that starts with "ai-co2:". It does not guess and it does not clamp.

import type { Triple } from '../track';

export function fail(message: string): never {
  throw new Error(`ai-co2: ${message}`);
}

export const isList = (x: unknown): x is readonly unknown[] => Array.isArray(x);

export const isRecord = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);

/** true for { ... } and for nothing else: not for a list, a Map, a class instance or text. */
export function isPlain(x: unknown): x is Record<string, unknown> {
  if (!isRecord(x)) return false;
  const proto: unknown = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

// A misspelt key would otherwise be ignored without a word.
export function onlyKeys(object: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) fail(`${what} does not take "${key}". It takes: ${allowed.join(', ')}.`);
  }
}

export function describe(x: unknown): string {
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'a list';
  if (typeof x === 'string') return `the text "${x}"`;
  return `${typeof x === 'number' ? 'the number ' : ''}${String(x)}`;
}

/** What went wrong inside a tip, without the "ai-co2:" that the outer message adds again. */
export function reasonOf(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : undefined;
  return String(message !== undefined ? message : error).replace(/^ai-co2: /, '');
}

function isTriple(x: unknown): x is Triple {
  if (!isList(x) || x.length !== 3) return false;
  const [low, typical, high] = x;
  return typeof low === 'number' && typeof typical === 'number' && typeof high === 'number'
    && Number.isFinite(low) && Number.isFinite(typical) && Number.isFinite(high)
    && low > 0 && low < typical && typical < high
    && Number.isFinite(typical / low) && Number.isFinite(high / typical);
}

/**
 * A row of the table must be three different numbers in rising order. Low equal to typical is refused:
 * half of the runs must use a value below typical, and the thumb of an untouched slider must sit in the
 * middle of its track.
 */
export function checkTriple(triple: unknown, name: string): asserts triple is Triple {
  if (!isTriple(triple)) fail(`"${name}" needs [low, typical, high] with 0 < low < typical < high`);
}
