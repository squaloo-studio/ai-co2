import { describe, expect, it } from 'vitest';
import { ASSUMPTION_ROWS, DEFAULT_LEAD, ENERGY_ROWS, SLIDERS, rowOf } from '../model/assumptions';
import type { EnergyClass, SliderId } from '../model/assumptions';
import { estimate } from '../model/estimate';
import type { ReadOutcome } from '../sources/chatgpt';
import { positionOf, valueAt } from '../track';
import { initialState, isPaid, reduce, stageOf, withLead } from './state';
import type { Event, State } from './state';
import { ANSWER_A, ANSWER_GRAMS, TODAY, answer, exampleReading, progress, report } from './test-kit';
import { count, estimateInput } from './usage';

/** A state after a run of events. */
const after = (events: readonly Event[], from: State = initialState()): State => events.reduce(reduce, from);

const paste = (text: string): Event => ({ type: 'set-answer', text, today: TODAY });
const set = (id: string, value: number, settled = true): Event => ({ type: 'set-assumption', id, value, settled });
const ended = (outcome: ReadOutcome): Event => ({ type: 'read-ended', outcome, today: TODAY });

const READING = exampleReading('current', true);
const GOOD: ReadOutcome = { ok: true, reading: READING, report: report() };

const claudeDone = (): State => after([{ type: 'choose-source', source: 'claude-code' }, paste(ANSWER_A)]);
const chatgptDone = (outcome: ReadOutcome = GOOD): State => after([{ type: 'choose-source', source: 'chatgpt' }, { type: 'read-started' }, ended(outcome)]);

describe('the first visit', () => {
  it('holds no tool, no data and nothing set', () => {
    const state = initialState();
    expect(state).toEqual({ source: null, today: '', answer: { text: '', reading: { state: 'empty' } }, export: { phase: 'waiting' }, pins: {}, lead: 'large', applied: [], flipped: [] });
    expect(stageOf(state)).toBe('choose');
    expect(isPaid(state)).toBe(true);
  });
});

describe('choose-source', () => {
  it('keeps the set sliders the chosen tool has', () => {
    const before = after([set('grid', 460), set('cacheWrite', 0.03), set('energy', 5.4)]);
    expect(before.pins).toEqual({ grid: 1, cacheWrite: 0, energy: 1 });

    const claude = reduce(before, { type: 'choose-source', source: 'claude-code' });
    expect(claude.source).toBe('claude-code');
    expect(claude.pins).toEqual({ grid: 1, cacheWrite: 0, energy: 1 });
    expect(claude.lead).toBe('large');
    expect(stageOf(claude)).toBe('steps');
  });

  it('drops a set cache-write slider for ChatGPT, which has none', () => {
    const before = after([set('grid', 460), set('cacheWrite', 0.03), set('energy', 5.4)]);
    const chatgpt = reduce(before, { type: 'choose-source', source: 'chatgpt' });
    expect(chatgpt.pins).toEqual({ grid: 1, energy: 1 });
    // The thumb stays where it is on the track. The slider now shows the mid-size row.
    expect(chatgpt.lead).toBe('medium');
  });

  it('is ignored once a tool is chosen, and for a tool that does not exist', () => {
    const chosen = reduce(initialState(), { type: 'choose-source', source: 'chatgpt' });
    expect(reduce(chosen, { type: 'choose-source', source: 'claude-code' })).toBe(chosen);
    const first = initialState();
    expect(reduce(first, { type: 'choose-source', source: 'gemini' } as unknown as Event)).toBe(first);
  });
});

describe('switch-source', () => {
  it('is ignored before a tool is chosen', () => {
    const first = initialState();
    expect(reduce(first, { type: 'switch-source' })).toBe(first);
  });

  it('keeps nothing: the other tool starts as on a first visit', () => {
    const busy = after([set('grid', 460), { type: 'toggle-switch', id: 'cc-clear' }], claudeDone());
    expect(busy.applied).toEqual(['cc-clear']);
    const other = reduce(busy, { type: 'switch-source' });
    expect(other).toEqual({ ...initialState(), source: 'chatgpt', lead: DEFAULT_LEAD.chatgpt });
    expect(stageOf(other)).toBe('steps');

    const back = reduce(after([set('hidden:thinking', 150), { type: 'toggle-switch', id: 'thinking' }], chatgptDone()), { type: 'switch-source' });
    expect(back).toEqual({ ...initialState(), source: 'claude-code', lead: DEFAULT_LEAD['claude-code'] });
  });
});

