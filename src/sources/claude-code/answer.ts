// Reads the answer a person pastes back from Claude Code. The pasted text is untrusted: this file
// only ever hands on numbers, dates, model names limited to A–Z a–z 0–9 . _ : / @ - and sentences
// from messages.ts. It never throws.

import type { ModelUsage, Usage } from '../../contracts/usage';
import { longDate } from '../../format';
import { dayCount, daySpan, noteSentence, problemSentence, WRONG_DAY_COUNT } from './messages';
import type { NoteCode, ProblemCode } from './messages';

/** Where readAnswer draws its lines. They are choices, set high on purpose, not measurements. */
export const LIMITS = {
  /** A real answer is under 2,000 characters. The limit also keeps the page fast. */
  maxChars: 20_000,
  /** A real answer has 1 to about 10 model lines. */
  maxModels: 40,
  /** A paste may hold the answer twice, plus the prompt. More is not a real paste. */
  maxHeaders: 8,
  /** Per number. Far above what one person can use, and it keeps every sum exact. */
  maxNumber: 1e12,
  /** The window an answer must cover, both ends counted. */
  windowDays: 30,
  /** Remark when the answer ended more than this many days ago. */
  staleDays: 7,
  /** Remark when the first day with data is this many days into the window. */
  shortDataDays: 3,
  /** Remark above this: about 770 output tokens every second for 30 days. */
  highOutput: 2e9,
  /** Remark above this: about 38,000 tokens every second for 30 days. */
  highTotal: 1e11,
} as const;

/** A remark on an answer that was accepted. */
export interface AnswerNote {
  /** Which remark it is, for code that needs to know. "short-data" means the logs start late (see `coveredDays`). */
  code: NoteCode;
  /** The finished sentence for the person. */
  message: string;
}

/** The pasted text cannot be used. */
export interface AnswerProblem {
  state: 'problem';
  /**
   * Which check failed. One code is not damage: "no-usage" means the script ran and found nothing.
   * The page then adds the sentence NO_USAGE_OTHER_CAUSES after `message`.
   */
  code: ProblemCode;
  /** The finished sentence for the person: what is wrong and what to do next. */
  message: string;
}

/** The pasted text is a whole answer whose numbers add up. */
export interface AnswerOk {
  state: 'ok';
  /**
   * The token counts by model, as the maths takes them. `from` and `to` are the window the script
   * looked at: always 30 days, both ends counted, ending on the day the script ran.
   */
  usage: Usage;
  /**
   * The first and the last day in the window on which anything was counted, as YYYY-MM-DD. `days`
   * runs from `first` to `last`, both counted. It is not the number of days that had use.
   */
  data: { first: string; last: string; days: number };
  /**
   * How many days the counts stand for: 30, or fewer when the logs start 3 or more days into the
   * window (the "short-data" remark). Then it runs from `data.first` to `usage.to`, both counted.
   */
  coveredDays: number;
  /** Every token of every model, added up. It equals the answer's own last line. */
  total: number;
  /** Remarks to show under the result, in the order to show them. Empty for most answers. */
  notes: AnswerNote[];
}

/**
 * What readAnswer makes of the text in the paste box.
 *
 * empty    nothing is pasted yet: the page keeps waiting and shows EMPTY as the placeholder
 * problem  the text cannot be used: the page shows `message`
 * ok       there are counts to work with
 */
export type AnswerReading = { state: 'empty' } | AnswerProblem | AnswerOk;

const problem = (code: ProblemCode, detail?: string): AnswerProblem => ({
  state: 'problem',
  code,
  message: problemSentence(code, detail),
});

