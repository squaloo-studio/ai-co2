// What the store builds on: windows, the plan, the calendar, the options, and the counts behind the
// page's notes and tips. One token per word, so every number here can be checked by hand.
import { describe, expect, it } from 'vitest';
import { createAccount, type AccountOptions } from './account';
import readingSource from './reading.ts?raw';
import rulesSource from './rules.ts?raw';
import { dayFromName, dayIndexIn, dayName, planFromExport, totals, windowEndingAt, windowOf, type Reading, type Totals } from './reading';
import { conversation, countWords, message, node, read, words, type Json } from './test-kit';

const at = (day: string, clock = '12:00:00') => Date.parse(`${day}T${clock}Z`) / 1000;
/** [fresh input, cache read, output] over all models. */
const rowsOf = (t: Totals) => [t.rows.reduce((s, r) => s + r.freshInput, 0), t.rows.reduce((s, r) => s + r.cacheRead, 0), t.rows.reduce((s, r) => s + r.output, 0)];
const turn = (id: string, time: number, question: number, answer: number, model = 'gpt-5-6'): Json =>
  conversation([node('q', 'root', message('user', question, { time })), node('a', 'q', message('assistant', answer, { time: time + 30, model }))], { id, update_time: time + 30 });

describe('the window', () => {
  const NOW = at('2026-10-07');
  // Three conversations of one question each: 25 August, 12 September and 20 September.
  const export3 = [turn('august', at('2026-08-25'), 10, 20), turn('mid', at('2026-09-12'), 9, 21), turn('newest', at('2026-09-20', '15:05:05'), 7, 13)];
  const reading = read(export3, { now: NOW });

  it('that ends today holds the 30 days up to today, today included', () => {
    const window = windowOf(reading, NOW);
    expect(window).toEqual({ from: '2026-09-08', to: '2026-10-07' });
    expect(dayFromName(window.to) - dayFromName(window.from) + 1).toBe(30);
    const t = totals(reading, window, 'paid');
    // 12 and 20 September are in it. 25 August is not.
    expect(rowsOf(t)).toEqual([9 + 7, 0, 21 + 13]);
    expect([t.conversations, t.requests, t.answers, t.prompts, t.messages]).toEqual([2, 2, 2, 2, 4]);
  });

  it('that ends at the newest message reaches further back', () => {
    expect(reading.lastMessage).toBe(at('2026-09-20', '15:05:35'));
    const window = windowOf(reading, reading.lastMessage ?? 0);
    expect(window).toEqual({ from: '2026-08-22', to: '2026-09-20' });
    const t = totals(reading, window, 'paid');
    expect(rowsOf(t)).toEqual([10 + 9 + 7, 0, 20 + 21 + 13]);
    expect([t.conversations, t.requests]).toEqual([3, 3]);
    expect(t).toEqual({ ...totals(reading, 'all', 'paid') });
  });

  it('in which no request falls is empty, and says so in every field', () => {
    const t = totals(reading, windowOf(reading, at('2027-01-15')), 'paid');
    expect(t).toEqual({
      conversations: 0, messages: 0, prompts: 0, answers: 0, requests: 0, coldRequests: 0, cutRequests: 0,
      rows: [], requestsByModel: [],
      hidden: { thinking: [], systemPrompt: [], memory: [], search: [], files: [], cacheMisses: [] },
      evidence: { thinking: 'none', memoryInUse: false, searchOrFiles: false },
      recaps: 0, thinkingSeconds: 0, thinkingSecondsAssumed: 0, thinkingRecorded: 0, thinkingAssumed: 0,
      sources: 0, searchRequests: 0, filesWithoutCount: 0, filesWithCount: 0, images: 0, transcripts: 0, memoryMessages: 0,
    });
    // The store can still say when the newest message was.
    expect(dayName(dayIndexIn(reading.calendar, reading.lastMessage ?? 0))).toBe('2026-09-20');
  });

  it('takes its first day from its first second and its last day to its last second', () => {
    const edges = read([
      turn('before', at('2026-09-07', '23:59:00'), 1, 1), turn('first', at('2026-09-08', '00:00:00'), 2, 2),
      turn('last', at('2026-10-07', '23:59:00'), 3, 3), turn('after', at('2026-10-08', '00:00:00'), 4, 4),
    ], { now: at('2026-10-09') });
    expect(rowsOf(totals(edges, { from: '2026-09-08', to: '2026-10-07' }, 'paid'))).toEqual([2 + 3, 0, 2 + 3]);
  });

  it('counts a conversation in every window one of its messages falls into, and a request only by its own time', () => {
    const long = conversation([
      node('q1', 'root', message('user', 10, { time: at('2026-08-01') })), node('a1', 'q1', message('assistant', 20, { time: at('2026-08-01') + 5 })),
      node('q2', 'a1', message('user', 5, { time: at('2026-09-30') })), node('a2', 'q2', message('assistant', 8, { time: at('2026-09-30') + 5 })),
    ], { id: 'long', update_time: at('2026-09-30') + 5 });
    const r = read([long], { now: NOW });
    const inside = totals(r, windowEndingAt(NOW), 'paid');
    // The second request is cold, so it read the first question again as fresh input: 5 + 20 + 10.
    expect([inside.conversations, inside.requests, ...rowsOf(inside)]).toEqual([1, 1, 35, 0, 8]);
    expect(inside.rows[0]?.rereadFresh).toBe(10);
    expect(totals(r, { from: '2026-08-02', to: '2026-09-29' }, 'paid').conversations).toBe(0);
  });

  it('leaves out a request dated ahead of a clock that is behind, unless the window ends a day later', () => {
    const now = at('2026-10-07', '22:00:00');
    const ahead = read([turn('ahead', now + 3 * 3600, 4, 6)], { now });
    expect(ahead.days.map((day) => day.day)).toEqual(['2026-10-08']);
    expect(ahead.lastRequest).toBe(now + 3 * 3600 + 30);
    expect(totals(ahead, windowEndingAt(now), 'paid').requests).toBe(0);
    expect(totals(ahead, windowEndingAt(now + 86_400), 'paid').requests).toBe(1);
  });

  it('refuses days that are not days, and holds nothing when it ends before it starts', () => {
    expect(() => totals(reading, { from: 'today', to: '2026-10-07' }, 'paid')).toThrow(RangeError);
    expect(totals(reading, { from: '2026-10-07', to: '2026-09-08' }, 'paid').requests).toBe(0);
  });
});

