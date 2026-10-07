// Every conversation is untrusted. None of these may hang, throw, or put a wrong number into the totals.
import { describe, expect, it } from 'vitest';
import { createAccount } from './account';
import { LIMITS } from './count';
import { NO_MODEL_NAME, totals, type Reading, type Totals, type WarningCode } from './reading';
import { countO200k } from './tokens';
import { conversation, countWords, message, node, read, words, type Json } from './test-kit';

const T = Date.UTC(2026, 8, 15, 12) / 1000;
const NOW = T + 86_400;
const user = (n: number, time: unknown = T) => message('user', n, { time });
const assistant = (n: number, time: unknown = T, model?: string) => message('assistant', n, { time, model });
const plain = (id: string): Json => conversation([node('u1', 'root', user(10)), node('a1', 'u1', assistant(20))], { id, update_time: T });

const all = (reading: Reading) => totals(reading, 'all', 'paid');
const sum = (t: Totals, type: 'output' | 'freshInput' | 'cacheRead') => t.rows.reduce((s, row) => s + row[type], 0);
const rowsOf = (t: Totals) => [sum(t, 'output'), sum(t, 'freshInput'), sum(t, 'cacheRead')];
const warned = (reading: Reading, code: WarningCode) => reading.warnings.find((w) => w.code === code)?.count ?? 0;

/** Every number in a reading and its totals is a finite number that is not negative. */
function expectSound(reading: Reading): void {
  const check = (value: unknown, path: string): void => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) throw new Error(`${path} is ${value}`);
    } else if (Array.isArray(value)) value.forEach((x, i) => check(x, `${path}[${i}]`));
    else if (value !== null && typeof value === 'object') for (const [k, x] of Object.entries(value)) check(x, `${path}.${k}`);
  };
  check(reading, 'reading');
  check(totals(reading, 'all', 'paid'), 'paid');
  check(totals(reading, 'all', 'free'), 'free');
}

const within = (ms: number, work: () => void): void => {
  const started = performance.now();
  work();
  expect(performance.now() - started).toBeLessThan(ms);
};

describe('things that are not conversations', () => {
  it('are skipped and counted', () => {
    const account = createAccount({ countTokens: countWords, now: NOW });
    const junk = [null, undefined, 5, 'text', true, [], [1, 2], {}, { mapping: null }, { mapping: [] }, { mapping: 'x' }, { mapping: 7 }, { id: 'a' }];
    for (const value of junk) expect(account.add(value)).toBe(false);
    expect(account.counted()).toBe(0);
    expect(account.add(plain('one'))).toBe(true);
    expect(account.counted()).toBe(1);
    const reading = account.finish();
    expect(warned(reading, 'not-a-conversation')).toBe(junk.length);
    expect(rowsOf(all(reading))).toEqual([20, 10, 0]);
  });

  it('an empty mapping is a conversation with nothing in it', () => {
    const reading = read([{ mapping: {}, id: 'empty' }], { now: NOW });
    expect([reading.conversations, all(reading).messages, all(reading).requests]).toEqual([1, 0, 0]);
  });
});

