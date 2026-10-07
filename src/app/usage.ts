// From what a reader hands over to what the estimator takes. Everything here follows from the data
// and the plan, and from nothing else: no slider, no tip and no hidden-work switch changes a `Counted`.
//
// Both readers pass on numbers and names from a pasted text or a dropped file. So every count is
// checked once more on the way through, and the estimator never sees a number it would refuse.

import type { SourceId } from '../contracts/usage';
import { monthYear } from '../format';
import { MODEL_TABLE, SLIDERS } from '../model/assumptions';
import type { EnergyClass, SliderId } from '../model/assumptions';
import type { EstimateInput, Row } from '../model/estimate';
import { HIDDEN_PIECES, NO_BASES, hiddenWork, piecesOn, switchDefaults } from '../model/hidden';
import type { Bases, HiddenId, HiddenPiece, SwitchDefault } from '../model/hidden';
import { buildTips } from '../model/tips';
import type { BuiltTip, UsageRow } from '../model/tips';
import { totals } from '../sources/chatgpt';
import type { ReadOutcome, Reading, Totals } from '../sources/chatgpt';
import { dayIndexIn, dayName } from '../sources/chatgpt/account/reading';
import type { AnswerOk } from '../sources/claude-code';
import { classifyModel } from '../sources/models';
import type { ChatGptPlan, ModelClass } from '../sources/models';
import { daysBetween, isDay, windowEndingOn } from './days';
import type { Period } from './days';
import { isPaid, stageOf } from './state';
import type { State } from './state';

/**
 * The row name the estimator gets for a ChatGPT request that names no model. The reader's name for it is "".
 * It is also what the model table shows for every row that names no model, for both tools.
 */
export const NO_NAME_ROW = '(no model name)';

/** What the Claude Code script prints as the model of a step whose log entry names none. */
export const UNNAMED_STEPS = 'unknown';

/** The longest name from a dropped file that is shown: a model's or a file's. */
export const SHOWN_NAME_LENGTH = 60;

/** Why an export gives no result. `name` is a file name, cut short. */
export type ExportProblem =
  /** E10: the worker ended before it reported anything, so its file was most likely never loaded. */
  | { readonly code: 'E1' | 'E2' | 'E3' | 'E4' | 'E6' | 'E7' | 'E9' | 'E10' }
  /** E5: a loose file that is no list. E11: a conversations file whose bytes could not be had. */
  | { readonly code: 'E5' | 'E11'; readonly name: string }
  /** `newest` is the day of the newest message, or null when no message has a date. */
  | { readonly code: 'E8'; readonly newest: string | null };

/** One raw model name, as counted. */
export interface CountedModel {
  /** The name of its rows in the estimator: the raw name, or NO_NAME_ROW. */
  readonly row: string;
  /** The friendly name. For ChatGPT cut short. */
  readonly display: string;
  readonly sizeClass: EnergyClass;
  /** Why the size is unknown. null for a known size. */
  readonly reason: 'empty' | 'auto' | 'tier-hidden' | 'unrecognised' | null;
  /** true for a name whose size the plan decides ("gpt-5-6"). */
  readonly byPlan: boolean;
  /** The visible tokens of all types. */
  readonly tokens: number;
  /** ChatGPT: requests under this name. 0 for Claude Code. */
  readonly requests: number;
}

/** The usage as counted. */
export interface Counted {
  readonly source: SourceId;
  /** The 30 days. Claude Code: the window of the answer. ChatGPT: the 30 days that end today. */
  readonly window: Period;
  /** The days the counts stand for. `days` runs from 1 to 30. */
  readonly covered: { readonly first: string; readonly last: string; readonly days: number };
  /** In the order of the source's rows. Rows that are no model are not in here. */
  readonly models: readonly CountedModel[];
  /** The estimator's rows, one per entry of `models`, in the same order. */
  readonly rows: readonly UsageRow[];
  /** The bases of the six pieces for the 30 days. NO_BASES for Claude Code. */
  readonly bases: Bases;
  /** The four ChatGPT switches as the export sets them. [] for Claude Code. */
  readonly switches: readonly SwitchDefault[];
  /** The tips that can apply to this usage, in catalogue order. */
  readonly built: readonly BuiltTip[];
  /** ChatGPT: the whole export. `since` is ready to print. null for Claude Code, and when no request has a date. */
  readonly history: { readonly rows: readonly UsageRow[]; readonly bases: Bases; readonly since: string } | null;
  /** ChatGPT: the reader's totals of the 30 days, for the headline and the notes. null for Claude Code. */
  readonly totals: Totals | null;
}

