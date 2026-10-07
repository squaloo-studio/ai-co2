// The counting rule on cases small enough to check by hand. One token per word.
import { describe, expect, it } from 'vitest';
import { createAccount } from './account';
import { dayName, NO_MODEL_NAME, totals, windowEndingAt, type Plan, type Totals } from './reading';
import { conversation, message, node, read, words, type Json } from './test-kit';

const T = Date.UTC(2026, 8, 15, 12) / 1000;
const user = (n: number, time: unknown = T) => message('user', n, { time });
const assistant = (n: number, time: unknown = T, model?: string) => message('assistant', n, { time, model });

const all = (c: Json | Json[], plan: Plan = 'paid'): Totals => totals(read(Array.isArray(c) ? c : [c], { now: T + 86_400 }), 'all', plan);
const sum = (rows: Totals['hidden']['thinking'], type: 'output' | 'freshInput' | 'cacheRead' | 'cacheWrite') => rows.reduce((s, row) => s + row[type], 0);
/** [output, fresh input, cache read, cache write] */
const rowsOf = (t: Totals) => [sum(t.rows, 'output'), sum(t.rows, 'freshInput'), sum(t.rows, 'cacheRead'), sum(t.rows, 'cacheWrite')];

const twoTurns = (gap: number, first = 10) =>
  conversation([
    node('u1', 'root', user(first)), node('a1', 'u1', assistant(20)),
    node('u2', 'a1', user(5, T + gap)), node('a2', 'u2', assistant(8, T + gap)),
  ]);

