// What is left of a ChatGPT export after counting: numbers per calendar day and per model, and nothing
// else. No text, no titles, no ids. It is plain data, so it can be posted from the worker to the page.
//
// How the page uses it:
//
//   const last30 = totals(reading, window, plan);      // the result
//   const history = totals(reading, 'all', plan);      // the whole-history line
//
// The page makes `window` itself, from today's date: { from, to } as day names, 30 days with both
// ends counted. `plan` is its plan switch, which starts from `reading.plusUser`. The helpers
// windowOf and planFromExport below do the same two things and are used by the tests only.
//
// `totals` gives the token rows and the six hidden-work bases the maths takes. Changing the window or
// the plan means calling totals() again (a few milliseconds), never reading the file again.
//
// Words used here:
//
//   request   one run of the model: it read the conversation so far and wrote an answer or a tool
//             call. Tokens are counted per request. This is the unit of the estimate.
//   answer    everything the model produced between one message of the person and the next. In
//             exports made since mid-2026 one answer is one request. Older exports also show the
//             tool calls inside an answer, and each of those is a request of its own.
//   token     counted with o200k_base, the tokenizer of OpenAI's models since GPT-4o.
//   warm      a request that came at most 30 minutes after the one before it in the same
//             conversation. It re-reads the earlier conversation from a cache. Any other is cold.
//
// This file loads no tokenizer, so the page can import it without pulling in the vocabulary. The page
// must not import ./account, ./count or ./tokens: those load the tokenizer and are for the worker.

import type { ModelUsage } from '../../../contracts/usage';
import type { Plan } from './rules';

export type { Plan } from './rules';

/**
 * The model name of requests for which the export names no model: the empty name. The model
 * classifier reads it as "no model name".
 */
export const NO_MODEL_NAME = '';

/**
 * Which calendar the days of a Reading follow. 'local' is the time zone of the computer that read
 * the export, which is what the page shows. 'utc' is for tests.
 */
export type Calendar = 'utc' | 'local';

/**
 * The counts of all requests of one model on one day.
 *
 * Fields ending in Free or Paid exist twice because the plan decides how much earlier conversation
 * fits into one request (7,000 tokens on the free plan; 34,000 for instant and 236,000 for thinking
 * models on a paid plan). Text beyond that ceiling is counted as not read again.
 */
export interface ModelDay {
  /**
   * The model's name as the export spells it, e.g. "gpt-5-6". It is text from the file: at most 64
   * letters, digits, dots, colons, hyphens and underscores, and still to be shown as text only. It
   * is empty when the export names no model for the request: the picker setting "auto" of a
   * conversation is not taken for a name. Hand it to the model classifier as it is.
   */
  model: string;
  /** Requests. */
  requests: number;
  /** Of these, the cold ones: the first of a conversation, or more than 30 minutes after the one before. */
  coldRequests: number;
  /** Tokens the model wrote: answers and tool calls. Thinking is not in here, the export does not have it. */
  output: number;
  /** Tokens read for the first time: the new question, files, images, tool results and the previous answer. */
  newInput: number;
  /** Earlier conversation read again by warm requests, in tokens, up to the ceiling. Counts as cache read. */
  rereadWarmFree: number;
  rereadWarmPaid: number;
  /** Earlier conversation read again by cold requests, in tokens, up to the ceiling. Counts as fresh input. */
  rereadColdFree: number;
  rereadColdPaid: number;
  /** Requests whose earlier conversation was longer than the ceiling and was cut. */
  cutFree: number;
  cutPaid: number;
  /** Seconds of thinking the export records ("Thought for 19s"). Can have a fraction. */
  thinkingSeconds: number;
  /** Seconds assumed for answers that thought with no readable time: the median of their conversation, or 15. */
  thinkingSecondsAssumed: number;
  /** Requests with a recorded thinking time. */
  thinkingRecorded: number;
  /** Requests with an assumed thinking time. */
  thinkingAssumed: number;
  /**
   * Readings of the hidden system prompt, in units of today's prompt: 1 per request since Aug 2026,
   * less before (0.8, 0.65, 0.12, 0.04 for earlier periods) and 0.06 for small models. A fraction.
   */
  promptReadings: number;
  /** Web sources listed on answers. The text read from them is not in the export. */
  sources: number;
  /** Requests that list at least one web source. */
  searchRequests: number;
  /** Uploaded files for which the export gives no token count. */
  filesWithoutCount: number;
  /** Uploaded files with a token count. Their tokens are already in newInput. */
  filesWithCount: number;
  /** Images the person sent. Their tokens are already in newInput, by a published rule that may not be ChatGPT's. */
  images: number;
}

