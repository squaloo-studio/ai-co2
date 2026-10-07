// Nothing a person wrote may leave the worker. A Reading holds numbers, days, warning codes and
// model names, and a model name is let through only when it is a short plain name.
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createAccount } from './account';
import { madeUpExport } from './made-up-export';
import { PIECES, totals, type Reading } from './reading';
import { seeded, type Json } from './test-kit';

const T = Date.UTC(2026, 8, 15, 12) / 1000;
const NOW = T + 86_400;

const READING_KEYS = new Set(['calendar', 'conversations', 'conversationDays', 'days', 'undated', 'firstRequest', 'lastRequest', 'lastMessage', 'plusUser', 'memorySeen', 'conversationsWithCustomInstructions', 'warnings']);
const DAY_KEYS = new Set(['day', 'messages', 'prompts', 'answers', 'recaps', 'transcripts', 'memoryMessages', 'models']);
const MODEL_KEYS = new Set([
  'model', 'requests', 'coldRequests', 'output', 'newInput', 'rereadWarmFree', 'rereadWarmPaid', 'rereadColdFree', 'rereadColdPaid', 'cutFree', 'cutPaid',
  'thinkingSeconds', 'thinkingSecondsAssumed', 'thinkingRecorded', 'thinkingAssumed', 'promptReadings', 'sources', 'searchRequests', 'filesWithoutCount', 'filesWithCount', 'images',
]);