describe('a broken tree', () => {
  it('ignores a loop of parent links and a node that is its own parent', () => {
    const reading = read([
      { id: 'loop', update_time: T, mapping: { a: { id: 'a', parent: 'b', message: user(5) }, b: { id: 'b', parent: 'a', message: assistant(5) } } },
      { id: 'self', update_time: T, mapping: { a: { id: 'a', parent: 'a', message: assistant(5) } } },
      { id: 'three', update_time: T, mapping: { a: { id: 'a', parent: 'c', message: user(5) }, b: { id: 'b', parent: 'a', message: assistant(5) }, c: { id: 'c', parent: 'b', message: user(5) }, d: { id: 'd', parent: 'c', message: assistant(9) } } },
    ], { now: NOW });
    expect(rowsOf(all(reading))).toEqual([0, 0, 0]);
    expect([all(reading).messages, all(reading).requests]).toEqual([0, 0]);
    expect(warned(reading, 'unreachable-message')).toBe(2 + 1 + 4);
    expectSound(reading);
  });

  it('counts the good part of a tree that also holds a loop', () => {
    const c = conversation([node('u1', 'root', user(10)), node('a1', 'u1', assistant(20)), node('x', 'y', user(99)), node('y', 'x', assistant(99))]);
    const reading = read([c], { now: NOW });
    expect(rowsOf(all(reading))).toEqual([20, 10, 0]);
    expect(warned(reading, 'unreachable-message')).toBe(2);
  });

  it('takes a node whose parent is missing as the start of its own tree', () => {
    const reading = read([conversation([node('a1', 'gone', assistant(20))])], { now: NOW });
    expect(rowsOf(all(reading))).toEqual([20, 0, 0]);
  });

  it('survives nodes, messages and fields of every wrong type', () => {
    const odd: unknown[] = [null, 5, 'text', true, [], [[]], {}, { length: 1e9 }, 1e308, -1];
    const nodes: Array<[string, unknown]> = [];
    for (const [i, x] of odd.entries()) {
      nodes.push([`node-${i}`, x]);
      nodes.push([`message-${i}`, { parent: 'u1', message: x }]);
      nodes.push([`parent-${i}`, { parent: x, message: assistant(1) }]);
      for (const field of ['author', 'content', 'metadata', 'create_time', 'recipient']) {
        nodes.push([`${field}-${i}`, { parent: 'u1', message: { ...assistant(1), [field]: x } }]);
      }
      nodes.push([`role-${i}`, { parent: 'u1', message: { ...assistant(1), author: { role: x, name: x } } }]);
      nodes.push([`type-${i}`, { parent: 'u1', message: { ...assistant(1), content: { content_type: x, parts: x, text: x, result: x } } }]);
      nodes.push([`parts-${i}`, { parent: 'u1', message: { ...user(1), content: { content_type: 'multimodal_text', parts: [x, { content_type: 'audio_transcription', text: x }, { content_type: 'image_asset_pointer', width: x, height: x, asset_pointer: x }] } } }]);
      nodes.push([`recap-${i}`, { parent: 'u1', message: { ...assistant(0), content: { content_type: 'reasoning_recap', content: x }, metadata: { finished_duration_sec: x } } }]);
      nodes.push([`context-${i}`, { parent: 'u1', message: { ...user(0), content: { content_type: 'user_editable_context', user_profile: x, user_instructions: x } } }]);
      nodes.push([`meta-${i}`, { parent: 'u1', message: { ...assistant(1), metadata: { model_slug: x, resolved_model_slug: x, search_result_groups: x, attachments: x, conversation_context_citation_metadata: x } } }]);
      nodes.push([`groups-${i}`, { parent: 'u1', message: { ...assistant(1), metadata: { search_result_groups: [x, { entries: x }] } } }]);
      nodes.push([`files-${i}`, { parent: 'u1', message: { ...user(1), metadata: { attachments: [x, { id: x, mime_type: x, file_token_size: x }, { mimeType: x, fileSizeTokens: x }] } } }]);
    }
    const c = { id: 'odd', update_time: T, create_time: 'yesterday', default_model_slug: { toString: 'x' }, current_node: 5, mapping: Object.fromEntries([node('root', null, null), node('u1', 'root', user(1)), ...nodes]) };
    for (const top of odd) {
      const reading = read([{ ...c, update_time: top, create_time: top, default_model_slug: top, title: top }], { now: NOW });
      expect(reading.conversations).toBe(1);
      expect(warned(reading, 'conversation-failed')).toBe(0);
      expectSound(reading);
    }
  });

  it('is not fooled by ids and field names that live on every object', () => {
    const raw = `{"id":"proto","update_time":${T},"mapping":{
      "__proto__":{"id":"__proto__","parent":null,"message":null},
      "constructor":{"id":"constructor","parent":"__proto__","message":${JSON.stringify(user(10))}},
      "toString":{"id":"toString","parent":"constructor","message":${JSON.stringify(assistant(20))}},
      "hasOwnProperty":{"id":"hasOwnProperty","parent":"valueOf","message":${JSON.stringify(assistant(7))}}
    }}`;
    const reading = read([JSON.parse(raw)], { now: NOW });
    expect(rowsOf(all(reading))).toEqual([27, 10, 0]);
    expect(all(reading).requests).toBe(2);
    expect(({} as Json)['mapping']).toBeUndefined();

    const inherited = read([conversation([node('u1', 'root', user(10)), node('a1', 'u1', { ...assistant(20), metadata: Object.create({ model_slug: 'gpt-4o', search_result_groups: [{ entries: [1, 2] }] }) as Json })])], { now: NOW });
    expect(all(inherited).rows.map((row) => row.model)).toEqual(['gpt-5-6']);
    expect(all(inherited).sources).toBe(0);
  });
});

