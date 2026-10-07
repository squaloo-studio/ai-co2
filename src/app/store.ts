// The store: it takes the page's actions and tells the page when the View has changed. Everything
// that calculates is pure and lives beside this file. Only this file touches a clock, a timer or the
// worker that reads an export, and all three are handed in, so a test can bring its own.

import type { Action, Store } from '../contracts/store';
import type { View } from '../contracts/view';
import { DEFAULT_LEAD } from '../model/assumptions';
import { startReading } from '../sources/chatgpt';
import type { ReadOutcome, ReadProgress, ReadingJob } from '../sources/chatgpt';
import { recalc } from './calc';
import type { Calc, CalcMode } from './calc';
import { localDay } from './days';
import { deriveView } from './derive';
import { initialState, isPaid, reduce, withLead } from './state';
import type { Event, State } from './state';
import { count } from './usage';
import type { Counted } from './usage';

/** Everything outside the pure part. */
export interface Env {
  /** The browser's local date as YYYY-MM-DD. */
  today(): string;
  /** Starts one read in a worker. */
  startReading(files: File[], onProgress: (progress: ReadProgress) => void): ReadingJob;
  /** Runs `run` once after `ms`. Returns a function that calls it off. */
  later(run: () => void, ms: number): () => void;
}

/** How long the pointer rests on a held slider before the tips are worked out again. */
export const REST_MS = 100;