/** Everything counted on one calendar day. */
export interface Day {
  /** YYYY-MM-DD in the Reading's calendar. Empty for the `undated` entry of a Reading. */
  day: string;
  /** Messages of any kind, hidden ones included. */
  messages: number;
  /** Messages the person wrote. */
  prompts: number;
  /** Answers, on the day they began. An answer with no text is an answer too, though it is no request. */
  answers: number;
  /** "Thought for …" lines. One or more means the export shows thinking on this day. */
  recaps: number;
  /** Messages that hold the transcript of a voice chat. Only the transcript is counted, not the audio. */
  transcripts: number;
  /** Messages that show memory in use: an answer that cites a memory, a memory being written, a memory message. */
  memoryMessages: number;
  /** One entry per model with a request on this day, by name. Empty on a day with messages and no request. */
  models: ModelDay[];
}

/**
 * Things the counting met that the page may want to mention. A code and a number, never a sentence
 * and never anything from the export.
 */
export type WarningCode =
  /** Elements of a conversations file that are not a conversation. Not counted. */
  | 'not-a-conversation'
  /** Conversations with more messages than the limit. Not counted. */
  | 'conversation-too-large'
  /** Conversations that could not be counted for a reason the code does not know. Not counted. */
  | 'conversation-failed'
  /** Conversations that came more than once. The copy with the later update time is the one counted. */
  | 'duplicate-conversation'
  /** Conversations without an id. Counted, but a second copy of one cannot be recognised. */
  | 'conversation-without-id'
  /** Messages that hang in a loop of parent links and belong to no conversation tree. Not counted. */
  | 'unreachable-message'
  /** Message times that were given in milliseconds. Read as such. */
  | 'time-in-milliseconds'
  /** Message times that are not a date since ChatGPT exists (a text, a negative number, the year 1970). Treated as missing. */
  | 'unusable-time'
  /** Requests dated more than a day after `now`. In the full history, in no window. */
  | 'request-in-future'
  /** Requests with no time anywhere, not even on their conversation. In the full history, in no window. */
  | 'request-without-time'
  /** Messages longer than the limit. Their start was counted and the rest estimated from it. */
  | 'message-too-long'
  /** Messages the tokenizer failed on. Estimated at one token per four characters. */
  | 'message-not-tokenized'
  /** Attachments whose token count is not a believable number. Treated as files without a count. */
  | 'attachment-size-ignored'
  /** Attachments and images beyond the limit per message. Not counted. */
  | 'attachment-over-limit'
  /** Images whose size is missing or not believable. Counted as a 1024 × 1024 image. */
  | 'image-size-unknown'
  /** Web sources beyond the limit per message. Not counted. */
  | 'source-over-limit'
  /** Thinking times above the limit. Counted as the limit. */
  | 'thinking-time-capped'
  /** "Thought for …" lines whose time could not be read, for example in another language. */
  | 'thinking-time-unreadable'
  /** "Thought for …" lines that belong to no answer. Not counted. */
  | 'thinking-time-unplaced'
  /** Model names that are not a short plain name. The next source for the name was used. */
  | 'model-name-ignored'
  /** Model names beyond the limit of different names. Their counts are under the empty name. */
  | 'model-name-over-limit'
  /** Messages of a content type this code does not know. Counted as messages, with no text. */
  | 'unknown-content-type';

export interface Warning {
  code: WarningCode;
  /** How often it happened. A whole number above zero. */
  count: number;
}

