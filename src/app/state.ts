// What the store keeps, and the one function that moves it on. Plain data in, plain data out: no
// clock, no timer and no worker in here, and nothing of it outlives the tab.
//
// The person can change four things: the data, the set sliders, the applied tips and the flipped
// switches. `reduce` says what each action does to them.

import type { SourceId } from '../contracts/usage';
import type { Stage } from '../contracts/view';
import { DEFAULT_LEAD, SLIDERS, isSliderId, rowOf } from '../model/assumptions';
import type { EnergyClass, SliderId } from '../model/assumptions';
import { isSwitchId } from '../model/hidden';
import type { SwitchId } from '../model/hidden';
import { isTipId } from '../model/tips';
import type { TipId } from '../model/tips';
import type { ExportReport, ReadOutcome, ReadProgress, Reading } from '../sources/chatgpt';
import { readAnswer } from '../sources/claude-code';
import type { AnswerOk, AnswerReading } from '../sources/claude-code';
import { positionOf } from '../track';
import { exportProblem } from './usage';
import type { ExportProblem } from './usage';
import { ANSWER_FAULT } from './words';

export type ExportState =
  | { readonly phase: 'waiting' }
  /** `progress` is null until the worker has reported once. */
  | { readonly phase: 'reading'; readonly progress: ReadProgress | null }
  | { readonly phase: 'problem'; readonly problem: ExportProblem }
  | { readonly phase: 'done'; readonly reading: Reading; readonly report: ExportReport };

/**
 * An answer the reader accepted and the page then failed on. It is shown like a refused answer, with
 * a sentence of its own. The reader never gives this code.
 */
export interface AnswerFault {
  readonly state: 'problem';
  readonly code: 'page-fault';
  readonly message: string;
}

/** Everything the store keeps. Never changed in place. */
export interface State {
  /** null until the person picks a tool. */
  readonly source: SourceId | null;
  /** The browser's local date when a paste or an export was last read, also one that was refused. "" before the first. */
  readonly today: string;
  /** Claude Code: what is in the paste box, and what the reader made of it. */
  readonly answer: { readonly text: string; readonly reading: AnswerReading | AnswerFault };
  /** ChatGPT: where the export stands. */
  readonly export: ExportState;
  /** The set sliders as track positions from 0 to 1. Only ids the chosen tool has. A slider that is not here varies. */
  readonly pins: Readonly<Partial<Record<SliderId, number>>>;
  /** The size whose row the energy slider shows now. A value for "energy" is read with this row. */
  readonly lead: EnergyClass;
  /** The tips that are switched on. */
  readonly applied: readonly TipId[];
  /** The ChatGPT switches that stand the other way round than their default. */
  readonly flipped: readonly SwitchId[];
}

/** What the reducer takes: the page's actions, with `today` added where data is read, and the reader's events. */
export type Event =
  | { readonly type: 'choose-source'; readonly source: SourceId }
  | { readonly type: 'switch-source' }
  | { readonly type: 'set-answer'; readonly text: string; readonly today: string }
  /** The store's own: no result could be worked out from the text that was just pasted. */
  | { readonly type: 'answer-failed'; readonly text: string }
  /** Files were dropped and a read is running. The files themselves never enter the state. */
  | { readonly type: 'read-started' }
  | { readonly type: 'read-progress'; readonly progress: ReadProgress }
  | { readonly type: 'read-ended'; readonly outcome: ReadOutcome; readonly today: string }
  | { readonly type: 'cancel-read' }
  | { readonly type: 'toggle-switch'; readonly id: string }
  | { readonly type: 'set-assumption'; readonly id: string; readonly value: number; readonly settled: boolean }
  | { readonly type: 'reset-assumptions' };

const NO_ANSWER: State['answer'] = Object.freeze({ text: '', reading: Object.freeze({ state: 'empty' }) });
const WAITING: ExportState = Object.freeze({ phase: 'waiting' });

/** The first visit: no tool, an empty box, nothing set. */
export function initialState(): State {
  return { source: null, today: '', answer: NO_ANSWER, export: WAITING, pins: {}, lead: DEFAULT_LEAD['claude-code'], applied: [], flipped: [] };
}

const isSource = (source: unknown): source is SourceId => source === 'claude-code' || source === 'chatgpt';

/** What an accepted answer says, without its object identity. */
const said = (answer: AnswerOk): string => JSON.stringify([answer.usage, answer.data, answer.coveredDays, answer.notes]);