describe('set-answer', () => {
  const chosen = reduce(initialState(), { type: 'choose-source', source: 'claude-code' });

  it('is ignored for ChatGPT, and when the text is the one already held', () => {
    const chatgpt = reduce(initialState(), { type: 'choose-source', source: 'chatgpt' });
    expect(reduce(chatgpt, paste(ANSWER_A))).toBe(chatgpt);
    const done = claudeDone();
    expect(reduce(done, paste(ANSWER_A))).toBe(done);
    expect(reduce(initialState(), paste(ANSWER_A)).source).toBeNull();
  });

  it('takes an accepted answer, with the day it was read', () => {
    const done = reduce(chosen, paste(ANSWER_A));
    expect(stageOf(done)).toBe('done');
    expect(done.today).toBe(TODAY);
    expect(done.answer.text).toBe(ANSWER_A);
    expect(done.answer.reading.state).toBe('ok');
  });

  it('shows a refused answer as a problem and an emptied box as the steps', () => {
    const refused = reduce(claudeDone(), paste('Here is your usage: lots of tokens.'));
    expect(stageOf(refused)).toBe('problem');
    expect(refused.answer.reading.state).toBe('problem');
    const emptied = reduce(claudeDone(), paste('   \n '));
    expect(stageOf(emptied)).toBe('steps');
    expect(emptied.answer.text).toBe('   \n ');
  });

  it('keeps the set sliders and drops the applied tips when new data comes in', () => {
    const before = after([set('grid', 460), { type: 'toggle-switch', id: 'cc-clear' }], claudeDone());
    const next = reduce(before, paste(ANSWER_GRAMS));
    expect(next.pins).toEqual({ grid: 1 });
    expect(next.applied).toEqual([]);
    expect(stageOf(next)).toBe('done');
  });

  it('drops the applied tips when the data is refused or the box is emptied, and keeps the set sliders', () => {
    const before = after([set('grid', 460), { type: 'toggle-switch', id: 'cc-clear' }], claudeDone());
    for (const text of ['not an answer', '']) {
      const next = reduce(before, paste(text));
      expect(next.applied).toEqual([]);
      expect(next.pins).toEqual({ grid: 1 });
    }
  });

  it('does not take the same answer pasted again as new data', () => {
    const before = after([{ type: 'toggle-switch', id: 'cc-clear' }], claudeDone());
    const again = reduce(before, paste(`Here is the result:\n\n${ANSWER_A}\n\n`));
    expect(again.applied).toEqual(['cc-clear']);
    // The same reading object: the store then knows that the usage has not changed.
    expect(again.answer.reading).toBe(before.answer.reading);
    expect(again.answer.text).toContain('Here is the result');
  });

  it('reads a text that is no text as an empty box', () => {
    const next = reduce(claudeDone(), { type: 'set-answer', text: 42, today: TODAY } as unknown as Event);
    expect(stageOf(next)).toBe('steps');
    expect(next.answer.text).toBe('');
  });
});

describe('answer-failed, the store\'s own event', () => {
  it('puts a fixed sentence in place of the result, keeps the text and the set sliders, drops the applied tips', () => {
    const before = after([set('grid', 460), { type: 'toggle-switch', id: 'cc-clear' }], claudeDone());
    const failed = reduce(before, { type: 'answer-failed', text: 'the new text' });
    expect(stageOf(failed)).toBe('problem');
    expect(failed.answer).toEqual({
      text: 'the new text',
      reading: { state: 'problem', code: 'page-fault', message: 'The page could not work out a result from this answer. The fault is in the page, not in your answer.' },
    });
    expect(failed.pins).toEqual(before.pins);
    expect(failed.applied).toEqual([]);
  });

  it('changes nothing for ChatGPT or before a tool is chosen, and takes a text that is no text', () => {
    const chatgpt = chatgptDone();
    expect(reduce(chatgpt, { type: 'answer-failed', text: 'x' })).toBe(chatgpt);
    expect(reduce(initialState(), { type: 'answer-failed', text: 'x' })).toEqual(initialState());
    const claude = claudeDone();
    expect(reduce(claude, { type: 'answer-failed', text: 7 } as unknown as Event).answer.text).toBe('');
  });

  it('goes away with the next answer that works', () => {
    const failed = reduce(claudeDone(), { type: 'answer-failed', text: 'x' });
    expect(stageOf(reduce(failed, { type: 'set-answer', text: '', today: TODAY }))).toBe('steps');
  });
});

