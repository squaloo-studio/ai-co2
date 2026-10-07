// How often the store calls the estimator, and in which form. The estimator is the real one, with a
// counter in front of it, so these tests see every call and can make one fail.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '../contracts/store';
import type { View } from '../contracts/view';
import type * as Model from '../model/estimate';
import { estimate } from '../model/estimate';
import type { ReadOutcome } from '../sources/chatgpt';
import { REST_MS, createStore } from './store';
import { ANSWER_A, answer, exampleReading, flaws, outside, report, vector } from './test-kit';
import type { Outside } from './test-kit';

vi.mock('../model/estimate', async (importOriginal) => {
  const real = await importOriginal<typeof Model>();
  return { ...real, estimate: vi.fn(real.estimate) };
});

const calls = vi.mocked(estimate);
const real = await vi.importActual<typeof Model>('../model/estimate');
/** The options of every call since the counter was last cleared. */
const forms = (): Array<'full' | 'fast' | 'other'> =>
  calls.mock.calls.map(([, options]) => (options?.marketGrid === 70 && options.tips === undefined ? 'full' : options?.tips === false && options.biggestUnknown === false ? 'fast' : 'other'));

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
  // A test may have made the estimator fail. The next one gets the real one back.
  calls.mockReset();
  calls.mockImplementation(real.estimate);
});

function claude(text: string, world: Outside): Store {
  const store = createStore(world.env);
  store.dispatch({ type: 'choose-source', source: 'claude-code' });
  store.dispatch({ type: 'set-answer', text });
  calls.mockClear();
  return store;
}

async function chatgpt(outcome: ReadOutcome, world: Outside): Promise<Store> {
  const store = createStore(world.env);
  store.dispatch({ type: 'choose-source', source: 'chatgpt' });
  store.dispatch({ type: 'add-files', files: [] });
  await world.read().end(outcome);
  calls.mockClear();
  return store;
}

const drag = (store: Store, id: string, value: number): void => store.dispatch({ type: 'set-assumption', id, value, settled: false });
const release = (store: Store, id: string, value: number): void => store.dispatch({ type: 'set-assumption', id, value, settled: true });
function resultOf(view: View): NonNullable<View['result']> {
  if (!view.result) throw new Error('no result');
  return view.result;
}
/** What must stand still while a slider moves. */
const kept = (view: View): unknown => ({
  tips: view.tips,
  noTipsNote: view.noTipsNote,
  notes: view.method.notes,
  switchNotes: resultOf(view).switches.items.map((item) => [item.id, item.label, item.note]),
  appliedLabel: resultOf(view).appliedLabel,
});

/** Fixture A at a fortieth: 92 to 856 g, just under the step to kilograms. */
const NEAR_A_KILOGRAM = answer(vector('A').input.rows.map((row) => ({
  model: row.model,
  in: Math.round((row.freshInput ?? 0) / 40),
  write: Math.round((row.cacheWrite ?? 0) / 40),
  read: Math.round((row.cacheRead ?? 0) / 40),
  out: Math.round((row.output ?? 0) / 40),
})));

describe('how often the estimator is called', () => {
  it('once in full when the result first appears, with one more short call to pick the size the energy slider shows', () => {
    const world = outside();
    const store = createStore(world.env);
    store.dispatch({ type: 'choose-source', source: 'claude-code' });
    expect(calls).not.toHaveBeenCalled();
    store.dispatch({ type: 'set-answer', text: ANSWER_A });
    expect(forms().sort()).toEqual(['fast', 'full']);
    expect(calls.mock.calls.map(([, options]) => options)).toContainEqual({ marketGrid: 70 });
  });

  it('once in full after every change that is not a drag', () => {
    const store = claude(ANSWER_A, outside());
    const steps: Array<() => void> = [
      () => store.dispatch({ type: 'toggle-switch', id: 'cc-clear' }),
      () => release(store, 'grid', 300),
      () => store.dispatch({ type: 'reset-assumptions' }),
      () => store.dispatch({ type: 'toggle-switch', id: 'cc-clear' }),
    ];
    for (const step of steps) {
      calls.mockClear();
      step();
      expect(forms().filter((form) => form === 'full')).toHaveLength(1);
      expect(forms()).not.toContain('other');
    }
  });

  it('not at all for an action that changes nothing, and not while there is no result', () => {
    const store = claude(ANSWER_A, outside());
    store.dispatch({ type: 'toggle-switch', id: 'thinking' });
    store.dispatch({ type: 'set-answer', text: ANSWER_A });
    store.dispatch({ type: 'cancel-read' });
    expect(calls).not.toHaveBeenCalled();
    store.dispatch({ type: 'set-answer', text: 'no answer' });
    release(store, 'grid', 300);
    drag(store, 'pue', 1.1);
    store.dispatch({ type: 'reset-assumptions' });
    expect(calls).not.toHaveBeenCalled();
  });

  it('for ChatGPT one more short call each time, for the whole-history line', async () => {
    const world = outside();
    const store = createStore(world.env);
    store.dispatch({ type: 'choose-source', source: 'chatgpt' });
    store.dispatch({ type: 'add-files', files: [] });
    await world.read().end({ ok: true, reading: exampleReading('current', true), report: report() });
    expect(forms().sort()).toEqual(['fast', 'fast', 'full']);
    calls.mockClear();
    store.dispatch({ type: 'toggle-switch', id: 'thinking' });
    expect(forms().sort()).toEqual(['fast', 'fast', 'full']);
    calls.mockClear();
    drag(store, 'grid', 300);
    expect(forms()).toEqual(['fast', 'fast']);
  });
});