const REAL: Env = {
  today: () => localDay(Date.now()),
  startReading: (files, onProgress) => startReading(files, onProgress),
  later: (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

/** The data a result is worked out from: the accepted answer, or the reading of the export. null while there is none. */
function acceptedData(state: State): object | null {
  if (state.source === 'claude-code') return state.answer.reading.state === 'ok' ? state.answer.reading : null;
  if (state.source === 'chatgpt') return state.export.phase === 'done' ? state.export.reading : null;
  return null;
}

/** The Store of the contract. Parts of `env` that are left out take their real form. */
export function createStore(env: Partial<Env> = {}): Store {
  const outside: Env = { today: env.today ?? REAL.today, startReading: env.startReading ?? REAL.startReading, later: env.later ?? REAL.later };

  let state = initialState();
  let counted: Counted | null = null;
  let calc: Calc | null = null;
  let view = deriveView(state, null, null);
  const listeners = new Set<(view: View, previous: View) => void>();

  /** The read that is running, with a number that tells its reports from those of a read given up before. */
  let job: ReadingJob | null = null;
  let reads = 0;
  /** Calls off the full call that is waiting for the pointer to rest. */
  let stopRest: (() => void) | null = null;

  /** Nothing from the person's data goes into the console: only that something failed. */
  const failed = (): void => console.error('ai-co2: the estimate could not be worked out');

  function show(next: View): void {
    const previous = view;
    view = next;
    // Every listener is told, also when one of them throws. Its error is passed on afterwards.
    let thrown: { error: unknown } | null = null;
    for (const listener of Array.from(listeners)) {
      try {
        listener(view, previous);
      } catch (error) {
        thrown ??= { error };
      }
    }
    if (thrown !== null) throw thrown.error;
  }

  /** One accepted event, from the action to the listeners. 'same': nothing changed. 'failed': it could not be worked out, and nothing changed. */
  function step(event: Event, mode: CalcMode): 'changed' | 'same' | 'failed' {
    let next: State;
    let nextCounted: Counted | null;
    let nextCalc: Calc | null;
    let nextView: View;
    try {
      next = reduce(state, event);
      if (next === state) return 'same';
      // The usage follows from the data and the plan alone. A slider, a tip or another switch leaves it as it is.
      const kept = counted !== null && acceptedData(next) === acceptedData(state) && isPaid(next) === isPaid(state);
      nextCounted = kept ? counted : count(next);
      nextCalc = nextCounted === null ? null : recalc(next, nextCounted, kept ? calc : null, mode);
      next = withLead(next, nextCalc === null ? DEFAULT_LEAD[next.source ?? 'claude-code'] : nextCalc.lead);
      nextView = deriveView(next, nextCounted, nextCalc);
    } catch {
      // A net. The readers and the checks before the estimator are there so that it is never needed.
      failed();
      return 'failed';
    }
    state = next;
    counted = nextCounted;
    calc = nextCalc;
    show(nextView);
    return 'changed';
  }

  /** The pointer has rested on a slider that is still held: the tips and the notes catch up. */
  function rested(): void {
    stopRest = null;
    if (counted === null || calc === null) return;
    let nextCalc: Calc;
    let nextView: View;
    try {
      nextCalc = recalc(state, counted, calc, 'rest');
      nextView = deriveView(state, counted, nextCalc);
    } catch {
      failed();
      return;
    }
    calc = nextCalc;
    show(nextView);
  }

  function callOffRest(): void {
    stopRest?.();
    stopRest = null;
  }

  function giveUpRead(): void {
    const running = job;
    job = null;
    reads += 1;
    running?.cancel();
  }

  function readEnded(outcome: ReadOutcome): void {
    const today = outside.today();
    if (step({ type: 'read-ended', outcome, today }, 'full') === 'changed') return;
    // The page must not stay on "reading" for good when the result could not be worked out.
    if (state.export.phase === 'reading') step({ type: 'read-ended', outcome: { ok: false, code: 'internal' }, today }, 'full');
  }

  function read(files: File[]): void {
    if (state.source !== 'chatgpt') return;
    giveUpRead();
    const mine = reads;
    step({ type: 'read-started' }, 'full');
    let started: ReadingJob;
    try {
      started = outside.startReading(files, (progress) => {
        if (mine === reads) step({ type: 'read-progress', progress }, 'full');
      });
    } catch {
      readEnded({ ok: false, code: 'worker-failed' });
      return;
    }
    job = started;
    void started.result.then(
      (outcome) => {
        // A read that was given up still answers. Its answer belongs to nobody.
        if (mine !== reads) return;
        job = null;
        readEnded(outcome);
      },
      () => {
        if (mine !== reads) return;
        job = null;
        readEnded({ ok: false, code: 'worker-failed' });
      },
    );
  }

  function dispatch(action: Action): void {
    if (typeof action !== 'object' || action === null) return;
    switch (action.type) {
      case 'choose-source':
        callOffRest();
        step({ type: 'choose-source', source: action.source }, 'full');
        break;
      case 'switch-source':
        callOffRest();
        giveUpRead();
        step({ type: 'switch-source' }, 'full');
        break;
      case 'set-answer':
        callOffRest();
        // The old result must not stay under a new text it does not belong to, with no word about it.
        if (step({ type: 'set-answer', text: action.text, today: outside.today() }, 'full') === 'failed') {
          step({ type: 'answer-failed', text: action.text }, 'full');
        }
        break;
      case 'add-files':
        callOffRest();
        read(Array.isArray(action.files) ? action.files : []);
        break;
      case 'cancel-read':
        callOffRest();
        giveUpRead();
        step({ type: 'cancel-read' }, 'full');
        break;
      case 'toggle-switch':
        callOffRest();
        step({ type: 'toggle-switch', id: action.id }, 'full');
        break;
      case 'set-assumption': {
        callOffRest();
        const event: Event = { type: 'set-assumption', id: action.id, value: action.value, settled: action.settled !== false };
        if (event.settled) {
          step(event, 'full');
        } else if (step(event, 'drag') === 'changed' && calc !== null) {
          stopRest = outside.later(rested, REST_MS);
        }
        break;
      }
      case 'reset-assumptions':
        callOffRest();
        step({ type: 'reset-assumptions' }, 'full');
        break;
      default:
        break;
    }
  }

  return {
    getView: () => view,
    dispatch,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