describe('model names', () => {
  it('only lets short plain names through', () => {
    const bad = ['<img src=x onerror=alert(1)>', 'gpt 5', 'a'.repeat(65), '', 5, ['gpt-5'], { a: 1 }, '-gpt', 'gpt-5\n', 'モデル'];
    const nodes = bad.flatMap((slug, i): Array<[string, Json]> => [node(`u${i}`, 'root', user(1)), node(`a${i}`, `u${i}`, { ...assistant(1), metadata: { model_slug: slug } })]);
    const reading = read([conversation(nodes, { default_model_slug: '"><script>' })], { now: NOW });
    expect(all(reading).rows.map((row) => row.model)).toEqual([NO_MODEL_NAME]);
    expect(all(reading).requests).toBe(bad.length);
    expect(warned(reading, 'model-name-ignored')).toBe(bad.length - 1 + 1);
  });

  it('keeps names that sit on every object apart from the object', () => {
    const names = ['constructor', 'toString', 'hasOwnProperty', 'valueOf'];
    const nodes = names.flatMap((slug, i): Array<[string, Json]> => [node(`u${i}`, 'root', user(1)), node(`a${i}`, `u${i}`, assistant(i + 1, T, slug))]);
    const t = all(read([conversation(nodes)], { now: NOW }));
    expect(Object.fromEntries(t.rows.map((row) => [row.model, row.output]))).toEqual({ constructor: 1, toString: 2, hasOwnProperty: 3, valueOf: 4 });
    expect(t.requestsByModel.every((row) => row.requests === 1)).toBe(true);
  });

  it('puts the rare names together when a file names more models than the limit', () => {
    const nodes: Array<[string, Json]> = [];
    for (let i = 0; i < 120; i++) {
      for (let k = 0; k <= (i < 10 ? 3 : 0); k++) nodes.push(node(`u${i}-${k}`, 'root', user(1)), node(`a${i}-${k}`, `u${i}-${k}`, assistant(1, T, `model-${i}`)));
    }
    const reading = read([conversation(nodes)], { now: NOW });
    const t = all(reading);
    expect(t.rows.length).toBe(LIMITS.maxModels);
    expect(t.requests).toBe(120 + 30);
    expect(sum(t, 'output')).toBe(150);
    for (let i = 0; i < 10; i++) expect(t.requestsByModel).toContainEqual({ model: `model-${i}`, requests: 4 });
    expect(t.requestsByModel).toContainEqual({ model: NO_MODEL_NAME, requests: 120 - (LIMITS.maxModels - 1) });
    expect(warned(reading, 'model-name-over-limit')).toBe(120 - (LIMITS.maxModels - 1));
  });
});