describe('a dragged slider', () => {
  it('sends no full call until it is let go: one short call for each move', () => {
    const world = outside();
    const store = claude(ANSWER_A, world);
    const before = store.getView();
    const seen: View[] = [];
    store.subscribe((view) => seen.push(view));

    for (const value of [360, 380, 400, 430, 460]) drag(store, 'grid', value);
    expect(forms()).toEqual(['fast', 'fast', 'fast', 'fast', 'fast']);
    expect(seen).toHaveLength(5);

    // The result, the slider, the costs and the extreme range follow the thumb.
    const middles = seen.map((view) => resultOf(view).range.mid);
    expect(middles).toEqual([...middles].sort((a, b) => a - b));
    expect(middles[0]).toBeGreaterThan(resultOf(before).range.mid);
    const last = seen.at(-1);
    if (!last) throw new Error('no view');
    expect(last.method.assumptions.find((entry) => entry.id === 'grid')).toMatchObject({ value: 460, pinned: true });
    expect(resultOf(last).setLabel).toBe('With 1 assumption set by you');
    expect(last.contribute?.costSentence).not.toBe(before.contribute?.costSentence);
    expect(last.method.extreme?.low).toBeGreaterThan(before.method.extreme?.low ?? Infinity);
    expect(last.method.extremeLabel).toBe('Extreme range (every assumption you have not set, at its low or at its high)');

    // The tips, their texts, the notes of their switches and the method notes stay as they were.
    for (const view of seen) {
      expect(kept(view)).toEqual(kept(before));
      view.tips.forEach((tip, index) => expect(tip).toBe(before.tips[index]));
      expect(flaws(view)).toEqual([]);
    }

    calls.mockClear();
    release(store, 'grid', 460);
    expect(forms().sort()).toEqual(['fast', 'full']);
    const settled = store.getView();
    expect(resultOf(settled).range).toEqual(resultOf(last).range);
    expect(kept(settled)).not.toEqual(kept(before));
    // "Now" in every tip is the range with the slider where it was let go.
    expect(settled.tips.every((tip) => tip.now.mid === resultOf(settled).range.mid)).toBe(true);
    expect(settled.method.notes[0]).toContain('Of the assumptions you have not set, what matters most is “Energy to write 1,000 tokens, large models”.');
  });

  it('gets the tips and the notes worked out again once the pointer has rested, with the slider still held', () => {
    const world = outside();
    const store = claude(ANSWER_A, world);
    const before = store.getView();
    drag(store, 'grid', 400);
    drag(store, 'grid', 460);
    const moving = store.getView();
    // Every move sets the timer again, so only the last one is left.
    expect(world.timers.map((timer) => [timer.ms, timer.off])).toEqual([[REST_MS, true], [REST_MS, false]]);
    expect(REST_MS).toBe(100);

    calls.mockClear();
    const told: View[] = [];
    store.subscribe((view) => told.push(view));
    world.timer()?.run();
    expect(forms()).toEqual(['full']);
    expect(told).toHaveLength(1);
    const rested = store.getView();
    expect(resultOf(rested).range).toEqual(resultOf(moving).range);
    expect(kept(rested)).not.toEqual(kept(before));
    expect(rested.tips[0]?.body).not.toEqual(before.tips[0]?.body);

    // Let go at the same place: the same View as after the rest.
    release(store, 'grid', 460);
    expect(store.getView()).toEqual(rested);
    // No timer is left behind.
    expect(world.timer()).toBeUndefined();
  });

  it('never lets the scale step down while it moves, and fits it afresh when it is let go', () => {
    const world = outside();
    const store = claude(ANSWER_A, world);
    expect(resultOf(store.getView()).scaleMax).toBe(50);
    const scales: number[] = [];
    store.subscribe((view) => scales.push(resultOf(view).scaleMax));

    // Up to the high end of the energy row, and back down past where it started.
    for (const value of [1.5, 3, 5.4, 3, 1.5, 0.8, 0.5]) drag(store, 'energy', value);
    expect(scales).toEqual([...scales].sort((a, b) => a - b));
    const top = Math.max(...scales);
    expect(top).toBeGreaterThan(50);
    expect(scales.at(-1)).toBe(top);
    // The range itself has come down. Only the scale has stayed.
    expect(resultOf(store.getView()).range.p95).toBeLessThan(20);

    // A rest is not a release.
    world.timer()?.run();
    expect(resultOf(store.getView()).scaleMax).toBe(top);

    release(store, 'energy', 0.5);
    expect(resultOf(store.getView()).scaleMax).toBeLessThan(50);
    expect(resultOf(store.getView()).scaleMax * 1.0000001).toBeGreaterThanOrEqual(resultOf(store.getView()).range.p95 * 1.08);
  });

  it('lets the unit only go up while it moves', () => {
    const world = outside();
    const store = claude(NEAR_A_KILOGRAM, world);
    expect([resultOf(store.getView()).unit, resultOf(store.getView()).scaleMax]).toEqual(['g', 1]);
    const before = store.getView();
    const units: string[] = [];
    store.subscribe((view) => units.push(`${resultOf(view).unit}/${view.method.unit}`));

    for (const value of [1.2, 5.4, 1, 0.5]) drag(store, 'energy', value);
    expect(units).toEqual(['g/g', 'kg/kg', 'kg/kg', 'kg/kg']);
    // The tips keep the words of the last full call, in the unit they were worded in.
    expect(kept(store.getView())).toEqual(kept(before));
    expect(store.getView().method.notes[0]).toMatch(/ g\.$/);

    world.timer()?.run();
    expect(resultOf(store.getView()).unit).toBe('kg');
    expect(store.getView().method.notes[0]).toMatch(/ kg\.$/);

    release(store, 'energy', 0.5);
    expect(resultOf(store.getView()).unit).toBe('g');
    expect(store.getView().method.notes[0]).toMatch(/ g\.$/);
  });

  it('keeps a tip that is on, its ghost and its tag while it moves', () => {
    const world = outside();
    const store = claude(ANSWER_A, world);
    store.dispatch({ type: 'toggle-switch', id: 'cc-clear' });
    const before = store.getView();
    calls.mockClear();
    drag(store, 'cacheRead', 0.05);
    expect(forms()).toEqual(['fast']);
    const moving = store.getView();
    expect(resultOf(moving).appliedLabel).toBe('With: A third less re-reading');
    expect(resultOf(moving).baseline?.mid).toBeGreaterThan(resultOf(before).baseline?.mid ?? Infinity);
    expect(resultOf(moving).range.mid).toBeLessThan(resultOf(moving).baseline?.mid ?? 0);
    expect(moving.method.extremeLabel).toBe('Extreme range (every assumption you have not set, at its low or at its high, with your tip applied)');
    expect(kept(moving)).toEqual(kept(before));
  });

  it('moves the whole-history line of ChatGPT along', async () => {
    const world = outside();
    const store = await chatgpt({ ok: true, reading: exampleReading('current', true), report: report() }, world);
    const before = store.getView();
    drag(store, 'grid', 460);
    const moving = store.getView();
    expect(resultOf(moving).history?.range.mid).toBeGreaterThan(resultOf(before).history?.range.mid ?? Infinity);
    expect(resultOf(moving).history?.since).toBe('July 2026');
    expect(kept(moving)).toEqual(kept(before));
    expect(moving.data.chatgpt.status).toMatchObject({ state: 'ok', notes: before.data.chatgpt.status.state === 'ok' ? before.data.chatgpt.status.notes : [] });
  });

  it('before the data is in only moves the slider: no call, and no timer', () => {
    const world = outside();
    const store = createStore(world.env);
    store.dispatch({ type: 'choose-source', source: 'claude-code' });
    const told = vi.fn();
    store.subscribe(told);
    drag(store, 'grid', 400);
    expect(told).toHaveBeenCalledTimes(1);
    expect(store.getView().method.assumptions.find((entry) => entry.id === 'grid')).toMatchObject({ pinned: true });
    expect(calls).not.toHaveBeenCalled();
    expect(world.timers).toHaveLength(0);
  });

  it('has its waiting full call called off by whatever comes next', () => {
    for (const next of [
      (store: Store) => store.dispatch({ type: 'toggle-switch', id: 'cc-clear' }),
      (store: Store) => store.dispatch({ type: 'reset-assumptions' }),
      (store: Store) => store.dispatch({ type: 'set-answer', text: '' }),
      (store: Store) => store.dispatch({ type: 'switch-source' }),
      (store: Store) => release(store, 'grid', 400),
    ]) {
      const world = outside();
      const store = claude(ANSWER_A, world);
      drag(store, 'grid', 400);
      const waiting = world.timer();
      expect(waiting?.off).toBe(false);
      next(store);
      expect(waiting?.off).toBe(true);
      expect(world.timer()).toBeUndefined();
      // A timer that fires all the same finds nothing to do, or does what a rest does. It never throws.
      const told = vi.fn();
      store.subscribe(told);
      expect(() => waiting?.run()).not.toThrow();
      expect(flaws(store.getView())).toEqual([]);
    }
  });
});