describe('reading an export', () => {
  const chosen = reduce(initialState(), { type: 'choose-source', source: 'chatgpt' });

  it('read-started is ignored for Claude Code', () => {
    const claude = claudeDone();
    expect(reduce(claude, { type: 'read-started' })).toBe(claude);
  });

  it('read-started shows the loading stage at once, drops the old result and keeps the set sliders', () => {
    const before = after([set('grid', 460), { type: 'toggle-switch', id: 'thinking' }, { type: 'toggle-switch', id: 'gpt-shorter-answers' }], chatgptDone());
    expect(before.flipped).toEqual(['thinking']);
    const reading = reduce(before, { type: 'read-started' });
    expect(stageOf(reading)).toBe('loading');
    expect(reading.export).toEqual({ phase: 'reading', progress: null });
    expect(reading.pins).toEqual({ grid: 1 });
    expect(reading.applied).toEqual([]);
    expect(reading.flipped).toEqual([]);
  });

  it('read-progress is kept while a read is running and ignored otherwise', () => {
    const reading = reduce(chosen, { type: 'read-started' });
    const report40 = progress({ bytesRead: 40, bytesTotal: 100, conversations: 2 });
    expect(reduce(reading, { type: 'read-progress', progress: report40 }).export).toEqual({ phase: 'reading', progress: report40 });
    expect(reduce(chosen, { type: 'read-progress', progress: report40 })).toBe(chosen);
    const done = chatgptDone();
    expect(reduce(done, { type: 'read-progress', progress: report40 })).toBe(done);
  });

  it('read-ended is ignored when no read is running', () => {
    expect(reduce(chosen, ended(GOOD))).toBe(chosen);
    const done = chatgptDone();
    expect(reduce(done, ended(GOOD))).toBe(done);
  });

  it('read-ended with a reading gives a result, with the day it was read', () => {
    const done = chatgptDone();
    expect(stageOf(done)).toBe('done');
    expect(done.today).toBe(TODAY);
    expect(done.export).toEqual({ phase: 'done', reading: READING, report: GOOD.ok ? GOOD.report : null });
  });

  it('read-ended with nothing to estimate gives a problem', () => {
    for (const code of ['too-many-files', 'internal', 'worker-failed'] as const) {
      const state = chatgptDone({ ok: false, code });
      expect(stageOf(state)).toBe('problem');
      // chatgptDone ends the read before the worker has reported anything: a worker that failed then was never loaded.
      expect(state.export).toEqual({ phase: 'problem', problem: { code: code === 'too-many-files' ? 'E2' : code === 'worker-failed' ? 'E10' : 'E9' } });
    }
  });

  it('a worker that fails after it has reported is not "could not start": E9', () => {
    const heard = after([{ type: 'choose-source', source: 'chatgpt' }, { type: 'read-started' }, { type: 'read-progress', progress: progress({ bytesRead: 10 }) }, ended({ ok: false, code: 'worker-failed' })]);
    expect(heard.export).toEqual({ phase: 'problem', problem: { code: 'E9' } });
    const unheard = after([{ type: 'choose-source', source: 'chatgpt' }, { type: 'read-started' }, ended({ ok: false, code: 'worker-failed' })]);
    expect(unheard.export).toEqual({ phase: 'problem', problem: { code: 'E10' } });
  });

  it('a new export sets the switches again and drops the applied tips', () => {
    const before = after([set('pue', 1.17), { type: 'toggle-switch', id: 'plan-paid' }, { type: 'toggle-switch', id: 'gpt-shorter-answers' }], chatgptDone());
    const next = after([{ type: 'read-started' }, ended({ ok: true, reading: exampleReading('current', false), report: report() })], before);
    expect(next.flipped).toEqual([]);
    expect(next.applied).toEqual([]);
    expect(next.pins).toEqual({ pue: 1 });
    expect(isPaid(next)).toBe(false);
  });

  it('a read that was stopped goes back to the steps, by the action or by the worker', () => {
    const reading = after([set('grid', 460), { type: 'read-started' }], chosen);
    const stopped = reduce(reading, { type: 'cancel-read' });
    expect(stageOf(stopped)).toBe('steps');
    expect(stopped.export).toEqual({ phase: 'waiting' });
    expect(stopped.pins).toEqual({ grid: 1 });
    expect(stageOf(reduce(reading, ended({ ok: false, code: 'cancelled' })))).toBe('steps');
  });

  it('cancel-read is ignored when no read is running', () => {
    expect(reduce(chosen, { type: 'cancel-read' })).toBe(chosen);
    const done = chatgptDone();
    expect(reduce(done, { type: 'cancel-read' })).toBe(done);
  });
});

