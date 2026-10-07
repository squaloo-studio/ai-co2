// Four small conversations, each worked through the counting rule on paper first. The numbers in the
// comments are that paper work. The code must give them, number by number. One token per word.
import { describe, expect, it } from 'vitest';
import { totals, type Reading, type Totals } from './reading';
import { conversation, message, node, read, words, type Json } from './test-kit';

const at = (day: string, clock: string) => Date.parse(`${day}T${clock}Z`) / 1000;
const NOW = at('2026-10-07', '12:00:00');

type Row = [model: string, freshInput: number, cacheRead: number, output: number];
const table = (rows: Totals['hidden']['thinking']): Row[] => rows.map((row) => [row.model, row.freshInput, row.cacheRead, row.output]);
const whole = (c: Json, plan: 'free' | 'paid' = 'paid'): { reading: Reading; t: Totals } => {
  const reading = read([c], { now: NOW });
  return { reading, t: totals(reading, 'all', plan) };
};

describe('a regenerated answer', () => {
  // q1 (12) ── a1 (30, first try)
  //        └── a1r (45, second try) ── q2 (7) ── a2 (16, first try)
  //                                          └── a2r (25, second try)
  const T = at('2026-09-10', '10:00:00');
  const c = conversation([
    node('q1', 'root', message('user', 12, { time: T })),
    node('a1', 'q1', message('assistant', 30, { time: T + 20, model: 'gpt-5-6' })),
    node('a1r', 'q1', message('assistant', 45, { time: T + 90, model: 'gpt-5-6' })),
    node('q2', 'a1r', message('user', 7, { time: T + 300 })),
    node('a2', 'q2', message('assistant', 16, { time: T + 310, model: 'gpt-5-6' })),
    node('a2r', 'q2', message('assistant', 25, { time: T + 400, model: 'gpt-5-6' })),
  ], { id: 'regenerated', update_time: T + 400 });

  // request   output   new   previous answer   earlier prompt   seconds after the one before
  // a1          30      12          0                 0          first: cold
  // a1r         45      12          0                 0          70: warm, with nothing to re-read
  // a2          16       7         45                12          220: warm
  // a2r         25       7         45                12          90: warm
  it('gives the rows worked out by hand', () => {
    const { t } = whole(c);
    // output 30 + 45 + 16 + 25. Fresh input 12 + 12 + (7 + 45) + (7 + 45). Cache read 12 + 12.
    expect(table(t.rows)).toEqual([['gpt-5-6', 128, 24, 116]]);
    expect(t.rows[0]?.cacheWrite).toBe(0);
    expect([t.requests, t.coldRequests, t.cutRequests]).toEqual([4, 1, 0]);
    expect([t.messages, t.prompts, t.answers, t.conversations]).toEqual([6, 2, 4, 1]);
  });

  it('gives the six bases worked out by hand', () => {
    const { t } = whole(c);
    expect(table(t.hidden.thinking)).toEqual([]);
    // Four requests in September 2026: four readings of today's prompt.
    expect(table(t.hidden.systemPrompt)).toEqual([['gpt-5-6', 0, 4, 0]]);
    // One cold request and three warm ones.
    expect(table(t.hidden.memory)).toEqual([['gpt-5-6', 1, 3, 0]]);
    expect(table(t.hidden.search)).toEqual([]);
    expect(table(t.hidden.files)).toEqual([]);
    // What went into the cache-read row.
    expect(table(t.hidden.cacheMisses)).toEqual([['gpt-5-6', 24, 0, 0]]);
    expect(t.evidence).toEqual({ thinking: 'none', memoryInUse: false, searchOrFiles: false });
  });

  it('is the same on the free plan, where nothing reaches the ceiling', () => {
    expect(whole(c, 'free').t).toEqual(whole(c, 'paid').t);
  });
});