// ---------- what both tools share ----------

/** A count as the estimator takes it: a finite number, 0 or more. Anything else counts as nothing. */
export const countOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** The first characters of a text, never cut inside a two-part character such as an emoji. */
export function cut(text: string, length: number = SHOWN_NAME_LENGTH): string {
  const characters = Array.from(text);
  return characters.length > length ? characters.slice(0, length).join('') : text;
}

const hold = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** What the classifier says about one raw name, in the store's words. */
interface Named {
  readonly row: string;
  readonly display: string;
  /** null: not a model. The row is left out. */
  readonly sizeClass: EnergyClass | null;
  readonly reason: CountedModel['reason'];
  readonly byPlan: boolean;
}

function named(row: string, display: string, answer: ModelClass): Named {
  const { byPlan } = answer;
  if (answer.class === 'skip') return { row, display, sizeClass: null, reason: null, byPlan };
  if (answer.class === 'unknown') return { row, display, sizeClass: 'unknown', reason: answer.reason, byPlan };
  return { row, display, sizeClass: answer.class, reason: null, byPlan };
}

const ALL_ON: Readonly<Record<HiddenId, boolean>> = { thinking: true, prompt: true, personal: true, search: true, files: true, misses: true };

// ---------- Claude Code ----------

export function countAnswer(answer: AnswerOk): Counted {
  const models: CountedModel[] = [];
  const rows: UsageRow[] = [];
  for (const line of answer.usage.models) {
    if (typeof line.model !== 'string' || line.model === '') continue;
    const answered = classifyModel(line.model);
    // "unknown" is the script's word for a step that names no model, not a model's name.
    const unnamed = line.model === UNNAMED_STEPS && answered.class === 'unknown';
    const placed = named(line.model, unnamed ? NO_NAME_ROW : answered.displayName, answered);
    const { row, display, sizeClass, byPlan } = placed;
    const reason = unnamed ? 'empty' : placed.reason;
    // The script already leaves out what is no model. This is the second guard.
    if (sizeClass === null) continue;
    const freshInput = countOf(line.freshInput);
    const cacheWrite = countOf(line.cacheWrite);
    const cacheRead = countOf(line.cacheRead);
    const output = countOf(line.output);
    rows.push({ model: row, display, sizeClass, freshInput, cacheWrite, cacheRead, output });
    models.push({ row, display, sizeClass, reason, byPlan, tokens: freshInput + cacheWrite + cacheRead + output, requests: 0 });
  }
  const window: Period = { from: answer.usage.from, to: answer.usage.to };
  const days = hold(Math.round(countOf(answer.coveredDays)) || 30, 1, 30);
  return {
    source: 'claude-code',
    window,
    // With a first use late in the window, the counts stand for the days from then to the end of the window.
    covered: { first: days < 30 ? answer.data.first : window.from, last: window.to, days },
    models,
    rows,
    bases: NO_BASES,
    switches: [],
    built: buildTips({ source: 'claude-code', rows, hidden: [], thinkingRecorded: false }),
    history: null,
    totals: null,
  };
}

// ---------- ChatGPT ----------

/** The day of a time in the reading's own calendar, or null when the time is no time. */
export function dayOf(reading: Reading, seconds: number | null): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  const day = dayName(dayIndexIn(reading.calendar, seconds));
  return isDay(day) ? day : null;
}

