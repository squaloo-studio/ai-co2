// The slider track, shared by the maths and the page: low sits at position 0, typical at 0.5 and
// high at 1, with equal ratio steps in between. Half-way between 1 and 4 is 2, not 2.5.

/** An assumption's low, typical and high value. */
export type Triple = readonly [low: number, typical: number, high: number];

/** The value at a track position from 0 to 1. Positions off the track land on its ends. */
export function valueAt(triple: Triple, position: number): number {
  const [low, typical, high] = triple;
  if (!(position > 0)) return low;
  if (position >= 1) return high;
  if (position === 0.5) return typical;
  if (position < 0.5) return low * Math.pow(typical / low, 2 * position);
  return typical * Math.pow(high / typical, 2 * position - 1);
}

/** The track position of a value, from 0 to 1. Values off the track land on its ends. */
export function positionOf(triple: Triple, value: number): number {
  const [low, typical, high] = triple;
  if (!(value > low)) return 0;
  if (value >= high) return 1;
  if (value === typical) return 0.5;
  if (value < typical) return (0.5 * Math.log(value / low)) / Math.log(typical / low);
  return 0.5 + (0.5 * Math.log(value / typical)) / Math.log(high / typical);
}