/** The whole export, counted. Times are Unix seconds and can have a fraction. */
export interface Reading {
  /** The calendar of every day in here. windowOf makes windows in it. */
  calendar: Calendar;
  /**
   * Conversations counted. A conversation that came twice counts once. Conversations that were
   * skipped are not in here: see the warnings not-a-conversation, conversation-too-large and
   * conversation-failed for how many.
   */
  conversations: number;
  /**
   * For each conversation, the days on which it has at least one message, as day numbers (see
   * dayFromName), ascending. Only used to say how many conversations fall into a window. The order
   * of the conversations means nothing.
   */
  conversationDays: number[][];
  /** Every day with at least one message or request, oldest first, each day once. */
  days: Day[];
  /**
   * Messages and requests that cannot be put on a day: no usable time anywhere, or a time more than
   * a day after `now`. They are part of the full history and of no window. Its `day` is empty.
   */
  undated: Day;
  /**
   * Time of the oldest and the newest request. null when no request has a day. The newest can lie
   * up to a day after `now`, when the computer's clock is behind.
   */
  firstRequest: number | null;
  lastRequest: number | null;
  /** Time of the newest message of any kind. An export can be days old when it arrives, so say when this is long ago. */
  lastMessage: number | null;
  /**
   * `chatgpt_plus_user` from user.json. null when the file or the field is missing. true was seen on a
   * Plus account and false on free accounts. What it says for Go, Pro or Edu is not known. With two
   * user.json files, the one read last counts.
   */
  plusUser: boolean | null;
  /**
   * true when the export shows memory in use anywhere: an answer cites a memory, or a memory was
   * written. false does not mean memory was off. An export cannot show that.
   */
  memorySeen: boolean;
  /** Conversations that hold the person's custom instructions as text. Their tokens are in the rows already. */
  conversationsWithCustomInstructions: number;
  /** Only codes with a count above zero, by code. */
  warnings: Warning[];
}

/**
 * First and last day of a window, both included, as YYYY-MM-DD in the Reading's calendar.
 * A window whose first day is after its last holds nothing.
 */
export interface Window {
  from: string;
  to: string;
}

/**
 * The six pieces of hidden work, in the order the maths takes them. The page's switches cover them
 * like this: "Thinking" is thinking. "Hidden instructions and memory" is systemPrompt and memory.
 * "Search results and file contents" is search and files. cacheMisses has no switch and is always on.
 */
export const PIECES = ['thinking', 'systemPrompt', 'memory', 'search', 'files', 'cacheMisses'] as const;
export type PieceId = (typeof PIECES)[number];

/**
 * Where the default of each hidden-work switch comes from.
 *
 * thinking        'recorded': the window has "Thought for …" lines. Switch on, "set from your export".
 *                 'model-name': it has none, but a thinking model answered. Switch on, "typical setting".
 *                 'none': nothing to add. Show no switch, or an inactive one.
 * memoryInUse     true: "set from your export". false: "typical setting". On either way: the export
 *                 cannot show that memory was off. This is about the whole export, not the window.
 *                 For the window alone, see Totals.memoryMessages.
 * searchOrFiles   true: the window has web sources or files without a token count. Switch on, "set
 *                 from your export". false: nothing to add. Show no switch, or an inactive one.
 */
export interface SwitchEvidence {
  thinking: 'recorded' | 'model-name' | 'none';
  memoryInUse: boolean;
  searchOrFiles: boolean;
}

/** One model's counted tokens. ChatGPT shows no cache writes, so cacheWrite is 0. */
export interface TokenRow extends ModelUsage {
  /**
   * The part of `freshInput` that is earlier conversation read again after a break of more than 30
   * minutes. It is inside `freshInput` already: never add it on top. The "new chat" tip needs it.
   */
  rereadFresh: number;
}

/** One window of a Reading, for one plan, in the form the maths takes. */
export interface Totals {
  /** Conversations with at least one message in the window. With 'all', every conversation counted. */
  conversations: number;
  messages: number;
  prompts: number;
  /** Answers that began in the window. This is the number to show as "answers". */
  answers: number;
  /**
   * Requests in the window. One per answer with text, more where older exports show tool calls.
   * Zero means there is nothing to estimate for this window, even when `answers` is not zero.
   */
  requests: number;
  coldRequests: number;
  /** Requests whose earlier conversation was cut at the plan's ceiling. */
  cutRequests: number;
  /**
   * The exact token rows: what was typed, what was answered, and every re-reading. One row per model
   * with at least one request, most tokens first. freshInput is the new input plus what cold
   * requests re-read. cacheRead is what warm requests re-read. Hidden work is not in here.
   */
  rows: TokenRow[];
  /** Requests per model, in the order of `rows`. For "{n} answers do not name a model", take the entries the classifier calls unknown. */
  requestsByModel: Array<{ model: string; requests: number }>;
  /**
   * The base of each piece of hidden work, keyed in the order of PIECES. A piece adds amount × base,
   * where the amount is its slider's value. A row gives units per model, filed under the token type
   * they count as. The units are not tokens, except for cacheMisses:
   *
   * thinking      seconds of thinking, recorded and assumed, under `output`
   * systemPrompt  readings of today's hidden prompt, under `cacheRead`. A fraction
   * memory        readings of the memory block, one per request: under `cacheRead` for a warm request, `freshInput` for a cold one
   * search        web sources shown, under `freshInput`
   * files         files without a token count, under `freshInput`
   * cacheMisses   tokens re-read from the cache, under `freshInput`. Equal to the rows' cacheRead. The amount is the share that missed
   *
   * Models with nothing to add are left out, so a base can be empty. Pass all six all the same.
   */
  hidden: Record<PieceId, ModelUsage[]>;
  evidence: SwitchEvidence;
  /** "Thought for …" lines in the window. */
  recaps: number;
  /** Seconds of thinking read from the export, and seconds assumed where the export gives none. */
  thinkingSeconds: number;
  thinkingSecondsAssumed: number;
  /** Requests with a recorded thinking time, and requests with an assumed one. */
  thinkingRecorded: number;
  thinkingAssumed: number;
  /** Web sources listed, and the requests that list any. */
  sources: number;
  searchRequests: number;
  /** Uploaded files without and with a token count, and images sent. */
  filesWithoutCount: number;
  filesWithCount: number;
  images: number;
  /** Messages with a voice transcript. Above zero: say that voice chats are counted by their transcript only. */
  transcripts: number;
  /** Messages in the window that show memory in use. Zero does not mean memory was off. */
  memoryMessages: number;
}

