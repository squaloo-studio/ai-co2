import { describe, expect, it } from 'vitest';
import {
  assumptionValue,
  distance,
  distanceUnitFor,
  euros,
  km,
  longDate,
  mass,
  massChange,
  massRange,
  massSpan,
  massWithUnit,
  money,
  monthYear,
  percent,
  plainNumber,
  printsSame,
  shortDate,
  tokenCount,
  unitFor,
  unitOf,
} from './format';

describe('plainNumber', () => {
  it('keeps one decimal below 10 and drops a trailing zero', () => {
    expect(plainNumber(4.24)).toBe('4.2');
    expect(plainNumber(5)).toBe('5');
    expect(plainNumber(9.96)).toBe('10');
  });
  it('keeps two decimals below 1, so a small low end does not print as nothing', () => {
    expect(plainNumber(0.6)).toBe('0.6');
    expect(plainNumber(0.726)).toBe('0.73');
    expect(plainNumber(0.0312)).toBe('0.03');
    expect(plainNumber(0.996)).toBe('1');
    expect(plainNumber(0.004)).toBe('0');
  });
  it('uses whole numbers from 10 and commas from 1,000', () => {
    expect(plainNumber(10.4)).toBe('10');
    expect(plainNumber(43.5)).toBe('44');
    expect(plainNumber(12345.6)).toBe('12,346');
  });
  it('never prints NaN', () => {
    expect(plainNumber(Number.NaN)).toBe('–');
  });
});

describe('mass', () => {
  it('prints grams when the high end is under a kilogram', () => {
    const range = { p5: 0.03, mid: 0.12, p95: 0.4 };
    expect(unitFor(range)).toBe('g');
    expect(massRange(range, 'g')).toBe('30–400 g');
    expect(mass(0.0042, 'g')).toBe('4.2');
  });
  it('prints kilograms otherwise', () => {
    const range = { p5: 3.7, mid: 9.8, p95: 34 };
    expect(unitFor(range)).toBe('kg');
    expect(massRange(range, 'kg')).toBe('3.7–34 kg');
  });
  it('prints milligrams when the high end is under a gram', () => {
    const range = { p5: 0.00001, mid: 0.00004, p95: 0.00014 };
    expect(unitFor(range)).toBe('mg');
    expect(massRange(range, 'mg')).toBe('10–140 mg');
  });
  it('picks the unit where the number is printed: a mass never reads "1,000 g" or "1,000 mg"', () => {
    // Just below, at and just above 0.9995 of a kilogram and of a gram.
    expect(unitOf(0.99949)).toBe('g');
    expect(massWithUnit(0.99949)).toBe('999 g');
    expect(unitOf(0.9995)).toBe('kg');
    expect(massWithUnit(0.9995)).toBe('1 kg');
    expect(massWithUnit(0.9996)).toBe('1 kg');
    expect(unitOf(1)).toBe('kg');
    expect(unitOf(0.00099949)).toBe('mg');
    expect(massWithUnit(0.00099949)).toBe('999 mg');
    expect(unitOf(0.0009995)).toBe('g');
    expect(massWithUnit(0.0009995)).toBe('1 g');
    expect(massWithUnit(0.0009996)).toBe('1 g');
    expect(unitOf(0.001)).toBe('g');
    expect(unitOf(0)).toBe('mg');
    // A range follows its high end, and both ends are printed in that unit.
    const range = { p5: 0.188, mid: 0.4, p95: 0.99975 };
    expect(unitFor(range)).toBe('kg');
    expect(massRange(range, unitFor(range))).toBe('0.19–1 kg');
    expect(massSpan(0.3, 0.9996)).toBe('300 g to 1 kg');
    for (let i = 0; i < 4000; i++) {
      const kg = 0.9985 + i * 5e-7;
      expect(massWithUnit(kg), String(kg)).not.toMatch(/^1,000 /);
      expect(massWithUnit(kg / 1000), String(kg / 1000)).not.toMatch(/^1,000 /);
    }
  });
  it('knows when a range has no visible width', () => {
    expect(printsSame(8.56, 8.64, 'kg')).toBe(true);
    expect(printsSame(8.5, 8.65, 'kg')).toBe(false);
  });
});

