// Calendar days as YYYY-MM-DD. Steps are taken on the date itself, so no clock and no time zone can
// shift a day. One function asks the computer for its local date, and only the store calls it.

/** A first and a last day, both counted. */
export interface Period {
  readonly from: string;
  readonly to: string;
}

const DAY_MS = 86_400_000;

/** The day as a count of days, or null when the text is not a real date ("2026-09-31"). */
function dayNumber(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day ? ms / DAY_MS : null;
}

/** true for a real calendar day written as YYYY-MM-DD. */
export function isDay(day: unknown): day is string {
  return typeof day === 'string' && dayNumber(day) !== null;
}

/** A day `n` days later (earlier with a negative n). A text that is no day comes back as it is. */
export function addDays(day: string, n: number): string {
  const number = dayNumber(day);
  if (number === null || !Number.isFinite(n)) return day;
  return new Date((number + Math.round(n)) * DAY_MS).toISOString().slice(0, 10);
}

/** `to` minus `from` in days. 0 for the same day, and 0 when one of them is no day. */
export function daysBetween(from: string, to: string): number {
  const first = dayNumber(from);
  const last = dayNumber(to);
  return first === null || last === null ? 0 : last - first;
}

/** The 30 calendar days that end on `today`. */
export function windowEndingOn(today: string): Period {
  return { from: addDays(today, -29), to: today };
}

/**
 * The local date of a clock time in milliseconds, in the browser's own time zone. Two more places ask
 * for the time zone: `monthYear` in src/format.ts (the month of the whole-history line) and the
 * reader's days of a reading made with the calendar 'local' (sources/chatgpt/account/reading.ts).
 */
export function localDay(ms: number): string {
  const date = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}