const DAY_SECONDS = 86_400;

/** The day number of a time in Unix seconds: days since 1 Jan 1970, counted in UTC. */
export function dayIndex(seconds: number): number {
  return Math.floor(seconds / DAY_SECONDS);
}

/**
 * The day number of a time in a calendar. For 'local' it is the number of the date the computer's
 * own clock shows at that moment, so summer time and the time zone are taken care of.
 */
export function dayIndexIn(calendar: Calendar, seconds: number): number {
  if (calendar === 'utc') return dayIndex(seconds);
  const date = new Date(seconds * 1000);
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/** YYYY-MM-DD for a day number. */
export function dayName(index: number): string {
  return new Date(index * DAY_SECONDS * 1000).toISOString().slice(0, 10);
}

/** The day number of YYYY-MM-DD. Throws on anything else: the days come from our own code. */
export function dayFromName(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const ms = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
  if (!Number.isFinite(ms) || dayName(ms / 86_400_000) !== day) throw new RangeError(`not a day: ${day}`);
  return ms / 86_400_000;
}

/**
 * For tests: the page makes its window from today's date itself.
 *
 * The window of `days` calendar days that ends on the day of `end` (Unix seconds), that day included,
 * in the calendar of this reading. With `end` as now, this is "the last 30 days": 29 whole days and
 * today so far. With `end` as reading.lastMessage, it is the 30 days before the export was made.
 *
 * A request dated after the last day is not in the window. That matters for one case only: the
 * computer's clock is behind, and a request seems to lie some hours ahead, on tomorrow's date.
 * To take those in, end the window at now + 86,400.
 */
export function windowOf(reading: Reading, end: number, days = 30): Window {
  return windowEndingAt(end, days, reading.calendar);
}

/** The same for a calendar given by name. A window must be in the calendar of the Reading it is used on. */
export function windowEndingAt(end: number, days = 30, calendar: Calendar = 'utc'): Window {
  const last = dayIndexIn(calendar, end);
  return { from: dayName(last - days + 1), to: dayName(last) };
}

/**
 * For tests: the page reads `reading.plusUser` itself, because its switch also needs to know when
 * the export did not say.
 *
 * The plan the export points to: 'free' when user.json says so, 'paid' otherwise. The person can
 * overrule it. The plan only sets the ceiling on re-read text. Go counts as 'paid' here.
 */
export function planFromExport(reading: Reading): Plan {
  return reading.plusUser === false ? 'free' : 'paid';
}

const usage = (model: string): ModelUsage => ({ model, freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
const tokensOf = (row: ModelUsage) => row.freshInput + row.cacheWrite + row.cacheRead + row.output;

class Table {
  private readonly rows = new Map<string, ModelUsage>();
  add(model: string, type: 'freshInput' | 'cacheRead' | 'output', units: number): void {
    if (!(units > 0)) return;
    let row = this.rows.get(model);
    if (!row) this.rows.set(model, (row = usage(model)));
    row[type] += units;
  }
  touch(model: string): void {
    if (!this.rows.has(model)) this.rows.set(model, usage(model));
  }
  list(): ModelUsage[] {
    return [...this.rows.values()].sort((a, b) => tokensOf(b) - tokensOf(a) || (a.model < b.model ? -1 : 1));
  }
}

/**
 * The totals of one window, or of the whole export with 'all', for one plan.
 * A request belongs to a window by its own time. What it re-read may be older.
 * Throws a RangeError when a day of the window is not YYYY-MM-DD.
 */
export function totals(reading: Reading, window: Window | 'all', plan: Plan): Totals {
  const from = window === 'all' ? -Infinity : dayFromName(window.from);
  const to = window === 'all' ? Infinity : dayFromName(window.to);
  const paid = plan === 'paid';

  const rows = new Table();
  const hidden = { thinking: new Table(), systemPrompt: new Table(), memory: new Table(), search: new Table(), files: new Table(), cacheMisses: new Table() };
  const requestsOf = new Map<string, number>();
  const rereadFresh = new Map<string, number>();
  const sum = {
    messages: 0, prompts: 0, answers: 0, recaps: 0, transcripts: 0, memoryMessages: 0, requests: 0, coldRequests: 0, cutRequests: 0,
    thinkingSeconds: 0, thinkingSecondsAssumed: 0, thinkingRecorded: 0, thinkingAssumed: 0,
    sources: 0, searchRequests: 0, filesWithoutCount: 0, filesWithCount: 0, images: 0,
  };

  const take = (day: Day): void => {
    sum.messages += day.messages;
    sum.prompts += day.prompts;
    sum.answers += day.answers;
    sum.recaps += day.recaps;
    sum.transcripts += day.transcripts;
    sum.memoryMessages += day.memoryMessages;
    for (const m of day.models) {
      const warm = paid ? m.rereadWarmPaid : m.rereadWarmFree;
      const cold = paid ? m.rereadColdPaid : m.rereadColdFree;
      rows.touch(m.model);
      rows.add(m.model, 'output', m.output);
      rows.add(m.model, 'freshInput', m.newInput + cold);
      rows.add(m.model, 'cacheRead', warm);
      hidden.thinking.add(m.model, 'output', m.thinkingSeconds + m.thinkingSecondsAssumed);
      hidden.systemPrompt.add(m.model, 'cacheRead', m.promptReadings);
      hidden.memory.add(m.model, 'cacheRead', m.requests - m.coldRequests);
      hidden.memory.add(m.model, 'freshInput', m.coldRequests);
      hidden.search.add(m.model, 'freshInput', m.sources);
      hidden.files.add(m.model, 'freshInput', m.filesWithoutCount);
      hidden.cacheMisses.add(m.model, 'freshInput', warm);
      requestsOf.set(m.model, (requestsOf.get(m.model) ?? 0) + m.requests);
      rereadFresh.set(m.model, (rereadFresh.get(m.model) ?? 0) + cold);
      sum.requests += m.requests;
      sum.coldRequests += m.coldRequests;
      sum.cutRequests += paid ? m.cutPaid : m.cutFree;
      sum.thinkingSeconds += m.thinkingSeconds;
      sum.thinkingSecondsAssumed += m.thinkingSecondsAssumed;
      sum.thinkingRecorded += m.thinkingRecorded;
      sum.thinkingAssumed += m.thinkingAssumed;
      sum.sources += m.sources;
      sum.searchRequests += m.searchRequests;
      sum.filesWithoutCount += m.filesWithoutCount;
      sum.filesWithCount += m.filesWithCount;
      sum.images += m.images;
    }
  };

  for (const day of reading.days) {
    const index = dayFromName(day.day);
    if (index >= from && index <= to) take(day);
  }
  if (window === 'all') take(reading.undated);

  let conversations = reading.conversations;
  if (window !== 'all') {
    conversations = 0;
    for (const days of reading.conversationDays) if (days.some((d) => d >= from && d <= to)) conversations++;
  }

  const list: TokenRow[] = rows.list().map((row) => ({ ...row, rereadFresh: rereadFresh.get(row.model) ?? 0 }));
  return {
    conversations,
    ...sum,
    rows: list,
    requestsByModel: list.map((row) => ({ model: row.model, requests: requestsOf.get(row.model) ?? 0 })),
    hidden: {
      thinking: hidden.thinking.list(),
      systemPrompt: hidden.systemPrompt.list(),
      memory: hidden.memory.list(),
      search: hidden.search.list(),
      files: hidden.files.list(),
      cacheMisses: hidden.cacheMisses.list(),
    },
    evidence: {
      thinking: sum.recaps > 0 ? 'recorded' : sum.thinkingSecondsAssumed > 0 ? 'model-name' : 'none',
      memoryInUse: reading.memorySeen,
      searchOrFiles: sum.sources > 0 || sum.filesWithoutCount > 0,
    },
  };
}
