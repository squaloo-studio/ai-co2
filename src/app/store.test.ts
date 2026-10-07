import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action, Store } from '../contracts/store';
import type { SourceStatus, View } from '../contracts/view';
import { mass, massRange } from '../format';
import { costSentence } from '../model/contribute';
import { SWITCH_GROUP } from '../model/hidden';
import type { ReadOutcome, Reading } from '../sources/chatgpt';
import { conversation, message, node, read } from '../sources/chatgpt/account/test-kit';
import type { Json } from '../sources/chatgpt/account/test-kit';
import { REST_MS, createStore } from './store';
import {
  ANSWER_A,
  ANSWER_GRAMS,
  ANSWER_MILLIGRAMS,
  TODAY,
  answer,
  bannedIn,
  exampleReading,
  flaws,
  outside,
  progress,
  report,
  sentences,
  vector,
} from './test-kit';
import type { Outside } from './test-kit';

const at = (day: string, clock = '12:00:00'): number => Date.parse(`${day}T${clock}Z`) / 1000;
const NOW = at(TODAY);

/** Every View a store of this file has shown. The last tests read them all. */
const SEEN: View[] = [];

/** A store whose Views are kept. */
function open(world: Outside = outside()): Store {
  const store = createStore(world.env);
  SEEN.push(store.getView());
  store.subscribe((view) => {
    SEEN.push(view);
  });
  return store;
}

function claude(text: string, world: Outside = outside()): Store {
  const store = open(world);
  store.dispatch({ type: 'choose-source', source: 'claude-code' });
  store.dispatch({ type: 'set-answer', text });
  return store;
}

const good = (reading: Reading): ReadOutcome => ({ ok: true, reading, report: report() });

async function chatgpt(outcome: ReadOutcome, world: Outside = outside()): Promise<Store> {
  const store = open(world);
  store.dispatch({ type: 'choose-source', source: 'chatgpt' });
  store.dispatch({ type: 'add-files', files: [] });
  await world.read().end(outcome);
  return store;
}

const set = (store: Store, id: string, value: number, settled = true): void => store.dispatch({ type: 'set-assumption', id, value, settled });
const toggle = (store: Store, id: string): void => store.dispatch({ type: 'toggle-switch', id });
const slider = (view: View, id: string): View['method']['assumptions'][number] | undefined => view.method.assumptions.find((entry) => entry.id === id);
const pinned = (view: View): string[] => view.method.assumptions.filter((entry) => entry.pinned).map((entry) => entry.id);
const ok = (status: SourceStatus): Extract<SourceStatus, { state: 'ok' }> => {
  if (status.state !== 'ok') throw new Error(`the status is ${status.state}`);
  return status;
};
function resultOf(view: View): NonNullable<View['result']> {
  if (!view.result) throw new Error('no result');
  return view.result;
}

/** One question and one answer in a conversation of its own. One word is one token. */
const turn = (id: string, time: number, model: string, question = 10, reply = 20): Json =>
  conversation([node('q', 'root', message('user', question, { time })), node('a', 'q', message('assistant', reply, { time: time + 30, model }))], { id, update_time: time + 30 });

/** One conversation of several questions and answers, each as [time, words asked, words answered]. */
function chat(id: string, model: string, turns: ReadonlyArray<readonly [time: number, question: number, reply: number]>): Json {
  const nodes: Array<[string, Json]> = [];
  let parent = 'root';
  let end = 0;
  turns.forEach(([time, question, reply], index) => {
    nodes.push(node(`q${index}`, parent, message('user', question, { time })));
    nodes.push(node(`a${index}`, `q${index}`, message('assistant', reply, { time: time + 30, model })));
    parent = `a${index}`;
    end = time + 30;
  });
  return conversation(nodes, { id, update_time: end });
}

// A long answer, a return after three hours (the conversation is read again afresh) and a quick reply
// (it is read again from the cache). So every tip and every piece of hidden work but the web has something to count.
const LONG_CHAT = chat('a', 'gpt-5-5', [[at('2026-09-20'), 2000, 300_000], [at('2026-09-20') + 10_800, 100, 1000], [at('2026-09-20') + 10_890, 100, 1000]]);
/** Enough use for tips to be worth showing: long answers of a large model, one of them from a thinking model. */
const BIG = read([LONG_CHAT, turn('b', at('2026-09-28'), 'gpt-5-5', 2000, 300_000), turn('c', at('2026-10-06'), 'gpt-5-5-thinking', 2000, 300_000)], { now: NOW });
/** The same person without the thinking model: nothing to count for the thinking piece. */
const NO_THINKING = read([LONG_CHAT, turn('b', at('2026-10-06'), 'gpt-5-5', 2000, 300_000)], { now: NOW });

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  // The net under the estimator is never needed.
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

// ---------- Claude Code: fixture A ----------

describe('fixture A, pasted as an answer', () => {
  const A = vector('A').expected;
  const store = claude(ANSWER_A);
  const view = store.getView();
  const result = resultOf(view);
  const close = (got: number, want: number): void => expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-9 * Math.abs(want));

  it('gives the range, the middle estimate and the 100 dots of the vectors', () => {
    close(result.range.p5, A.range.p5);
    close(result.range.mid, A.range.mid);
    close(result.range.p95, A.range.p95);
    expect(result.quantiles).toHaveLength(100);
    result.quantiles.forEach((dot, index) => close(dot, A.dots[index] ?? Number.NaN));
    expect(result.single).toBe(false);
    close(result.car.p5, A.car.p5);
    close(result.car.mid, A.car.mid);
    close(result.car.p95, A.car.p95);
    // About 61 km in the middle: the place picked beside it is the drive from Munich to Augsburg.
    expect(result.carPlace).toEqual({ text: ['About ', { strong: 'the drive from Munich to Augsburg' }, ' (66 km).'], road: { from: 'Munich', to: 'Augsburg', km: 66 }, beyond: false });
  });

  it('gives the extreme range of the vectors', () => {
    close(view.method.extreme?.low ?? Number.NaN, A.extreme.low);
    close(view.method.extreme?.high ?? Number.NaN, A.extreme.high);
    expect(view.method.unit).toBe('kg');
  });

  it('gives the model shares of the vectors, under the friendly names', () => {
    const rows = ok(view.data.claudeCode.status).models;
    expect(rows.map((row) => [row.name, row.tokens])).toEqual([['Opus 5.5', 576263273], ['Sonnet 5', 183752375], ['Haiku 4.5', 21415968]]);
    rows.forEach((row, index) => close(row.share, A.shares.models[index]?.share ?? Number.NaN));
  });

  it('fits a 50 kg scale in kilograms', () => {
    expect(result.unit).toBe('kg');
    expect(result.scaleMax).toBe(50);
    expect(massRange(result.range, result.unit)).toBe('3.7–34 kg');
    expect(mass(result.range.mid, result.unit)).toBe('9.8');
  });

  it('words the result with those numbers printed', () => {
    expect(view.stage).toBe('done');
    expect(result.summary).toBe('Likely CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct)');
    expect(ok(view.data.claudeCode.status).headline).toBe('3 models · 781 million tokens · 8 Sep – 7 Oct');
    // The sentence is the contribute chapter's own, with this result's printed range in it.
    expect(view.contribute?.costSentence).toBe(costSentence(result.range, 'kg', false));
    expect(view.contribute?.costSentence).toContain(' for 3.7–34 kg of CO₂, the size of your estimate.');
    expect(view.contribute?.options.map((option) => option.forYourRange)).toEqual([
      '$2–17. At the middle estimate: $5. Plus tax where it applies.',
      '€5. That is their minimum. On their form it covers up to 40 kg.',
      'You choose. The smallest donation is 10 euros.',
    ]);
    expect(view.method.notes[2]).toBe(
      'With every assumption at its typical value, the formula gives 8.6 kg. The middle estimate is higher, 9.8 kg: 5,746 of the 10,000 results lie above that all-typical value.',
    );
  });

  it('picks three tips from these numbers, each a stated what-if with its saving as a range', () => {
    expect(view.tips.map((tip) => tip.id)).toEqual(['cc-opus-to-sonnet', 'cc-clear', 'cc-effort']);
    expect(view.tips[0]).toMatchObject({
      title: 'About 85% of your estimate comes from Opus 5.5',
      body: ['Moving half of your Opus 5.5 work to Sonnet would save ', { mark: 'roughly 0.75–7.6 kg a month' }, '.'],
      afterLabel: 'Sonnet',
      applied: false,
      now: result.range,
    });
    expect(view.noTipsNote).toBeNull();
    expect(result.switches.items).toEqual([
      { id: 'cc-opus-to-sonnet', label: 'Sonnet for half of your Opus work', note: 'Saves roughly 0.75–7.6 kg a month', noteIcon: null, on: false },
      { id: 'cc-clear', label: 'A third less re-reading', note: 'Saves roughly 0.23–8 kg a month', noteIcon: null, on: false },
      { id: 'cc-effort', label: 'A fifth less writing and thinking', note: 'Saves roughly 0.26–1.4 kg a month', noteIcon: null, on: false },
    ]);
  });

  it('shows a tip that is applied as a ghost, a tag and a lower range, and every tip against the range without tips', () => {
    toggle(store, 'cc-opus-to-sonnet');
    const applied = store.getView();
    const after = resultOf(applied);
    expect(after.baseline).toEqual(result.range);
    expect(after.appliedLabel).toBe('With: Sonnet for half of your Opus work');
    // The range is a what-if now, and the two sentences that name it say so.
    expect(result.summary).toBe('Likely CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct)');
    expect(after.summary).toBe('Likely CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct), with your tip applied');
    expect(applied.contribute?.costSentence).toBe(costSentence(after.range, 'kg', false, 1));
    expect(applied.contribute?.costSentence).toContain(`for ${massRange(after.range, 'kg')} of CO₂, the size of your estimate with your tip applied.`);
    expect(after.range.mid).toBeLessThan(result.range.mid);
    expect(after.range).toEqual(view.tips[0]?.after);
    // The unit and the scale still fit the range without the tip.
    expect([after.unit, after.scaleMax]).toEqual(['kg', 50]);
    expect(applied.tips.map((tip) => [tip.id, tip.applied])).toEqual([['cc-opus-to-sonnet', true], ['cc-clear', false], ['cc-effort', false]]);
    expect(applied.tips.every((tip) => tip.now.mid === result.range.mid)).toBe(true);
    // A tip's own sentence does not change when another tip goes on.
    expect(applied.tips.map((tip) => tip.body)).toEqual(view.tips.map((tip) => tip.body));
    expect(after.switches.items.map((item) => item.on)).toEqual([true, false, false]);

    toggle(store, 'cc-clear');
    expect(resultOf(store.getView()).appliedLabel).toBe('With 2 tips applied');
    expect(resultOf(store.getView()).summary).toBe('Likely CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct), with your tips applied');
    expect(store.getView().contribute?.costSentence).toContain('the size of your estimate with your tips applied.');
    expect(resultOf(store.getView()).baseline).toEqual(result.range);
    toggle(store, 'cc-clear');
    toggle(store, 'cc-opus-to-sonnet');
    expect(store.getView()).toEqual(view);
  });
});