describe('the plan', () => {
  // q1 (8,000) ── a1 (100) ── q2 (50) ── a2 (20) ── three hours ── q3 (30,000) ── a3 (10) ── q4 (5) ── a4 (7)
  const T = at('2026-09-15');
  const long = (model: string): Json => conversation([
    node('q1', 'root', message('user', 8_000, { time: T })), node('a1', 'q1', message('assistant', 100, { time: T + 10, model })),
    node('q2', 'a1', message('user', 50, { time: T + 60 })), node('a2', 'q2', message('assistant', 20, { time: T + 70, model })),
    node('q3', 'a2', message('user', 30_000, { time: T + 10_800 })), node('a3', 'q3', message('assistant', 10, { time: T + 10_810, model })),
    node('q4', 'a3', message('user', 5, { time: T + 10_860 })), node('a4', 'q4', message('assistant', 7, { time: T + 10_870, model })),
  ], { id: model, update_time: T + 10_870 });
  const of = (model: string, plan: 'free' | 'paid') => totals(read([long(model)], { now: T + 86_400 }), 'all', plan);

  // request   new      previous answer   earlier prompt                   after
  // a1         8,000         0                  0                         cold
  // a2            50       100              8,000                         warm
  // a3        30,000        20              8,000 + 100 + 50 = 8,150      cold
  // a4             5        10              8,150 + 20 + 30,000 = 38,170  warm
  it('on a paid plan cuts an instant model at 34,000 tokens of earlier conversation', () => {
    const t = of('gpt-5-6', 'paid');
    // Fresh: 8,000 + (50 + 100) + (30,000 + 20 + 8,150) + (5 + 10). Cache read: 8,000 + 34,000 of the 38,170.
    expect(rowsOf(t)).toEqual([46_335, 42_000, 137]);
    expect([t.cutRequests, t.rows[0]?.rereadFresh]).toEqual([1, 8_150]);
    expect(t.hidden.cacheMisses.map((row) => row.freshInput)).toEqual([42_000]);
  });

  it('on a paid plan lets a thinking model re-read up to 236,000', () => {
    const t = of('gpt-5-6-thinking', 'paid');
    expect(rowsOf(t)).toEqual([46_335, 8_000 + 38_170, 137]);
    expect([t.cutRequests, t.rows[0]?.rereadFresh]).toEqual([0, 8_150]);
  });

  it.each(['gpt-5-6', 'gpt-5-6-thinking'])('on the free plan cuts %s at 7,000', (model) => {
    const t = of(model, 'free');
    // Fresh: 8,000 + 150 + (30,000 + 20 + 7,000) + 15. Cache read: 7,000 + 7,000.
    expect(rowsOf(t)).toEqual([45_185, 14_000, 137]);
    expect([t.cutRequests, t.rows[0]?.rereadFresh]).toEqual([3, 7_000]);
    expect(t.hidden.cacheMisses.map((row) => row.freshInput)).toEqual([14_000]);
  });

  it('changes the re-read text, the count of cut requests and the cache-miss base, and nothing else', () => {
    for (const model of ['gpt-5-6', 'gpt-5-6-thinking']) {
      const paid = of(model, 'paid');
      const free = of(model, 'free');
      const same = (t: Totals) => {
        const { rows, cutRequests, hidden: { cacheMisses, ...otherBases }, ...rest } = t;
        return { ...rest, otherBases, output: rows.map((row) => [row.model, row.output, row.cacheWrite]) };
      };
      expect(same(free)).toEqual(same(paid));
      expect(free.cutRequests).toBeGreaterThan(paid.cutRequests);
      // What was new to the model is never cut: fresh input minus the re-read part is the same on both plans.
      const neverCut = (t: Totals) => t.rows.map((row) => row.freshInput - row.rereadFresh);
      expect(neverCut(free)).toEqual(neverCut(paid));
      expect(neverCut(paid)).toEqual([8_000 + 150 + 30_020 + 15]);
    }
  });

  it('comes from user.json: free only when it says so', () => {
    const plan = (user?: unknown) => {
      const account = createAccount({ countTokens: countWords });
      if (user !== undefined) account.setUser(user);
      return planFromExport(account.finish());
    };
    expect([plan({ chatgpt_plus_user: false }), plan({ chatgpt_plus_user: true }), plan(), plan({ email: 'x' })]).toEqual(['free', 'paid', 'paid', 'paid']);
  });
});

