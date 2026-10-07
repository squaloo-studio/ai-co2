import { describe, expect, it } from 'vitest';
import { MODEL_TABLE } from '../model/assumptions';
import { estimate } from '../model/estimate';
import { hiddenWork } from '../model/hidden';
import { buildTips } from '../model/tips';
import type { ExportReport, ReadOutcome, Reading } from '../sources/chatgpt';
import { conversation, message, node, read } from '../sources/chatgpt/account/test-kit';
import type { Json } from '../sources/chatgpt/account/test-kit';
import { readAnswer } from '../sources/claude-code';
import type { AnswerOk } from '../sources/claude-code';
import { initialState, reduce } from './state';
import type { Event, State } from './state';
import { ANSWER_A, TODAY, WINDOW, answer, exampleReading, report, vector } from './test-kit';
import { cutOffNote, problemWords } from './words';
import { NO_NAME_ROW, count, countAnswer, countExport, cut, estimateInput, exportProblem, fileName, historyInput, leadInput } from './usage';

const at = (day: string, clock = '12:00:00'): number => Date.parse(`${day}T${clock}Z`) / 1000;
const NOW = at(TODAY);

function accepted(text: string, today = TODAY): AnswerOk {
  const reading = readAnswer(text, today);
  if (reading.state !== 'ok') throw new Error(`the answer was not accepted: ${reading.state}`);
  return reading;
}

/** One question and one answer in a conversation of its own. */
const turn = (id: string, time: number, model: string, question = 10, reply = 20): Json =>
  conversation([node('q', 'root', message('user', question, { time })), node('a', 'q', message('assistant', reply, { time: time + 30, model }))], { id, update_time: time + 30 });

const chatgpt = (reading: Reading, events: readonly Event[] = []): State =>
  [{ type: 'choose-source', source: 'chatgpt' }, { type: 'read-started' }, { type: 'read-ended', outcome: { ok: true, reading, report: report() }, today: TODAY }, ...events]
    .reduce((state, event) => reduce(state, event as Event), initialState());

describe('a Claude Code answer, as the estimator takes it', () => {
  it('gives the rows of fixture A, each with its size and its friendly name', () => {
    const counted = countAnswer(accepted(ANSWER_A));
    expect(counted.rows).toEqual(vector('A').input.rows.map((row) => ({ ...row, display: counted.rows.find((mine) => mine.model === row.model)?.display })));
    expect(counted.rows.map((row) => [row.model, row.display, row.sizeClass])).toEqual([
      ['claude-opus-5-5', 'Opus 5.5', 'large'],
      ['claude-sonnet-5', 'Sonnet 5', 'medium'],
      ['claude-haiku-4-5-20251001', 'Haiku 4.5', 'small'],
    ]);
    expect(counted.models.map((model) => model.tokens)).toEqual([576263273, 183752375, 21415968]);
    expect(counted.models.every((model) => model.reason === null && !model.byPlan && model.requests === 0)).toBe(true);
  });

  it('takes the window from the answer and covers all 30 days', () => {
    const counted = countAnswer(accepted(ANSWER_A));
    expect(counted.source).toBe('claude-code');
    expect(counted.window).toEqual(WINDOW);
    expect(counted.covered).toEqual({ first: WINDOW.from, last: WINDOW.to, days: 30 });
    expect(counted.bases.thinking).toEqual([]);
    expect(counted.switches).toEqual([]);
    expect(counted.history).toBeNull();
    expect(counted.totals).toBeNull();
  });

  it('covers fewer days when the logs start late: from the first day with data to the end of the window', () => {
    const counted = countAnswer(accepted(answer([{ model: 'claude-opus-5-5', out: 5000 }], { first: '2026-09-26', last: '2026-10-03' })));
    expect(counted.covered).toEqual({ first: '2026-09-26', last: '2026-10-07', days: 12 });
    // Two days into the window is not late enough for a note, so the 30 days stand.
    expect(countAnswer(accepted(answer([{ model: 'claude-opus-5-5', out: 5000 }], { first: '2026-09-10' }))).covered.days).toBe(30);
  });

  it('builds the tips that can apply, in the order of the catalogue', () => {
    expect(countAnswer(accepted(ANSWER_A)).built.map((tip) => tip.id)).toEqual(['cc-opus-to-sonnet', 'cc-sonnet-to-haiku', 'cc-clear', 'cc-effort']);
    expect(countAnswer(accepted(answer([{ model: 'some-local-model', out: 5000 }]))).built).toEqual([]);
  });

  it('counts a name it cannot place with the widest range, and says why', () => {
    const counted = countAnswer(accepted(answer([{ model: 'unknown', out: 10 }, { model: 'constructor', in: 5 }, { model: 'gpt-5-6', out: 7 }, { model: 'auto', out: 1 }])));
    expect(counted.models.map((model) => [model.row, model.display, model.sizeClass, model.reason, model.byPlan])).toEqual([
      // "unknown" is the script's word for a step that names no model: it is shown as that, not as a model's name.
      ['unknown', NO_NAME_ROW, 'unknown', 'empty', false],
      ['constructor', 'constructor', 'unknown', 'unrecognised', false],
      // No plan is known for Claude Code, so the plan decides nothing here.
      ['gpt-5-6', 'GPT-5.6', 'unknown', 'tier-hidden', true],
      ['auto', 'Auto', 'unknown', 'auto', false],
    ]);
  });

  it('leaves out a row that is no model, and takes no count that is no count', () => {
    const base = accepted(ANSWER_A);
    const odd: AnswerOk = {
      ...base,
      coveredDays: Number.NaN,
      usage: {
        ...base.usage,
        models: [
          { model: '<synthetic>', freshInput: 9, cacheWrite: 9, cacheRead: 9, output: 9 },
          { model: '', freshInput: 9, cacheWrite: 9, cacheRead: 9, output: 9 },
          { model: 'claude-opus-5-5', freshInput: Number.NaN, cacheWrite: -4, cacheRead: Infinity, output: 12 },
        ],
      },
    };
    const counted = countAnswer(odd);
    expect(counted.rows).toEqual([{ model: 'claude-opus-5-5', display: 'Opus 5.5', sizeClass: 'large', freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 12 }]);
    expect(counted.covered.days).toBe(30);
    const state = reduce(reduce(initialState(), { type: 'choose-source', source: 'claude-code' }), { type: 'set-answer', text: ANSWER_A, today: TODAY });
    expect(() => estimate(estimateInput(counted, state))).not.toThrow();
  });
});