/** The token rows and the six bases of one call to `totals`, as the estimator takes them. */
function usageOf(sums: Totals, plan: ChatGptPlan): { models: CountedModel[]; rows: UsageRow[]; bases: Bases } {
  // A Map, never a plain object: "constructor" is a valid model name.
  const known = new Map<string, Named>();
  const who = (raw: unknown): Named => {
    const name = typeof raw === 'string' ? raw : '';
    let entry = known.get(name);
    if (entry === undefined) {
      const answered = classifyModel(name, { plan });
      // The estimator refuses a row without a name, so the empty name gets one no real name can have.
      // "auto" names no model either: both are shown as one row, under the words of the remark about them.
      const unnamed = answered.class === 'unknown' && (answered.reason === 'auto' || answered.reason === 'empty');
      entry = named(name === '' ? NO_NAME_ROW : name, unnamed ? NO_NAME_ROW : cut(answered.displayName), answered);
      known.set(name, entry);
    }
    return entry;
  };

  const requests = new Map<string, number>();
  for (const entry of sums.requestsByModel) requests.set(who(entry.model).row, countOf(entry.requests));

  const models: CountedModel[] = [];
  const rows: UsageRow[] = [];
  for (const line of sums.rows) {
    const { row, display, sizeClass, reason, byPlan } = who(line.model);
    if (sizeClass === null) continue;
    const freshInput = countOf(line.freshInput);
    const cacheRead = countOf(line.cacheRead);
    const output = countOf(line.output);
    // What was read again after a break is a part of the fresh input, never more than it.
    const rereadFresh = Math.min(countOf(line.rereadFresh), freshInput);
    rows.push({ model: row, display, sizeClass, freshInput, cacheWrite: 0, cacheRead, output, rereadFresh });
    models.push({ row, display, sizeClass, reason, byPlan, tokens: freshInput + cacheRead + output, requests: requests.get(row) ?? 0 });
  }

  const base = (piece: HiddenPiece): Row[] => {
    const units: Row[] = [];
    for (const line of sums.hidden[piece.readerKey]) {
      const { row, sizeClass } = who(line.model);
      if (sizeClass === null) continue;
      units.push({ model: row, sizeClass, freshInput: countOf(line.freshInput), cacheRead: countOf(line.cacheRead), output: countOf(line.output) });
    }
    return units;
  };
  const bases: Record<HiddenId, readonly Row[]> = { ...NO_BASES };
  for (const piece of HIDDEN_PIECES) bases[piece.id] = base(piece);
  return { models, rows, bases };
}

export function countExport(reading: Reading, today: string, paid: boolean): Counted {
  // One switch sets both: how much earlier conversation counts as read again, and the size of "gpt-5-6".
  const readerPlan = paid ? 'paid' : 'free';
  const plan: ChatGptPlan = paid ? 'plus-or-pro' : 'free-or-go';
  const window = windowEndingOn(today);
  const sums = totals(reading, window, readerPlan);
  const { models, rows, bases } = usageOf(sums, plan);

  // An export cannot hold what came after it was made, and it may start inside the 30 days.
  const oldest = reading.days[0]?.day;
  const first = isDay(oldest) && daysBetween(window.from, oldest) > 0 ? oldest : window.from;
  const newest = dayOf(reading, reading.lastMessage);
  let last = newest !== null && daysBetween(newest, window.to) > 0 ? newest : window.to;
  if (daysBetween(first, last) < 0) last = first;

  let history: Counted['history'] = null;
  if (typeof reading.firstRequest === 'number' && Number.isFinite(reading.firstRequest)) {
    const whole = usageOf(totals(reading, 'all', readerPlan), plan);
    history = { rows: whole.rows, bases: whole.bases, since: monthYear(reading.firstRequest) };
  }

  return {
    source: 'chatgpt',
    window,
    covered: { first, last, days: hold(daysBetween(first, last) + 1, 1, 30) },
    models,
    rows,
    bases,
    switches: switchDefaults(sums.evidence, reading.plusUser === true ? true : reading.plusUser === false ? false : null),
    built: buildTips({
      source: 'chatgpt',
      rows,
      hidden: hiddenWork(bases, ALL_ON),
      thinkingRecorded: countOf(sums.thinkingRecorded) > 0,
      // Seconds the reader assumed for answers of a thinking model that show no time. The tip's title then says "By our count".
      thinkingPartlyAssumed: countOf(sums.thinkingSecondsAssumed) > 0,
    }),
    history,
    totals: sums,
  };
}

/** The usage of the data the state holds. null unless there is a result to show. */
export function count(state: State): Counted | null {
  if (stageOf(state) !== 'done') return null;
  if (state.source === 'claude-code') return state.answer.reading.state === 'ok' ? countAnswer(state.answer.reading) : null;
  return state.export.phase === 'done' ? countExport(state.export.reading, state.today, isPaid(state)) : null;
}

// ---------- what goes to the estimator ----------

/** The set sliders the tool has, as track positions. The estimator refuses a slider it does not know. */
function pinsOf(counted: Counted, state: State): Partial<Record<SliderId, number>> {
  const pins: Partial<Record<SliderId, number>> = {};
  for (const id of SLIDERS[counted.source]) {
    const position = state.pins[id];
    if (typeof position === 'number' && position >= 0 && position <= 1) pins[id] = position;
  }
  return pins;
}

const piecesOf = (counted: Counted, state: State, bases: Bases): EstimateInput['hidden'] =>
  (counted.source === 'chatgpt' ? hiddenWork(bases, piecesOn(counted.switches, state.flipped)) : []);

/** The input of the main call: the 30 days, the pieces as the switches stand, the set sliders and the tips. */
export function estimateInput(counted: Counted, state: State): EstimateInput {
  const built = new Set<string>(counted.built.map((tip) => tip.id));
  return {
    rows: counted.rows,
    hidden: piecesOf(counted, state, counted.bases),
    pins: pinsOf(counted, state),
    tips: counted.built,
    applied: state.applied.filter((id) => built.has(id)),
    table: MODEL_TABLE,
  };
}