describe('what the tips and notes need', () => {
  const T = at('2026-09-15');
  const NOW = at('2026-10-07');

  it('gives the part of fresh input that is old conversation read again after a break, per model', () => {
    const c = conversation([
      node('q1', 'root', message('user', 10, { time: T })), node('a1', 'q1', message('assistant', 20, { time: T + 5, model: 'gpt-5-6' })),
      node('q2', 'a1', message('user', 5, { time: T + 60 })), node('a2', 'q2', message('assistant', 8, { time: T + 65, model: 'gpt-4o' })),
      node('q3', 'a2', message('user', 4, { time: T + 9_000 })), node('a3', 'q3', message('assistant', 6, { time: T + 9_005, model: 'gpt-4o' })),
    ]);
    const t = totals(read([c], { now: NOW }), 'all', 'paid');
    // a2 is warm: it read q1 from the cache. a3 is cold: it read q1, a1 and q2 again as fresh input.
    expect(t.rows.map((row) => [row.model, row.freshInput, row.rereadFresh, row.cacheRead])).toEqual([
      ['gpt-4o', (5 + 20) + (4 + 8 + 35), 35, 10],
      ['gpt-5-6', 10, 0, 0],
    ]);
    for (const row of t.rows) expect(row.rereadFresh).toBeLessThanOrEqual(row.freshInput);
  });

  it('counts messages with a voice transcript, by day', () => {
    const spoken = (role: string, time: number): Json => ({ ...message(role, 0, { time }), content: { content_type: 'multimodal_text', parts: [{ content_type: 'audio_transcription', text: words(6), direction: role === 'user' ? 'in' : 'out' }, { content_type: 'audio_asset_pointer' }] } });
    const r = read([conversation([
      node('q1', 'root', spoken('user', T)), node('a1', 'q1', spoken('assistant', T + 5)),
      node('q2', 'a1', message('user', 3, { time: T + 86_400 })), node('a2', 'q2', message('assistant', 4, { time: T + 86_405 })),
    ])], { now: NOW });
    expect(r.days.map((day) => [day.day, day.transcripts])).toEqual([['2026-09-15', 2], ['2026-09-16', 0]]);
    expect(totals(r, 'all', 'paid').transcripts).toBe(2);
    expect(totals(r, { from: '2026-09-16', to: '2026-09-16' }, 'paid').transcripts).toBe(0);
    // The transcript is counted as text: 6 words asked, 6 words answered.
    expect(rowsOf(totals(r, { from: '2026-09-15', to: '2026-09-15' }, 'paid'))).toEqual([6, 0, 6]);
  });

  it('says whether memory shows in the window, and in the export as a whole', () => {
    const r = read([
      conversation([
        node('q1', 'root', message('user', 3, { time: T })),
        node('a1', 'q1', message('assistant', 4, { time: T + 5, metadata: { conversation_context_citation_metadata: [{ citation: { conversation_context_type: 'user_memory' } }] } })),
        node('q2', 'a1', message('user', 3, { time: T + 60 })),
        node('note', 'q2', message('assistant', 5, { time: T + 61, recipient: 'bio' })),
        node('done', 'note', message('tool', 3, { time: T + 62, name: 'bio' })),
        node('a2', 'done', message('assistant', 4, { time: T + 65 })),
      ], { id: 'with' }),
      turn('without', T + 5 * 86_400, 3, 4),
    ], { now: NOW });
    expect(r.memorySeen).toBe(true);
    const early = totals(r, { from: '2026-09-15', to: '2026-09-15' }, 'paid');
    const late = totals(r, { from: '2026-09-20', to: '2026-09-20' }, 'paid');
    expect([early.memoryMessages, late.memoryMessages]).toEqual([2, 0]);
    // The switch's label is about the whole export.
    expect([early.evidence.memoryInUse, late.evidence.memoryInUse]).toEqual([true, true]);
  });

  it('gives the thinking lines of the window, which decide the label of the thinking switch', () => {
    const line = (id: string, parent: string, time: number) => node(id, parent, message('assistant', 0, { type: 'reasoning_recap', content: { content: 'Thought for 9s' }, time }));
    const r = read([conversation([
      node('q1', 'root', message('user', 3, { time: T })), line('r1', 'q1', T + 9), node('a1', 'r1', message('assistant', 4, { time: T + 10 })),
      node('q2', 'a1', message('user', 3, { time: T + 86_400 })), node('a2', 'q2', message('assistant', 4, { time: T + 86_410, model: 'gpt-5-6-thinking' })),
      node('q3', 'a2', message('user', 3, { time: T + 2 * 86_400 })), node('a3', 'q3', message('assistant', 4, { time: T + 2 * 86_400 + 10, model: 'gpt-5-6' })),
    ])], { now: NOW });
    const on = (day: string) => totals(r, { from: day, to: day }, 'paid');
    expect([on('2026-09-15').recaps, on('2026-09-15').evidence.thinking]).toEqual([1, 'recorded']);
    expect([on('2026-09-16').recaps, on('2026-09-16').evidence.thinking]).toEqual([0, 'model-name']);
    expect([on('2026-09-17').recaps, on('2026-09-17').evidence.thinking]).toEqual([0, 'none']);
  });
});