describe('a ChatGPT reading, as the estimator takes it', () => {
  const READING = exampleReading('current', true);

  it('counts the 30 days that end today, with the size the plan gives "gpt-5-6"', () => {
    const paid = countExport(READING, TODAY, true);
    expect(paid.source).toBe('chatgpt');
    expect(paid.window).toEqual(WINDOW);
    expect(paid.models.map((model) => [model.row, model.display, model.sizeClass, model.byPlan, model.requests])).toEqual([
      ['gpt-5-6-t-mini', 'GPT-5.6 Thinking mini', 'small', false, 1],
      ['gpt-5-6', 'GPT-5.6', 'large', true, 5],
    ]);
    const free = countExport(READING, TODAY, false);
    expect(free.models.map((model) => [model.row, model.sizeClass])).toEqual([['gpt-5-6-t-mini', 'small'], ['gpt-5-6', 'small']]);
    // ChatGPT shows no cache writes.
    expect([...paid.rows, ...free.rows].every((row) => row.cacheWrite === 0)).toBe(true);
  });

  it('counts less re-reading on the free plan, and nothing else differently', () => {
    const paid = countExport(READING, TODAY, true);
    const free = countExport(READING, TODAY, false);
    const sum = (rows: typeof paid.rows, type: 'freshInput' | 'cacheRead' | 'output'): number => rows.reduce((total, row) => total + (row[type] ?? 0), 0);
    expect(sum(free.rows, 'output')).toBe(sum(paid.rows, 'output'));
    expect(sum(free.rows, 'cacheRead') + sum(free.rows, 'freshInput')).toBeLessThanOrEqual(sum(paid.rows, 'cacheRead') + sum(paid.rows, 'freshInput'));
    // The seconds of thinking are the same. Only the size of "gpt-5-6" follows the plan.
    const units = (rows: typeof paid.bases.thinking): Array<[string, number]> => rows.map((row) => [row.model, row.output ?? 0]);
    expect(units(free.bases.thinking)).toEqual(units(paid.bases.thinking));
    expect(free.switches).toEqual(paid.switches);
  });

  it('hands over the six bases under the names the estimator knows, each row with its size', () => {
    const counted = countExport(READING, TODAY, true);
    expect(Object.keys(counted.bases)).toEqual(['thinking', 'prompt', 'personal', 'search', 'files', 'misses']);
    // 129 seconds of thinking are recorded inside the 30 days, and one more answer thought by its name alone.
    expect(counted.bases.thinking.reduce((sum, row) => sum + (row.output ?? 0), 0)).toBeGreaterThanOrEqual(129);
    for (const rows of Object.values(counted.bases)) {
      for (const row of rows) {
        expect(['gpt-5-6', 'gpt-5-6-t-mini']).toContain(row.model);
        expect(row.sizeClass).toBe(row.model === 'gpt-5-6' ? 'large' : 'small');
      }
    }
    // One request, one reading of the memory block: six in all.
    expect(counted.bases.personal.reduce((sum, row) => sum + (row.freshInput ?? 0) + (row.cacheRead ?? 0), 0)).toBe(6);
    expect(counted.totals?.requests).toBe(6);
  });

  it('tells the thinking tip when some of the thinking time is assumed, so its title says "By our count"', () => {
    const counted = countExport(READING, TODAY, true);
    // The example records 129 seconds, and the reader assumes a time for one more answer of a thinking model.
    expect(counted.totals?.thinkingRecorded).toBeGreaterThan(0);
    expect(counted.totals?.thinkingSecondsAssumed).toBeGreaterThan(0);
    const title = counted.built.find((tip) => tip.id === 'gpt-less-thinking')?.texts.title([]);
    expect(title).toMatch(/^By our count, ChatGPT thought for about \d+ minutes before its answers$/);
    // With every time recorded, the title states the time as the export's own.
    const recordedOnly = buildTips({ source: 'chatgpt', rows: counted.rows, hidden: hiddenWork(counted.bases, { thinking: true, prompt: true, personal: true, search: true, files: true, misses: true }), thinkingRecorded: true, thinkingPartlyAssumed: false });
    expect(recordedOnly.find((tip) => tip.id === 'gpt-less-thinking')?.texts.title([])).toMatch(/^ChatGPT thought for about /);
  });

  it('sets the switches from the export', () => {
    const switches = countExport(READING, TODAY, true).switches;
    expect(switches.map((entry) => [entry.id, entry.shown, entry.on])).toEqual([
      ['thinking', true, true],
      ['instructions-memory', true, true],
      ['search-files', true, true],
      ['plan-paid', true, true],
    ]);
    expect(countExport(exampleReading('current', false), TODAY, false).switches.find((entry) => entry.id === 'plan-paid')?.on).toBe(false);
  });

  it('covers the days from the start of the window to the newest message', () => {
    // The newest message of the example is from 2 October.
    expect(countExport(READING, TODAY, true).covered).toEqual({ first: '2026-09-08', last: '2026-10-02', days: 25 });
  });

  it('covers the days from the oldest message when the export starts inside the window', () => {
    const young = read([turn('a', at('2026-09-28'), 'gpt-5-5'), turn('b', at('2026-10-05'), 'gpt-5-5')], { now: NOW });
    expect(countExport(young, TODAY, true).covered).toEqual({ first: '2026-09-28', last: '2026-10-05', days: 8 });
    const oneDay = read([turn('a', at('2026-10-07', '08:00:00'), 'gpt-5-5')], { now: NOW });
    expect(countExport(oneDay, TODAY, true).covered).toEqual({ first: '2026-10-07', last: '2026-10-07', days: 1 });
    // An export made 20 days ago, dropped today, covers 10 days of the window.
    const old = read([turn('a', at('2026-07-01'), 'gpt-5-5'), turn('b', at('2026-09-17'), 'gpt-5-5')], { now: NOW });
    expect(countExport(old, TODAY, true).covered).toEqual({ first: '2026-09-08', last: '2026-09-17', days: 10 });
  });

  it('keeps the whole history beside the 30 days, since the month of the oldest request', () => {
    const counted = countExport(READING, TODAY, true);
    expect(counted.history?.since).toBe('July 2026');
    expect(counted.history?.rows.map((row) => row.model).sort()).toEqual(['gpt-5-5', 'gpt-5-5-thinking', 'gpt-5-6', 'gpt-5-6-t-mini']);
    const all = (rows: readonly { output?: number }[]): number => rows.reduce((sum, row) => sum + (row.output ?? 0), 0);
    expect(all(counted.history?.rows ?? [])).toBeGreaterThan(all(counted.rows));
  });

  it('gives a request that names no model a row name the estimator takes', () => {
    const nameless = conversation(
      [node('q', 'root', message('user', 10, { time: at('2026-10-01') })), node('a', 'q', message('assistant', 20, { time: at('2026-10-01') + 30 }))],
      { id: 'n', update_time: at('2026-10-01') + 30, default_model_slug: null },
    );
    const reading = read([nameless, turn('auto', at('2026-10-02'), 'auto')], { now: NOW });
    const counted = countExport(reading, TODAY, true);
    expect(counted.models.map((model) => [model.row, model.display, model.sizeClass, model.reason, model.requests]).sort()).toEqual([
      [NO_NAME_ROW, '(no model name)', 'unknown', 'empty', 1],
      // "auto" names no model either. The remark says "names no model", and the row is called the same.
      ['auto', NO_NAME_ROW, 'unknown', 'auto', 1],
    ]);
    const state = chatgpt(reading);
    expect(() => estimate(estimateInput(counted, state), { marketGrid: 70 })).not.toThrow();
    const history = historyInput(counted, state);
    expect(history).not.toBeNull();
    if (history) expect(() => estimate(history)).not.toThrow();
  });

  it('takes any model name a file can hold, and shows at most 60 characters of it', () => {
    const long = `my-own-model-${'x'.repeat(51)}`;
    expect(long).toHaveLength(64);
    const reading = read([turn('a', at('2026-10-01'), 'constructor'), turn('b', at('2026-10-02'), 'valueOf'), turn('c', at('2026-10-03'), long), turn('d', at('2026-10-04'), 'toString')], { now: NOW });
    const counted = countExport(reading, TODAY, true);
    expect(counted.models.map((model) => model.row).sort()).toEqual(['valueOf', 'constructor', long, 'toString'].sort());
    expect(counted.models.find((model) => model.row === long)?.display).toBe(long.slice(0, 60));
    expect(counted.models.every((model) => model.sizeClass === 'unknown' && model.requests === 1 && model.tokens === 30)).toBe(true);
    const result = estimate(estimateInput(counted, chatgpt(reading)));
    expect(result.shares.models.map((share) => share.model).sort()).toEqual(['valueOf', 'constructor', long, 'toString'].sort());
  });

  it('takes no count that is no count from a reading', () => {
    const reading = read([turn('a', at('2026-10-01'), 'gpt-5-5', 10, 20)], { now: NOW });
    const day = reading.days[0];
    const model = day?.models[0];
    if (!day || !model) throw new Error('the made-up reading has no day');
    const broken: Reading = {
      ...reading,
      days: [{ ...day, models: [{ ...model, output: Number.NaN, newInput: -5, promptReadings: Infinity, thinkingSeconds: Number.NaN, requests: 1 }] }],
    };
    const counted = countExport(broken, TODAY, true);
    for (const row of [...counted.rows, ...Object.values(counted.bases).flat()]) {
      for (const value of [row.freshInput, row.cacheWrite, row.cacheRead, row.output]) expect(value === undefined || (Number.isFinite(value) && value >= 0)).toBe(true);
    }
    const state = chatgpt(broken);
    expect(() => estimate(estimateInput(counted, state))).not.toThrow();
  });

  it('has no whole-history line when no request has a date', () => {
    const reading = { ...exampleReading('current'), firstRequest: null };
    expect(countExport(reading, TODAY, true).history).toBeNull();
    const state = chatgpt(reading);
    const counted = count(state);
    expect(counted && historyInput(counted, state)).toBeNull();
  });
});

