// For the tests of the store: made-up answers and exports, a stand-in for everything outside the
// pure part, and helpers that read a View the way a person would. Everything here is invented data.

import type { View } from '../contracts/view';
import vectorsFile from '../model/fixtures/vectors.json?raw';
import currentShape from '../sources/chatgpt/account/fixtures/export.current-shape.json?raw';
import olderShape from '../sources/chatgpt/account/fixtures/export.older-shape.json?raw';
import { createAccount } from '../sources/chatgpt/account/account';
import type { ExportReport, ReadOutcome, ReadProgress, Reading, ReadingJob } from '../sources/chatgpt';
import { recalc } from './calc';
import type { Calc } from './calc';
import { deriveView } from './derive';
import { initialState, reduce, withLead } from './state';
import type { Event, State } from './state';
import type { Env } from './store';
import { count } from './usage';
import type { Counted } from './usage';

export const TODAY = '2026-10-07';
/** The 30 days that end on TODAY. */
export const WINDOW = { from: '2026-09-08', to: '2026-10-07' };

// ---------- the estimator's own test vectors ----------

interface VectorRow {
  model: string;
  sizeClass: string;
  freshInput?: number;
  cacheWrite?: number;
  cacheRead?: number;
  output?: number;
}
export interface Vector {
  name: string;
  input: { rows: VectorRow[] };
  expected: {
    range: { p5: number; mid: number; p95: number };
    dots: number[];
    extreme: { low: number; high: number };
    single: boolean;
    car: { p5: number; mid: number; p95: number };
    shares: { models: Array<{ model: string; share: number }> };
  };
}

// Taken in as text, so the same helper works in a test that runs in a page.
const VECTORS = JSON.parse(vectorsFile) as { vectors: Vector[] };

export function vector(name: string): Vector {
  const found = VECTORS.vectors.find((entry) => entry.name === name);
  if (!found) throw new Error(`no vector called ${name}`);
  return found;
}

// ---------- Claude Code answers ----------

export interface Line {
  model: string;
  in?: number;
  write?: number;
  read?: number;
  out?: number;
}

/** An answer in the script's own format. `data` is the first and the last day with data. */
export function answer(lines: readonly Line[], options: { from?: string; to?: string; first?: string; last?: string } = {}): string {
  const from = options.from ?? WINDOW.from;
  const to = options.to ?? WINDOW.to;
  let total = 0;
  const body = lines.map((line) => {
    const counts = [line.in ?? 0, line.write ?? 0, line.read ?? 0, line.out ?? 0] as const;
    total += counts[0] + counts[1] + counts[2] + counts[3];
    return `${line.model} | in ${counts[0]} | cache_write ${counts[1]} | cache_read ${counts[2]} | out ${counts[3]}`;
  });
  return [`ai-co2 v1 | ${from} to ${to} | data ${options.first ?? from} to ${options.last ?? to}`, ...body, `total | ${total}`].join('\n');
}

/** The answer a person would paste whose counts are those of a test vector. */
export function answerOfVector(name: string): string {
  return answer(vector(name).input.rows.map((row) => ({ model: row.model, in: row.freshInput, write: row.cacheWrite, read: row.cacheRead, out: row.output })));
}

/** Fixture A: Opus 5.5, Sonnet 5 and Haiku 4.5, 3.7–34 kg. */
export const ANSWER_A = answerOfVector('A');
/** Fixture C: Haiku 4.5 alone, 0.51–2.9 g. */
export const ANSWER_GRAMS = answerOfVector('C');
/** A tenth of fixture C: 51–287 mg. */
export const ANSWER_MILLIGRAMS = answer([{ model: 'claude-haiku-4-5', in: 1200, write: 3000, read: 40000, out: 900 }]);

// ---------- ChatGPT exports ----------

const EXAMPLES = { current: currentShape, older: olderShape };