describe('when the estimator refuses what it is handed', () => {
  const refuse = (): never => {
    throw new Error('ai-co2: a refusal made up for this test');
  };

  it('the action is dropped: the View stays, no listener is called, and the console says only that it failed', () => {
    const store = claude(ANSWER_A, outside());
    const before = store.getView();
    const told = vi.fn();
    store.subscribe(told);
    calls.mockImplementationOnce(refuse);
    expect(() => store.dispatch({ type: 'toggle-switch', id: 'cc-clear' })).not.toThrow();
    expect(store.getView()).toBe(before);
    expect(told).not.toHaveBeenCalled();
    expect(errors.mock.calls).toEqual([['ai-co2: the estimate could not be worked out']]);
    // The next action finds the store as it was.
    store.dispatch({ type: 'toggle-switch', id: 'cc-clear' });
    expect(resultOf(store.getView()).appliedLabel).toBe('With: A third less re-reading');
    expect(told).toHaveBeenCalledTimes(1);
  });

  it('a rest that fails leaves the View of the drag', () => {
    const world = outside();
    const store = claude(ANSWER_A, world);
    drag(store, 'grid', 400);
    const moving = store.getView();
    calls.mockImplementationOnce(refuse);
    expect(() => world.timer()?.run()).not.toThrow();
    expect(store.getView()).toBe(moving);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('a read whose result cannot be worked out ends as a problem, never as a page that reads for ever', async () => {
    const world = outside();
    const store = createStore(world.env);
    store.dispatch({ type: 'choose-source', source: 'chatgpt' });
    store.dispatch({ type: 'add-files', files: [] });
    calls.mockImplementation(refuse);
    await world.read().end({ ok: true, reading: exampleReading('current', true), report: report() });
    expect(store.getView().stage).toBe('problem');
    expect(store.getView().data.chatgpt.status).toEqual({
      state: 'problem',
      message: 'The page could not finish reading this export. Close other tabs and try again, or unzip it on your computer and drop only the conversations files.',
    });
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('an answer whose result cannot be worked out is told so: the old result does not stay under the new text', () => {
    const world = outside();
    const store = claude(ANSWER_A, world);
    store.dispatch({ type: 'set-assumption', id: 'grid', value: 300, settled: true });
    store.dispatch({ type: 'toggle-switch', id: 'cc-clear' });
    expect(store.getView().stage).toBe('done');
    const told = vi.fn();
    store.subscribe(told);

    const other = answer([{ model: 'claude-opus-5-5', in: 1000, out: 500 }]);
    calls.mockImplementation(refuse);
    expect(() => store.dispatch({ type: 'set-answer', text: other })).not.toThrow();
    const view = store.getView();
    expect(view.stage).toBe('problem');
    expect(view.result).toBeNull();
    expect(view.tips).toEqual([]);
    expect(view.contribute).toBeNull();
    expect(view.data.claudeCode.answer).toBe(other);
    expect(view.data.claudeCode.status).toEqual({
      state: 'problem',
      message: 'The page could not work out a result from this answer. The fault is in the page, not in your answer.',
    });
    expect(flaws(view)).toEqual([]);
    expect(told).toHaveBeenCalledTimes(1);
    // One fixed line in the console, with nothing from the answer in it.
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]).toEqual(['ai-co2: the estimate could not be worked out']);
    // The set slider is kept, as for any refused answer, and the applied tip is dropped.
    expect(view.method.assumptions.filter((entry) => entry.pinned).map((entry) => entry.id)).toEqual(['grid']);

    // The page works again as soon as the estimator does: the same text, typed again, is taken as new.
    calls.mockImplementation(real.estimate);
    store.dispatch({ type: 'set-answer', text: `${other}\n` });
    expect(store.getView().stage).toBe('done');
    expect(resultOf(store.getView()).appliedLabel).toBeNull();
    store.dispatch({ type: 'set-answer', text: '' });
    expect(store.getView().stage).toBe('steps');
  });
});