// ---------- ChatGPT: the invented example export ----------

describe('the invented example export, dropped', () => {
  const switchesOf = (view: View): Array<[string, string, string | null, boolean]> =>
    resultOf(view).switches.items.map((item) => [item.id, item.note, item.noteIcon, item.on]);

  it('on Plus: the counts, the models and the switches the export sets', async () => {
    const view = (await chatgpt(good(exampleReading('current', true)))).getView();
    expect(view.stage).toBe('done');
    const status = ok(view.data.chatgpt.status);
    // 3 conversations in the export. 6 of its 10 answers lie inside the 30 days: 5 of gpt-5-6 and 1 of gpt-5-6-t-mini.
    expect(status.headline).toBe('3 conversations · 6 answers in the last 30 days · newest message 2 Oct');
    expect(status.confirmation).toBe('Your export was read in this tab.');
    expect(status.models.map((row) => row.name)).toEqual(['GPT-5.6', 'GPT-5.6 Thinking mini']);
    expect(status.models.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 12);
    expect(resultOf(view).switches.title).toBe('Hidden work in ChatGPT');
    expect(resultOf(view).switches.note).toBe(SWITCH_GROUP.note);
    expect(resultOf(view).switches.note).toContain('The last switch is your plan');
    expect(switchesOf(view)).toEqual([
      // 129 seconds of thinking are recorded inside the 30 days.
      ['thinking', 'Set from your export', 'export', true],
      // One answer cites a memory.
      ['instructions-memory', 'Set from your export: memory was used', 'export', true],
      // One answer shows its web sources.
      ['search-files', 'Set from your export', 'export', true],
      ['plan-paid', 'Set from your export', 'export', true],
    ]);
    expect(resultOf(view).sourceName).toBe('ChatGPT');
    expect(resultOf(view).unit).toBe('g');
    expect(resultOf(view).history?.since).toBe('July 2026');
    // The example is a light month: nothing to suggest.
    expect(view.tips).toEqual([]);
    expect(view.noTipsNote).toBe(
      'We tried 3 changes on your ChatGPT numbers and suggest none: each would save less than 10 g over these 25 days in at least half of the possible outcomes.',
    );
  });

  it('on Free or Go: the plan switch is off, "gpt-5-6" is the small model, and the result is lower', async () => {
    const paid = (await chatgpt(good(exampleReading('current', true)))).getView();
    const free = (await chatgpt(good(exampleReading('current', false)))).getView();
    expect(switchesOf(free).at(-1)).toEqual(['plan-paid', 'Set from your export: Free or Go', 'export', false]);
    expect(switchesOf(free).slice(0, 3)).toEqual(switchesOf(paid).slice(0, 3));
    expect(ok(free.data.chatgpt.status).headline).toBe(ok(paid.data.chatgpt.status).headline);
    expect(resultOf(free).range.p95).toBeLessThan(resultOf(paid).range.p5 * 2);
    expect(resultOf(free).range.mid).toBeLessThan(resultOf(paid).range.mid);
    expect(resultOf(free).history?.range.mid).toBeLessThan(resultOf(paid).history?.range.mid ?? 0);
    // Both models are small now, so the energy slider stands for one value.
    expect(slider(free, 'energy')).toMatchObject({ low: 0.05, typical: 0.1, high: 0.4 });
    expect(slider(free, 'energy')?.parts).toBeUndefined();
    expect(slider(paid, 'energy')?.parts?.map((part) => part.label)).toEqual(['large', 'small']);
  });

  it('with no user.json in the drop: the plan switch is on, and says that the files did not say', async () => {
    const view = (await chatgpt(good(exampleReading('current', null)))).getView();
    expect(switchesOf(view).at(-1)).toEqual(['plan-paid', 'Your files did not say. Switch this off if you are on Free or Go.', 'typical', true]);
  });

  it('gives the same numbers whether the export or the person sets the plan, with no second read', async () => {
    const world = outside();
    const store = await chatgpt(good(exampleReading('current', true)), world);
    const free = (await chatgpt(good(exampleReading('current', false)))).getView();
    toggle(store, 'plan-paid');
    const flipped = store.getView();
    expect(world.reads).toHaveLength(1);
    expect(resultOf(flipped).range).toEqual(resultOf(free).range);
    expect(resultOf(flipped).quantiles).toEqual(resultOf(free).quantiles);
    expect(resultOf(flipped).history).toEqual(resultOf(free).history);
    expect(ok(flipped.data.chatgpt.status).models).toEqual(ok(free.data.chatgpt.status).models);
    expect(switchesOf(flipped).at(-1)).toEqual(['plan-paid', 'Changed by you.', null, false]);
    expect(ok(flipped.data.chatgpt.status).notes.at(-1)).toContain('We counted it as a small model, because you chose Free or Go.');
  });

  it('reads the older shape of the same story to the same counts', async () => {
    const world = outside();
    world.today = '2026-04-07';
    const view = (await chatgpt(good(exampleReading('older', true)), world)).getView();
    expect(ok(view.data.chatgpt.status).headline).toMatch(/^3 conversations · 6 answers in the last 30 days · newest message \d+ (Mar|Apr)$/);
    expect(resultOf(view).period).toEqual({ from: '2026-03-09', to: '2026-04-07' });
    expect(flaws(view)).toEqual([]);
  });
});