/** Every text in a value, with the path to it. */
function textsIn(value: unknown, path = 'reading', out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((item, i) => textsIn(item, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') for (const [key, item] of Object.entries(value)) textsIn(item, `${path}.${key}`, out);
  return out;
}

/** Fails unless the reading is made of the known fields, and every text in it is a day, a code, the calendar or a model name. */
function expectOnlyCounts(reading: Reading, modelNames: ReadonlySet<string>): void {
  expect(new Set(Object.keys(reading))).toEqual(READING_KEYS);
  for (const day of [...reading.days, reading.undated]) {
    expect(new Set(Object.keys(day))).toEqual(DAY_KEYS);
    for (const model of day.models) expect(new Set(Object.keys(model))).toEqual(MODEL_KEYS);
  }
  for (const [path, text] of textsIn(reading)) {
    if (/\.model$/.test(path)) {
      expect(text === '' || modelNames.has(text), `${path}: ${text}`).toBe(true);
      expect(text).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$|^$/);
    } else if (/\.day$/.test(path)) expect(text).toMatch(/^(\d{4}-\d{2}-\d{2})?$/);
    else if (/^reading\.warnings\[\d+\]\.code$/.test(path)) expect(text).toMatch(/^[a-z]+(-[a-z]+)+$/);
    else if (path === 'reading.calendar') expect(text).toMatch(/^(utc|local)$/);
    else throw new Error(`a text at ${path}`);
  }
  for (const days of reading.conversationDays) for (const day of days) expect(Number.isInteger(day)).toBe(true);
}

describe('a reading', () => {
  it('holds nothing of a conversation whose every text field carries a mark', () => {
    let serial = 0;
    const mark = (what: string) => `PRIVATE ${what} ${serial++}`;
    const message = (role: string, content: Json, metadata: Json = {}, more: Json = {}): Json =>
      ({ id: mark('message id'), author: { role, name: mark('author name'), metadata: { note: mark('author note') } }, create_time: T + serial, content, metadata, status: mark('status'), channel: mark('channel'), ...more });
    const nodes: Array<[string, Json]> = [];
    let tip: string | null = null;
    const put = (m: Json | null): string => {
      const id = mark('node id');
      nodes.push([id, { id, parent: tip, children: [mark('child')], message: m }]);
      tip = id;
      return id;
    };
    put(null);
    put(message('system', { content_type: 'text', parts: [mark('system text')] }));
    put(message('user', { content_type: 'user_editable_context', user_profile: mark('profile'), user_instructions: mark('instructions') }, { user_context_message_data: { about_user_message: mark('about') } }));
    put(message('system', { content_type: 'model_editable_context', model_set_context: mark('memory') }));
    put(message('user', { content_type: 'app_pairing_content', workspaces: [mark('workspace')], context_parts: [{ text: mark('context') }], custom_instructions: mark('custom') }));
    put(message('user', {
      content_type: 'multimodal_text',
      parts: [mark('question'), { content_type: 'image_asset_pointer', asset_pointer: `sediment://${mark('pointer')}`, width: 800, height: 600, metadata: { caption: mark('caption') } }, { content_type: 'audio_transcription', text: mark('spoken'), direction: 'in' }],
    }, { attachments: [{ id: mark('file id'), name: mark('file name'), mime_type: mark('mime'), file_token_size: 12 }, { id: mark('file id'), name: mark('file name'), mimeType: 'application/pdf' }], targeted_reply_label: mark('label'), model_slug: mark('user slug') }));
    put(message('assistant', { content_type: 'thoughts', thoughts: [{ summary: mark('thought title'), content: mark('thought') }], source_analysis_msg_id: mark('analysis id') }, { model_slug: 'gpt-5-6-thinking', reasoning_title: mark('reasoning title') }));
    put(message('assistant', { content_type: 'reasoning_recap', content: mark('recap wording') }, { model_slug: 'gpt-5-6-thinking' }));
    put(message('assistant', { content_type: 'code', language: mark('language'), text: mark('code') }, { model_slug: 'gpt-5-6-thinking', search_queries: [{ q: mark('query') }] }, { recipient: mark('recipient') }));
    put(message('tool', { content_type: 'execution_output', text: mark('output') }, { aggregate_result: { code: mark('ran') } }));
    put(message('tool', { content_type: 'tether_browsing_display', result: mark('page'), summary: mark('summary') }));
    put(message('tool', { content_type: 'tether_quote', url: mark('url'), domain: mark('domain'), title: mark('quote title'), text: mark('quote') }));
    put(message('tool', { content_type: 'system_error', name: mark('error name'), text: mark('error') }));
    put(message('tool', { content_type: mark('new type'), text: mark('new text'), [mark('new field')]: mark('new value') }));
    put(message('assistant', { content_type: 'text', parts: [mark('answer')] }, {
      model_slug: 'gpt-5-6-thinking', resolved_model_slug: mark('resolved'), default_model_slug: mark('default'),
      search_result_groups: [{ domain: mark('domain'), entries: [{ title: mark('title'), url: mark('url'), snippet: mark('snippet'), attribution: mark('attribution') }] }],
      content_references: [{ matched_text: mark('matched'), alt: mark('alt') }],
      conversation_context_citation_metadata: [{ citation: { attribution: mark('memory line') } }],
      citations: [{ metadata: { title: mark('cited') } }],
    }));
    // A model name that is really free text, a long one, and one that looks plain but is not a name at all.
    put(message('user', { content_type: 'text', parts: [mark('second question')] }));
    put(message('assistant', { content_type: 'text', parts: [mark('second answer')] }, { model_slug: mark('free text as a model name') }));
    put(message('user', { content_type: 'text', parts: [mark('third question')] }));
    put(message('assistant', { content_type: 'text', parts: [mark('third answer')] }, { model_slug: `PRIVATE-${'x'.repeat(80)}` }));
    put(message('user', { content_type: 'text', parts: [mark('fourth question')] }));
    const current = put(message('assistant', { content_type: 'text', parts: [mark('fourth answer')] }, { model_slug: '<b>PRIVATE</b>' }));

    const conversation: Json = {
      id: mark('conversation id'), conversation_id: mark('conversation id'), title: mark('title'), create_time: T, update_time: T + 999,
      current_node: current, default_model_slug: mark('picker'), conversation_template_id: mark('project'), gizmo_id: mark('gpt'),
      safe_urls: [mark('url')], voice: mark('voice'), [mark('unknown field')]: mark('unknown value'), mapping: Object.fromEntries(nodes),
    };

    const account = createAccount({ now: NOW });
    account.setUser({ id: mark('user id'), email: mark('email'), chatgpt_plus_user: true, phone_number: mark('phone') });
    expect(account.add(conversation)).toBe(true);
    // Things that are skipped must leave nothing behind either.
    expect(account.add({ title: mark('no mapping') })).toBe(false);
    expect(account.add({ ...conversation, update_time: T })).toBe(false);
    expect(account.add(mark('a text where a conversation should be'))).toBe(false);
    const reading = account.finish();

    expect(JSON.stringify(reading)).not.toContain('PRIVATE');
    for (const plan of ['free', 'paid'] as const) expect(JSON.stringify(totals(reading, 'all', plan))).not.toContain('PRIVATE');
    expectOnlyCounts(reading, new Set(['gpt-5-6-thinking']));
    // It did count the conversation. Where the name was not one, a request has the model of the
    // request before it, so all five are under the one real name.
    const t = totals(reading, 'all', 'paid');
    expect(new Set(t.requestsByModel)).toEqual(new Set([{ model: 'gpt-5-6-thinking', requests: 5 }]));
    expect(reading.warnings.map((w) => w.code)).toEqual(['duplicate-conversation', 'model-name-ignored', 'not-a-conversation', 'thinking-time-unreadable', 'unknown-content-type']);
    expect(serial).toBeGreaterThan(90);
  });

  it('lets a model name through only as a short plain name, and that is all the text it holds', () => {
    const names = ['gpt-5-6', 'o3', 'gpt-4o-mini', 'text-davinci-002-render-sha', 'gpt-5.6-sol-wm', 'ft:gpt-4o:acme', 'a_b', 'x'.repeat(64)];
    const refused = ['', ' gpt-5-6', 'gpt-5-6 ', 'gpt 5', 'gpt-5\n', '<gpt>', 'gpt/5', 'gpt\\5', '"gpt"', 'gpt-5;', '#gpt', 'x'.repeat(65), 'モデル', 'gpt-5\u200b', '.hidden', '-flag', '__proto__'];
    const turnOf = (slug: string, i: number): Array<[string, Json]> => [
      [`q${i}`, { id: `q${i}`, parent: 'root', message: { author: { role: 'user' }, create_time: T, content: { content_type: 'text', parts: ['a question'] }, metadata: {} } }],
      [`a${i}`, { id: `a${i}`, parent: `q${i}`, message: { author: { role: 'assistant' }, create_time: T + 1, content: { content_type: 'text', parts: ['an answer'] }, metadata: { model_slug: slug } } }],
    ];
    const account = createAccount({ now: NOW });
    account.add({ id: 'names', update_time: T, mapping: Object.fromEntries([['root', { id: 'root', parent: null, message: null }], ...[...names, ...refused].flatMap(turnOf)]) });
    const reading = account.finish();
    expectOnlyCounts(reading, new Set(names));
    const t = totals(reading, 'all', 'paid');
    expect(new Set(t.rows.map((row) => row.model))).toEqual(new Set([...names, '']));
    expect(t.requestsByModel.find((row) => row.model === '')?.requests).toBe(refused.length);
  });

  it('holds only counts for 600 made-up conversations in both shapes, and so do its totals', () => {
    for (const shape of ['full', 'trimmed'] as const) {
      const { conversations } = madeUpExport(seeded(31), shape, 300, NOW);
      const names = new Set<string>(['auto']);
      for (const c of conversations) {
        const slug = c['default_model_slug'];
        if (typeof slug === 'string') names.add(slug);
        for (const n of Object.values(c['mapping'] as Record<string, Json>)) {
          const metadata = ((n['message'] as Json | null)?.['metadata'] ?? {}) as Json;
          for (const key of ['model_slug', 'resolved_model_slug']) if (typeof metadata[key] === 'string') names.add(metadata[key]);
        }
      }
      const account = createAccount({ now: NOW + 86_400, countTokens: (text) => text.length });
      for (const c of conversations) account.add(c);
      const reading = account.finish();
      expectOnlyCounts(reading, names);
      const t = totals(reading, 'all', 'paid');
      const allowed = new Set([...names, '', 'recorded', 'model-name', 'none']);
      for (const [path, text] of textsIn(t, 'totals')) expect(allowed.has(text), `${path}: ${text}`).toBe(true);
      expect(Object.keys(t.hidden)).toEqual([...PIECES]);
    }
  });
});

describe('the memory in use while reading', () => {
  // The collector is not within reach of a test unless it is asked for. Where that fails, there is nothing to measure.
  let collect: (() => void) | null = null;
  try {
    v8.setFlagsFromString('--expose-gc');
    const found: unknown = vm.runInNewContext('gc');
    if (typeof found === 'function') collect = () => (found as () => void)();
  } catch {
    collect = null;
  }
  const heap = (): number => {
    collect?.();
    return process.memoryUsage().heapUsed;
  };

  it.skipIf(collect === null)('does not grow with the size of the conversations: no text is kept', () => {
    const MB = 1024 * 1024;
    /** `count` conversations with `chars` characters of text each, every text a different one. */
    const grow = (count: number, chars: number): number => {
      const account = createAccount({ now: NOW, countTokens: (text) => text.length >> 2 });
      // In a function of its own, so that the last text is not held by this one while the heap is measured.
      const addOne = (n: number): void => {
        const text = `${n} words that nobody else wrote `.repeat(Math.ceil(chars / 32));
        account.add({
          id: `c${n}`, title: text.slice(0, 80), update_time: T,
          mapping: {
            root: { id: 'root', parent: null, message: null },
            q: { id: 'q', parent: 'root', message: { author: { role: 'user' }, create_time: T, content: { content_type: 'text', parts: [text] }, metadata: {} } },
            a: { id: 'a', parent: 'q', message: { author: { role: 'assistant' }, create_time: T + 5, content: { content_type: 'text', parts: [`${text} too`] }, metadata: { model_slug: 'gpt-5-6' } } },
          },
        });
      };
      const before = heap();
      for (let n = 0; n < count; n++) addOne(n);
      const after = heap();
      expect(account.counted()).toBe(count);
      return (after - before) / MB;
    };
    // 300 conversations of about a megabyte each: 300 MB of text go through, and a few kilobytes per conversation stay.
    const small = grow(300, 200);
    const large = grow(300, 500_000);
    expect(large).toBeLessThan(4);
    expect(large - small).toBeLessThan(2);
  }, 120_000);
});