/** The invented example export, read by the real counting side. `now` is the day the example was made for. */
export function exampleReading(shape: keyof typeof EXAMPLES = 'current', plusUser: boolean | null = null): Reading {
  const now = Date.parse(shape === 'current' ? '2026-10-07T00:00:00Z' : '2026-04-07T00:00:00Z') / 1000;
  const account = createAccount({ now, calendar: 'utc' });
  for (const conversation of JSON.parse(EXAMPLES[shape]) as unknown[]) account.add(conversation);
  if (plusUser !== null) account.setUser({ chatgpt_plus_user: plusUser });
  return account.finish();
}

/** The file report of an export ZIP that was read with no trouble. */
export function report(change: Partial<ExportReport> = {}): ExportReport {
  return {
    files: [{ path: ['export.zip', 'conversations.json'], bytes: 4096, handed: 3, skipped: 0, problem: null }],
    filesNotListed: 0,
    notices: [],
    noticesNotListed: 0,
    totals: { archives: 1, conversationFiles: 1, filesWithProblems: 0, bytes: 4096, handed: 3, skipped: 0, userFiles: 0 },
    ...change,
  };
}

export function progress(change: Partial<ReadProgress> = {}): ReadProgress {
  return { bytesRead: 0, bytesTotal: null, conversations: 0, conversationsAbout: null, scan: null, ...change };
}

// ---------- everything outside the store ----------

export interface FakeRead {
  readonly files: File[];
  cancelled: boolean;
  /** A progress report from the worker. */
  progress(report: ReadProgress): void;
  /** The worker's answer. Resolves once the store has taken it. */
  end(outcome: ReadOutcome): Promise<void>;
}

export interface FakeTimer {
  readonly ms: number;
  /** true once it was called off, or has run: nothing is waiting any more. */
  off: boolean;
  /** Fires the timer, also one that was called off, as a late timer of a browser might. */
  run(): void;
}

export interface Outside {
  readonly env: Env;
  today: string;
  readonly reads: FakeRead[];
  readonly timers: FakeTimer[];
  /** The newest read, and the newest timer that is still waiting. */
  read(): FakeRead;
  timer(): FakeTimer | undefined;
}

/** A clock, a worker and a timer that do nothing until the test says so. */
export function outside(): Outside {
  const reads: FakeRead[] = [];
  const timers: FakeTimer[] = [];
  const world: Outside = {
    today: TODAY,
    reads,
    timers,
    read() {
      const last = reads.at(-1);
      if (!last) throw new Error('no read was started');
      return last;
    },
    timer: () => timers.filter((timer) => !timer.off).at(-1),
    env: {
      today: () => world.today,
      startReading(files, onProgress): ReadingJob {
        let settle: (outcome: ReadOutcome) => void = () => {};
        const result = new Promise<ReadOutcome>((resolve) => {
          settle = resolve;
        });
        const read: FakeRead = {
          files,
          cancelled: false,
          progress: onProgress,
          async end(outcome) {
            settle(outcome);
            await result;
            // One more turn, so the store's own "then" has run.
            await Promise.resolve();
          },
        };
        reads.push(read);
        return {
          result,
          cancel() {
            read.cancelled = true;
            settle({ ok: false, code: 'cancelled' });
          },
        };
      },
      later(run, ms) {
        const timer: FakeTimer = {
          ms,
          off: false,
          run() {
            timer.off = true;
            run();
          },
        };
        timers.push(timer);
        return () => {
          timer.off = true;
        };
      },
    },
  };
  return world;
}

// ---------- reading a View ----------

/** Every text in a value, however deep. */
export function texts(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const entry of value) texts(entry, found);
  else if (typeof value === 'object' && value !== null) for (const entry of Object.values(value)) texts(entry, found);
  return found;
}