describe('rows', () => {
  it('reads the first question from the cache on a quick second turn, and the first answer fresh', () => {
    expect(rowsOf(all(twoTurns(60)))).toEqual([28, 10 + 20 + 5, 10, 0]);
  });

  it('reads everything fresh two hours later', () => {
    expect(rowsOf(all(twoTurns(7200)))).toEqual([28, 10 + 10 + 20 + 5, 0, 0]);
  });

  it('is still warm at exactly 30 minutes and cold one second later', () => {
    expect([sum(all(twoTurns(1800)).rows, 'cacheRead'), sum(all(twoTurns(1801)).rows, 'cacheRead')]).toEqual([10, 0]);
  });

  it('counts a regenerated answer as its own request that read the question again', () => {
    const t = all(conversation([node('u1', 'root', user(10)), node('a1', 'u1', assistant(20)), node('a1b', 'u1', assistant(30, T + 30))]));
    expect(rowsOf(t)).toEqual([50, 20, 0, 0]);
    expect([t.requests, t.answers, t.prompts, t.messages]).toEqual([2, 2, 1, 3]);
  });

  it('counts answers that hang side by side below a node with no message as separate answers', () => {
    const t = all(conversation([node('a1', 'root', assistant(20)), node('a2', 'root', assistant(30)), node('gap', 'root', null), node('a3', 'gap', assistant(5)), node('a4', 'gap', assistant(6))]));
    expect([t.answers, t.requests, sum(t.rows, 'output')]).toEqual([4, 4, 61]);
  });

  it('does not let one branch re-read the other after an edited question', () => {
    const t = all(conversation([
      node('u1', 'root', user(10)), node('a1', 'u1', assistant(20)),
      node('u2', 'a1', user(5, T + 60)), node('a2', 'u2', assistant(8, T + 60)),
      node('u2b', 'a1', user(7, T + 120)), node('a2b', 'u2b', assistant(9, T + 120)),
    ]));
    expect(rowsOf(t)).toEqual([20 + 8 + 9, 10 + (20 + 5) + (20 + 7), 10 + 10, 0]);
  });

  it('loses no text at a fork in the middle of an answer', () => {
    const t = all(conversation([
      node('u1', 'root', user(10)), node('a1', 'u1', assistant(20)),
      node('a2a', 'a1', assistant(3)), node('a2b', 'a1', assistant(4)),
    ]));
    expect(sum(t.rows, 'output')).toBe(27);
    expect(t.requests).toBe(1);
  });

  it('makes a tool call its own request, and lets thoughts and recaps not split a run', () => {
    const model = 'gpt-5-6-thinking';
    const t = all(conversation([
      node('u1', 'root', user(10)),
      node('th', 'u1', message('assistant', 0, { type: 'thoughts', content: { thoughts: [{ summary: 's', content: words(50) }] }, model, time: T })),
      node('rc', 'th', message('assistant', 0, { type: 'reasoning_recap', content: { content: 'Thought for 1m 12s' }, model, time: T })),
      node('call', 'rc', message('assistant', 0, { type: 'code', content: { text: words(6) }, recipient: 'python', model, time: T })),
      node('res', 'call', message('tool', 0, { type: 'execution_output', content: { text: words(40) }, name: 'python', time: T })),
      node('a1', 'res', message('assistant', 20, { model, time: T })),
    ]));
    expect([t.requests, ...rowsOf(t)]).toEqual([2, 26, 10 + (6 + 40), 10, 0]);
    expect([t.thinkingSeconds, t.thinkingRecorded, t.thinkingAssumed, t.answers]).toEqual([72, 1, 0, 1]);
  });

  it('cuts the re-read text at the ceiling of the plan and never the new text', () => {
    const c = twoTurns(60, 9000);
    expect(rowsOf(all(c, 'free'))).toEqual([28, 9000 + 25, 7000, 0]);
    expect(all(c, 'free').cutRequests).toBe(1);
    expect(rowsOf(all(c, 'paid'))).toEqual([28, 9000 + 25, 9000, 0]);
    expect(all(c, 'paid').cutRequests).toBe(0);
  });

  it('gives a thinking model the higher ceiling on a paid plan only', () => {
    const c = (model: string) => conversation([
      node('u1', 'root', user(40_000)), node('a1', 'u1', assistant(20, T, model)),
      node('u2', 'a1', user(5, T + 60)), node('a2', 'u2', assistant(8, T + 60, model)),
    ]);
    expect(sum(all(c('gpt-5-6'), 'paid').rows, 'cacheRead')).toBe(34_000);
    expect(sum(all(c('gpt-5-6-thinking'), 'paid').rows, 'cacheRead')).toBe(40_000);
    expect(sum(all(c('gpt-5-6-thinking'), 'free').rows, 'cacheRead')).toBe(7_000);
    // Deep research is a thinking model by its name too.
    expect(sum(all(c('research'), 'paid').rows, 'cacheRead')).toBe(40_000);
    expect(sum(all(c('gpt-5-6-deep-research'), 'paid').rows, 'cacheRead')).toBe(40_000);
    expect(all(c('research'), 'paid').cutRequests).toBe(0);
    expect(all(c('research'), 'paid').hidden.thinking).toEqual([expect.objectContaining({ model: 'research', output: 30 })]);
  });

  it('puts a request into a window by its own time, with a prefix that may be older', () => {
    const old = T - 40 * 86_400;
    const reading = read([conversation([
      node('u1', 'root', user(10, old)), node('a1', 'u1', assistant(20, old)),
      node('u2', 'a1', user(5)), node('a2', 'u2', assistant(8)),
    ])], { now: T });
    expect(rowsOf(totals(reading, windowEndingAt(T), 'paid'))).toEqual([8, 10 + 20 + 5, 0, 0]);
    expect(rowsOf(totals(reading, 'all', 'paid'))).toEqual([28, 10 + 10 + 20 + 5, 0, 0]);
    expect(rowsOf(totals(reading, windowEndingAt(old), 'paid'))).toEqual([20, 10, 0, 0]);
  });

  it('names the model by the message, then by the conversation, then not at all', () => {
    const one = (model: string | undefined, fields: Json) => all(conversation([node('u1', 'root', user(1)), node('a1', 'u1', assistant(1, T, model))], fields)).rows.map((row) => row.model);
    expect(one('gpt-4o', {})).toEqual(['gpt-4o']);
    expect(one(undefined, {})).toEqual(['gpt-5-6']);
    // "auto" is the setting of the model picker, not a model.
    expect(one(undefined, { default_model_slug: 'auto' })).toEqual([NO_MODEL_NAME]);
    expect(one(undefined, { default_model_slug: null })).toEqual([NO_MODEL_NAME]);
    const resolved = conversation([node('u1', 'root', user(1)), node('a1', 'u1', message('assistant', 1, { time: T, metadata: { resolved_model_slug: 'gpt-5-2' } }))]);
    expect(all(resolved).rows.map((row) => row.model)).toEqual(['gpt-5-2']);
  });

  describe('the model of a request, the first of these that exists', () => {
    const named = (c: Json) => all(c).requestsByModel;
    const unnamed = (n: number, time: number, extra: Json = {}) => message('assistant', n, { time, metadata: extra });
    const thoughts = (time: number, model: string) => message('assistant', 0, { type: 'thoughts', content: { thoughts: [] }, time, model });

    it('the name on the latest message of the run that has one', () => {
      // The second part of the answer names the model, the first does not.
      expect(named(conversation([node('u1', 'root', user(1)), node('a1', 'u1', unnamed(2, T + 5)), node('a2', 'a1', assistant(3, T + 6, 'gpt-5-5'))], { default_model_slug: null })))
        .toEqual([{ model: 'gpt-5-5', requests: 1 }]);
      // Both name one: the later message decides, also when the file lists it first.
      const both = [node('a2', 'a1', assistant(3, T + 6, 'gpt-5-5')), node('u1', 'root', user(1)), node('a1', 'u1', assistant(2, T + 5, 'gpt-4o'))];
      expect(named(conversation(both))).toEqual([{ model: 'gpt-5-5', requests: 1 }]);
      // At a fork inside the answer the later of the two branches decides.
      const fork = [node('u1', 'root', user(1)), node('a1', 'u1', unnamed(2, T + 5)), node('b1', 'a1', assistant(3, T + 9, 'gpt-5-5')), node('b2', 'a1', assistant(3, T + 7, 'gpt-4o'))];
      expect(named(conversation(fork))).toEqual([{ model: 'gpt-5-5', requests: 1 }]);
    });

    it('then the name on another assistant message of the same answer, such as its thinking line', () => {
      const c = conversation([
        node('u1', 'root', user(1)), node('t1', 'u1', thoughts(T + 1, 'gpt-5-5-thinking')), node('a1', 't1', unnamed(4, T + 9)),
      ], { default_model_slug: 'gpt-5-6' });
      expect(named(c)).toEqual([{ model: 'gpt-5-5-thinking', requests: 1 }]);
      // Not from another answer: a regenerated answer below the same question is on its own.
      const two = conversation([
        node('u1', 'root', user(1)), node('t1', 'u1', thoughts(T + 1, 'gpt-5-5-thinking')), node('a1', 't1', unnamed(4, T + 9)),
        node('again', 'u1', unnamed(4, T + 60)),
      ], { default_model_slug: 'gpt-5-6' });
      expect(named(two)).toEqual([{ model: 'gpt-5-5-thinking', requests: 1 }, { model: 'gpt-5-6', requests: 1 }]);
    });

    it('then the resolved name on those messages, the run first', () => {
      const c = conversation([
        node('u1', 'root', user(1)),
        node('t1', 'u1', message('assistant', 0, { type: 'thoughts', content: { thoughts: [] }, time: T + 1, metadata: { resolved_model_slug: 'gpt-5-2' } })),
        node('a1', 't1', unnamed(4, T + 9, { resolved_model_slug: 'gpt-5-3' })),
      ]);
      expect(named(c)).toEqual([{ model: 'gpt-5-3', requests: 1 }]);
      // A name anywhere in the answer goes before a resolved name on the run.
      const mixed = conversation([node('u1', 'root', user(1)), node('t1', 'u1', thoughts(T + 1, 'gpt-5-5-thinking')), node('a1', 't1', unnamed(4, T + 9, { resolved_model_slug: 'gpt-5-3' }))]);
      expect(named(mixed)).toEqual([{ model: 'gpt-5-5-thinking', requests: 1 }]);
    });

    it('then the model of the nearest earlier request on the same path, before the setting of the conversation', () => {
      const c = conversation([
        node('u1', 'root', user(1)), node('t1', 'u1', thoughts(T + 1, 'gpt-5-5-thinking')), node('a1', 't1', unnamed(4, T + 9)),
        node('u2', 'a1', user(1, T + 60)), node('a2', 'u2', unnamed(4, T + 70)),
        node('u3', 'a2', user(1, T + 80)), node('a3', 'u3', unnamed(4, T + 90)),
      ], { default_model_slug: 'auto' });
      expect(named(c)).toEqual([{ model: 'gpt-5-5-thinking', requests: 3 }]);
      // The path decides, not the clock: the other branch below the question was answered by another model.
      const branches = conversation([
        node('u1', 'root', user(1)), node('a1', 'u1', assistant(2, T + 5, 'gpt-4o')),
        node('u2', 'a1', user(1, T + 10)), node('a2', 'u2', assistant(2, T + 15, 'o3')),
        node('u2b', 'a1', user(1, T + 20)), node('a2b', 'u2b', unnamed(2, T + 25)),
      ]);
      expect(named(branches)).toEqual([{ model: 'gpt-4o', requests: 2 }, { model: 'o3', requests: 1 }]);
    });

    it('takes no name from a message of the person, a tool or the system', () => {
      const c = conversation([
        node('s', 'root', message('system', 0, { time: T, model: 'gpt-4o' })),
        node('u1', 's', message('user', 1, { time: T, model: 'gpt-4o' })),
        node('call', 'u1', unnamed(2, T + 1)),
        node('tool', 'call', message('tool', 3, { time: T + 2, name: 'python', model: 'gpt-4o' })),
        node('a1', 'tool', unnamed(2, T + 3)),
      ], { default_model_slug: null });
      expect(named(c)).toEqual([{ model: NO_MODEL_NAME, requests: 2 }]);
    });
  });

  it('puts a request without a time on the day of the message above it, not at the end of its conversation', () => {
    // A chat from 60 days ago whose answer has no time, renamed today.
    const old = T - 60 * 86_400;
    const renamed = conversation([node('u1', 'root', user(10, old)), node('a1', 'u1', assistant(20, null))], { create_time: old, update_time: T });
    const reading = read([renamed], { now: T });
    expect(totals(reading, windowEndingAt(T), 'paid').requests).toBe(0);
    expect(rowsOf(totals(reading, windowEndingAt(old), 'paid'))).toEqual([20, 10, 0, 0]);
    expect(reading.lastRequest).toBe(old);

    // Two days lie between the two answers. The first has no time, and that must not bring it next to the second.
    const apart = conversation([
      node('u1', 'root', user(10)), node('a1', 'u1', assistant(20, null)),
      node('u2', 'a1', user(5, T + 2 * 86_400)), node('a2', 'u2', assistant(8, T + 2 * 86_400 + 5)),
    ], { create_time: T, update_time: T + 2 * 86_400 + 60 });
    const t = totals(read([apart], { now: T + 3 * 86_400 }), 'all', 'paid');
    expect([t.requests, t.coldRequests]).toEqual([2, 2]);
    expect(rowsOf(t)).toEqual([28, 10 + 10 + 20 + 5, 0, 0]);
  });

  it('counts no citation marker: neither the marker nor the words inside it', () => {
    const cite = '\ue200cite\ue202turn0search0\ue201';
    const entity = '\ue200entity\ue202["city","Paris","capital of France"]\ue201';
    const answer = { ...assistant(0), content: { content_type: 'text', parts: [`Paris is the capital ${cite} of France ${entity} today ${cite}`, `\ue203 and \ue204 more ${cite}`] } };
    const quote = message('tool', 0, { type: 'tether_quote', content: { text: `${cite} quoted words ${cite}` }, name: 'web', time: T });
    const t = all(conversation([node('u1', 'root', user(3)), node('a1', 'u1', answer), node('q', 'a1', quote), node('a2', 'q', assistant(1, T + 5))]));
    // 7 words in the first part and 2 in the second; then the last answer.
    expect(sum(t.rows, 'output')).toBe(7 + 2 + 1);
    // The quote of 2 words is new input of the last request, and the first answer is read again.
    expect(sum(t.rows, 'freshInput')).toBe(3 + (2 + 9));
    // An answer that is nothing but markers has no text, so it is an answer and no request.
    const only = all(conversation([node('u1', 'root', user(3)), node('a1', 'u1', { ...assistant(0), content: { content_type: 'text', parts: [cite, entity] } })]));
    expect([only.answers, only.requests]).toEqual([1, 0]);
  });

  it('counts every kind of text a message can hold, and nothing of thoughts', () => {
    const t = all(conversation([
      node('u1', 'root', { ...user(0), content: { content_type: 'multimodal_text', parts: [words(3), { content_type: 'audio_transcription', text: words(4) }, { content_type: 'audio_asset_pointer' }, 7, null] } }),
      node('q', 'u1', message('tool', 0, { type: 'tether_quote', content: { text: words(5) }, name: 'file_search', time: T })),
      node('e', 'q', message('tool', 0, { type: 'system_error', content: { text: words(6) }, name: 'python', time: T })),
      node('x', 'e', message('tool', 0, { type: 'something_new', content: { text: words(100) }, name: 'python', time: T })),
      node('th', 'x', message('assistant', 0, { type: 'thoughts', content: { thoughts: [{ content: words(50) }] }, time: T })),
      node('a1', 'th', message('assistant', 2, { time: T })),
    ]));
    expect(rowsOf(t)).toEqual([2, 3 + 4 + 5 + 6, 0, 0]);
  });
});