// ---------- what the store keeps ----------

describe('what each action keeps and drops', () => {
  it('choose-source keeps the set sliders the chosen tool has', () => {
    const before = (): Store => {
      const store = open();
      set(store, 'grid', 460);
      set(store, 'cacheWrite', 0.45);
      set(store, 'energy', 5.4);
      return store;
    };
    const first = before();
    expect(first.getView().stage).toBe('choose');
    expect(pinned(first.getView())).toEqual(['energy', 'cacheWrite', 'grid']);

    first.dispatch({ type: 'choose-source', source: 'claude-code' });
    expect(pinned(first.getView())).toEqual(['energy', 'cacheWrite', 'grid']);
    expect(slider(first.getView(), 'energy')?.value).toBe(5.4);

    const second = before();
    second.dispatch({ type: 'choose-source', source: 'chatgpt' });
    // ChatGPT has no cache-write slider. The thumb of the energy slider stays at the right end, now of the mid-size row.
    expect(pinned(second.getView())).toEqual(['energy', 'grid']);
    expect(slider(second.getView(), 'energy')).toMatchObject({ value: 2.2, high: 2.2 });
    second.dispatch({ type: 'choose-source', source: 'claude-code' });
    expect(second.getView().source).toBe('chatgpt');
  });

  it('switch-source keeps nothing, and stops a read that is running', async () => {
    const fresh = (source: 'claude-code' | 'chatgpt'): View => {
      const store = createStore(outside().env);
      store.dispatch({ type: 'choose-source', source });
      return store.getView();
    };
    const pastedIn = claude(ANSWER_A);
    set(pastedIn, 'grid', 460);
    toggle(pastedIn, 'cc-clear');
    pastedIn.dispatch({ type: 'switch-source' });
    expect(pastedIn.getView()).toEqual(fresh('chatgpt'));
    expect(pastedIn.getView().data.claudeCode.answer).toBe('');

    const world = outside();
    const droppedIn = await chatgpt(good(BIG), world);
    set(droppedIn, 'hidden:prompt', 35000);
    toggle(droppedIn, 'thinking');
    toggle(droppedIn, 'gpt-shorter-answers');
    droppedIn.dispatch({ type: 'add-files', files: [] });
    expect(droppedIn.getView().stage).toBe('loading');
    droppedIn.dispatch({ type: 'switch-source' });
    expect(world.read().cancelled).toBe(true);
    expect(droppedIn.getView()).toEqual(fresh('claude-code'));
    // The other tool starts as on a first visit: back again, nothing has come along.
    droppedIn.dispatch({ type: 'switch-source' });
    expect(droppedIn.getView()).toEqual(fresh('chatgpt'));
  });

  it('new data for the same tool keeps the set sliders, drops the applied tips and fits the scale afresh', async () => {
    const store = claude(ANSWER_A);
    set(store, 'grid', 300);
    toggle(store, 'cc-clear');
    expect(resultOf(store.getView())).toMatchObject({ unit: 'kg', appliedLabel: 'With: A third less re-reading', setLabel: 'With 1 assumption set by you' });
    store.dispatch({ type: 'set-answer', text: ANSWER_GRAMS });
    const next = store.getView();
    expect(resultOf(next)).toMatchObject({ unit: 'g', scaleMax: 0.005, appliedLabel: null, baseline: null, setLabel: 'With 1 assumption set by you' });
    expect(slider(next, 'grid')).toMatchObject({ pinned: true });
    expect(slider(next, 'grid')?.value).toBeCloseTo(300, 9);
    expect(next.tips.every((tip) => !tip.applied)).toBe(true);

    // ChatGPT: the switches are set again from the new export.
    const world = outside();
    const gpt = await chatgpt(good(exampleReading('current', true)), world);
    set(gpt, 'pue', 1.17);
    toggle(gpt, 'plan-paid');
    toggle(gpt, 'thinking');
    toggle(gpt, 'gpt-shorter-answers');
    gpt.dispatch({ type: 'add-files', files: [] });
    await world.read().end(good(exampleReading('current', true)));
    const again = gpt.getView();
    expect(resultOf(again).switches.items.map((item) => [item.id, item.note, item.on])).toEqual([
      ['thinking', 'Set from your export', true],
      ['instructions-memory', 'Set from your export: memory was used', true],
      ['search-files', 'Set from your export', true],
      ['plan-paid', 'Set from your export', true],
    ]);
    expect(resultOf(again)).toMatchObject({ appliedLabel: null, baseline: null, setLabel: 'With 1 assumption set by you' });
    expect(pinned(again)).toEqual(['pue']);
  });

  it('refused data and an emptied box take the result away, keep the set sliders and drop the applied tips', () => {
    for (const text of ['Here is your usage: a lot.', '']) {
      const store = claude(ANSWER_A);
      set(store, 'grid', 300);
      toggle(store, 'cc-clear');
      store.dispatch({ type: 'set-answer', text });
      const gone = store.getView();
      expect(gone.stage).toBe(text === '' ? 'steps' : 'problem');
      expect([gone.result, gone.contribute, gone.tips, gone.noTipsNote]).toEqual([null, null, [], null]);
      expect(gone.method.notes).toEqual([]);
      expect(pinned(gone)).toEqual(['grid']);
      store.dispatch({ type: 'set-answer', text: ANSWER_A });
      expect(resultOf(store.getView())).toMatchObject({ appliedLabel: null, baseline: null, setLabel: 'With 1 assumption set by you' });
    }
  });

  it('add-files while a result is shown takes the old result away at once, and stops a read that is running first', async () => {
    const world = outside();
    const store = await chatgpt(good(BIG), world);
    set(store, 'grid', 300);
    toggle(store, 'thinking');
    store.dispatch({ type: 'add-files', files: [] });
    const loading = store.getView();
    expect(loading.stage).toBe('loading');
    expect([loading.result, loading.contribute, loading.tips]).toEqual([null, null, []]);
    expect(loading.data.chatgpt.status).toMatchObject({ state: 'reading', done: 0, total: null });
    expect(pinned(loading)).toEqual(['grid']);
    expect(world.reads).toHaveLength(2);
    expect(world.reads[1]?.cancelled).toBe(false);

    store.dispatch({ type: 'add-files', files: [] });
    expect(world.reads).toHaveLength(3);
    expect(world.reads[1]?.cancelled).toBe(true);
    expect(store.getView().stage).toBe('loading');
    await world.read().end(good(BIG));
    expect(store.getView().stage).toBe('done');
    expect(pinned(store.getView())).toEqual(['grid']);
    expect(resultOf(store.getView()).switches.items.find((item) => item.id === 'thinking')?.on).toBe(true);
  });

  it('cancel-read goes back to the steps with no result, and keeps the set sliders', async () => {
    const world = outside();
    const store = open(world);
    store.dispatch({ type: 'choose-source', source: 'chatgpt' });
    set(store, 'grid', 300);
    store.dispatch({ type: 'add-files', files: [] });
    world.read().progress(progress({ bytesRead: 10, bytesTotal: 100, conversations: 2 }));
    expect(store.getView().stage).toBe('loading');
    store.dispatch({ type: 'cancel-read' });
    expect(world.read().cancelled).toBe(true);
    const stopped = store.getView();
    expect(stopped.stage).toBe('steps');
    expect(stopped.result).toBeNull();
    expect(stopped.data.chatgpt.status).toEqual({ state: 'waiting' });
    expect(pinned(stopped)).toEqual(['grid']);
    // The read that was stopped still answers. Its answer belongs to nobody.
    await world.read().end(good(BIG));
    expect(store.getView()).toBe(stopped);
  });

  it('a hidden-work switch or the plan switch keeps the set sliders and the applied tips, and an applied tip stays when it saves nothing', async () => {
    // Mostly answers of a thinking model, so that half as much thinking is a saving a person can see.
    const THINKER = read(
      [LONG_CHAT, ...Array.from({ length: 40 }, (_, i) => turn(`t${i}`, at('2026-10-01') + i * 600, 'gpt-5-5-thinking', 200, 400))],
      { now: NOW },
    );
    const store = await chatgpt(good(THINKER));
    set(store, 'grid', 300);
    toggle(store, 'gpt-less-thinking');
    const before = store.getView();
    const tip = (view: View): View['tips'][number] | undefined => view.tips.find((entry) => entry.id === 'gpt-less-thinking');
    expect(tip(before)?.applied).toBe(true);
    expect(resultOf(before).appliedLabel).toBe('With: Half as much thinking');

    toggle(store, 'thinking');
    const off = store.getView();
    expect(pinned(off)).toEqual(['grid']);
    // The switch the person needs to go back is still there, and it says what it does now.
    expect(tip(off)).toMatchObject({ applied: true, body: ['With your current settings this change saves nothing.'] });
    expect(resultOf(off).range.mid).toBeLessThan(resultOf(before).range.mid);
    // The tip is still on, and no tag names it: with thinking switched off, half as much thinking changes nothing.
    expect(resultOf(off).appliedLabel).toBeNull();
    // Nor do the summary and the cost sentence: what they name is the result as counted.
    expect(resultOf(before).summary).toMatch(/, with your tip applied$/);
    expect(before.contribute?.costSentence).toContain('the size of your estimate with your tip applied.');
    expect(resultOf(off).summary).not.toContain('applied');
    expect(off.contribute?.costSentence).toContain('the size of your estimate. The third');
    expect(before.method.extremeLabel).toBe('Extreme range (every assumption you have not set, at its low or at its high, with your tip applied)');
    expect(off.method.extremeLabel).toBe('Extreme range (every assumption you have not set, at its low or at its high)');
    // A second tip that does change the result is named alone, not as one of two.
    toggle(store, 'gpt-shorter-answers');
    expect(resultOf(store.getView()).appliedLabel).toBe('With: Answers a quarter shorter');
    expect(store.getView().method.extremeLabel).toBe('Extreme range (every assumption you have not set, at its low or at its high, with your tip applied)');
    toggle(store, 'thinking');
    expect(resultOf(store.getView()).appliedLabel).toBe('With 2 tips applied');
    toggle(store, 'thinking');
    toggle(store, 'gpt-shorter-answers');
    expect(store.getView()).toEqual(off);

    toggle(store, 'plan-paid');
    expect(pinned(store.getView())).toEqual(['grid']);
    expect(tip(store.getView())?.applied).toBe(true);
    toggle(store, 'plan-paid');
    toggle(store, 'thinking');
    expect(store.getView()).toEqual(before);
  });

  it('a tip that is on and saves nothing a person can see is not named in a tag, from the start', async () => {
    // Here thinking is a few tenths of a gram in a result of kilograms.
    const store = await chatgpt(good(BIG));
    const plain = store.getView();
    toggle(store, 'gpt-less-thinking');
    const on = store.getView();
    expect(on.tips.find((entry) => entry.id === 'gpt-less-thinking')).toMatchObject({ applied: true, body: ['With your current settings this change saves nothing.'] });
    expect(massRange(resultOf(on).range, resultOf(on).unit)).toBe(massRange(resultOf(plain).range, resultOf(plain).unit));
    expect(resultOf(on).appliedLabel).toBeNull();
    expect(on.method.extremeLabel).toBe(plain.method.extremeLabel);
    toggle(store, 'gpt-less-thinking');
    expect(store.getView()).toEqual(plain);
  });

  it('a tip switched on or off keeps everything, and the list is built again', async () => {
    const store = await chatgpt(good(BIG));
    set(store, 'grid', 300);
    toggle(store, 'instructions-memory');
    const before = store.getView();
    expect(before.tips.map((tip) => tip.id)).toContain('gpt-shorter-answers');
    toggle(store, 'gpt-shorter-answers');
    const on = store.getView();
    expect(pinned(on)).toEqual(['grid']);
    expect(resultOf(on).switches.items).toEqual(resultOf(before).switches.items);
    expect(ok(on.data.chatgpt.status)).toEqual(ok(before.data.chatgpt.status));
    expect(on.tips.map((tip) => [tip.id, tip.applied])).toEqual(before.tips.map((tip) => [tip.id, tip.id === 'gpt-shorter-answers']));
    expect(resultOf(on).baseline).toEqual(resultOf(before).range);
    expect(resultOf(on).appliedLabel).toBe('With: Answers a quarter shorter');
  });

  it('set-assumption keeps everything else', () => {
    const store = claude(ANSWER_A);
    toggle(store, 'cc-clear');
    const before = store.getView();
    set(store, 'pue', 1.09);
    const after = store.getView();
    const [was, is] = [ok(before.data.claudeCode.status), ok(after.data.claudeCode.status)];
    expect({ ...is, models: [] }).toEqual({ ...was, models: [] });
    expect(is.models.map((row) => [row.name, row.tokens])).toEqual(was.models.map((row) => [row.name, row.tokens]));
    // Overhead is the same factor for every model, so no share moves.
    is.models.forEach((row, index) => expect(row.share).toBeCloseTo(was.models[index]?.share ?? Number.NaN, 12));
    expect(after.data.claudeCode.answer).toBe(ANSWER_A);
    expect(resultOf(after).appliedLabel).toBe('With: A third less re-reading');
    expect(after.tips.map((tip) => [tip.id, tip.applied])).toEqual(before.tips.map((tip) => [tip.id, tip.applied]));
    expect(resultOf(after).setLabel).toBe('With 1 assumption set by you');
    expect(resultOf(after).range.mid).toBeLessThan(resultOf(before).range.mid);
  });

  it('reset-assumptions clears every set slider and keeps the data, the applied tips and the switches', async () => {
    const store = await chatgpt(good(BIG));
    toggle(store, 'instructions-memory');
    toggle(store, 'gpt-shorter-answers');
    const before = store.getView();
    set(store, 'grid', 300);
    set(store, 'energy', 0.6);
    set(store, 'hidden:misses', 1);
    expect(resultOf(store.getView()).setLabel).toBe('With 3 assumptions set by you');
    store.dispatch({ type: 'reset-assumptions' });
    expect(pinned(store.getView())).toEqual([]);
    expect(store.getView()).toEqual(before);
  });
});