describe('an abandoned edit and a two-hour pause', () => {
  // q1 (9) ── a1 (21) ── q2 (6, abandoned) ── a2 (14)
  //                  └── q2e (8, the edit) ── a2e (18) ── two hours ── q3 (5) ── a3 (11) ── q4 (4) ── a4 (10)
  const T = at('2026-09-12', '08:00:00');
  const c = conversation([
    node('q1', 'root', message('user', 9, { time: T })),
    node('a1', 'q1', message('assistant', 21, { time: T + 10 })),
    node('q2', 'a1', message('user', 6, { time: T + 60 })),
    node('a2', 'q2', message('assistant', 14, { time: T + 75 })),
    node('q2e', 'a1', message('user', 8, { time: T + 120 })),
    node('a2e', 'q2e', message('assistant', 18, { time: T + 130 })),
    node('q3', 'a2e', message('user', 5, { time: T + 7330 })),
    node('a3', 'q3', message('assistant', 11, { time: T + 7340 })),
    node('q4', 'a3', message('user', 4, { time: T + 7400 })),
    node('a4', 'q4', message('assistant', 10, { time: T + 7410 })),
  ], { id: 'edited', update_time: T + 7410 });

  // request   output   new   previous answer   earlier prompt          seconds after the one before
  // a1          21       9          0                0                  first: cold
  // a2          14       6         21                9                  65: warm
  // a2e         18       8         21                9                  55: warm. It never read q2 or a2.
  // a3          11       5         18                9 + 21 + 8 = 38    7,210: cold, so the 38 are read fresh
  // a4          10       4         11                38 + 18 + 5 = 61   70: warm
  it('gives the rows worked out by hand', () => {
    const { t } = whole(c);
    // output 21 + 14 + 18 + 11 + 10. Fresh 9 + (6 + 21) + (8 + 21) + (5 + 18 + 38) + (4 + 11). Cache read 9 + 9 + 61.
    expect(table(t.rows)).toEqual([['gpt-5-6', 141, 79, 74]]);
    expect([t.requests, t.coldRequests, t.cutRequests]).toEqual([5, 2, 0]);
    // Five questions: the abandoned one is a prompt too, and its answer an answer.
    expect([t.messages, t.prompts, t.answers]).toEqual([10, 5, 5]);
  });

  it('gives the six bases worked out by hand', () => {
    const { t } = whole(c);
    expect(table(t.hidden.systemPrompt)).toEqual([['gpt-5-6', 0, 5, 0]]);
    expect(table(t.hidden.memory)).toEqual([['gpt-5-6', 2, 3, 0]]);
    expect(table(t.hidden.cacheMisses)).toEqual([['gpt-5-6', 79, 0, 0]]);
    expect([t.hidden.thinking, t.hidden.search, t.hidden.files]).toEqual([[], [], []]);
  });

  it('would have read the 38 from the cache without the pause', () => {
    const quick = JSON.parse(JSON.stringify(c).replaceAll(String(T + 7330), String(T + 200)).replaceAll(String(T + 7340), String(T + 210)).replaceAll(String(T + 7400), String(T + 270)).replaceAll(String(T + 7410), String(T + 280))) as Json;
    const { t } = whole(quick);
    expect(table(t.rows)).toEqual([['gpt-5-6', 141 - 38, 79 + 38, 74]]);
    expect(t.coldRequests).toBe(1);
  });
});