describe('massChange', () => {
  it('equals the difference between the two printed numbers', () => {
    expect(massChange(9.8, 7.84, 'kg')).toBe('−2 kg');
    expect(massChange(7.84, 6.26, 'kg')).toBe('−1.5 kg');
    expect(massChange(8.74, 10.4, 'kg')).toBe('+1.3 kg');
    expect(massChange(1.8, 1.48, 'kg')).toBe('−0.3 kg');
  });
  it('is null when both print the same', () => {
    expect(massChange(13.2, 13.4, 'kg')).toBeNull();
  });
  it('works in grams', () => {
    expect(massChange(0.12, 0.1, 'g')).toBe('−20 g');
  });
  it('still matches the screen when the unit changes between the two numbers', () => {
    // "0.43 kg" was on screen, "180 g" is on screen now.
    expect(massChange(0.43, 0.18, 'g', 'kg')).toBe('−250 g');
    expect(massChange(0.355, 0.4, 'kg', 'g')).toBe('+0.05 kg');
  });
  it('never rounds the difference itself', () => {
    expect(massChange(125, 9.5, 'kg')).toBe('−115.5 kg');
    expect(massChange(0.43, 0.38, 'kg')).toBe('−0.05 kg');
  });
});

describe('masses far apart', () => {
  it('gives each end the unit that suits it', () => {
    expect(massWithUnit(0.0312)).toBe('31 g');
    expect(massWithUnit(15.2)).toBe('15 kg');
    expect(massSpan(0.0312, 15.2)).toBe('31 g to 15 kg');
    expect(massSpan(0.997, 259.6)).toBe('997 g to 260 kg');
    expect(massSpan(1.2, 259.6)).toBe('1.2–260 kg');
    expect(massSpan(0.029, 1.12)).toBe('29 g to 1.1 kg');
    expect(massSpan(0.000173, 0.0162)).toBe('173 mg to 16 g');
  });
});