/** Every number in a value, however deep. */
export function numbers(value: unknown, found: number[] = []): number[] {
  if (typeof value === 'number') found.push(value);
  else if (Array.isArray(value)) for (const entry of value) numbers(entry, found);
  else if (typeof value === 'object' && value !== null) for (const entry of Object.values(value)) numbers(entry, found);
  return found;
}

/** The sentences of a View: every text but the prompt and the pasted answer, which are not the page's words. */
export function sentences(view: View): string[] {
  return texts({ ...view, data: { claudeCode: view.data.claudeCode.status, chatgpt: view.data.chatgpt.status } });
}

/** What must never reach a person: a number that is none, a missing value printed as a word, an empty sentence. */
export function flaws(view: View): string[] {
  const found: string[] = [];
  for (const text of sentences(view)) {
    if (/\bNaN\b|undefined|\bnull\b|Infinity|\[object/.test(text)) found.push(text);
  }
  const mustSay = [view.method.formula, view.method.sliderNote, view.method.extremeLabel, ...view.method.counted, ...view.method.leftOut, ...view.method.notes];
  if (view.result) mustSay.push(view.result.summary, view.result.sourceName, view.result.switches.title, view.result.switches.note);
  if (view.contribute) mustSay.push(view.contribute.costSentence, ...view.contribute.options.map((option) => option.forYourRange));
  if (view.noTipsNote !== null) mustSay.push(view.noTipsNote);
  for (const tip of view.tips) mustSay.push(tip.title, tip.afterLabel, ...texts(tip.body));
  for (const status of [view.data.claudeCode.status, view.data.chatgpt.status]) {
    if (status.state === 'ok') mustSay.push(status.headline, status.confirmation, ...status.notes, ...status.models.map((row) => row.name));
    if (status.state === 'problem') mustSay.push(status.message);
    if (status.state === 'reading') mustSay.push(status.text);
  }
  if (mustSay.some((text) => text.trim() === '')) found.push('(an empty sentence)');
  if (numbers({ result: view.result, tips: view.tips, method: view.method, data: view.data }).some((n) => !Number.isFinite(n))) found.push('(a number that is none)');
  return found;
}

/** The words the page never uses as a claim about emissions, and "up to" beside a saving. */
export function bannedIn(text: string): string | null {
  const word = /offset|neutral|compensat|net[- ]zero|carbon debt|\bow(e|es|ed|ing)\b|pay(s|ing)? off|guilt/i.exec(text);
  if (word) return word[0];
  // "Saves up to" is never true of a high end. The one exception is the sentence for a tip that can cost more.
  if (/\bup to\b/i.test(text) && /\bsav/i.test(text) && !/^Could save up to roughly .*, or cost up to roughly .* more\.?$/.test(text)) return 'up to';
  return null;
}

// ---------- the pure layers, one after the other ----------

/** The state after a run of events, starting from a first visit. */
export function stateAfter(events: readonly Event[], from: State = initialState()): State {
  return events.reduce(reduce, from);
}

/** What the store would hold and show for a state, worked out afresh. */
export function shownFor(state: State): { state: State; counted: Counted | null; calc: Calc | null; view: View } {
  const counted = count(state);
  const calc = counted === null ? null : recalc(state, counted, null, 'full');
  const led = calc === null ? state : withLead(state, calc.lead);
  return { state: led, counted, calc, view: deriveView(led, counted, calc) };
}

export const chose = (source: 'claude-code' | 'chatgpt'): Event => ({ type: 'choose-source', source });
export const paste = (text: string, today: string = TODAY): Event => ({ type: 'set-answer', text, today });
export const setTo = (id: string, value: number, settled = true): Event => ({ type: 'set-assumption', id, value, settled });
export const toggle = (id: string): Event => ({ type: 'toggle-switch', id });
/** The events of an export that was read with no trouble. */
export const readIn = (reading: Reading, files: ExportReport = report(), today: string = TODAY): Event[] => [
  { type: 'read-started' },
  { type: 'read-ended', outcome: { ok: true, reading, report: files }, today },
];