/** The list with `id` taken out, or added when it was not in it. */
function flip<T>(list: readonly T[], id: T): T[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

function setAnswer(state: State, text: string, today: string): State {
  if (state.source !== 'claude-code' || text === state.answer.text) return state;
  const before = state.answer.reading;
  const reading = readAnswer(text, today);
  // The same answer pasted again, with a blank line or the prompt along, is not new data: the applied tips stay.
  if (before.state === 'ok' && reading.state === 'ok' && said(before) === said(reading)) {
    return { ...state, answer: { text, reading: before } };
  }
  return { ...state, answer: { text, reading }, today, applied: [], flipped: [] };
}

function readEnded(state: State, outcome: ReadOutcome, today: string): State {
  if (state.export.phase !== 'reading') return state;
  // Stopping a read is not an error: back to the steps.
  if (!outcome.ok && outcome.code === 'cancelled') return { ...state, export: WAITING };
  const problem = exportProblem(outcome, today, state.export.progress !== null);
  const next: ExportState = problem !== null || !outcome.ok
    ? { phase: 'problem', problem: problem ?? { code: 'E9' } }
    : { phase: 'done', reading: outcome.reading, report: outcome.report };
  return { ...state, export: next, today, applied: [], flipped: [] };
}

function toggleSwitch(state: State, id: string): State {
  const source = state.source;
  if (source === null || stageOf(state) !== 'done') return state;
  if (source === 'chatgpt' && isSwitchId(id)) return { ...state, flipped: flip(state.flipped, id) };
  if (isTipId(source, id)) return { ...state, applied: flip(state.applied, id) };
  return state;
}

function setAssumption(state: State, id: string, value: number): State {
  if (typeof id !== 'string' || !isSliderId(id)) return state;
  if (!SLIDERS[state.source ?? 'claude-code'].includes(id)) return state;
  if (typeof value !== 'number' || !Number.isFinite(value)) return state;
  // The value becomes a track position here, once, with the row the slider shows. Read again later
  // with another size's row, the same value would land somewhere else on the track.
  const position = positionOf(rowOf(id, state.lead).triple, value);
  return { ...state, pins: { ...state.pins, [id]: position } };
}

/** The next state. Pure. It returns the SAME object when the event changes nothing. */
export function reduce(state: State, event: Event): State {
  switch (event.type) {
    case 'choose-source': {
      const source = event.source;
      if (state.source !== null || !isSource(source)) return state;
      const pins: Partial<Record<SliderId, number>> = {};
      for (const id of SLIDERS[source]) {
        const position = state.pins[id];
        if (position !== undefined) pins[id] = position;
      }
      return { ...state, source, pins, lead: DEFAULT_LEAD[source] };
    }
    case 'switch-source': {
      if (state.source === null) return state;
      const source: SourceId = state.source === 'claude-code' ? 'chatgpt' : 'claude-code';
      return { ...initialState(), source, lead: DEFAULT_LEAD[source] };
    }
    case 'set-answer':
      return setAnswer(state, typeof event.text === 'string' ? event.text : '', event.today);
    case 'answer-failed':
      if (state.source !== 'claude-code') return state;
      return {
        ...state,
        answer: { text: typeof event.text === 'string' ? event.text : '', reading: { state: 'problem', code: 'page-fault', message: ANSWER_FAULT } },
        applied: [],
        flipped: [],
      };
    case 'read-started':
      if (state.source !== 'chatgpt') return state;
      return { ...state, export: { phase: 'reading', progress: null }, applied: [], flipped: [] };
    case 'read-progress':
      if (state.export.phase !== 'reading') return state;
      return { ...state, export: { phase: 'reading', progress: event.progress } };
    case 'read-ended':
      return readEnded(state, event.outcome, event.today);
    case 'cancel-read':
      if (state.export.phase !== 'reading') return state;
      return { ...state, export: WAITING };
    case 'toggle-switch':
      return toggleSwitch(state, event.id);
    case 'set-assumption':
      return setAssumption(state, event.id, event.value);
    case 'reset-assumptions':
      return { ...state, pins: {} };
    default:
      return state;
  }
}

/** choose: no tool. Claude Code: steps (empty box), problem, done. ChatGPT: steps (waiting), loading, problem, done. */
export function stageOf(state: State): Stage {
  if (state.source === null) return 'choose';
  if (state.source === 'claude-code') {
    const reading = state.answer.reading.state;
    return reading === 'ok' ? 'done' : reading === 'problem' ? 'problem' : 'steps';
  }
  const phase = state.export.phase;
  return phase === 'done' ? 'done' : phase === 'problem' ? 'problem' : phase === 'reading' ? 'loading' : 'steps';
}

/** Where the plan switch stands: on unless the export says the account has no Plus, turned round when flipped. true before data. */
export function isPaid(state: State): boolean {
  const fromExport = !(state.export.phase === 'done' && state.export.reading.plusUser === false);
  return state.flipped.includes('plan-paid') ? !fromExport : fromExport;
}

/** The same state with another `lead`. The same object when nothing changes. */
export function withLead(state: State, lead: EnergyClass): State {
  return state.lead === lead ? state : { ...state, lead };
}