describe('the calendar', () => {
  // Half past midnight in Auckland on 16 September is still the 15th in London.
  const T = at('2026-09-15', '12:30:00');
  const one = (options: AccountOptions): Reading => read([turn('c', T, 3, 4)], { now: T + 86_400, ...options });

  it('is UTC unless the page asks for the local one, and the reading says which', () => {
    expect(one({}).calendar).toBe('utc');
    expect(one({ calendar: 'local' }).calendar).toBe('local');
    expect(one({}).days.map((day) => day.day)).toEqual(['2026-09-15']);
  });

  it('puts a request on the date the computer shows at that moment', () => {
    // Whatever the time zone of the machine that runs this test.
    const local = (seconds: number) => new Date(seconds * 1000).toLocaleDateString('sv-SE');
    for (let hour = 0; hour < 48; hour++) {
      const time = at('2026-03-28', '00:10:00') + hour * 3600;
      const reading = read([turn('c', time, 3, 4)], { now: time + 86_400, calendar: 'local' });
      expect(reading.days.map((day) => day.day)).toEqual([local(time)]);
      expect(reading.conversationDays).toEqual([[dayFromName(local(time))]]);
      expect(windowEndingAt(time, 1, 'local')).toEqual({ from: local(time), to: local(time) });
      expect(windowOf(reading, time, 1)).toEqual({ from: local(time), to: local(time) });
      expect(totals(reading, windowOf(reading, time), 'paid').requests).toBe(1);
    }
  });

  it('follows the time zone, summer time included', () => {
    const before = process.env['TZ'];
    try {
      process.env['TZ'] = 'Pacific/Auckland';
      // Not every way of running tests lets the time zone be set. Then there is nothing to check here.
      if (new Date(at('2026-09-15') * 1000).getTimezoneOffset() !== -720) return;
      expect(one({ calendar: 'local' }).days.map((day) => day.day)).toEqual(['2026-09-16']);
      expect(one({ calendar: 'utc' }).days.map((day) => day.day)).toEqual(['2026-09-15']);
      // Summer time starts on 27 September 2026 at 2:00, so that day has 23 hours. 11:30 UTC is 00:30 on the 28th.
      const afterChange = at('2026-09-27', '11:30:00');
      expect(dayName(dayIndexIn('local', afterChange))).toBe('2026-09-28');
      expect(dayName(dayIndexIn('local', afterChange - 3600))).toBe('2026-09-27');
      expect(windowEndingAt(afterChange, 30, 'local')).toEqual({ from: '2026-08-30', to: '2026-09-28' });
    } finally {
      if (before === undefined) delete process.env['TZ'];
      else process.env['TZ'] = before;
    }
  });
});

