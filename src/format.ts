// How numbers are printed. The logic side and the page side both use these, so a number reads
// the same in a sentence, on the chart and in the floating pill.

import type { MassUnit } from './contracts/view';
import type { Spread } from './contracts/usage';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Below 1: two decimals. Below 10: one decimal. From 10: whole numbers, with commas from 1,000.
 * Trailing zeros are dropped. The second decimal keeps a small low end from printing as "0".
 */
export function plainNumber(x: number): string {
  if (!Number.isFinite(x)) return '–';
  const a = Math.abs(x);
  if (a < 1) return String(Math.round(x * 100) / 100);
  if (a < 10) return String(Math.round(x * 10) / 10);
  return Math.round(x).toLocaleString('en');
}

/** How many of each unit make one kilogram. */
export const PER_KG: Readonly<Record<MassUnit, number>> = { kg: 1, g: 1000, mg: 1_000_000 };

/**
 * The unit that suits one mass: milligrams below one gram, grams below one kilogram, kilograms from
 * there. The border is where the number is printed, not where it is worked out: 0.9996 kg would print
 * as "1,000 g", so it is "1 kg". Every place that picks a unit asks here.
 */
export function unitOf(kg: number): MassUnit {
  if (kg * PER_KG.mg < 999.5) return 'mg';
  return kg * PER_KG.g < 999.5 ? 'g' : 'kg';
}

/** The unit for a range: the one that suits its high end. */
export function unitFor(range: Pick<Spread, 'p95'>): MassUnit {
  return unitOf(range.p95);
}

/** A mass given in kilograms, printed in `unit`, without the unit's name. */
export function mass(kg: number, unit: MassUnit): string {
  return plainNumber(kg * PER_KG[unit]);
}

/** true when two masses print as the same number, so a range between them has no visible width. */
export function printsSame(aKg: number, bKg: number, unit: MassUnit): boolean {
  return mass(aKg, unit) === mass(bKg, unit);
}

/** "3.7–34 kg" */
export function massRange(range: Pick<Spread, 'p5' | 'p95'>, unit: MassUnit): string {
  return `${mass(range.p5, unit)}–${mass(range.p95, unit)} ${unit}`;
}

/** A single mass in the unit that suits it, with the unit's name: "31 g", "15 kg". */
export function massWithUnit(kg: number): string {
  const unit = unitOf(kg);
  return `${mass(kg, unit)} ${unit}`;
}

/**
 * Two masses that can lie far apart, each in the unit that suits it: "1–260 kg", "31 g to 15 kg".
 * For the extreme range, whose low end would lose its digits in the high end's unit.
 */
export function massSpan(lowKg: number, highKg: number): string {
  const low = massWithUnit(lowKg);
  const high = massWithUnit(highKg);
  const unit = high.slice(high.lastIndexOf(' ') + 1);
  return low.endsWith(` ${unit}`) ? `${low.slice(0, -unit.length - 1)}–${high}` : `${low} to ${high}`;
}

/**
 * The change between two shown numbers, e.g. "−2 kg" or "+0.3 kg". Works from the printed values,
 * each read in the unit it was shown in, so the chip always equals the difference the reader can see.
 * `fromUnit` is the unit the earlier number was shown in, when it differs. null when nothing changed on screen.
 */
export function massChange(fromKg: number, toKg: number, unit: MassUnit, fromUnit: MassUnit = unit): string | null {
  const shown = (kg: number, u: MassUnit) => Number(mass(kg, u).replace(/,/g, ''));
  const before = (shown(fromKg, fromUnit) * PER_KG[unit]) / PER_KG[fromUnit];
  const d = Math.round((shown(toKg, unit) - before) * 100) / 100;
  if (!d) return null;
  return `${d < 0 ? '−' : '+'}${Math.abs(d).toLocaleString('en', { maximumFractionDigits: 2 })} ${unit}`;
}