describe('the six pieces', () => {
  const base = (rows: Totals['hidden']['thinking']) => rows.map((row) => [row.model, row.freshInput, row.cacheRead, row.output]);

  it('does not lose a thinking time that sits after the first message of its answer', () => {
    const t = all(conversation([
      node('u1', 'root', user(10)),
      node('q', 'u1', message('assistant', 4, { recipient: 'web', time: T })),
      node('rc', 'q', message('assistant', 0, { type: 'reasoning_recap', content: { content: 'Worked for 24s' }, time: T })),
      node('a1', 'rc', assistant(20)),
    ]));
    expect([t.thinkingSeconds, t.thinkingRecorded]).toEqual([24, 1]);
    expect(base(t.hidden.thinking)).toEqual([['gpt-5-6', 0, 0, 24]]);
  });

  it('gives a thinking model with no recorded time 15 seconds, and an instant model nothing', () => {
    const one = (model: string) => all(conversation([node('u1', 'root', user(10)), node('a1', 'u1', assistant(20, T, model))]));
    expect([one('gpt-5-6-thinking').thinkingSecondsAssumed, one('gpt-5-6-thinking').thinkingAssumed]).toEqual([15, 1]);
    expect(one('gpt-5-6-thinking').evidence.thinking).toBe('model-name');
    expect([one('gpt-5-6').thinkingSecondsAssumed, one('gpt-5-6').thinkingAssumed]).toEqual([0, 0]);
    expect(one('gpt-5-6').evidence.thinking).toBe('none');
    expect(one('gpt-5-6').hidden.thinking).toEqual([]);
  });

  it('gives it the median of the timed answers of its conversation when there are any', () => {
    const model = 'gpt-5-6-thinking';
    const turn = (k: number, recap: string | null): Array<[string, Json]> => [
      node(`u${k}`, k === 0 ? 'root' : `a${k - 1}`, user(1, T + k * 10)),
      ...(recap === null ? [] : [node(`r${k}`, `u${k}`, message('assistant', 0, { type: 'reasoning_recap', content: { content: recap }, time: T + k * 10 }))]),
      node(`a${k}`, recap === null ? `u${k}` : `r${k}`, assistant(1, T + k * 10, model)),
    ];
    const t = all(conversation([...turn(0, 'Thought for 8s'), ...turn(1, 'Thought for 40s'), ...turn(2, 'Thought for 12s'), ...turn(3, null), ...turn(4, 'Nachgedacht')]));
    expect([t.thinkingSeconds, t.thinkingRecorded, t.thinkingSecondsAssumed, t.thinkingAssumed]).toEqual([60, 3, 24, 2]);
    expect(t.evidence.thinking).toBe('recorded');

    // With an even number of timed answers the median is the mean of the two in the middle, not the upper one.
    const two = all(conversation([...turn(0, 'Thought for 14s'), ...turn(1, 'Worked for 2m 9s'), ...turn(2, null)]));
    expect([two.thinkingSeconds, two.thinkingRecorded, two.thinkingSecondsAssumed, two.thinkingAssumed]).toEqual([143, 2, 71.5, 1]);
    const four = all(conversation([...turn(0, 'Thought for 8s'), ...turn(1, 'Thought for 40s'), ...turn(2, 'Thought for 12s'), ...turn(3, 'Thought for 20s'), ...turn(4, null)]));
    expect([four.thinkingSecondsAssumed, four.thinkingAssumed]).toEqual([16, 1]);
    const one = all(conversation([...turn(0, 'Thought for 8s'), ...turn(1, null)]));
    expect([one.thinkingSecondsAssumed, one.thinkingAssumed]).toEqual([8, 1]);
  });

  it('assumes thinking for an instant model whose thinking line cannot be read', () => {
    const t = all(conversation([
      node('u1', 'root', user(10)),
      node('rc', 'u1', message('assistant', 0, { type: 'reasoning_recap', content: { content: 'Nachgedacht' }, time: T })),
      node('a1', 'rc', assistant(20)),
    ]));
    expect([t.thinkingSeconds, t.thinkingSecondsAssumed, t.thinkingAssumed, t.evidence.thinking]).toEqual([0, 15, 1, 'recorded']);
  });

  it('weighs the system prompt by period and model name', () => {
    const at = (day: string, model: string) => {
      const time = Date.parse(day) / 1000;
      const c = conversation([node('u1', 'root', user(1, time)), node('a1', 'u1', assistant(1, time, model))], { update_time: time });
      return sum(all(c).hidden.systemPrompt, 'cacheRead');
    };
    expect([
      at('2026-09-01', 'gpt-5-6'), at('2026-05-01', 'gpt-5-5'), at('2025-12-01', 'gpt-5-2'), at('2025-01-01', 'gpt-4o'),
      at('2023-06-01', 'gpt-4'), at('2026-09-01', 'gpt-5-3-mini'), at('2026-09-01', 'gpt-5-6-t-mini'),
    ]).toEqual([1, 0.8, 0.65, 0.12, 0.04, 0.06, 1]);
  });

  it('reads memory once per request, fresh when cold and from the cache when warm, and bases cache misses on the cached text', () => {
    const t = all(twoTurns(60));
    expect(base(t.hidden.memory)).toEqual([['gpt-5-6', 1, 1, 0]]);
    expect(base(t.hidden.cacheMisses)).toEqual([['gpt-5-6', 10, 0, 0]]);
    expect(base(t.hidden.systemPrompt)).toEqual([['gpt-5-6', 0, 2, 0]]);
    expect([t.requests, t.coldRequests]).toEqual([2, 1]);
  });

  it('counts sources, files with and without a token count, and images', () => {
    const attachments = [{ id: 'f1', mime_type: 'application/pdf' }, { id: 'f2', mime_type: 'text/plain', file_token_size: 300 }, { id: 'f3', mime_type: 'image/png' }, { id: 'f4', mimeType: 'text/csv', fileSizeTokens: 50 }];
    const t = all(conversation([
      node('u1', 'root', { ...user(10), metadata: { attachments } }),
      node('a1', 'u1', message('assistant', 20, { time: T, metadata: { search_result_groups: [{ entries: [{}, {}, {}] }, { entries: [{}] }] } })),
    ]));
    expect([t.sources, t.searchRequests, t.filesWithoutCount, t.filesWithCount, sum(t.rows, 'freshInput')]).toEqual([4, 1, 1, 2, 360]);
    expect(base(t.hidden.search)).toEqual([['gpt-5-6', 4, 0, 0]]);
    expect(base(t.hidden.files)).toEqual([['gpt-5-6', 1, 0, 0]]);
    expect(t.evidence.searchOrFiles).toBe(true);
  });

  it('takes the longest source list when several messages of one answer carry one', () => {
    const listed = (n: number) => ({ search_result_groups: [{ entries: Array.from({ length: n }, () => ({})) }] });
    const t = all(conversation([
      node('u1', 'root', user(10)),
      node('a1', 'u1', message('assistant', 5, { time: T, metadata: listed(2) })),
      node('a2', 'a1', message('assistant', 5, { time: T, metadata: listed(5) })),
      node('a3', 'a2', message('assistant', 5, { time: T, metadata: listed(3) })),
    ]));
    expect([t.requests, t.sources, t.searchRequests]).toEqual([1, 5, 1]);
  });

  it('counts an image by its size and not again as an attachment', () => {
    const t = all(conversation([
      node('u1', 'root', {
        ...user(0),
        content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_1', width: 1024, height: 1024 }, words(10)] },
        metadata: { attachments: [{ id: 'file_1', name: 'photo' }] },
      }),
      node('a1', 'u1', assistant(20)),
    ]));
    expect([t.images, t.filesWithoutCount, t.filesWithCount, sum(t.rows, 'freshInput')]).toEqual([1, 0, 0, 1229 + 10]);
    expect(t.evidence.searchOrFiles).toBe(false);
  });

  it('adds no sources when the old browser tool left its text in the export', () => {
    const t = all(conversation([
      node('u1', 'root', user(10)), node('q', 'u1', message('assistant', 3, { recipient: 'browser', time: T })),
      node('b', 'q', message('tool', 0, { type: 'tether_browsing_display', content: { result: words(50) }, name: 'browser', time: T })),
      node('a1', 'b', message('assistant', 20, { time: T, metadata: { search_result_groups: [{ entries: [{}, {}] }] } })),
    ]));
    expect([t.sources, sum(t.rows, 'freshInput')]).toEqual([0, 10 + 3 + 50]);
  });

  it('skips attachments where the file text is in the export as a tool message', () => {
    const t = all(conversation([
      node('u1', 'root', { ...user(10), metadata: { attachments: [{ id: 'f1', mime_type: 'application/pdf' }, { id: 'f2', mime_type: 'text/plain', file_token_size: 300 }] } }),
      node('f', 'u1', message('tool', 70, { name: 'file_search', time: T })),
      node('a1', 'f', assistant(20)),
    ]));
    expect([t.filesWithoutCount, t.filesWithCount, sum(t.rows, 'freshInput')]).toEqual([0, 0, 80]);
  });

  it('counts custom instructions as text when the export has them', () => {
    const reading = read([conversation([
      node('ci', 'root', message('user', 0, { type: 'user_editable_context', content: { user_profile: words(30), user_instructions: words(12) }, time: null })),
      node('u1', 'ci', user(10)), node('a1', 'u1', assistant(20)),
    ])], { now: T });
    const t = totals(reading, 'all', 'paid');
    expect([sum(t.rows, 'freshInput'), reading.conversationsWithCustomInstructions, t.prompts, t.messages]).toEqual([52, 1, 1, 3]);
  });

  it('sees memory in use from a cited memory, a memory note or a memory message', () => {
    const seen = (nodes: Array<[string, Json]>) => read([conversation(nodes)], { now: T }).memorySeen;
    const plain: Array<[string, Json]> = [node('u1', 'root', user(1)), node('a1', 'u1', assistant(1))];
    expect(seen(plain)).toBe(false);
    expect(seen([node('u1', 'root', user(1)), node('a1', 'u1', message('assistant', 1, { time: T, metadata: { conversation_context_citation_metadata: [] } }))])).toBe(true);
    expect(seen([...plain, node('b', 'a1', message('tool', 0, { name: 'bio', time: T }))])).toBe(true);
    expect(seen([node('m', 'root', message('system', 0, { type: 'model_editable_context', content: { model_set_context: words(9) } })), node('u1', 'm', user(1)), node('a1', 'u1', assistant(1))])).toBe(true);
  });
});