describe('times', () => {
  const at = (time: unknown, fields: Json = {}) =>
    read([conversation([node('u1', 'root', user(10, time)), node('a1', 'u1', assistant(20, time))], { id: 'c', update_time: T, ...fields })], { now: NOW });

  it('reads a time in milliseconds as the same moment', () => {
    const reading = at(T * 1000);
    expect(reading.days.map((day) => day.day)).toEqual(['2026-09-15']);
    expect([reading.firstRequest, reading.lastRequest]).toEqual([T, T]);
    expect(warned(reading, 'time-in-milliseconds')).toBe(2);
  });

  it.each([['a text', String(T)], ['negative', -T], ['zero', 0], ['1970', 86_400], ['absurd', 1e300], ['beyond milliseconds', 1e17], ['an object', { $date: T }]])(
    'takes a time that is %s as missing and uses the time of the conversation',
    (_name, time) => {
      const reading = at(time);
      expect(reading.days.map((day) => day.day)).toEqual(['2026-09-15']);
      expect(warned(reading, 'unusable-time')).toBe(2);
      expect(rowsOf(all(reading))).toEqual([20, 10, 0]);
      expectSound(reading);
    },
  );

  it('keeps a request from the far future out of every window and out of the newest time', () => {
    const future = Date.UTC(2100, 0, 1) / 1000;
    const account = createAccount({ countTokens: countWords, now: NOW });
    account.add(plain('now'));
    account.add(conversation([node('u1', 'root', user(3, future)), node('a1', 'u1', assistant(4, future))], { id: 'future', update_time: future }));
    const reading = account.finish();
    expect(reading.lastRequest).toBe(T);
    expect(reading.lastMessage).toBe(T);
    expect(reading.days.map((day) => day.day)).toEqual(['2026-09-15']);
    expect(reading.undated.messages).toBe(2);
    expect(warned(reading, 'request-in-future')).toBe(1);
    expect(rowsOf(totals(reading, { from: '2026-09-15', to: '2100-12-31' }, 'paid'))).toEqual([20, 10, 0]);
    expect(rowsOf(all(reading))).toEqual([24, 13, 0]);
    expect([all(reading).conversations, totals(reading, { from: '2026-09-15', to: '2100-12-31' }, 'paid').conversations]).toEqual([2, 1]);
  });

  it('still believes a time up to a day after now', () => {
    const reading = read([conversation([node('u1', 'root', user(10, NOW + 3600)), node('a1', 'u1', assistant(20, NOW + 3600))], { update_time: NOW })], { now: NOW });
    expect(reading.undated.messages).toBe(0);
    expect(reading.lastRequest).toBe(NOW + 3600);
  });

  it('keeps requests with no time anywhere in the full history only', () => {
    const reading = at(null, { update_time: null, create_time: 'x' });
    expect(reading.days).toEqual([]);
    expect([reading.firstRequest, reading.lastRequest, reading.lastMessage]).toEqual([null, null, null]);
    expect(warned(reading, 'request-without-time')).toBe(1);
    expect(rowsOf(all(reading))).toEqual([20, 10, 0]);
    expect(all(reading).hidden.systemPrompt.map((row) => row.cacheRead)).toEqual([1]);
    expectSound(reading);
  });

  it('uses the nearest earlier message for a message and for a request without a time, never the update time of the conversation', () => {
    const later = T + 5 * 86_400;
    const reading = read([conversation([node('u1', 'root', user(10)), node('a1', 'u1', assistant(20, null))], { update_time: later, create_time: T - 86_400 })], { now: later });
    expect(reading.days.map((day) => [day.day, day.messages, day.models.length])).toEqual([['2026-09-15', 2, 1]]);
    expect([reading.firstRequest, reading.lastRequest]).toEqual([T, T]);
  });

  it('uses the time the conversation was made when nothing above a request has a time', () => {
    const later = T + 5 * 86_400;
    const reading = read([conversation([node('u1', 'root', user(10, null)), node('a1', 'u1', assistant(20, null))], { update_time: later, create_time: T - 86_400 })], { now: later });
    expect(reading.days.map((day) => [day.day, day.messages, day.models.length])).toEqual([['2026-09-14', 2, 1]]);
  });
});