describe('set sliders and the data', () => {
  it('a slider can be moved before the data is in, and the result then starts with it set', () => {
    const store = open();
    store.dispatch({ type: 'choose-source', source: 'claude-code' });
    set(store, 'grid', 460);
    expect(store.getView().stage).toBe('steps');
    expect(slider(store.getView(), 'grid')).toMatchObject({ pinned: true, value: 460 });
    store.dispatch({ type: 'set-answer', text: ANSWER_A });
    expect(resultOf(store.getView()).setLabel).toBe('With 1 assumption set by you');
    expect(resultOf(store.getView()).range.mid).toBeGreaterThan(vector('A').expected.range.mid);
    store.dispatch({ type: 'reset-assumptions' });
    expect(resultOf(store.getView()).range.mid).toBeCloseTo(vector('A').expected.range.mid, 9);
  });

  it('a set slider that the data no longer shows keeps its position, is not counted, and comes back still set', async () => {
    const world = outside();
    const store = await chatgpt(good(BIG), world);
    set(store, 'hidden:thinking', 150);
    expect(slider(store.getView(), 'hidden:thinking')).toMatchObject({ pinned: true, value: 150 });
    expect(resultOf(store.getView()).setLabel).toBe('With 1 assumption set by you');

    store.dispatch({ type: 'add-files', files: [] });
    await world.read().end(good(NO_THINKING));
    expect(slider(store.getView(), 'hidden:thinking')).toBeUndefined();
    expect(resultOf(store.getView()).setLabel).toBeNull();

    store.dispatch({ type: 'add-files', files: [] });
    await world.read().end(good(BIG));
    expect(slider(store.getView(), 'hidden:thinking')).toMatchObject({ pinned: true, value: 150 });
    expect(resultOf(store.getView()).setLabel).toBe('With 1 assumption set by you');

    // "Reset sliders" clears it while it is not on the page, too.
    store.dispatch({ type: 'add-files', files: [] });
    await world.read().end(good(NO_THINKING));
    store.dispatch({ type: 'reset-assumptions' });
    store.dispatch({ type: 'add-files', files: [] });
    await world.read().end(good(BIG));
    expect(slider(store.getView(), 'hidden:thinking')).toMatchObject({ pinned: false, value: 60 });
  });

  it('the energy slider keeps its place on the track, and its row while that size is still in use', () => {
    const store = claude(ANSWER_A);
    expect(slider(store.getView(), 'energy')).toMatchObject({ typical: 1, high: 5.4, pinned: false });
    set(store, 'energy', 5.4);
    expect(slider(store.getView(), 'energy')?.parts?.map((part) => [part.label, part.value])).toEqual([['large', 5.4], ['mid-size', 2.2], ['small', 0.4]]);

    // New data in which Haiku weighs most: Opus is still used, so the large row stays.
    store.dispatch({ type: 'set-answer', text: answer([{ model: 'claude-opus-5-5', in: 5, out: 100 }, { model: 'claude-haiku-4-5', in: 5, out: 900000 }]) });
    expect(slider(store.getView(), 'energy')).toMatchObject({ high: 5.4, value: 5.4, pinned: true });

    // New data without Opus: the row is picked again, and the thumb stays at the right end.
    store.dispatch({ type: 'set-answer', text: answer([{ model: 'claude-haiku-4-5', in: 5, out: 900000 }]) });
    expect(slider(store.getView(), 'energy')).toMatchObject({ high: 0.4, value: 0.4, pinned: true });

    // Not set, the slider follows the size with the most kilograms.
    store.dispatch({ type: 'reset-assumptions' });
    store.dispatch({ type: 'set-answer', text: answer([{ model: 'claude-opus-5-5', in: 5, out: 100 }, { model: 'claude-haiku-4-5', in: 5, out: 900000 }]) });
    expect(slider(store.getView(), 'energy')).toMatchObject({ high: 0.4, pinned: false });
    expect(slider(store.getView(), 'energy')?.parts?.map((part) => part.label)).toEqual(['small', 'large']);
  });

  it('a value sent for the energy slider is read with the row the slider shows at that moment', () => {
    const store = claude(answer([{ model: 'claude-haiku-4-5', in: 5, out: 900000 }]));
    const shown = slider(store.getView(), 'energy');
    expect(shown).toMatchObject({ low: 0.05, typical: 0.1, high: 0.4 });
    set(store, 'energy', 0.1);
    // Typical for the small row is the middle of the track, not a place near its low end.
    expect(slider(store.getView(), 'energy')).toMatchObject({ value: 0.1, pinned: true });
    expect(resultOf(store.getView()).setLabel).toBe('With 1 assumption set by you');
  });
});