/** The input of the whole-history call: the same sliders and switches, no tips. null when there is no such line. */
export function historyInput(counted: Counted, state: State): EstimateInput | null {
  if (counted.history === null) return null;
  return {
    rows: counted.history.rows,
    hidden: piecesOf(counted, state, counted.history.bases),
    pins: pinsOf(counted, state),
    table: MODEL_TABLE,
  };
}

/** The input that picks the lead size: the usage as the switches stand, with no slider set and no tip. */
export function leadInput(counted: Counted, state: State): EstimateInput {
  return { rows: counted.rows, hidden: piecesOf(counted, state, counted.bases), table: MODEL_TABLE };
}

// ---------- an export with no result ----------

const TOO_LARGE: ReadonlySet<string> = new Set(['file-too-large', 'total-too-large', 'ratio-too-high', 'conversation-too-large']);
const TOO_MANY: ReadonlySet<string> = new Set(['too-many-entries', 'too-many-conversation-files', 'too-many-inner-archives']);

/** Marks that open or close a quotation. A file name is shown between “ and ”, and must not be able to end them. */
const QUOTATION_MARKS = /["“”„‟«»]/g;

/**
 * The name of a file, as text to show: the last name of its place, without the folders inside a ZIP,
 * with no mark that could close the quotation it is shown in, and cut short.
 */
export function fileName(path: readonly string[]): string {
  const last = path.at(-1);
  if (typeof last !== 'string') return '';
  const name = last.split(/[/\\]/).filter((part) => part !== '').at(-1) ?? '';
  return cut(name.replace(QUOTATION_MARKS, "'"));
}

const BROKEN: ReadonlySet<string> = new Set(['damaged', 'cut-off', 'not-json']);
const NO_LIST: ReadonlySet<string> = new Set(['not-an-array', 'empty']);

/**
 * null: there is something to estimate. Never called with the outcome "cancelled".
 * `heard` is false when the worker ended before it reported anything.
 */
export function exportProblem(outcome: ReadOutcome, today: string, heard: boolean = true): ExportProblem | null {
  if (!outcome.ok) {
    if (outcome.code === 'too-many-files') return { code: 'E2' };
    // A worker that never said a word was most likely never loaded: the connection is gone, or the
    // site was published again since the page was opened. Closing tabs does not help then. A reload does.
    return { code: outcome.code === 'worker-failed' && !heard ? 'E10' : 'E9' };
  }
  const { report, reading } = outcome;
  const noticed = (code: string): boolean => report.notices.some((notice) => notice.code === code);

  // A limit was passed. What was read before it is not shown as a result: it could be a small part of the whole.
  if (report.files.some((file) => file.problem !== null && TOO_LARGE.has(file.problem))) return { code: 'E6' };
  if (report.notices.some((notice) => TOO_MANY.has(notice.code))) return { code: 'E6' };

  if (report.totals.archives === 0 && report.totals.conversationFiles === 0) return { code: 'E1' };
  // A conversations file behind a password is there and cannot be opened: that is not "no conversations file".
  if (report.totals.conversationFiles === 0) return { code: noticed('unreadable') || noticed('encrypted') ? 'E4' : 'E3' };
  if (!(reading.conversations > 0)) {
    if (noticed('rescued')) return { code: 'E4' };
    // A file that broke before its first conversation is damaged, not empty.
    const broken = report.files.find((file) => file.problem !== null && BROKEN.has(file.problem));
    if (broken) return { code: 'E11', name: fileName(broken.path) };
    if (noticed('encrypted')) return { code: 'E4' };
    const noList = report.files.find((file) => file.problem !== null && NO_LIST.has(file.problem));
    // Inside a ZIP the advice of E5, to drop the export ZIP as it was downloaded, is what the person just did.
    if (noList) return noList.path.length === 1 ? { code: 'E5', name: fileName(noList.path) } : { code: 'E3' };
    return { code: 'E7' };
  }
  let requests: number;
  try {
    requests = totals(reading, windowEndingOn(today), 'paid').requests;
  } catch {
    // A reading whose days are no days cannot be counted. That is the page's fault, not the file's.
    return { code: 'E9' };
  }
  // Requests, not answers: an answer with no text is an answer and adds no tokens.
  if (!(requests > 0)) return { code: 'E8', newest: dayOf(reading, reading.lastMessage) };
  return null;
}