describe('the tokenizer', () => {
  it('is called with the option that keeps it from throwing on control-token strings', () => {
    let safe: boolean | null = null;
    const account = createAccount({
      now: T,
      countTokens: (text, options) => {
        if (text.includes('<|endoftext|>')) safe = options.disallowedSpecial instanceof Set && options.disallowedSpecial.size === 0;
        return 1;
      },
    });
    account.add(conversation([node('u1', 'root', { ...user(1), content: { content_type: 'text', parts: ['a <|endoftext|> b'] } }), node('a1', 'u1', assistant(2))]));
    expect(safe).toBe(true);
  });

  it('counts such strings as plain text with the real one', async () => {
    const { countO200k } = await import('./tokens');
    const strings = ['<|endoftext|>', '<|im_start|>', '<|im_end|>', '<|fim_prefix|>', '<|endofprompt|>'];
    const reading = read([conversation([node('u1', 'root', { ...user(1), content: { content_type: 'text', parts: strings } }), node('a1', 'u1', { ...assistant(1), content: { content_type: 'text', parts: ['ok'] } })])], { now: T, countTokens: countO200k });
    const t = totals(reading, 'all', 'paid');
    expect(sum(t.rows, 'freshInput')).toBeGreaterThan(5 * 5);
    expect(sum(t.rows, 'freshInput')).toBeLessThan(5 * 12);
    expect(reading.warnings.map((w) => w.code)).not.toContain('message-not-tokenized');
  });

  it('joins the parts of a message with line breaks before counting', () => {
    const seen: string[] = [];
    const account = createAccount({ now: T, countTokens: (text) => (seen.push(text), 1) });
    account.add(conversation([node('u1', 'root', { ...user(1), content: { content_type: 'text', parts: ['one', 'two', 'three'] } })]));
    expect(seen).toEqual(['one\ntwo\nthree']);
  });
});

describe('days', () => {
  it('names the day of a time in UTC', () => {
    expect(windowEndingAt(Date.UTC(2026, 9, 7, 0, 0, 0) / 1000)).toEqual({ from: '2026-09-08', to: '2026-10-07' });
    expect(windowEndingAt(Date.UTC(2026, 9, 7, 23, 59, 59) / 1000, 1)).toEqual({ from: '2026-10-07', to: '2026-10-07' });
    expect(dayName(0)).toBe('1970-01-01');
  });
});