describe('what goes to the estimator', () => {
  const done = (events: readonly Event[] = []): State =>
    [{ type: 'choose-source', source: 'claude-code' }, { type: 'set-answer', text: ANSWER_A, today: TODAY }, ...events].reduce((state, event) => reduce(state, event as Event), initialState());

  it('is nothing until there is a result', () => {
    expect(count(initialState())).toBeNull();
    expect(count(reduce(initialState(), { type: 'choose-source', source: 'claude-code' }))).toBeNull();
    expect(count(reduce(reduce(initialState(), { type: 'choose-source', source: 'chatgpt' }), { type: 'read-started' }))).toBeNull();
  });

  it('holds the rows, the set sliders as positions, every tip and the applied ones, and the table with the unknown size', () => {
    const state = done([{ type: 'set-assumption', id: 'grid', value: 460, settled: true }, { type: 'toggle-switch', id: 'cc-clear' }]);
    const counted = count(state);
    if (!counted) throw new Error('no usage');
    const input = estimateInput(counted, state);
    expect(input.rows).toBe(counted.rows);
    expect(input.hidden).toEqual([]);
    expect(input.pins).toEqual({ grid: 1 });
    expect(input.tips).toBe(counted.built);
    expect(input.applied).toEqual(['cc-clear']);
    expect(input.table).toBe(MODEL_TABLE);
    expect(MODEL_TABLE.energy.unknown).toEqual([0.05, 0.6, 5.4]);
    expect(historyInput(counted, state)).toBeNull();
    expect(leadInput(counted, state)).toEqual({ rows: counted.rows, hidden: [], table: MODEL_TABLE });
  });

  it('leaves out an applied tip that this usage has no place for, and a pin the tool has no slider for', () => {
    const state: State = { ...done(), applied: ['cc-fable-to-sonnet', 'cc-clear', 'gpt-new-chat'], pins: { grid: 0.25, 'hidden:thinking': 0.9, energy: 7 } };
    const counted = count(state);
    if (!counted) throw new Error('no usage');
    const input = estimateInput(counted, state);
    expect(input.applied).toEqual(['cc-clear']);
    expect(input.pins).toEqual({ grid: 0.25 });
    expect(() => estimate(input)).not.toThrow();
  });

  it('always hands over all six pieces for ChatGPT, each switched as its switch stands', () => {
    const reading = exampleReading('current', true);
    const on = chatgpt(reading);
    const counted = count(on);
    if (!counted) throw new Error('no usage');
    expect(estimateInput(counted, on).hidden?.map((piece) => [piece.id, piece.slot, piece.on])).toEqual([
      ['thinking', 0, true], ['prompt', 1, true], ['personal', 2, true], ['search', 3, true], ['files', 4, true], ['misses', 5, true],
    ]);
    const off = chatgpt(reading, [{ type: 'toggle-switch', id: 'instructions-memory' }, { type: 'toggle-switch', id: 'thinking' }]);
    expect(estimateInput(counted, off).hidden?.map((piece) => piece.on)).toEqual([false, false, false, true, true, true]);
    expect(historyInput(counted, off)?.hidden?.map((piece) => piece.on)).toEqual([false, false, false, true, true, true]);
    expect(historyInput(counted, off)?.tips).toBeUndefined();
    // The size that leads the energy slider is picked with no slider set and no tip.
    expect(leadInput(counted, off).pins).toBeUndefined();
  });
});