describe('a thinking line, a search and files, as exports are made today', () => {
  // q1 (10 words, a PDF with 300 tokens, a CSV with no count) ── thoughts ── "Thought for 1m 12s" ── a1 (40, five sources)
  //   ── q2 (5) ── a2 (12, a thinking model, no thinking line)
  //   ── q3 (6 words and a 1024 × 1024 picture) ── "Thought for a few seconds" ── a3 (9, an instant model)
  const T = at('2026-09-20', '15:00:00');
  const thinking = 'gpt-5-6-thinking';
  const c = conversation([
    node('q1', 'root', {
      ...message('user', 10, { time: T }),
      metadata: { attachments: [{ id: 'file_a', name: 'a.pdf', mime_type: 'application/pdf', size: 90_000, file_token_size: 300 }, { id: 'file_b', name: 'b.csv', mime_type: 'text/csv', size: 2_000 }] },
    }),
    node('th1', 'q1', message('assistant', 0, { type: 'thoughts', content: { thoughts: [{ summary: 'Reading the file', content: words(25) }] }, time: T + 2, model: thinking })),
    node('rc1', 'th1', message('assistant', 0, { type: 'reasoning_recap', content: { content: 'Thought for 1m 12s' }, time: T + 74, model: thinking })),
    node('a1', 'rc1', message('assistant', 40, { time: T + 75, model: thinking, metadata: { search_result_groups: [{ domain: 'one.example', entries: [{}, {}, {}] }, { domain: 'two.example', entries: [{}, {}] }] } })),
    node('q2', 'a1', message('user', 5, { time: T + 200 })),
    node('a2', 'q2', message('assistant', 12, { time: T + 215, model: thinking })),
    node('q3', 'a2', {
      ...message('user', 0, { time: T + 300 }),
      content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_c', width: 1024, height: 1024 }, words(6)] },
      metadata: { attachments: [{ id: 'file_c', name: 'c.jpg', mime_type: 'image/jpeg' }] },
    }),
    node('rc3', 'q3', message('assistant', 0, { type: 'reasoning_recap', content: { content: 'Thought for a few seconds' }, time: T + 304, model: 'gpt-5-6' })),
    node('a3', 'rc3', message('assistant', 9, { time: T + 305, model: 'gpt-5-6' })),
  ], { id: 'thinking', update_time: T + 305, default_model_slug: 'auto' });

  // request   model      output   new                  previous answer   earlier prompt       after      thinking
  // a1        thinking     40     10 + 300 = 310             0                 0              cold       72 s, recorded
  // a2        thinking     12      5                        40               310             140: warm  none recorded: the median of 4 and 72, which is 38
  // a3        instant       9      6 + 1,229 = 1,235        12        310 + 40 + 5 = 355      90: warm   4 s, recorded
  it('gives the rows worked out by hand', () => {
    const { t } = whole(c);
    expect(table(t.rows)).toEqual([
      ['gpt-5-6', 1235 + 12, 355, 9],
      [thinking, 310 + (5 + 40), 310, 40 + 12],
    ]);
    expect([t.requests, t.coldRequests]).toEqual([3, 1]);
    expect([t.messages, t.prompts, t.answers]).toEqual([9, 3, 3]);
    expect(t.requestsByModel).toEqual([{ model: 'gpt-5-6', requests: 1 }, { model: thinking, requests: 2 }]);
  });

  it('gives the six bases worked out by hand', () => {
    const { t } = whole(c);
    expect(table(t.hidden.thinking)).toEqual([[thinking, 0, 0, 72 + 38], ['gpt-5-6', 0, 0, 4]]);
    expect(table(t.hidden.systemPrompt)).toEqual([[thinking, 0, 2, 0], ['gpt-5-6', 0, 1, 0]]);
    expect(table(t.hidden.memory)).toEqual([[thinking, 1, 1, 0], ['gpt-5-6', 0, 1, 0]]);
    expect(table(t.hidden.search)).toEqual([[thinking, 5, 0, 0]]);
    expect(table(t.hidden.files)).toEqual([[thinking, 1, 0, 0]]);
    expect(table(t.hidden.cacheMisses)).toEqual([['gpt-5-6', 355, 0, 0], [thinking, 310, 0, 0]]);
  });

  it('gives the counts behind the switches', () => {
    const { t } = whole(c);
    expect([t.thinkingSeconds, t.thinkingRecorded, t.thinkingSecondsAssumed, t.thinkingAssumed]).toEqual([76, 2, 38, 1]);
    expect([t.sources, t.searchRequests, t.filesWithoutCount, t.filesWithCount, t.images]).toEqual([5, 1, 1, 1, 1]);
    expect(t.evidence).toEqual({ thinking: 'recorded', memoryInUse: false, searchOrFiles: true });
  });
});