// ---------- switches ----------

describe('every switch, on and off again, gives back the exact earlier View', () => {
  it('each tip of Claude Code, alone and together', () => {
    const store = claude(ANSWER_A);
    const before = store.getView();
    const ids = before.tips.map((tip) => tip.id);
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      toggle(store, id);
      expect(store.getView()).not.toEqual(before);
      toggle(store, id);
      expect(store.getView()).toEqual(before);
    }
    for (const id of ids) toggle(store, id);
    expect(resultOf(store.getView()).appliedLabel).toBe('With 3 tips applied');
    for (const id of [...ids].reverse()) toggle(store, id);
    expect(store.getView()).toEqual(before);
  });

  it('each ChatGPT switch, the plan switch and each tip, with a slider set', async () => {
    const store = await chatgpt(good(BIG));
    set(store, 'grid', 300);
    const before = store.getView();
    const ids = [...resultOf(before).switches.items.map((item) => item.id), 'gpt-less-thinking', 'gpt-new-chat', 'gpt-shorter-answers'];
    expect(ids).toContain('plan-paid');
    for (const id of ids) {
      toggle(store, id);
      expect(store.getView()).not.toEqual(before);
      toggle(store, id);
      expect(store.getView()).toEqual(before);
    }
    for (const id of ids) toggle(store, id);
    for (const id of ids) toggle(store, id);
    expect(store.getView()).toEqual(before);
  });

  it('with the energy slider set, the plan switch off and on gives back the numbers, and the slider keeps the row it had to change to', async () => {
    const store = await chatgpt(good(exampleReading('current', true)));
    set(store, 'energy', 5.4);
    const before = store.getView();
    expect(slider(before, 'energy')).toMatchObject({ high: 5.4, value: 5.4, pinned: true });
    // Off: "gpt-5-6" is the small model now, so no large model is left and the small row is shown.
    toggle(store, 'plan-paid');
    expect(slider(store.getView(), 'energy')).toMatchObject({ high: 0.4, value: 0.4, pinned: true });
    // On again: the small size is still in use, so its row stays. The thumb never moved on its own.
    toggle(store, 'plan-paid');
    const after = store.getView();
    expect(slider(after, 'energy')).toMatchObject({ high: 0.4, value: 0.4, pinned: true });
    expect(slider(after, 'energy')?.parts?.map((part) => [part.label, part.value])).toEqual([['small', 0.4], ['large', 5.4]]);
    expect(after.result).toEqual(before.result);
    expect(after.tips).toEqual(before.tips);
    expect(after.contribute).toEqual(before.contribute);
    expect(after.data).toEqual(before.data);
  });

  it('a flipped switch says so, and gets its own words back when it is flipped back', async () => {
    const store = await chatgpt(good(exampleReading('current', true)));
    const start = resultOf(store.getView()).switches.items;
    toggle(store, 'instructions-memory');
    expect(resultOf(store.getView()).switches.items[1]).toEqual({ id: 'instructions-memory', label: 'Hidden instructions and memory', note: 'Changed by you.', noteIcon: null, on: false });
    expect(slider(store.getView(), 'hidden:prompt')?.note).toBe('This is switched off in your result.');
    expect(slider(store.getView(), 'hidden:personal')?.note).toBe('This is switched off in your result.');
    toggle(store, 'instructions-memory');
    expect(resultOf(store.getView()).switches.items).toEqual(start);
  });
});

// ---------- one outcome, and small results ----------

describe('one outcome', () => {
  it('with every slider set there is one number: the vectors\' own for every slider at typical', () => {
    const store = claude(ANSWER_A);
    for (const entry of store.getView().method.assumptions) set(store, entry.id, entry.typical);
    const view = store.getView();
    const result = resultOf(view);
    const want = vector('pinned-all-typical').expected.range.mid;
    expect(result.single).toBe(true);
    for (const value of [result.range.p5, result.range.mid, result.range.p95, ...result.quantiles]) expect(value).toBeCloseTo(want, 9);
    expect(result.summary).toBe('CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct), with every assumption that changes your result set by you');
    expect(result.setLabel).toBe('With 7 assumptions set by you');
    expect(view.method.extreme).toBeNull();
    expect(view.method.extremeLabel).toBe('Extreme range (every assumption you have not set, at its low or at its high)');
    expect(view.method.notes).toEqual([
      'The least certain number in the list of assumptions below is “Re-reading a stored token, compared with writing one”: its high value is 100 times its low value.',
      "Counted with the clean power that Google and Microsoft buy, about 70 g per kWh, and with making the hardware counted as before, your result would be about 2.4 kg. The power their data centres draw is no cleaner than the local grid's, so this is shown only for comparison.",
      "A model's share is worked out with every assumption at its typical value, or at your value where you have set one.",
    ]);
    expect(view.contribute?.costSentence).toBe(costSentence(resultOf(view).range, 'kg', true));
    expect(view.contribute?.costSentence).toContain(' for about 8.6 kg of CO₂, the size of your estimate.');
    expect(view.contribute?.options[0]?.forYourRange).toBe('About $4.50. Plus tax where it applies.');
    expect(view.method.assumptions.every((entry) => entry.pinned && entry.value === entry.typical)).toBe(true);
    expect(flaws(view)).toEqual([]);

    store.dispatch({ type: 'reset-assumptions' });
    expect(resultOf(store.getView()).single).toBe(false);
    expect(resultOf(store.getView()).summary).toBe('Likely CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct)');
  });

  it('one slider left is still a range', () => {
    const store = claude(ANSWER_A);
    for (const entry of store.getView().method.assumptions.filter((one) => one.id !== 'hardware')) set(store, entry.id, entry.typical);
    expect(resultOf(store.getView()).single).toBe(false);
    expect(store.getView().method.extreme).not.toBeNull();
    expect(store.getView().method.notes[0]).toContain('Of the assumptions you have not set, what matters most is “Making the hardware, as a factor on top”.');
  });
});

