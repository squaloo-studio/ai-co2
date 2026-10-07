// A real distance beside the car figure, so "61 km" becomes "about the drive from Munich to Augsburg".
// The list and its figures come from the car-line design board (design/boards/car-line.html), checked
// on 7 Oct 2026: drives by the fastest route on OpenStreetMap (OSRM) between main stations or city
// centres, lengths from the body that owns them. Roughly one step every ×1.5, from Europe, Asia and
// North America, so most results land near a place a reader can picture.

import type { Spread } from '../contracts/usage';
import type { CarPlace, Rich } from '../contracts/view';
import { distance, percent, plainNumber } from '../format';

export interface Place {
  /** Where a drive starts. null for a fixed length, such as a bridge. */
  from: string | null;
  /** Where a drive ends, or the name of the fixed length. Drawn at the end of the road. */
  to: string;
  /** How the sentence names it, e.g. "the drive from Paris to Berlin" or "the Øresund Bridge". */
  words: string;
  km: number;
  source: string;
}

const OSRM = 'fastest route on OpenStreetMap (OSRM)';
const drive = (from: string, to: string, km: number): Place => ({ from, to, words: `the drive from ${from} to ${to}`, km, source: OSRM });
const length = (to: string, words: string, km: number, source: string): Place => ({ from: null, to, words, km, source });

/** Shortest first. */
export const PLACES: readonly Place[] = Object.freeze([
  length('Tennis court', 'the length of a tennis court', 0.02377, 'ITF Rules of Tennis 2026, Rule 1'),
  length('Olympic pool', 'the length of an Olympic pool', 0.05, 'World Aquatics pool certification'),
  length('Football pitch', 'the length of a football pitch', 0.105, 'FIFA Football Stadiums Guidelines 5.3'),
  length('One lap', 'a lap of a running track', 0.4, 'World Athletics Technical Rules, Rule 160'),
  length('Champs-Élysées', 'the length of the Champs-Élysées', 1.9, 'City of Paris'),
  length('Golden Gate Bridge', 'the Golden Gate Bridge, end to end', 2.737, 'Golden Gate Bridge District'),
  length('Akashi Kaikyō Bridge', 'the Akashi Kaikyō Bridge in Japan', 3.911, 'Honshu-Shikoku Bridge Expressway'),
  length('Øresund Bridge', 'the Øresund Bridge', 7.845, 'Øresundsbron'),
  drive('Seoul Station', 'Gangnam', 10.5),
  length('Vasco da Gama Bridge', 'the Vasco da Gama Bridge in Lisbon', 17.2, 'Vinci Concessions'),
  drive('Los Angeles', 'Santa Monica Pier', 27.3),
  drive('Seoul', 'Incheon', 40),
  drive('Munich', 'Augsburg', 66),
  drive('San Francisco', 'San Jose', 80.3),
  drive('Hamburg', 'Bremen', 125),
  drive('Delhi', 'Agra', 202),
  drive('Berlin', 'Hamburg', 281),
  drive('Seoul', 'Busan', 397),
  drive('Toronto', 'Montréal', 548),
  drive('Tokyo', 'Hiroshima', 806),
  drive('New York', 'Chicago', 1275),
  drive('Beijing', 'Chengdu', 1783),
  drive('Beijing', 'Ürümqi', 2779),
  drive('Lisbon', 'Warsaw', 3320),
  drive('New York', 'Los Angeles', 4498),
  drive('Tarifa', 'the North Cape', 5674),
]);

/** The average distance from the Earth to the Moon (NASA). */
export const MOON_KM = 384_400;

/** The source lines of the method card link here. src/links.ts allows them. */
export const PLACE_LINKS: readonly string[] = Object.freeze(['https://www.openstreetmap.org/copyright', 'https://science.nasa.gov/moon/facts/']);

/** Beyond the longest place by more than this, the sentence turns to the Moon. Below the shortest by more, there is no place. */
const STRETCH = { beyond: 1.3, below: 1.5 } as const;

export type PlaceMatch = { kind: 'none' } | { kind: 'near'; place: Place } | { kind: 'beyond'; place: Place };

/** The place closest to `km` on a log scale: twice as far and half as far count the same. */
export function pickPlace(km: number): PlaceMatch {
  const first = PLACES[0];
  const last = PLACES[PLACES.length - 1];
  if (!first || !last || !(km > 0) || !Number.isFinite(km)) return { kind: 'none' };
  if (km > last.km * STRETCH.beyond) return { kind: 'beyond', place: last };
  if (km < first.km / STRETCH.below) return { kind: 'none' };
  let best = first;
  for (const place of PLACES) if (Math.abs(Math.log(km / place.km)) < Math.abs(Math.log(km / best.km))) best = place;
  return { kind: 'near', place: best };
}

/** A place's own length, in the unit that suits it: "24 m", "1,280 km". */
function placeLength(km: number): string {
  return km < 1 ? `${distance(km, 'm')} m` : `${distance(km, 'km')} km`;
}

function moonWords(km: number): string {
  const share = km / MOON_KM;
  return share < 1 ? `About ${percent(share)} of the way to the Moon.` : `About ${plainNumber(share)} times as far as the Moon.`;
}

/** The sentence and the road beside the car figure, for the car range in km. null when no place is near enough. */
export function carPlace(car: Spread): CarPlace | null {
  const match = pickPlace(car.mid);
  if (match.kind === 'none') return null;
  const { place } = match;
  const road = { from: place.from, to: place.to, km: place.km };
  if (match.kind === 'beyond') {
    const text: Rich = ['Farther than ', { strong: place.words }, ` (${placeLength(place.km)}). ${moonWords(car.mid)}`];
    return { text, road, beyond: true };
  }
  return { text: ['About ', { strong: place.words }, ` (${placeLength(place.km)}).`], road, beyond: false };
}