describe('an export that gives no result', () => {
  const READING = exampleReading('current');
  const EMPTY: Reading = read([], { now: NOW });
  const ok = (reading: Reading, change: Partial<ExportReport> = {}): ReadOutcome => ({ ok: true, reading, report: report(change) });
  const totals = (change: Partial<ExportReport['totals']>): ExportReport['totals'] => ({ ...report().totals, ...change });

  it('E2: too many files were dropped', () => {
    expect(exportProblem({ ok: false, code: 'too-many-files' }, TODAY)).toEqual({ code: 'E2' });
  });

  it('E9: the worker stopped for another reason', () => {
    expect(exportProblem({ ok: false, code: 'internal' }, TODAY)).toEqual({ code: 'E9' });
    expect(exportProblem({ ok: false, code: 'worker-failed' }, TODAY)).toEqual({ code: 'E9' });
    expect(exportProblem({ ok: false, code: 'worker-failed' }, TODAY, true)).toEqual({ code: 'E9' });
    // A fault in the page's own code is not a reader that could not be loaded, heard or not.
    expect(exportProblem({ ok: false, code: 'internal' }, TODAY, false)).toEqual({ code: 'E9' });
  });

  it('E10: the worker ended before it reported anything, as when its file cannot be fetched', () => {
    expect(exportProblem({ ok: false, code: 'worker-failed' }, TODAY, false)).toEqual({ code: 'E10' });
    expect(exportProblem({ ok: false, code: 'too-many-files' }, TODAY, false)).toEqual({ code: 'E2' });
  });

  it('E6: a limit was passed, also when other conversations were read', () => {
    for (const problem of ['file-too-large', 'total-too-large', 'ratio-too-high', 'conversation-too-large'] as const) {
      const files = [...report().files, { path: ['export.zip', 'conversations-001.json'], bytes: 1, handed: 0, skipped: 0, problem }];
      expect(exportProblem(ok(READING, { files }), TODAY)).toEqual({ code: 'E6' });
    }
    expect(exportProblem(ok(READING, { notices: [{ code: 'too-many-entries', path: ['x.zip'], limit: 100000 }] }), TODAY)).toEqual({ code: 'E6' });
    expect(exportProblem(ok(READING, { notices: [{ code: 'too-many-conversation-files', path: ['x.zip'], limit: 2000 }] }), TODAY)).toEqual({ code: 'E6' });
    expect(exportProblem(ok(READING, { notices: [{ code: 'too-many-inner-archives', path: ['x.zip'], limit: 50, found: 51 }] }), TODAY)).toEqual({ code: 'E6' });
  });

  it('E1: no dropped file is a ZIP or a conversations file', () => {
    const outcome = ok(EMPTY, { files: [], notices: [{ code: 'ignored', path: ['holiday.jpg'] }], totals: totals({ archives: 0, conversationFiles: 0 }) });
    expect(exportProblem(outcome, TODAY)).toEqual({ code: 'E1' });
  });

  it('E3: a ZIP opens and holds no conversations file', () => {
    const outcome = ok(EMPTY, { files: [], notices: [{ code: 'no-conversations', path: ['photos.zip'] }], totals: totals({ conversationFiles: 0 }) });
    expect(exportProblem(outcome, TODAY)).toEqual({ code: 'E3' });
  });

  it('E4: a ZIP cannot be read at all, or the rescue read finds no conversation', () => {
    const unreadable = ok(EMPTY, { files: [], notices: [{ code: 'unreadable', path: ['export.zip'] }], totals: totals({ conversationFiles: 0 }) });
    expect(exportProblem(unreadable, TODAY)).toEqual({ code: 'E4' });
    const rescued = ok(EMPTY, { notices: [{ code: 'rescued', path: ['export.zip'], files: 1, conversations: 0 }] });
    expect(exportProblem(rescued, TODAY)).toEqual({ code: 'E4' });
  });

  it('E4, not E3 or E7: the conversations file is there, behind a password', () => {
    const notices = [{ code: 'encrypted' as const, path: ['export.zip', 'conversations.json'] }];
    expect(exportProblem(ok(EMPTY, { files: [], notices, totals: totals({ conversationFiles: 0 }) }), TODAY)).toEqual({ code: 'E4' });
    // One file behind a password beside one that holds an empty list.
    expect(exportProblem(ok(EMPTY, { notices }), TODAY)).toEqual({ code: 'E4' });
  });

  it('E11, not E7: a conversations file is damaged, cut off or broken before its first conversation', () => {
    for (const problem of ['damaged', 'cut-off', 'not-json'] as const) {
      const files = [{ path: ['export.zip', 'conversations.json'], bytes: 0, handed: 0, skipped: 0, problem }];
      expect(exportProblem(ok(EMPTY, { files }), TODAY)).toEqual({ code: 'E11', name: 'conversations.json' });
      expect(exportProblem(ok(EMPTY, { files: [{ ...files[0], path: ['conversations-000.json'] }] } as Partial<ExportReport>), TODAY)).toEqual({ code: 'E11', name: 'conversations-000.json' });
    }
    // A damaged file comes before one that is no list: it is the one worth downloading again.
    const both = [
      { path: ['a.json'], bytes: 4, handed: 0, skipped: 0, problem: 'not-an-array' as const },
      { path: ['b.zip', 'conversations.json'], bytes: 0, handed: 0, skipped: 0, problem: 'damaged' as const },
    ];
    expect(exportProblem(ok(EMPTY, { files: both }), TODAY)).toEqual({ code: 'E11', name: 'conversations.json' });
  });

  it('E5: a loose file is not a list, named by its own name, cut short', () => {
    const name = `${'n'.repeat(80)}.json`;
    const files = [{ path: ['conversations.json'], bytes: 10, handed: 0, skipped: 0, problem: 'not-an-array' as const }];
    expect(exportProblem(ok(EMPTY, { files }), TODAY)).toEqual({ code: 'E5', name: 'conversations.json' });
    expect(exportProblem(ok(EMPTY, { files: [{ ...files[0], path: [name], problem: 'empty' }] } as Partial<ExportReport>), TODAY)).toEqual({ code: 'E5', name: 'n'.repeat(60) });
  });

  it('E3, not E5, for a file inside a ZIP that is not a list: "drop the export ZIP" is what the person just did', () => {
    for (const problem of ['not-an-array', 'empty'] as const) {
      const files = [{ path: ['export.zip', 'conversations.json'], bytes: 7, handed: 0, skipped: 0, problem }];
      expect(exportProblem(ok(EMPTY, { files }), TODAY)).toEqual({ code: 'E3' });
      expect(exportProblem(ok(EMPTY, { files: [{ ...files[0], path: ['outer.zip', 'inner.zip', 'conversations.json'] }] } as Partial<ExportReport>), TODAY)).toEqual({ code: 'E3' });
    }
  });

  it('E7: every file was read and there is no conversation at all', () => {
    expect(exportProblem(ok(EMPTY), TODAY)).toEqual({ code: 'E7' });
  });

  it('E8: there are conversations, and no request falls inside the 30 days', () => {
    expect(exportProblem(ok(READING), '2027-03-01')).toEqual({ code: 'E8', newest: '2026-10-02' });
    const old = read([turn('a', at('2026-07-01'), 'gpt-5-5')], { now: NOW });
    expect(exportProblem(ok(old), TODAY)).toEqual({ code: 'E8', newest: '2026-07-01' });
    expect(exportProblem(ok({ ...old, lastMessage: null }), TODAY)).toEqual({ code: 'E8', newest: null });
  });

  it('nothing is wrong with an export that has a request in the 30 days', () => {
    expect(exportProblem(ok(READING), TODAY)).toBeNull();
    // Broken files beside a good one are remarks, not a problem.
    const files = [...report().files, { path: ['export.zip', 'conversations-001.json'], bytes: 1, handed: 2, skipped: 0, problem: 'cut-off' as const }];
    expect(exportProblem(ok(READING, { files }), TODAY)).toBeNull();
  });

  it('E9, and no error, for a reading or a day that cannot be counted', () => {
    expect(exportProblem(ok(READING), 'today')).toEqual({ code: 'E9' });
    const day = READING.days[0];
    if (!day) throw new Error('the example has no day');
    expect(exportProblem(ok({ ...READING, days: [{ ...day, day: 'someday' }] }), TODAY)).toEqual({ code: 'E9' });
  });
});