describe('numbers in attachments, images and sources', () => {
  const withFiles = (attachments: unknown[]) => read([conversation([node('u1', 'root', { ...user(10), metadata: { attachments } }), node('a1', 'u1', assistant(20))])], { now: NOW });

  it('believes no token count that is negative, absurd or not a number', () => {
    const sizes = [-5, 1e300, Infinity, NaN, '300', 2_000_001, null, {}, [300]];
    const reading = withFiles(sizes.map((file_token_size, i) => ({ id: `f${i}`, mime_type: 'text/plain', file_token_size })));
    const t = all(reading);
    expect([t.filesWithoutCount, t.filesWithCount, sum(t, 'freshInput')]).toEqual([sizes.length, 0, 10]);
    expect(warned(reading, 'attachment-size-ignored')).toBe(sizes.length - 1);
    expectSound(reading);
  });

  it('takes a count with a fraction as whole tokens', () => {
    expect(sum(all(withFiles([{ id: 'f', file_token_size: 299.6 }])), 'freshInput')).toBe(310);
  });

  it('counts at most the limit of attachments and of images on one message', () => {
    const files = Array.from({ length: 5_000 }, (_, i) => ({ id: `f${i}`, file_token_size: 1_000_000 }));
    const reading = withFiles(files);
    expect(all(reading).filesWithCount).toBe(LIMITS.maxAttachments);
    expect(sum(all(reading), 'freshInput')).toBe(10 + LIMITS.maxAttachments * 1_000_000);
    expect(warned(reading, 'attachment-over-limit')).toBe(5_000 - LIMITS.maxAttachments);

    const parts = Array.from({ length: 5_000 }, () => ({ content_type: 'image_asset_pointer', width: 1e300, height: -1 }));
    const pictures = read([conversation([node('u1', 'root', { ...user(0), content: { content_type: 'multimodal_text', parts } }), node('a1', 'u1', assistant(20))])], { now: NOW });
    expect(all(pictures).images).toBe(LIMITS.maxAttachments);
    expect(sum(all(pictures), 'freshInput')).toBe(LIMITS.maxAttachments * 1229);
    expect(warned(pictures, 'image-size-unknown')).toBe(LIMITS.maxAttachments);
    expectSound(pictures);
  });

  it('counts sources only from real lists, and at most the limit on one message', () => {
    const groups = [{ entries: 'abcdef' }, { entries: { length: 1e9 } }, 'abc', null, { entries: Array.from({ length: 4_000 }, () => ({})) }];
    const reading = read([conversation([node('u1', 'root', user(10)), node('a1', 'u1', message('assistant', 20, { time: T, metadata: { search_result_groups: groups } }))])], { now: NOW });
    expect(all(reading).sources).toBe(LIMITS.maxSources);
    expect(warned(reading, 'source-over-limit')).toBe(4_000 - LIMITS.maxSources);
    const fake = read([conversation([node('u1', 'root', user(10)), node('a1', 'u1', message('assistant', 20, { time: T, metadata: { search_result_groups: { length: 1e9 } } }))])], { now: NOW });
    expect(all(fake).sources).toBe(0);
  });

  it('caps a thinking time that cannot be true', () => {
    const recap = (id: string, parent: string, content: string, metadata: Json = {}) =>
      node(id, parent, message('assistant', 0, { type: 'reasoning_recap', content: { content }, metadata, time: T }));
    const reading = read([conversation([
      node('u1', 'root', user(10)), recap('r1', 'u1', 'Thought for 99999999999999999999999h'), node('a1', 'r1', assistant(20)),
      node('u2', 'a1', user(10)), recap('r2', 'u2', '', { finished_duration_sec: 1e300 }), node('a2', 'r2', assistant(20)),
    ])], { now: NOW });
    expect(all(reading).thinkingSeconds).toBe(2 * 7200);
    expect(warned(reading, 'thinking-time-capped')).toBe(2);
    expectSound(reading);
  });
});