describe('toggle-switch', () => {
  it('is ignored until there is a result', () => {
    const steps = reduce(initialState(), { type: 'choose-source', source: 'chatgpt' });
    expect(reduce(steps, { type: 'toggle-switch', id: 'thinking' })).toBe(steps);
    const problem = after([{ type: 'choose-source', source: 'claude-code' }, paste('nothing')]);
    expect(reduce(problem, { type: 'toggle-switch', id: 'cc-clear' })).toBe(problem);
    const first = initialState();
    expect(reduce(first, { type: 'toggle-switch', id: 'cc-clear' })).toBe(first);
  });

  it('flips a ChatGPT switch, and flips it back', () => {
    const done = chatgptDone();
    const off = reduce(done, { type: 'toggle-switch', id: 'instructions-memory' });
    expect(off.flipped).toEqual(['instructions-memory']);
    expect(reduce(off, { type: 'toggle-switch', id: 'instructions-memory' }).flipped).toEqual([]);
    expect(off.applied).toEqual([]);
  });

  it('applies a tip of the chosen tool, and takes it off again', () => {
    const done = claudeDone();
    const on = after([{ type: 'toggle-switch', id: 'cc-clear' }, { type: 'toggle-switch', id: 'cc-effort' }], done);
    expect(on.applied).toEqual(['cc-clear', 'cc-effort']);
    expect(reduce(on, { type: 'toggle-switch', id: 'cc-clear' }).applied).toEqual(['cc-effort']);
    expect(after([{ type: 'toggle-switch', id: 'gpt-new-chat' }], chatgptDone()).applied).toEqual(['gpt-new-chat']);
  });

  it('keeps the set sliders and the other switches', () => {
    const before = after([set('grid', 460), { type: 'toggle-switch', id: 'thinking' }], chatgptDone());
    const next = reduce(before, { type: 'toggle-switch', id: 'gpt-less-thinking' });
    expect(next.pins).toEqual({ grid: 1 });
    expect(next.flipped).toEqual(['thinking']);
    expect(next.applied).toEqual(['gpt-less-thinking']);
  });

  it('is ignored for an id that is neither a switch nor a tip of this tool', () => {
    const claude = claudeDone();
    for (const id of ['thinking', 'plan-paid', 'gpt-new-chat', 'opus', '', 'constructor', '__proto__', 'toString']) {
      expect(reduce(claude, { type: 'toggle-switch', id })).toBe(claude);
    }
    const chatgpt = chatgptDone();
    for (const id of ['cc-clear', 'memory', 'hidden:thinking', 'constructor', '__proto__']) {
      expect(reduce(chatgpt, { type: 'toggle-switch', id })).toBe(chatgpt);
    }
    expect(reduce(chatgpt, { type: 'toggle-switch', id: 7 } as unknown as Event)).toBe(chatgpt);
  });
});

