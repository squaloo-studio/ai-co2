import { describe, expect, it } from 'vitest';
import { MOON_KM, PLACES, carPlace, pickPlace } from './places';

const around = (mid: number) => ({ p5: mid / 3, mid, p95: mid * 3 });

describe('the list of places', () => {
  it('is sorted, shortest first, and every place has a name and a length', () => {
    for (let i = 1; i < PLACES.length; i++) expect(PLACES[i]?.km).toBeGreaterThan(PLACES[i - 1]?.km ?? Infinity);
    for (const place of PLACES) {
      expect(place.words.length).toBeGreaterThan(0);
      expect(place.source.length).toBeGreaterThan(0);
    }
  });
  it('picks each place for its own length', () => {
    for (const place of PLACES) expect(pickPlace(place.km)).toEqual({ kind: 'near', place });
  });
});

describe('pickPlace', () => {
  it('takes the closest place on a log scale', () => {
    // 61 km: Munich–Augsburg (66 km) is 8% away, Seoul–Incheon (40 km) is 53% away.
    expect(pickPlace(61)).toMatchObject({ kind: 'near', place: { from: 'Munich', to: 'Augsburg' } });
  });
  it('has no place for a distance well below the shortest', () => {
    expect(pickPlace(0.01)).toEqual({ kind: 'none' });
    expect(pickPlace(0)).toEqual({ kind: 'none' });
    expect(pickPlace(Number.NaN)).toEqual({ kind: 'none' });
    expect(pickPlace(0.02)).toMatchObject({ kind: 'near', place: { to: 'Tennis court' } });
  });
  it('turns to the longest drive and the Moon well beyond it', () => {
    expect(pickPlace(7000)).toMatchObject({ kind: 'near', place: { to: 'the North Cape' } });
    expect(pickPlace(7500)).toMatchObject({ kind: 'beyond', place: { to: 'the North Cape' } });
  });
});

describe('carPlace', () => {
  it('names the drive with its own length', () => {
    expect(carPlace(around(61))).toEqual({
      text: ['About ', { strong: 'the drive from Munich to Augsburg' }, ' (66 km).'],
      road: { from: 'Munich', to: 'Augsburg', km: 66 },
      beyond: false,
    });
  });
  it('prints a short length in metres, and a fixed length without a start', () => {
    expect(carPlace(around(0.024))).toEqual({
      text: ['About ', { strong: 'the length of a tennis court' }, ' (24 m).'],
      road: { from: null, to: 'Tennis court', km: 0.02377 },
      beyond: false,
    });
  });
  it('says how far towards the Moon a result beyond the longest drive goes', () => {
    expect(carPlace(around(7500))?.text).toEqual(['Farther than ', { strong: 'the drive from Tarifa to the North Cape' }, ' (5,670 km). About 2% of the way to the Moon.']);
    expect(carPlace(around(7500))?.beyond).toBe(true);
    expect(carPlace(around(MOON_KM * 1.3))?.text[2]).toBe(' (5,670 km). About 1.3 times as far as the Moon.');
  });
  it('is null when no place is near enough', () => {
    expect(carPlace(around(0.001))).toBeNull();
  });
});