describe('size', () => {
  it('skips a mapping with a million nodes, quickly, and goes on', () => {
    const mapping: Json = {};
    for (let i = 0; i < 1_000_001; i++) mapping[`n${i}`] = { parent: i === 0 ? null : `n${i - 1}`, message: null };
    const account = createAccount({ countTokens: countWords, now: NOW });
    within(2_000, () => expect(account.add({ id: 'huge', mapping })).toBe(false));
    account.add(plain('one'));
    const reading = account.finish();
    expect(warned(reading, 'conversation-too-large')).toBe(1);
    expect([reading.conversations, ...rowsOf(all(reading))]).toEqual([1, 20, 10, 0]);
  });

  it('walks a chain as deep as the limit allows without running out of stack', () => {
    const size = 100_000;
    const nodes: Array<[string, Json]> = [];
    for (let i = 0; i < size; i++) nodes.push(node(`n${i}`, i === 0 ? 'root' : `n${i - 1}`, i % 2 === 0 ? user(1, T + i) : assistant(1, T + i)));
    let reading: Reading | undefined;
    within(5_000, () => (reading = read([conversation(nodes)], { now: NOW + size })));
    if (!reading) throw new Error('not read');
    const t = totals(reading, 'all', 'paid');
    expect([t.requests, sum(t, 'output'), t.messages]).toEqual([size / 2, size / 2, size]);
    // Request k re-reads the 2k - 1 messages before its question, up to the ceiling.
    let expected = 0;
    for (let k = 1; k < size / 2; k++) expected += Math.min(2 * k - 1, 34_000);
    expect(sum(t, 'cacheRead')).toBe(expected);
  });

  it('stays fast on trees built to make a slow reader crawl', () => {
    const half = 60_000;
    // A long chain of questions with as many answers hanging off its end: each answer has the whole chain above it.
    const comb: Array<[string, Json]> = [];
    for (let i = 0; i < half; i++) comb.push(node(`u${i}`, i === 0 ? 'root' : `u${i - 1}`, user(1)));
    for (let i = 0; i < half; i++) comb.push(node(`a${i}`, `u${half - 1}`, assistant(1)));
    // A long chain of thinking lines with no answer below.
    const recaps: Array<[string, Json]> = [node('u', 'root', user(1))];
    for (let i = 0; i < half; i++) recaps.push(node(`r${i}`, i === 0 ? 'u' : `r${i - 1}`, message('assistant', 0, { type: 'reasoning_recap', content: { content: 'Thought for 2s' }, time: T })));
    // A long chain of thinking lines, each also with its own answer.
    const both: Array<[string, Json]> = [node('u', 'root', user(1))];
    for (let i = 0; i < half; i++) {
      both.push(node(`r${i}`, i === 0 ? 'u' : `r${i - 1}`, message('assistant', 0, { type: 'reasoning_recap', content: { content: 'Thought for 2s' }, time: T })));
      both.push(node(`a${i}`, `r${i}`, assistant(1)));
    }
    let reading: Reading | undefined;
    within(5_000, () => (reading = read([conversation(comb, { id: 'comb' }), conversation(recaps, { id: 'recaps' }), conversation(both, { id: 'both' })], { now: NOW })));
    if (!reading) throw new Error('not read');
    const t = totals(reading, 'all', 'paid');
    expect(t.requests).toBe(half + half);
    expect(sum(t, 'freshInput')).toBe(half * half + half);
    expect(warned(reading, 'thinking-time-unplaced')).toBe(half);
    expect(t.thinkingSeconds).toBe(2 * half);
    expectSound(reading);
  });

  it('counts a long unbroken run of one character without stalling the tokenizer', () => {
    const texts = ['x'.repeat(300_000), ' '.repeat(300_000), '='.repeat(300_000), '字'.repeat(100_000), '😀'.repeat(50_000), '\udc00'.repeat(100_000), 'ab '.repeat(100_000)];
    let reading: Reading | undefined;
    within(8_000, () => {
      reading = read([conversation(texts.flatMap((text, i): Array<[string, Json]> => [
        node(`u${i}`, 'root', { ...user(0), content: { content_type: 'text', parts: [text] } }), node(`a${i}`, `u${i}`, assistant(1)),
      ]))], { now: NOW, countTokens: countO200k });
    });
    if (!reading) throw new Error('not read');
    expect(warned(reading, 'message-not-tokenized')).toBe(0);
    expect(sum(all(reading), 'freshInput')).toBeGreaterThan(100_000);
    expectSound(reading);
  });

  it('counts a text in pieces to the same number, give or take a token per piece', () => {
    const text = `${'word '.repeat(50)}${'x'.repeat(5_000)} ${'字'.repeat(3_000)} end`;
    const one = (maxRunChars: number) =>
      sum(all(read([conversation([node('u1', 'root', { ...user(0), content: { content_type: 'text', parts: [text] } }), node('a1', 'u1', assistant(1))])], { now: NOW, countTokens: countO200k, limits: { maxRunChars } })), 'freshInput');
    const whole = one(1_000_000);
    const pieces = one(512);
    expect(Math.abs(pieces - whole)).toBeLessThanOrEqual(Math.ceil(8_000 / 512));
    expect(whole).toBe(countO200k(text, { disallowedSpecial: new Set() }));
  });

  it('leaves ordinary text to the tokenizer in one piece', () => {
    const seen: string[] = [];
    const text = `${'An ordinary sentence, with a comma. '.repeat(400)}\n\n${'12345678901234567890'.repeat(60)}`;
    const account = createAccount({ now: NOW, countTokens: (t) => (seen.push(t), 1) });
    account.add(conversation([node('u1', 'root', { ...user(0), content: { content_type: 'text', parts: [text] } })]));
    expect(seen).toEqual([text]);
  });

  it('estimates the rest of a message that is longer than the limit from its start', () => {
    const reading = read([conversation([
      node('u1', 'root', { ...user(0), content: { content_type: 'text', parts: [words(300), words(300), words(400)] } }),
      node('a1', 'u1', assistant(20)),
    ])], { now: NOW, limits: { maxMessageChars: 200 } });
    // 1,000 words in 1,999 characters. The first 200 characters hold 100 words.
    expect(sum(all(reading), 'freshInput')).toBe(Math.round((100 * 1999) / 200));
    expect(warned(reading, 'message-too-long')).toBe(1);
  });

  it('estimates a message the tokenizer fails on, and says so', () => {
    const reading = read([plain('one')], { now: NOW, countTokens: () => { throw new Error('no'); } });
    expect(rowsOf(all(reading))).toEqual([Math.ceil(39 / 4), Math.ceil(19 / 4), 0]);
    expect(warned(reading, 'message-not-tokenized')).toBe(2);
    const nonsense = read([plain('one')], { now: NOW, countTokens: () => NaN });
    expect(warned(nonsense, 'message-not-tokenized')).toBe(2);
    expectSound(nonsense);
  });
});

