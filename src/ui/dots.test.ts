import { describe, expect, it } from 'vitest';
import { beyondScale, dotSizes, layoutDots, MAX_STACK, rowsFor, type DotsGeometry } from './dots';

const geometry: DotsGeometry = { width: 1000, scaleMax: 50, step: 10, gutter: 26, rows: 12 };

describe('layoutDots', () => {
  it('puts each value in the column nearest to it', () => {
    const layout = layoutDots([0, 5, 25, 50], geometry);
    expect(layout.x).toEqual([0, 100, 500, 1000]);
    expect(layout.y).toEqual([0, 0, 0, 0]);
  });

  it('stacks values that share a column, in the order they come', () => {
    const layout = layoutDots([10, 10.1, 10.2, 30], geometry);
    expect(layout.x).toEqual([200, 200, 200, 600]);
    expect(layout.y).toEqual([0, 10, 20, 0]);
    expect(layout.tallest).toBe(3);
  });

  it('stacks values above the top of the scale in the gutter past its end', () => {
    const layout = layoutDots([49, 50, 51, 80, 1000], geometry);
    expect(layout.beyond).toBe(3);
    expect(layout.x.slice(2)).toEqual([1013, 1013, 1013]);
    expect(layout.y.slice(2)).toEqual([0, 10, 20]);
    // The top of the scale itself is still on the scale.
    expect(layout.x[1]).toBe(1000);
  });

  it('gives the same layout for the same input every time', () => {
    const values = Array.from({ length: 100 }, (_, i) => 3 + (i * i) / 180);
    const first = layoutDots(values, geometry);
    expect(layoutDots(values, geometry)).toEqual(first);
    expect(layoutDots([...values], { ...geometry })).toEqual(first);
  });

  it('never stacks higher than the rows it is given: a full column spills into its neighbours', () => {
    const layout = layoutDots(Array.from({ length: 100 }, () => 20), geometry);
    expect(layout.tallest).toBe(12);
    expect(Math.max(...layout.y)).toBe(110);
    const columns = new Set(layout.x);
    expect(columns.size).toBe(Math.ceil(100 / 12));
    // The pile stays centred on the value: as many columns to its left as to its right, give or take one.
    const centre = 400;
    const left = [...columns].filter(x => x < centre).length;
    const right = [...columns].filter(x => x > centre).length;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it('keeps every dot on the scale when the pile sits at its start', () => {
    const layout = layoutDots(Array.from({ length: 100 }, () => 0), geometry);
    expect(Math.min(...layout.x)).toBe(0);
    expect(layout.tallest).toBe(12);
  });

  it('treats values that are not numbers, or below zero, as zero', () => {
    const layout = layoutDots([Number.NaN, -4, Number.POSITIVE_INFINITY], geometry);
    expect(layout.x).toEqual([0, 0, 0]);
    expect(layout.beyond).toBe(0);
  });
});

describe('dotSizes and rowsFor', () => {
  it('uses smaller dots in a narrow chart', () => {
    expect(dotSizes(1100)).toEqual({ dot: 12, step: 15, gutter: 26 });
    expect(dotSizes(700)).toEqual({ dot: 10, step: 13, gutter: 24 });
    expect(dotSizes(320)).toEqual({ dot: 8, step: 10, gutter: 22 });
  });

  it('gives a narrow chart more rows, and never more than twelve', () => {
    expect(rowsFor(1082, 15)).toBe(11);
    expect(rowsFor(296, 10)).toBe(MAX_STACK);
    expect(rowsFor(100, 10)).toBe(MAX_STACK);
    expect(rowsFor(4000, 15)).toBe(8);
    expect(MAX_STACK).toBe(12);
  });
});

describe('beyondScale', () => {
  it('counts the values past the end of the scale and finds the highest', () => {
    expect(beyondScale([1, 49, 50, 50.01, 61.3, 55], 50)).toEqual({ count: 3, highest: 61.3 });
    expect(beyondScale([1, 49, 50], 50)).toEqual({ count: 0, highest: 0 });
    expect(beyondScale([Number.NaN, Number.POSITIVE_INFINITY, 70], 50)).toEqual({ count: 1, highest: 70 });
  });
});