describe('other units', () => {
  it('prints kilometres', () => {
    expect(km(61.1)).toBe('61');
    expect(km(214.1)).toBe('210');
    expect(km(3.14)).toBe('3.1');
  });
  it('prints short distances in metres', () => {
    const far = { p5: 23, mid: 61, p95: 214 };
    const near = { p5: 0.0032, mid: 0.0066, p95: 0.018 };
    expect(distanceUnitFor(far)).toBe('km');
    expect(distance(far.p95, 'km')).toBe('210');
    expect(distanceUnitFor(near)).toBe('m');
    expect(distance(near.p5, 'm')).toBe('3.2');
    expect(distance(near.p95, 'm')).toBe('18');
  });
  it('prints euros', () => {
    expect(euros(0.5)).toBe('0.50');
    expect(euros(3.01)).toBe('3');
    expect(euros(4.26)).toBe('4.3');
    expect(euros(20.64)).toBe('21');
  });
  it('prints assumption values with at least two meaningful digits', () => {
    expect(assumptionValue(0.001, 2)).toBe('0.0010');
    expect(assumptionValue(0.015, 2)).toBe('0.015');
    expect(assumptionValue(0.1, 2)).toBe('0.10');
    expect(assumptionValue(0.5, 1)).toBe('0.50');
    expect(assumptionValue(5.4, 1)).toBe('5.4');
    expect(assumptionValue(1.115, 3)).toBe('1.115');
    expect(assumptionValue(350, 0)).toBe('350');
    expect(assumptionValue(25000, 0)).toBe('25,000');
  });
  it('prints shares', () => {
    expect(percent(0.825)).toBe('83%');
    expect(percent(0.004)).toBe('<1%');
    expect(percent(0)).toBe('0%');
    expect(percent(1)).toBe('100%');
    expect(percent(Number.NaN)).toBe('–');
  });
  it('prints "<1%" only below half a per cent, and never for nothing', () => {
    expect(percent(0.0049)).toBe('<1%');
    expect(percent(0.005)).toBe('1%');
    expect(percent(0.0051)).toBe('1%');
    expect(percent(0.0099)).toBe('1%');
    expect(percent(1e-12)).toBe('<1%');
  });
  it('prints ">99%" for a share that is nearly everything, so it never reads "100%" beside a row of "<1%"', () => {
    expect(percent(0.9949)).toBe('99%');
    expect(percent(0.995)).toBe('>99%');
    expect(percent(0.99778)).toBe('>99%');
    expect(percent(0.9999)).toBe('>99%');
    expect(percent(1)).toBe('100%');
  });
  it('prints token counts', () => {
    expect(tokenCount(781_431_616)).toBe('781 million');
    expect(tokenCount(1_100_000_000)).toBe('1.10 billion');
    expect(tokenCount(12_400)).toBe('12,400');
    expect(tokenCount(461_947)).toBe('461,947');
    expect(tokenCount(0)).toBe('0');
    expect(tokenCount(Number.NaN)).toBe('–');
  });
  it('prints three meaningful digits from a million on, so rows add up to their headline', () => {
    expect(tokenCount(1_400_000)).toBe('1.40 million');
    expect(tokenCount(1_499_999)).toBe('1.50 million');
    expect(tokenCount(1_500_000)).toBe('1.50 million');
    expect(tokenCount(1_844_978)).toBe('1.84 million');
    expect(tokenCount(4_200_000)).toBe('4.20 million');
    expect(tokenCount(9_994_999)).toBe('9.99 million');
    expect(tokenCount(9_995_000)).toBe('10.0 million');
    expect(tokenCount(21_400_000)).toBe('21.4 million');
    expect(tokenCount(99_949_999)).toBe('99.9 million');
    expect(tokenCount(99_950_000)).toBe('100 million');
    expect(tokenCount(576_000_000)).toBe('576 million');
  });
  it('steps to the next name where the one below would print "1,000"', () => {
    expect(tokenCount(999_999)).toBe('999,999');
    expect(tokenCount(999_999.5)).toBe('1.00 million');
    expect(tokenCount(1_000_000)).toBe('1.00 million');
    expect(tokenCount(999_499_999)).toBe('999 million');
    expect(tokenCount(999_500_000)).toBe('1.00 billion');
    expect(tokenCount(999_700_000)).toBe('1.00 billion');
    expect(tokenCount(1_000_000_000)).toBe('1.00 billion');
    expect(tokenCount(12_345_000_000)).toBe('12.3 billion');
    expect(tokenCount(999_499_999_999)).toBe('999 billion');
    expect(tokenCount(999_500_000_000)).toBe('1.00 trillion');
    expect(tokenCount(4e12)).toBe('4.00 trillion');
    expect(tokenCount(3.85e12)).toBe('3.85 trillion');
    // 40 models at the largest number an answer may hold.
    expect(tokenCount(1.6e14)).toBe('160 trillion');
    expect(tokenCount(4e15)).toBe('4,000 trillion');
  });
  it('prints dates', () => {
    expect(shortDate('2026-08-30')).toBe('30 Aug');
    expect(longDate('2026-09-29')).toBe('29 Sep 2026');
    expect(monthYear(new Date(2023, 2, 14, 12).getTime() / 1000)).toBe('March 2023');
    expect(monthYear(Number.NaN)).toBe('–');
  });
  it('prints money in half units without rounding it away', () => {
    expect(money(17.5)).toBe('17.50');
    expect(money(18)).toBe('18');
    expect(money(0.5)).toBe('0.50');
    expect(money(1234)).toBe('1,234');
  });
});