// Only printable ASCII ever reaches a message, so pasted text cannot carry markup or control characters into the page.
const safe = (s: string): string =>
  s
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/[<>&"'`]/g, '?')
    .trim()
    .slice(0, 48);

const DATE = String.raw`(\d{4})\s*-\s*(\d{2})\s*-\s*(\d{2})`;
const NUM = String.raw`(\d{1,3}(?:[ ,._']\d{3})+(?!\d)|\d+)`;
const ANY_HEADER = String.raw`ai-co2\s*v\s*(\d+)\s*\|`;
const EVERY_HEADER = new RegExp(ANY_HEADER, 'gi');
const HEADER_START = new RegExp(`^${ANY_HEADER}`, 'i');
const HEADER = new RegExp(String.raw`^${ANY_HEADER}\s*${DATE}\s*to\s*${DATE}\s*\|\s*data\s*(?:(none)|${DATE}\s*to\s*${DATE})`, 'i');
// A model name is 1 to 80 characters. The upper bound also keeps the search fast on hostile input.
const MODEL_LINE = new RegExp(
  String.raw`([A-Za-z][A-Za-z0-9._:/@-]{0,79})\s*\|\s*in\s*${NUM}\s*\|\s*cache[_ ]?write\s*${NUM}\s*\|\s*cache[_ ]?read\s*${NUM}\s*\|\s*out\s*${NUM}`,
  'gi',
);
const TOTAL = new RegExp(String.raw`total\s*\|\s*${NUM}`, 'i');
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Undoes what terminals, chat windows and Markdown do to a copied block. Every character that
 * cannot be seen is written as an escape, so that an editor cannot drop it without anyone noticing.
 */
function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '') // zero-width characters, soft hyphen
    .replace(/[\t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ') // every kind of space
    .replace(/[\u2502\u2503\uFF5C\u00A6\u2223]/g, '|') // look-alikes of |: │ ┃ ｜ ¦ ∣
    .replace(/[\u2010-\u2015\u2212]/g, '-') // look-alikes of -: hyphens, dashes, the minus sign
    .replace(/[`*]/g, '') // code fences, inline code marks, bold marks
    .replace(/^ *(?:[>\u23FA\u23BF\u25CF\u2022] *)+/gm, ''); // at line starts: quote marks, the bullets ⏺ ● • and the terminal's output mark ⎿
}

/** NaN when the number is too long to be exact. Separators only ever got here grouped in threes. */
function toNumber(raw: string | undefined): number {
  if (raw === undefined) return NaN;
  const digits = raw.replace(/[ ,._']/g, '');
  return digits.length > 15 ? NaN : Number(digits);
}

interface Day {
  text: string;
  /** Days since 1 Jan 1970, so two days can be subtracted. */
  n: number;
}

/** null for a date the calendar does not have, such as 31 September. */
function toDay(y: string | undefined, m: string | undefined, d: string | undefined): Day | null {
  if (y === undefined || m === undefined || d === undefined) return null;
  const year = Number(y);
  const month = Number(m);
  const date = Number(d);
  const ms = Date.UTC(year, month - 1, date);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== date) return null;
  return { text: `${y}-${m}-${d}`, n: Math.round(ms / 86_400_000) };
}

interface Parts {
  header: RegExpExecArray;
  lines: RegExpExecArray[];
  total: string | undefined;
}

/** One attempt at reading one answer. The text starts at a header. */
function read(text: string): AnswerProblem | Parts {
  const any = HEADER_START.exec(text);
  if (!any) return problem('no-header');
  if (any[1] !== '1') return problem('version');
  const header = HEADER.exec(text);
  if (!header) return problem('bad-header');
  const rest = text.slice(header[0].length);
  const total = TOTAL.exec(rest);
  if (!total) return problem('truncated');
  const body = rest.slice(0, total.index);
  const lines = [...body.matchAll(MODEL_LINE)];
  // What is left after taking the model lines out must be nothing, or only the bars and dashes of a
  // Markdown table. The pieces between the lines are cut out by hand: searching the text a second
  // time would double the time a hostile paste can take.
  let between = '';
  let from = 0;
  for (const m of lines) {
    between += `${body.slice(from, m.index)}\n`;
    from = m.index + m[0].length;
  }
  const left = (between + body.slice(from))
    .split('\n')
    .map((s) => s.replace(/^[\s|:-]+$/, '').trim())
    .find((s) => s !== '');
  if (left !== undefined) return problem('bad-line', safe(left));
  return { header, lines, total: total[1] };
}

function check(parts: Parts, now: Day | null): AnswerProblem | AnswerOk {
  const h = parts.header;
  const start = toDay(h[2], h[3], h[4]);
  const end = toDay(h[5], h[6], h[7]);
  const none = Boolean(h[8]);
  const first = none ? null : toDay(h[9], h[10], h[11]);
  const last = none ? null : toDay(h[12], h[13], h[14]);
  if (!start || !end || (!none && (!first || !last))) return problem('bad-date');
  const span = end.n - start.n + 1;
  if (span !== LIMITS.windowDays) return problem('bad-window', span > 0 && span < 1000 ? dayCount(span) : WRONG_DAY_COUNT);
  // Printed like every other date on the page: "10 Oct 2026".
  if (now && end.n > now.n + 1) return problem('future', longDate(end.text));
  if (first && last && (first.n > last.n || first.n < start.n || last.n > end.n)) return problem('bad-data-range');
  if (parts.lines.length > LIMITS.maxModels) return problem('too-many-models');

  const models: ModelUsage[] = [];
  // A Set, not object keys: "constructor" is a valid model name here.
  const seen = new Set<string>();
  let sum = 0;
  let output = 0;
  for (const m of parts.lines) {
    const model = m[1];
    const freshInput = toNumber(m[2]);
    const cacheWrite = toNumber(m[3]);
    const cacheRead = toNumber(m[4]);
    const out = toNumber(m[5]);
    if (model === undefined) return problem('bad-line');
    // Written so that NaN fails too.
    if (![freshInput, cacheWrite, cacheRead, out].every((n) => n <= LIMITS.maxNumber)) return problem('bad-number');
    // Exact spelling: the script prints each name once, and two names may differ only in capitals.
    if (seen.has(model)) return problem('duplicate-model', safe(model));
    seen.add(model);
    sum += freshInput + cacheWrite + cacheRead + out;
    output += out;
    models.push({ model, freshInput, cacheWrite, cacheRead, output: out });
  }
  const total = toNumber(parts.total);
  if (!(total <= LIMITS.maxNumber * 4 * LIMITS.maxModels)) return problem('bad-number');
  if (total !== sum) return problem('total-mismatch');
  if (none !== (sum === 0)) return problem('inconsistent');
  if (sum === 0 || !first || !last) return problem('no-usage');

  const notes: AnswerNote[] = [];
  const note = (code: NoteCode, detail?: string) => notes.push({ code, message: noteSentence(code, detail) });
  const days = last.n - first.n + 1;
  const short = first.n - start.n >= LIMITS.shortDataDays;
  if (short) note('short-data', daySpan(first.text, last.text, days));
  if (now && end.n < now.n - LIMITS.staleDays) note('stale', end.text);
  if (output > LIMITS.highOutput) note('high-output');
  if (sum > LIMITS.highTotal) note('high-total');
  const odd = models.find((m) => m.output > 0 && m.freshInput + m.cacheWrite + m.cacheRead === 0);
  if (odd) note('output-without-input', safe(odd.model));
  return {
    state: 'ok',
    usage: { source: 'claude-code', from: start.text, to: end.text, models },
    data: { first: first.text, last: last.text, days },
    coveredDays: short ? end.n - first.n + 1 : LIMITS.windowDays,
    total: sum,
    notes,
  };
}

// Damage that joining the lines again could repair.
const WORTH_JOINING: ReadonlySet<ProblemCode> = new Set(['bad-line', 'bad-header', 'truncated', 'total-mismatch', 'bad-date']);

// "Nothing found" is a complete answer too.
const complete = (r: AnswerProblem | AnswerOk): boolean => r.state === 'ok' || r.code === 'no-usage';

/** Reads one answer: first as pasted, then with the line breaks taken out. */
function readOne(asPasted: string, now: Day | null): AnswerProblem | AnswerOk {
  // A terminal can break a long line in the middle of a word or a number. Joining the lines again
  // repairs that. The total line tells us whether a reading is right, so a wrong repair cannot slip
  // through. (Split and trim, not one regular expression: that one is slow on a long run of spaces.)
  const joined = asPasted
    .split('\n')
    .map((s) => s.trim())
    .join('');
  let firstResult: AnswerProblem | null = null;
  for (const candidate of [asPasted, joined]) {
    const parts = read(candidate);
    const result = 'state' in parts ? parts : check(parts, now);
    if (result.state === 'ok' || result.code === 'no-usage') return result;
    firstResult ??= result;
    if (!WORTH_JOINING.has(result.code)) break;
  }
  return firstResult ?? problem('no-header');
}

function readText(text: string, today: string): AnswerReading {
  if (typeof text !== 'string' || text.trim() === '') return { state: 'empty' };
  if (text.length > LIMITS.maxChars) return problem('too-long');
  // Without a usable date the checks against today are skipped, and every other check still runs.
  const t = typeof today === 'string' ? ISO_DAY.exec(today) : null;
  const now = t ? toDay(t[1], t[2], t[3]) : null;
  const clean = normalise(text);
  // A paste can hold the header more than once: the terminal shows the script's own output above
  // Claude's reply, and the prompt itself contains the header inside the script. Each piece that
  // starts at a header is read on its own.
  const starts = [...clean.matchAll(EVERY_HEADER)].map((m) => m.index);
  if (starts.length === 0) return problem('no-header');
  if (starts.length > LIMITS.maxHeaders) return problem('two-answers');
  const results = starts.map((at, i) => readOne(clean.slice(at, starts[i + 1] ?? clean.length), now));
  const readable = results.filter(complete);
  const firstReadable = readable[0];
  if (firstReadable) {
    // Several complete answers are fine when they say the same thing.
    const wanted = JSON.stringify(firstReadable);
    return readable.every((r) => JSON.stringify(r) === wanted) ? firstReadable : problem('two-answers');
  }
  // Nothing readable: report the problem of the last piece that got past its header.
  const pastHeader = results.filter((r) => r.state === 'problem' && r.code !== 'bad-header');
  const lastPastHeader = pastHeader[pastHeader.length - 1];
  if (lastPastHeader) return lastPastHeader;
  // The script inside the prompt holds the header pattern, so a pasted prompt ends up here.
  if (/AI_CO2_END|CLAUDE_CONFIG_DIR/.test(clean)) return problem('pasted-prompt');
  return results[results.length - 1] ?? problem('no-header');
}

/**
 * Reads what is in the paste box. It never throws, whatever the text is.
 *
 * `today` is the date on the person's own computer, in their own time zone, as YYYY-MM-DD. Always
 * pass it: an answer that ends in the future is refused, and an old one gets a remark. With
 * anything that is not a date those two checks are skipped, and every other check still runs.
 */
export function readAnswer(text: string, today: string): AnswerReading {
  try {
    return readText(text, today);
  } catch {
    // Nothing above is known to throw. This keeps that promise even if an engine runs out of room.
    return problem('no-header');
  }
}
