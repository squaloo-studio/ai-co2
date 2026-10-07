import { describe, expect, it } from 'vitest';
import { positionOf, valueAt, type Triple } from './track';

const ENERGY: Triple = [0.5, 1.0, 5.4];
const CACHE_READ: Triple = [0.001, 0.015, 0.1];

describe('valueAt', () => {
  it('puts low, typical and high at the left end, the middle and the right end', () => {
    expect(valueAt(ENERGY, 0)).toBe(0.5);
    expect(valueAt(ENERGY, 0.5)).toBe(1.0);
    expect(valueAt(ENERGY, 1)).toBe(5.4);
  });
  it('moves in equal ratio steps on each side', () => {
    expect(valueAt([1, 4, 64], 0.25)).toBeCloseTo(2, 12);
    expect(valueAt([1, 4, 64], 0.75)).toBeCloseTo(16, 12);
  });
  it('never leaves the track', () => {
    expect(valueAt(ENERGY, -3)).toBe(0.5);
    expect(valueAt(ENERGY, 7)).toBe(5.4);
    expect(valueAt(ENERGY, Number.NaN)).toBe(0.5);
  });
});

describe('positionOf', () => {
  it('is the way back from valueAt', () => {
    for (const triple of [ENERGY, CACHE_READ]) {
      for (let i = 0; i <= 1000; i++) {
        const position = i / 1000;
        expect(positionOf(triple, valueAt(triple, position))).toBeCloseTo(position, 12);
      }
    }
  });
  it('lands on the ends for values off the track', () => {
    expect(positionOf(CACHE_READ, 0)).toBe(0);
    expect(positionOf(CACHE_READ, 5)).toBe(1);
    expect(positionOf(CACHE_READ, Number.NaN)).toBe(0);
  });
});