describe('set-assumption', () => {
  it('keeps a track position, never the value', () => {
    const state = after([set('grid', 400), set('cacheRead', 0.015), set('hardware', 1.1)]);
    expect(state.pins).toEqual({ grid: positionOf([270, 350, 460], 400), cacheRead: 0.5, hardware: 0 });
    expect(valueAt([270, 350, 460], state.pins.grid ?? -1)).toBeCloseTo(400, 9);
  });

  it('reads an energy value with the row the slider shows', () => {
    // Before a tool is chosen the slider shows the large row: 0.5, 1.0, 5.4.
    expect(after([set('energy', 5.4)]).pins.energy).toBe(1);
    expect(after([set('energy', 2.2)]).pins.energy).toBe(positionOf([0.5, 1.0, 5.4], 2.2));
    // For ChatGPT it shows the mid-size row, whose high end is 2.2.
    expect(after([{ type: 'choose-source', source: 'chatgpt' }, set('energy', 2.2)]).pins.energy).toBe(1);
    // With another lead size the same value is another place on the track.
    expect(reduce(withLead(initialState(), 'fable'), set('energy', 5.4)).pins.energy).toBe(positionOf([0.5, 1.0, 10.8], 5.4));
  });

  it('lands on the ends of the track for a value off the track', () => {
    expect(after([set('grid', 9999), set('pue', -3)]).pins).toEqual({ grid: 1, pue: 0 });
  });

  it('gives a new state every time, also for the same position, and for a drag as for a release', () => {
    const once = reduce(initialState(), set('grid', 400, false));
    const twice = reduce(once, set('grid', 400, true));
    expect(twice).not.toBe(once);
    expect(twice).toEqual(once);
  });

  it('is ignored for a slider that does not exist, one the tool does not have, or a value that is no number', () => {
    const first = initialState();
    for (const id of ['energy-large', 'hidden:memory', '', 'constructor', '__proto__', 'hidden:thinking']) expect(reduce(first, set(id, 1))).toBe(first);
    const claude = reduce(first, { type: 'choose-source', source: 'claude-code' });
    expect(reduce(claude, set('hidden:prompt', 25000))).toBe(claude);
    const chatgpt = reduce(first, { type: 'choose-source', source: 'chatgpt' });
    expect(reduce(chatgpt, set('cacheWrite', 0.15))).toBe(chatgpt);
    expect(reduce(chatgpt, set('hidden:prompt', 25000)).pins).toEqual({ 'hidden:prompt': 0.5 });
    for (const value of [Number.NaN, Infinity, -Infinity]) expect(reduce(first, set('grid', value))).toBe(first);
    expect(reduce(first, { type: 'set-assumption', id: 'grid', value: '350', settled: true } as unknown as Event)).toBe(first);
    expect(reduce(first, { type: 'set-assumption', id: 5, value: 350, settled: true } as unknown as Event)).toBe(first);
  });

  it('keeps the data, the applied tips and the switches', () => {
    const before = after([{ type: 'toggle-switch', id: 'thinking' }, { type: 'toggle-switch', id: 'gpt-new-chat' }], chatgptDone());
    const next = reduce(before, set('grid', 460, false));
    expect(next.export).toBe(before.export);
    expect(next.applied).toEqual(['gpt-new-chat']);
    expect(next.flipped).toEqual(['thinking']);
  });
});

describe('reset-assumptions', () => {
  it('clears every set slider and keeps the data, the applied tips and the switches', () => {
    const before = after([set('grid', 460), set('hidden:files', 40000), { type: 'toggle-switch', id: 'thinking' }, { type: 'toggle-switch', id: 'gpt-new-chat' }], chatgptDone());
    const next = reduce(before, { type: 'reset-assumptions' });
    expect(next.pins).toEqual({});
    expect(next.export).toBe(before.export);
    expect(next.applied).toEqual(['gpt-new-chat']);
    expect(next.flipped).toEqual(['thinking']);
  });

  it('works at every stage, and always gives a new state', () => {
    const first = initialState();
    expect(reduce(first, { type: 'reset-assumptions' })).not.toBe(first);
    expect(reduce(after([set('grid', 460)]), { type: 'reset-assumptions' }).pins).toEqual({});
  });
});

describe('an event the store does not know', () => {
  it('changes nothing', () => {
    const state = claudeDone();
    expect(reduce(state, { type: 'add-files', files: [] } as unknown as Event)).toBe(state);
    expect(reduce(state, { type: 'explode' } as unknown as Event)).toBe(state);
  });
});