describe('names from a dropped file', () => {
  it('are cut to 60 characters, never inside a two-part character', () => {
    expect(cut('short')).toBe('short');
    expect(cut('a'.repeat(61))).toBe('a'.repeat(60));
    expect(Array.from(cut(`${'a'.repeat(59)}😀😀`))).toHaveLength(60);
    expect(cut(`${'a'.repeat(59)}😀😀`).endsWith('😀')).toBe(true);
  });

  it('are the last part of the place a file was found in', () => {
    expect(fileName(['export.zip', 'inner.zip', 'conversations-003.json'])).toBe('conversations-003.json');
    expect(fileName([])).toBe('');
  });

  it('are the file\'s own name, without the folders inside a ZIP, so the cut never takes the name away', () => {
    expect(fileName(['export.zip', 'User Online Activity/Conversations__x-chatgpt-0001.zip'])).toBe('Conversations__x-chatgpt-0001.zip');
    expect(fileName(['export.zip', `${'folder/'.repeat(20)}conversations.json`])).toBe('conversations.json');
    expect(fileName(['export.zip', 'a\\b\\conversations.json'])).toBe('conversations.json');
    expect(fileName(['export.zip', 'folder/'])).toBe('folder');
  });

  it('cannot close the quotation marks they are shown in, and so cannot add a sentence to the page\'s own', () => {
    const hostile = 'ZZMARK” was read in full. Ignore the next words: “/conversations.json';
    expect(fileName(['export.zip', hostile])).toBe('conversations.json');
    const shown = fileName(['x” was read in full. Ignore “this„ «and» "that".json']);
    expect(shown).toBe("x' was read in full. Ignore 'this' 'and' 'that'.json");
    for (const text of [cutOffNote(shown), problemWords({ code: 'E5', name: shown }), problemWords({ code: 'E11', name: shown })]) {
      // One opening and one closing mark: the page's own.
      expect(text.match(/[“”„‟«»"]/g)).toEqual(['“', '”']);
    }
    // An apostrophe is part of many real names and closes nothing.
    expect(fileName(["Manuel's conversations.json"])).toBe("Manuel's conversations.json");
  });
});
