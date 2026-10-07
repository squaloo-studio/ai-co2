import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isDay, localDay, windowEndingOn } from './days';

describe('calendar days', () => {
  it('steps over the end of a month, a year and a leap day', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-10-07', 0)).toBe('2026-10-07');
  });

  it('counts the days between two days, either way round', () => {
    expect(daysBetween('2026-09-08', '2026-10-07')).toBe(29);
    expect(daysBetween('2026-10-07', '2026-09-08')).toBe(-29);
    expect(daysBetween('2026-10-07', '2026-10-07')).toBe(0);
    // A change to summer time lies between these two. A day is still a day.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('gives the 30 days that end on a day, both ends counted', () => {
    const window = windowEndingOn('2026-10-07');
    expect(window).toEqual({ from: '2026-09-08', to: '2026-10-07' });
    expect(daysBetween(window.from, window.to) + 1).toBe(30);
  });

  it('knows a real day from a text that only looks like one', () => {
    expect(isDay('2026-10-07')).toBe(true);
    for (const not of ['2026-09-31', '2026-13-01', '26-10-07', 'today', '', null, undefined, 20261007]) expect(isDay(not)).toBe(false);
  });

  it('never makes a number that is none out of a text that is no day', () => {
    expect(addDays('today', 3)).toBe('today');
    expect(addDays('2026-10-07', Number.NaN)).toBe('2026-10-07');
    expect(daysBetween('', '2026-10-07')).toBe(0);
    expect(daysBetween('2026-10-07', '2026-09-31')).toBe(0);
  });

  it('reads the local date off the clock', () => {
    const noon = new Date(2026, 9, 7, 12, 0, 0).getTime();
    expect(localDay(noon)).toBe('2026-10-07');
    expect(localDay(new Date(2026, 0, 1, 0, 0, 1).getTime())).toBe('2026-01-01');
    expect(localDay(new Date(2026, 11, 31, 23, 59, 59).getTime())).toBe('2026-12-31');
  });
});