describe('the stage', () => {
  it('follows the chosen tool and its data', () => {
    expect(stageOf(initialState())).toBe('choose');
    expect(stageOf(after([{ type: 'choose-source', source: 'claude-code' }]))).toBe('steps');
    expect(stageOf(after([{ type: 'choose-source', source: 'claude-code' }, paste('x')]))).toBe('problem');
    expect(stageOf(claudeDone())).toBe('done');
    expect(stageOf(after([{ type: 'choose-source', source: 'chatgpt' }]))).toBe('steps');
    expect(stageOf(after([{ type: 'choose-source', source: 'chatgpt' }, { type: 'read-started' }]))).toBe('loading');
    expect(stageOf(chatgptDone({ ok: false, code: 'internal' }))).toBe('problem');
    expect(stageOf(chatgptDone())).toBe('done');
  });
});

describe('the plan switch', () => {
  const withPlan = (plusUser: boolean | null): State => chatgptDone({ ok: true, reading: exampleReading('current', plusUser), report: report() });

  it('is on unless the export says the account has no Plus', () => {
    expect(isPaid(withPlan(true))).toBe(true);
    expect(isPaid(withPlan(null))).toBe(true);
    expect(isPaid(withPlan(false))).toBe(false);
  });

  it('turns round when the person flips it', () => {
    expect(isPaid(reduce(withPlan(true), { type: 'toggle-switch', id: 'plan-paid' }))).toBe(false);
    expect(isPaid(reduce(withPlan(false), { type: 'toggle-switch', id: 'plan-paid' }))).toBe(true);
  });
});

describe('withLead', () => {
  it('gives the same object when nothing changes', () => {
    const state = initialState();
    expect(withLead(state, 'large')).toBe(state);
    expect(withLead(state, 'small')).toEqual({ ...state, lead: 'small' });
  });
});

describe('a slider set to its typical value', () => {
  // A slider that was never moved varies. One that is set to typical does not. So the position 0.5
  // must arrive at the estimator, and must not be lost on the way as "nothing set".
  const typicalOf = (id: SliderId, lead: EnergyClass): number => rowOf(id, lead).triple[1];

  it.each(SLIDERS['claude-code'])('Claude Code, %s: position 0.5 in the state and in the estimate', (id) => {
    const done = claudeDone();
    const state = reduce(done, set(id, typicalOf(id, done.lead)));
    expect(state.pins).toEqual({ [id]: 0.5 });
    const counted = count(state);
    expect(counted).not.toBeNull();
    if (counted) expect(estimate(estimateInput(counted, state), { tips: false, biggestUnknown: false }).pins).toEqual({ [id]: 0.5 });
  });

  it.each(SLIDERS.chatgpt)('ChatGPT, %s: position 0.5 in the state and in the estimate', (id) => {
    const done = chatgptDone();
    const state = reduce(done, set(id, typicalOf(id, done.lead)));
    expect(state.pins).toEqual({ [id]: 0.5 });
    const counted = count(state);
    expect(counted).not.toBeNull();
    if (counted) expect(estimate(estimateInput(counted, state), { tips: false, biggestUnknown: false }).pins).toEqual({ [id]: 0.5 });
  });

  it.each(Object.keys(ENERGY_ROWS) as EnergyClass[])('the energy slider with the %s row', (lead) => {
    const state = reduce(withLead(initialState(), lead), set('energy', ENERGY_ROWS[lead].triple[1]));
    expect(state.pins.energy).toBe(0.5);
  });

  it('a bare value never reaches the estimator as a position', () => {
    // 0.015 is the typical weight of a cache read. Read as a position it would sit near the low end.
    const state = reduce(claudeDone(), set('cacheRead', ASSUMPTION_ROWS.cacheRead.triple[1]));
    expect(state.pins.cacheRead).toBe(0.5);
    expect(state.pins.cacheRead).not.toBe(0.015);
  });
});

describe('an answer whose lines are made up of nothing', () => {
  it('still gives a state the estimator takes', () => {
    const state = after([{ type: 'choose-source', source: 'claude-code' }, paste(answer([{ model: 'claude-opus-5-5' }], { first: '2026-10-01' }))]);
    // Whether the reader takes such an answer or not, nothing throws on the way to the numbers.
    const counted = count(state);
    if (counted) expect(() => estimate(estimateInput(counted, state))).not.toThrow();
  });
});