/** Kilometres, rounded to the nearest 10 from 100 km and to whole kilometres below. */
export function km(x: number): string {
  if (!Number.isFinite(x)) return '–';
  if (x < 10) return plainNumber(x);
  return (x < 100 ? Math.round(x) : Math.round(x / 10) * 10).toLocaleString('en');
}

export type DistanceUnit = 'km' | 'm';

/** Metres when the far end of the range is under one kilometre, otherwise kilometres. */
export function distanceUnitFor(range: Spread): DistanceUnit {
  return range.p95 < 1 ? 'm' : 'km';
}

/** A distance given in kilometres, printed in `unit`, without the unit's name. */
export function distance(kilometres: number, unit: DistanceUnit): string {
  return km(unit === 'm' ? kilometres * 1000 : kilometres);
}

/** Euros: cents below 1, one decimal below 10, whole euros from 10. Without the sign. */
export function euros(x: number): string {
  if (!Number.isFinite(x)) return '–';
  if (x < 1) return x.toFixed(2);
  if (x < 10) return x.toFixed(1).replace(/\.0$/, '');
  return Math.round(x).toLocaleString('en');
}

/**
 * An assumption's value for its slider: at least `decimals` decimals, and more when fewer would show
 * less than two meaningful digits ("0.0010", "0.015", "0.50", "1.115", "350").
 */
export function assumptionValue(x: number, decimals: number): string {
  if (!Number.isFinite(x)) return '–';
  const magnitude = x === 0 ? 0 : Math.floor(Math.log10(Math.abs(x)));
  const digits = Math.min(8, Math.max(decimals, 1 - magnitude, 0));
  return x.toLocaleString('en', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * A share from 0 to 1 as whole per cent: "82%". A share that is small but not nothing reads "<1%",
 * and one that is nearly but not quite everything reads ">99%", so the two can stand side by side.
 */
export function percent(share: number): string {
  if (!Number.isFinite(share)) return '–';
  if (share > 0 && share < 0.005) return '<1%';
  if (share < 1 && share >= 0.995) return '>99%';
  return `${Math.round(share * 100)}%`;
}

/** Money without the sign: a whole amount prints without decimals ("18"), any other with two ("17.50"). */
export function money(amount: number): string {
  if (!Number.isFinite(amount)) return '–';
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  return amount.toLocaleString('en', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

// A count is named after the largest of these that it reaches. Each starts where the one below would
// print "1,000": 999.5 million is "1.00 billion", never "1,000 million".
const COUNT_NAMES: ReadonlyArray<{ from: number; size: number; name: string }> = [
  { from: 999_500_000_000, size: 1e12, name: 'trillion' },
  { from: 999_500_000, size: 1e9, name: 'billion' },
  { from: 999_999.5, size: 1e6, name: 'million' },
];

/**
 * A number of tokens. Below a million every digit is printed: "12,400". From a million on, three
 * meaningful digits: "1.40 million", "21.4 million", "781 million", "1.10 billion". So a row of 1.4
 * million and a row of 1.6 million do not both read "1 million" under a headline of "3 million".
 */
export function tokenCount(n: number): string {
  if (!Number.isFinite(n)) return '–';
  for (const { from, size, name } of COUNT_NAMES) {
    if (n < from) continue;
    const x = n / size;
    const decimals = x < 9.995 ? 2 : x < 99.95 ? 1 : 0;
    return `${x.toLocaleString('en', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${name}`;
  }
  return Math.round(n).toLocaleString('en');
}

/** "2026-08-30" becomes "30 Aug". */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  const month = m ? MONTHS[m - 1] : undefined;
  return month && d ? `${d} ${month}` : iso;
}

/** "2026-08-30" becomes "30 Aug 2026". */
export function longDate(iso: string): string {
  const [y] = iso.split('-');
  return `${shortDate(iso)} ${y}`;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "March 2023", from a time in Unix seconds, in the browser's own time zone. */
export function monthYear(seconds: number): string {
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? '–' : `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}