describe('the options', () => {
  const T = at('2026-09-15');
  const plain = turn('c', T, 3, 4);
  const withOptions = (options: unknown): Reading => {
    // What arrives in a message from the page can be anything.
    const account = createAccount(options as AccountOptions);
    account.add(plain);
    return account.finish();
  };

  it('fall back to the clock, UTC and the real tokenizer when they are missing or of the wrong kind', () => {
    const usual = withOptions(undefined);
    expect(usual.days.map((day) => day.day)).toEqual(['2026-09-15']);
    const odd: unknown[] = [null, 5, 'now', [], [{ now: 1 }], { now: 'yesterday' }, { now: NaN }, { now: -1 }, { now: {} }, { calendar: 'mars' }, { countTokens: 'fast' }, { limits: null }, { limits: 'none' }, { limits: { maxNodes: 'many', maxModels: -3, maxRunChars: 0, maxSources: NaN } }];
    for (const options of odd) expect(withOptions(options), JSON.stringify(options)).toEqual(usual);
  });

  it('read a `now` in milliseconds as the moment it means', () => {
    const later = turn('later', at('2026-10-20'), 3, 4);
    for (const now of [at('2026-10-07'), at('2026-10-07') * 1000]) {
      const account = createAccount({ now, countTokens: countWords });
      account.add(later);
      const reading = account.finish();
      // 20 October is in the future of 7 October, so the request has no day.
      expect([reading.days.length, reading.undated.messages]).toEqual([0, 2]);
    }
  });

  it('take a limit only when it is a number of at least one', () => {
    const account = createAccount({ countTokens: countWords, now: T + 86_400, limits: { maxNodes: 2 } });
    expect(account.add(plain)).toBe(false);
    expect(account.finish().warnings).toEqual([{ code: 'conversation-too-large', count: 1 }]);
  });
});

describe('the id of a conversation', () => {
  const T = at('2026-09-15');
  const copy = (fields: Json, answer: number): Json => ({ ...turn('x', T, 3, answer), id: undefined, ...fields });

  it('is taken from either field, so two copies are known as one', () => {
    const cases: Array<[Json, Json]> = [
      [{ id: 'same' }, { conversation_id: 'same' }],
      [{ conversation_id: '', id: 'same' }, { conversation_id: 'same', id: 'other' }],
      [{ conversation_id: 5, id: 'same' }, { id: 'same' }],
    ];
    for (const [first, second] of cases) {
      const reading = read([copy({ ...first, update_time: T }, 4), copy({ ...second, update_time: T + 9 }, 6)], { now: T + 86_400 });
      expect([reading.conversations, rowsOf(totals(reading, 'all', 'paid'))[2]]).toEqual([1, 6]);
      expect(reading.warnings).toEqual([{ code: 'duplicate-conversation', count: 1 }]);
    }
  });
});

describe('the files the page may load', () => {
  it('reading.ts and rules.ts bring in no code of their own, so the page does not load the tokenizer with them', () => {
    for (const source of [readingSource, rulesSource]) {
      const imports = source.split('\n').filter((line) => /^\s*(import|export)\b.*\bfrom\b/.test(line));
      for (const line of imports) expect(line).toMatch(/^(import|export) type /);
      expect(source).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
    }
    expect(readingSource.split('\n').filter((line) => /^import /.test(line)).length).toBeGreaterThan(0);
  });
});