describe('the same conversation twice', () => {
  const version = (updateTime: unknown, answerWords: number) =>
    conversation([node('u1', 'root', user(10)), node('a1', 'u1', assistant(answerWords))], { conversation_id: 'same', id: 'same', update_time: updateTime });

  it('keeps the copy with the later update time, whichever comes first', () => {
    for (const order of [[version(T, 20), version(T + 100, 30)], [version(T + 100, 30), version(T, 20)]]) {
      const account = createAccount({ countTokens: countWords, now: NOW });
      const added = order.map((c) => account.add(c));
      expect(added).toEqual(order[0] === order.find((c) => c['update_time'] === T) ? [true, true] : [true, false]);
      expect(account.counted()).toBe(1);
      const reading = account.finish();
      expect([reading.conversations, ...rowsOf(all(reading))]).toEqual([1, 30, 10, 0]);
      expect(warned(reading, 'duplicate-conversation')).toBe(1);
    }
  });

  it('keeps the first copy when the times are equal or missing', () => {
    for (const time of [T, null, 'x']) {
      const reading = read([version(time, 20), version(time, 30)], { now: NOW });
      expect([reading.conversations, sum(all(reading), 'output')]).toEqual([1, 20]);
    }
  });

  it('does not let the warnings of a replaced copy stay', () => {
    const broken = conversation([node('u1', 'root', user(10, 'x')), node('a1', 'u1', assistant(20))], { id: 'same', update_time: T });
    const reading = read([broken, version(T + 1, 30)], { now: NOW });
    expect(warned(reading, 'unusable-time')).toBe(0);
  });

  it('counts conversations without an id, each on its own', () => {
    const noId = () => ({ mapping: plain('x')['mapping'], update_time: T });
    const reading = read([noId(), noId(), { ...noId(), id: 7 }, { ...noId(), id: 'x'.repeat(500) }], { now: NOW });
    expect([reading.conversations, sum(all(reading), 'output')]).toEqual([4, 80]);
    expect(warned(reading, 'conversation-without-id')).toBe(4);
  });
});

describe('user.json', () => {
  const plus = (...users: unknown[]) => {
    const account = createAccount({ countTokens: countWords, now: NOW });
    for (const u of users) account.setUser(u);
    return account.finish().plusUser;
  };

  it('gives the plan flag, before or after the conversations', () => {
    expect(plus({ chatgpt_plus_user: true })).toBe(true);
    expect(plus({ chatgpt_plus_user: false })).toBe(false);
    expect(plus([{ chatgpt_plus_user: false }])).toBe(false);
    expect(plus()).toBeNull();
  });

  it('ignores anything that is not the flag', () => {
    for (const odd of [null, 5, 'true', [], [null], {}, { chatgpt_plus_user: 'true' }, { chatgpt_plus_user: 1 }, { chatgpt_plus_user: null }, Object.create({ chatgpt_plus_user: false })]) {
      expect(plus(odd)).toBeNull();
    }
    expect(plus({ chatgpt_plus_user: false }, { chatgpt_plus_user: 'yes' })).toBe(false);
  });
});