describe('a small result', () => {
  it('in grams: fixture C on a 5 g scale', () => {
    const view = claude(ANSWER_GRAMS).getView();
    const result = resultOf(view);
    const C = vector('C').expected.range;
    expect(result.range.p5).toBeCloseTo(C.p5, 12);
    expect(result.range.p95).toBeCloseTo(C.p95, 12);
    expect([result.unit, result.scaleMax, view.method.unit]).toEqual(['g', 0.005, 'g']);
    expect(massRange(result.range, result.unit)).toBe('0.51–2.9 g');
    expect(view.contribute?.costSentence).toContain('for 0.51–2.9 g of CO₂');
    expect(view.contribute?.options[0]?.forYourRange).toBe('$0.50 for 1 kg. Climeworks counts in whole kilograms, and your range is below 1 kg. Plus tax where it applies.');
    expect(view.method.notes[0]).toMatch(/your middle estimate goes from [\d.]+ to [\d.]+ g\.$/);
    expect(view.tips).toEqual([]);
    // Haiku alone: the one change that could be worked out is less re-reading.
    expect(view.noTipsNote).toBe('We tried 1 change on your Claude Code numbers and do not suggest it: it would save less than 10 g a month in at least half of the possible outcomes.');
    expect(result.switches.items).toEqual([]);
    expect(flaws(view)).toEqual([]);
  });

  it('in milligrams', () => {
    const view = claude(ANSWER_MILLIGRAMS).getView();
    const result = resultOf(view);
    expect([result.unit, view.method.unit]).toEqual(['mg', 'mg']);
    expect(massRange(result.range, result.unit)).toBe('51–287 mg');
    expect(result.scaleMax).toBe(0.0005);
    expect(view.contribute?.costSentence).toContain('for 51–287 mg of CO₂');
    expect(view.method.notes.find((note) => note.startsWith('Counted with the clean power'))).toMatch(/your range would be [\d.]+–[\d.]+ mg, middle estimate [\d.]+ mg\./);
    expect(flaws(view)).toEqual([]);
  });

  it('under one milligram, and with no tokens at all, still has every sentence', () => {
    const tiny = claude(answer([{ model: 'claude-haiku-4-5', in: 1, out: 1 }])).getView();
    expect(resultOf(tiny).unit).toBe('mg');
    expect(resultOf(tiny).scaleMax).toBe(0.000001);
    expect(resultOf(tiny).range.p95).toBeLessThan(0.000001);
    expect(flaws(tiny)).toEqual([]);

    const none = claude(answer([{ model: 'claude-haiku-4-5' }])).getView();
    // Whether the reader takes an answer of zeros or refuses it, the page has something to say.
    expect(['done', 'problem']).toContain(none.stage);
    expect(flaws(none)).toEqual([]);
  });

  it('a result that outgrows grams is shown in kilograms, and above 1,000 kg too', () => {
    const big = claude(answer([{ model: 'claude-opus-5-5', in: 1e9, write: 1e10, read: 5e11, out: 5e9 }])).getView();
    expect(resultOf(big).unit).toBe('kg');
    expect(resultOf(big).scaleMax).toBeGreaterThanOrEqual(1000);
    expect(flaws(big)).toEqual([]);
  });
});

// ---------- the stages ----------

describe('the stages', () => {
  it('choose: nothing picked yet', () => {
    const view = open().getView();
    expect(view).toMatchObject({ stage: 'choose', source: null, result: null, tips: [], noTipsNote: null, contribute: null });
    expect(view.data.claudeCode.status).toEqual({ state: 'waiting' });
    expect(view.data.chatgpt.status).toEqual({ state: 'waiting' });
    expect(view.method.assumptions).toHaveLength(7);
  });

  it('steps: a tool is picked and its data is not in', () => {
    const store = open();
    store.dispatch({ type: 'choose-source', source: 'chatgpt' });
    expect(store.getView()).toMatchObject({ stage: 'steps', source: 'chatgpt', result: null });
    expect(store.getView().method.assumptions).toHaveLength(12);
  });

  it('loading: the export is being read, and the progress is in the View', () => {
    const world = outside();
    const store = open(world);
    store.dispatch({ type: 'choose-source', source: 'chatgpt' });
    store.dispatch({ type: 'add-files', files: [] });
    expect(store.getView().stage).toBe('loading');
    expect(store.getView().data.chatgpt.status).toEqual({ state: 'reading', done: 0, total: null, text: 'Reading your export in this tab: 0 conversations so far. Large exports can take a minute.' });
    world.read().progress(progress({ bytesRead: 300, bytesTotal: 1200, conversations: 41 }));
    expect(store.getView().data.chatgpt.status).toEqual({ state: 'reading', done: 300, total: 1200, text: 'Reading your export in this tab: 41 conversations so far. Large exports can take a minute.' });
    expect(store.getView().stage).toBe('loading');
  });

  it('problem: the data that was given could not be used', async () => {
    const pastedIn = claude('total | 12');
    expect(pastedIn.getView().stage).toBe('problem');
    expect(pastedIn.getView().data.claudeCode.status.state).toBe('problem');
    const droppedIn = await chatgpt({ ok: false, code: 'too-many-files' });
    expect(droppedIn.getView().stage).toBe('problem');
    expect(droppedIn.getView().data.chatgpt.status).toEqual({
      state: 'problem',
      message: 'That is more than 20 ZIP files. Drop the export ZIP on its own, or only the conversations files from inside it.',
    });
    expect(droppedIn.getView().result).toBeNull();
  });

  it('done: there is a result, tips or a sentence in their place, and the ways to give money', async () => {
    for (const view of [claude(ANSWER_A).getView(), (await chatgpt(good(BIG))).getView()]) {
      expect(view.stage).toBe('done');
      expect(view.result).not.toBeNull();
      expect(view.contribute?.options).toHaveLength(3);
      expect(view.tips.length > 0 || view.noTipsNote !== null).toBe(true);
      expect(view.method.notes.length).toBeGreaterThan(3);
    }
  });
});

// ---------- reading an export ----------