describe('the same kind of answer as older exports show it', () => {
  // system (hidden, no text, no time) ── q1 (10 words, a PDF with 300 tokens in the old spelling, a CSV with no count)
  //   ── the search call (4 words, to the tool "web") ── the tool's reply (no text) ── thoughts ── recap (70 s as a number)
  //   ── a1 (40, five sources) ── q2 (5) ── a2 (12, no thinking line)
  const T = at('2026-02-10', '09:00:00');
  const model = 'gpt-5-2-thinking';
  const c = conversation([
    node('sys', 'root', { ...message('system', 0, { time: null, metadata: { is_visually_hidden_from_conversation: true } }), content: { content_type: 'text', parts: [''] } }),
    node('q1', 'sys', {
      ...message('user', 10, { time: T }),
      metadata: { attachments: [{ id: 'file-a', name: 'a.pdf', mimeType: 'application/pdf', fileSizeTokens: 300 }, { id: 'file-b', name: 'b.csv', mimeType: 'text/csv' }] },
    }),
    node('call', 'q1', message('assistant', 0, { type: 'code', content: { language: 'unknown', text: words(4) }, recipient: 'web', time: T + 3, model })),
    node('res', 'call', { ...message('tool', 0, { name: 'web', time: T + 5 }), content: { content_type: 'text', parts: [''] } }),
    node('th', 'res', message('assistant', 0, { type: 'thoughts', content: { thoughts: [{ summary: 'Comparing', content: words(30) }] }, time: T + 6, model })),
    node('rc', 'th', message('assistant', 0, { type: 'reasoning_recap', content: { content: 'Thought for 1m 12s' }, time: T + 74, model, metadata: { finished_duration_sec: 70, reasoning_status: 'reasoning_ended' } })),
    node('a1', 'rc', message('assistant', 40, { time: T + 75, model, metadata: { search_result_groups: [{ domain: 'one.example', entries: [{}, {}, {}, {}, {}] }] } })),
    node('q2', 'a1', message('user', 5, { time: T + 200 })),
    node('a2', 'q2', message('assistant', 12, { time: T + 215, model })),
  ], { id: 'older', update_time: T + 215, default_model_slug: 'gpt-5-2-thinking' });

  // request   output   new        previous answer   earlier prompt       after      thinking
  // call         4     310              0                 0              cold       none: it went to a tool
  // a1          40     0                4               310              72: warm   70 s: the number wins over the text
  // a2          12     5               40          310 + 4 = 314         140: warm  none recorded: the median, 70
  it('gives the rows worked out by hand', () => {
    const { t } = whole(c);
    expect(table(t.rows)).toEqual([[model, 310 + 4 + (5 + 40), 310 + 314, 4 + 40 + 12]]);
    expect([t.requests, t.coldRequests]).toEqual([3, 1]);
    // The call, the tool's reply, the thinking and the text are one answer.
    expect([t.messages, t.prompts, t.answers]).toEqual([9, 2, 2]);
  });

  it('gives the six bases worked out by hand', () => {
    const { t } = whole(c);
    expect(table(t.hidden.thinking)).toEqual([[model, 0, 0, 70 + 70]]);
    // February 2026: each request read 0.65 of today's prompt.
    expect(t.hidden.systemPrompt.map((row) => [row.model, Math.round(row.cacheRead * 1e6) / 1e6])).toEqual([[model, 1.95]]);
    expect(table(t.hidden.memory)).toEqual([[model, 1, 2, 0]]);
    expect(table(t.hidden.search)).toEqual([[model, 5, 0, 0]]);
    // The file without a count was read by the request that came right after the question: the call.
    expect(table(t.hidden.files)).toEqual([[model, 1, 0, 0]]);
    expect(table(t.hidden.cacheMisses)).toEqual([[model, 624, 0, 0]]);
    expect([t.thinkingSeconds, t.thinkingRecorded, t.thinkingSecondsAssumed, t.thinkingAssumed]).toEqual([70, 1, 70, 1]);
    expect([t.sources, t.searchRequests, t.filesWithoutCount, t.filesWithCount, t.images]).toEqual([5, 1, 1, 1, 0]);
  });
});

describe('an answer that goes on after thinking again', () => {
  // q1 (10) ── a note (5) ── thoughts ── "Thought for 9s" ── the answer (7) ── q2 (3) ── a2 (4)
  const T = at('2026-09-22', '09:00:00');
  const c = conversation([
    node('q1', 'root', message('user', 10, { time: T })),
    node('note', 'q1', message('assistant', 5, { time: T + 2 })),
    node('th', 'note', message('assistant', 0, { type: 'thoughts', content: { thoughts: [{ summary: 'Checking', content: words(12) }] }, time: T + 3 })),
    node('rc', 'th', message('assistant', 0, { type: 'reasoning_recap', content: { content: 'Thought for 9s' }, time: T + 12 })),
    node('text', 'rc', message('assistant', 7, { time: T + 13 })),
    node('q2', 'text', message('user', 3, { time: T + 60 })),
    node('a2', 'q2', message('assistant', 4, { time: T + 65 })),
  ], { id: 'goes-on', update_time: T + 65 });

  // request        output      new   previous answer   earlier prompt   thinking
  // note + text    5 + 7 = 12   10          0                0          9 s: the line sits inside the run
  // a2                 4         3         12               10          none
  it('is one request, and its thinking time is not lost', () => {
    const { t } = whole(c);
    expect(table(t.rows)).toEqual([['gpt-5-6', 10 + (3 + 12), 10, 12 + 4]]);
    expect([t.requests, t.coldRequests, t.answers, t.prompts, t.messages]).toEqual([2, 1, 2, 2, 7]);
    expect(table(t.hidden.thinking)).toEqual([['gpt-5-6', 0, 0, 9]]);
    expect([t.thinkingSeconds, t.thinkingRecorded, t.thinkingAssumed, t.recaps]).toEqual([9, 1, 0, 1]);
    expect(table(t.hidden.systemPrompt)).toEqual([['gpt-5-6', 0, 2, 0]]);
    expect(table(t.hidden.memory)).toEqual([['gpt-5-6', 1, 1, 0]]);
  });
});