describe('a read', () => {
  it('hands the dropped files to the reader as they are', () => {
    const world = outside();
    const store = open(world);
    store.dispatch({ type: 'choose-source', source: 'chatgpt' });
    const files = [new File(['[]'], 'conversations.json'), new File(['x'], 'export.zip')];
    store.dispatch({ type: 'add-files', files });
    expect(world.read().files).toEqual(files);
  });

  it('is not started for Claude Code, or before a tool is chosen', () => {
    const world = outside();
    const store = open(world);
    store.dispatch({ type: 'add-files', files: [] });
    store.dispatch({ type: 'choose-source', source: 'claude-code' });
    store.dispatch({ type: 'add-files', files: [] });
    expect(world.reads).toHaveLength(0);
    expect(store.getView().stage).toBe('steps');
  });

  it('tells the listeners about the start, each progress report and the end', async () => {
    const world = outside();
    const store = open(world);
    store.dispatch({ type: 'choose-source', source: 'chatgpt' });
    const stages: string[] = [];
    store.subscribe((view) => stages.push(view.data.chatgpt.status.state));
    store.dispatch({ type: 'add-files', files: [] });
    expect(stages).toEqual(['reading']);
    world.read().progress(progress({ bytesRead: 1, bytesTotal: 10, conversations: 1 }));
    world.read().progress(progress({ bytesRead: 9, bytesTotal: 10, conversations: 3 }));
    expect(stages).toEqual(['reading', 'reading', 'reading']);
    await world.read().end(good(exampleReading('current')));
    expect(stages).toEqual(['reading', 'reading', 'reading', 'ok']);
    // A report that comes after the end changes nothing.
    world.read().progress(progress({ bytesRead: 10, bytesTotal: 10, conversations: 3 }));
    expect(stages).toHaveLength(4);
  });

  it('takes no notice of what an earlier read still says', async () => {
    const world = outside();
    const store = open(world);
    store.dispatch({ type: 'choose-source', source: 'chatgpt' });
    store.dispatch({ type: 'add-files', files: [] });
    const first = world.read();
    store.dispatch({ type: 'add-files', files: [] });
    const second = world.read();
    expect(first.cancelled).toBe(true);
    first.progress(progress({ bytesRead: 5, bytesTotal: 10, conversations: 99 }));
    expect(store.getView().data.chatgpt.status).toMatchObject({ state: 'reading', done: 0 });
    await first.end(good(BIG));
    expect(store.getView().stage).toBe('loading');
    second.progress(progress({ bytesRead: 5, bytesTotal: 10, conversations: 2 }));
    expect(store.getView().data.chatgpt.status).toMatchObject({ state: 'reading', done: 5 });
    await second.end(good(exampleReading('current')));
    expect(ok(store.getView().data.chatgpt.status).headline).toContain('3 conversations');
  });

  it('that the worker gave up as cancelled goes back to the steps', async () => {
    const store = await chatgpt({ ok: false, code: 'cancelled' });
    expect(store.getView().stage).toBe('steps');
    expect(store.getView().data.chatgpt.status).toEqual({ state: 'waiting' });
  });

  it('cancel-read with no read running changes nothing and calls no listener', async () => {
    const store = await chatgpt(good(BIG));
    const calls = vi.fn();
    store.subscribe(calls);
    store.dispatch({ type: 'cancel-read' });
    expect(calls).not.toHaveBeenCalled();
    expect(store.getView().stage).toBe('done');
  });

  it('that fails ends as a problem, also when the reader itself cannot be started', async () => {
    // The worker stopped in the middle of a read: closing other tabs can help.
    const world = outside();
    const heard = createStore(world.env);
    heard.dispatch({ type: 'choose-source', source: 'chatgpt' });
    heard.dispatch({ type: 'add-files', files: [] });
    world.read().progress(progress({ bytesRead: 10, bytesTotal: 100, conversations: 1 }));
    await world.read().end({ ok: false, code: 'worker-failed' });
    expect(heard.getView().data.chatgpt.status).toEqual({
      state: 'problem',
      message: 'The page could not finish reading this export. Close other tabs and try again, or unzip it on your computer and drop only the conversations files.',
    });
    expect((await chatgpt({ ok: false, code: 'internal' })).getView().data.chatgpt.status).toMatchObject({ message: expect.stringContaining('could not finish reading') });
  });

  it('that fails before the worker has said anything asks for a reload: its file could not be fetched, and closing tabs cannot help', async () => {
    const START = { state: 'problem', message: 'The page could not start reading this export. Check your connection, reload the page, then drop the export again.' };
    expect((await chatgpt({ ok: false, code: 'worker-failed' })).getView().data.chatgpt.status).toEqual(START);
    const store = createStore({
      today: () => TODAY,
      startReading: () => {
        throw new Error('no worker here');
      },
    });
    store.dispatch({ type: 'choose-source', source: 'chatgpt' });
    expect(() => store.dispatch({ type: 'add-files', files: [] })).not.toThrow();
    expect(store.getView().stage).toBe('problem');
    expect(store.getView().data.chatgpt.status).toEqual(START);
  });
});

// ---------- the listeners ----------

describe('the listeners', () => {
  it('are called before dispatch returns, with the new View and the one before it', () => {
    const store = open();
    const calls: Array<[View, View]> = [];
    store.subscribe((view, previous) => calls.push([view, previous]));
    const first = store.getView();
    store.dispatch({ type: 'choose-source', source: 'claude-code' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(store.getView());
    expect(calls[0]?.[1]).toBe(first);
    store.dispatch({ type: 'set-answer', text: ANSWER_A });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[0].stage).toBe('done');
    expect(calls[1]?.[1]).toBe(calls[0]?.[0]);
  });

  it('are not called for an action that changes nothing', () => {
    const store = claude(ANSWER_A);
    const calls = vi.fn();
    store.subscribe(calls);
    store.dispatch({ type: 'choose-source', source: 'chatgpt' });
    store.dispatch({ type: 'set-answer', text: ANSWER_A });
    store.dispatch({ type: 'toggle-switch', id: 'no-such-switch' });
    store.dispatch({ type: 'set-assumption', id: 'no-such-slider', value: 1, settled: true });
    store.dispatch({ type: 'cancel-read' });
    store.dispatch({ type: 'add-files', files: [] });
    expect(calls).not.toHaveBeenCalled();
  });

  it('are called for every slider that is let go, also when the value is the one it had', () => {
    const store = claude(ANSWER_A);
    const calls = vi.fn();
    store.subscribe(calls);
    set(store, 'grid', 400);
    set(store, 'grid', 400);
    expect(calls).toHaveBeenCalledTimes(2);
    expect(calls.mock.calls[1]?.[0]).toEqual(calls.mock.calls[0]?.[0]);
  });

  it('stop being called once they are taken off, and each is told when another one throws', () => {
    const store = open();
    const quiet = vi.fn();
    const stop = store.subscribe(quiet);
    const loud = vi.fn(() => {
      throw new Error('a listener of the page broke');
    });
    const stopLoud = store.subscribe(loud);
    const last = vi.fn();
    store.subscribe(last);
    expect(() => store.dispatch({ type: 'choose-source', source: 'claude-code' })).toThrow('a listener of the page broke');
    expect([quiet, loud, last].map((listener) => listener.mock.calls.length)).toEqual([1, 1, 1]);
    // The store itself is as it should be.
    expect(store.getView().stage).toBe('steps');
    stop();
    stopLoud();
    store.dispatch({ type: 'set-answer', text: ANSWER_A });
    expect([quiet, loud, last].map((listener) => listener.mock.calls.length)).toEqual([1, 1, 2]);
  });

  it('take their real clock, timer and reader when none is handed in', () => {
    const store = createStore();
    store.dispatch({ type: 'choose-source', source: 'claude-code' });
    store.dispatch({ type: 'set-answer', text: 'ai-co2 v1 | 2020-01-01 to 2020-01-30 | data 2020-01-01 to 2020-01-30\nclaude-opus-5-5 | in 5 | cache_write 5 | cache_read 5 | out 5\ntotal | 20' });
    // An answer from years ago is taken, with a note that it is old.
    expect(store.getView().stage).toBe('done');
    expect(resultOf(store.getView()).summary).toBe('Likely CO₂e from Claude Code in the 30 days from 1 Jan to 30 Jan');
    expect(REST_MS).toBe(100);
  });
});

// ---------- what a person can paste or drop ----------

describe('nothing a person can paste', () => {
  interface Case {
    group: string;
    name: string;
    today: string;
    input: unknown;
    expect: { ok: boolean };
  }
  const cases = (JSON.parse(readFileSync(new URL('../sources/claude-code/fixtures/answer-cases.json', import.meta.url), 'utf8')) as { cases: Case[] }).cases;

  it('has 94 cases to go through', () => {
    expect(cases).toHaveLength(94);
  });

  it.each(cases.map((one) => [one.group, one.name, one] as const))('%s: %s', (_group, _name, one) => {
    const world = outside();
    world.today = one.today;
    const store = open(world);
    store.dispatch({ type: 'choose-source', source: 'claude-code' });
    expect(() => store.dispatch({ type: 'set-answer', text: one.input } as Action)).not.toThrow();
    const view = store.getView();
    expect(view.stage).toBe(one.expect.ok ? 'done' : typeof one.input === 'string' && one.input.trim() !== '' ? 'problem' : 'steps');
    expect(flaws(view)).toEqual([]);
    if (view.stage === 'done') {
      // Every switch and every slider of the result still works.
      for (const item of resultOf(view).switches.items) toggle(store, item.id);
      for (const entry of view.method.assumptions) set(store, entry.id, entry.high, false);
      for (const entry of view.method.assumptions) set(store, entry.id, entry.low);
      expect(flaws(store.getView())).toEqual([]);
      expect(resultOf(store.getView()).single).toBe(true);
    }
  });

  it('makes the store throw: text that is no answer, text that is no text, and very long text', () => {
    const store = open();
    store.dispatch({ type: 'choose-source', source: 'claude-code' });
    const pastes: unknown[] = [
      '<img src=x onerror=alert(1)>',
      'ai-co2 v1 | 2026-09-08 to 2026-10-07 | data 2026-09-08 to 2026-10-07\nconstructor | in 1 | cache_write 2 | cache_read 3 | out 4\ntotal | 10',
      'ai-co2 v1 | 2026-09-08 to 2026-10-07 | data 2026-09-08 to 2026-10-07\n__proto__ | in 1 | cache_write 2 | cache_read 3 | out 4\ntotal | 10',
      `ai-co2 v1 | 2026-09-08 to 2026-10-07 | data 2026-09-08 to 2026-10-07\nm | in 999999999999 | cache_write 999999999999 | cache_read 999999999999 | out 999999999999\ntotal | ${4 * 999999999999}`,
      'ai-co2 v1 | 2026-09-08 to 2026-10-07 | data 2026-09-08 to 2026-10-07\nx | in NaN | cache_write -1 | cache_read 1e99 | out Infinity\ntotal | NaN',
      'x'.repeat(200_000),
      '\u0000￿\uD800',
      null,
      undefined,
      42,
      { toString: () => ANSWER_A },
      [ANSWER_A],
    ];
    for (const text of pastes) {
      expect(() => store.dispatch({ type: 'set-answer', text } as Action)).not.toThrow();
      expect(flaws(store.getView())).toEqual([]);
    }
  });

  it('shows a model name from the paste as text and nowhere as anything else', () => {
    const view = claude(answer([{ model: 'constructor', in: 5, out: 7 }, { model: 'claude-opus-5-5', in: 5, out: 3 }])).getView();
    expect(ok(view.data.claudeCode.status).models.map((row) => row.name)).toEqual(['constructor', 'Opus 5.5']);
    expect(ok(view.data.claudeCode.status).notes.at(-1)).toContain('We don\'t know the model “constructor”. It makes up 60% of your tokens.');
  });
});

describe('nothing a page can send', () => {
  it('makes the store throw: actions that are no actions, ids that are no ids, values that are no values', async () => {
    const store = await chatgpt(good(exampleReading('current', true)));
    const before = store.getView();
    const odd: unknown[] = [
      null,
      undefined,
      'reset-assumptions',
      {},
      { type: 'explode' },
      { type: 'choose-source' },
      { type: 'choose-source', source: 'gemini' },
      { type: 'toggle-switch' },
      { type: 'toggle-switch', id: null },
      { type: 'toggle-switch', id: '__proto__' },
      { type: 'toggle-switch', id: 'constructor' },
      { type: 'set-assumption' },
      { type: 'set-assumption', id: 'grid' },
      { type: 'set-assumption', id: 'grid', value: Number.NaN, settled: true },
      { type: 'set-assumption', id: 'grid', value: '350', settled: false },
      { type: 'set-assumption', id: '__proto__', value: 1, settled: true },
      { type: 'set-assumption', id: 'cacheWrite', value: 0.1, settled: true },
      { type: 'set-answer', text: ANSWER_A },
    ];
    for (const action of odd) expect(() => store.dispatch(action as Action)).not.toThrow();
    expect(store.getView()).toBe(before);
    expect(() => store.dispatch({ type: 'add-files', files: 'export.zip' } as unknown as Action)).not.toThrow();
    expect(store.getView().stage).toBe('loading');
  });

  it('both example exports give a View with nothing missing, under every switch', async () => {
    for (const [shape, today] of [['current', '2026-10-07'], ['older', '2026-04-07']] as const) {
      for (const plusUser of [true, false, null]) {
        const world = outside();
        world.today = today;
        const store = await chatgpt(good(exampleReading(shape, plusUser)), world);
        expect(store.getView().stage).toBe('done');
        const ids = [...resultOf(store.getView()).switches.items.map((item) => item.id), 'gpt-less-thinking', 'gpt-new-chat', 'gpt-shorter-answers'];
        for (const id of ids) {
          toggle(store, id);
          expect(flaws(store.getView())).toEqual([]);
        }
        for (const entry of store.getView().method.assumptions) set(store, entry.id, entry.low);
        expect(flaws(store.getView())).toEqual([]);
        for (const id of ids) toggle(store, id);
        expect(flaws(store.getView())).toEqual([]);
      }
    }
  });

  it('an export from a file that lies about its numbers still gives numbers', async () => {
    const day = BIG.days[0];
    const model = day?.models[0];
    if (!day || !model) throw new Error('the made-up reading has no day');
    const lying: Reading = {
      ...BIG,
      conversations: Number.NaN,
      lastMessage: Number.NaN,
      firstRequest: Infinity,
      plusUser: 'yes' as unknown as boolean,
      warnings: [{ code: 'duplicate-conversation', count: Number.NaN }],
      days: [{ ...day, answers: Number.NaN, models: [{ ...model, model: 'gpt-5-5', output: 1e300, newInput: Number.NaN, rereadColdPaid: -1, requests: Number.NaN }] }, ...BIG.days.slice(1)],
    };
    const store = await chatgpt(good(lying));
    expect(flaws(store.getView())).toEqual([]);
    expect(['done', 'problem']).toContain(store.getView().stage);
  });
});

// ---------- every sentence ----------

describe('every View the store has shown in this file', () => {
  afterAll(() => {
    SEEN.length = 0;
  });

  it('came in every stage, for both tools', () => {
    expect(SEEN.length).toBeGreaterThan(500);
    for (const stage of ['choose', 'steps', 'loading', 'problem', 'done']) expect(SEEN.some((view) => view.stage === stage)).toBe(true);
    for (const source of ['claude-code', 'chatgpt']) expect(SEEN.some((view) => view.source === source && view.result !== null)).toBe(true);
    expect(SEEN.some((view) => view.result?.single)).toBe(true);
    expect(SEEN.some((view) => view.result?.unit === 'g')).toBe(true);
    expect(SEEN.some((view) => view.result?.unit === 'mg')).toBe(true);
    expect(SEEN.some((view) => view.tips.some((tip) => tip.applied))).toBe(true);
  });

  it('holds no word the page never uses about emissions', () => {
    const said = new Set<string>();
    for (const view of SEEN) for (const text of sentences(view)) said.add(text);
    expect(said.size).toBeGreaterThan(300);
    for (const text of said) expect([text, bannedIn(text)]).toEqual([text, null]);
  });

  it('holds no "NaN", no "undefined" and no empty sentence', () => {
    for (const view of SEEN) expect(flaws(view)).toEqual([]);
  });

  it('never has a result without the chapters that go with it, or the chapters without a result', () => {
    for (const view of SEEN) {
      expect(view.result !== null).toBe(view.stage === 'done');
      expect(view.contribute !== null).toBe(view.result !== null);
      if (view.result === null) expect([view.tips, view.noTipsNote, view.method.notes, view.method.extreme]).toEqual([[], null, [], null]);
      else expect(view.tips.length > 0 ? view.noTipsNote === null : view.noTipsNote !== null).toBe(true);
      if (view.result) {
        expect(view.result.unit).toBe(view.method.unit);
        expect(view.result.scaleMax * 1.0000001).toBeGreaterThanOrEqual(Math.max(view.result.range.p95, view.result.baseline?.p95 ?? 0));
        expect(view.result.quantiles).toHaveLength(100);
      }
    }
  });
});
