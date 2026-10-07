// Made-up conversations in the two shapes real exports have, for the tests that lay this folder's
// counting beside the reference. Everything is invented here from a seed: the words, the ids, the
// times. The field names, the nesting and the kinds of message follow what the export report lists.
//
// It is written apart from test-kit.ts on purpose, as a second and different source of test data.

import type { Json } from './test-kit';

/** 'full': exports to about April 2026. 'trimmed': exports since about July 2026. */
export type Shape = 'full' | 'trimmed';

/** Every wording of the thinking line the two reports list, with the seconds it stands for. null: no time can be read. */
export const THINKING_LINES: ReadonlyArray<readonly [text: string, seconds: number | null]> = [
  ['Thought for 14s', 14], ['Thought for 19s', 19], ['Thought for 2m 9s', 129], ['Thought for 1m 12s', 72], ['Thought for 12 seconds', 12],
  ['Thought for 5 seconds', 5], ['Thought for 1 second', 1], ['Thought for a second', 1], ['Thought for a couple of seconds', 2],
  ['Thought for a few seconds', 4], ['Thought for 2 minutes', 120], ['Thought for 1 minute', 60], ['Thought for a minute', 60],
  ['Thought for a couple of minutes', 120], ['Thought for a few minutes', 240], ['Thought for 1h 2m 3s', 3723], ['Thought for 1 hour', 3600],
  ['Thought for 1 hr 5 min', 3900], ['Thought for 2hrs', 7200], ['Thought for 3 min 20 sec', 200], ['Thought for 45 sec', 45], ['Thought for 90s', 90],
  ['Thought for 14 s', 14], ['Thought for 1m', 60], ['Thought about 3 hypotheses for 5s', 5],
  ['Worked for 24s', 24], ['Worked for 1m 15s', 75], ['Worked for 2m 9s', 129], ['Worked for 12 seconds', 12], ['Worked for a second', 1],
  ['Worked for a couple of seconds', 2], ['Worked for a few seconds', 4], ['Worked for a minute', 60],
  // Interface text in another language, or no time at all.
  ['Nachgedacht', null], ['Nachgedacht für 12 Sekunden', null], ['Pensó durante 12 segundos', null], ['Thought', null], ['', null],
];

/** Every content type the export report lists, and one that does not exist. */
export const CONTENT_TYPES = [
  'text', 'multimodal_text', 'thoughts', 'reasoning_recap', 'code', 'execution_output', 'tether_browsing_display', 'tether_quote',
  'system_error', 'user_editable_context', 'app_pairing_content', 'model_editable_context', 'something_new',
] as const;

const MODELS = [
  'gpt-5-6', 'gpt-5-6', 'gpt-5-6', 'gpt-5-5', 'gpt-5-5', 'gpt-5-6-thinking', 'gpt-5-5-thinking', 'gpt-5-6-t-mini', 'gpt-5-t-mini', 'gpt-5-3',
  'gpt-5-2', 'gpt-5-2-thinking', 'gpt-5-3-mini', 'gpt-4o', 'gpt-4o-mini', 'gpt-4', 'gpt-4-5', 'o3', 'o4-mini', 'o1-pro', 'gpt-5-6-pro',
  'gpt-5-nano', 'text-davinci-002-render-sha', 'research',
];

// Plain words, and words that are hard on a tokenizer: other scripts, emoji, a control-token string,
// a citation marker from the private-use range, code, a web address.
const WORDS = [
  'tea', 'plan', 'the', 'of', 'bread', 'heat', 'pump', 'list', 'pack', 'and', 'a', 'is', 'why', 'quote', 'train', 'window', 'seven',
  'Lisbon', 'starter', 'smell', 'check', 'it\'s', 'don\'t', 'e-mail', 'naïve', 'Ünïcödé', '東京', 'мир', 'שלום', '😀', '👩‍💻', '3.14159', '1,024',
  '<|endoftext|>', '<|im_start|>', '\ue200cite\ue202turn0search0\ue201', 'https://example.org/a/b?c=d', '`run()`', '{"k":[1,2]}', 'C++', 'AT&T', '—', '…',
];

export interface MadeUpExport {
  conversations: Json[];
  /** How many messages of each content type were made. */
  contentTypes: Map<string, number>;
  /** How many thinking lines of each wording were made. */
  thinkingLines: Map<string, number>;
  /** Other things the set must hold to be worth anything, by name. */
  seen: Map<string, number>;
}

/**
 * `count` conversations of one shape, with times around `around` (Unix seconds, to the millisecond).
 * Left out on purpose, because the reference handles them differently and says so: times in
 * milliseconds on answers, token counts with a fraction, thinking times above two hours.
 */
export function madeUpExport(random: () => number, shape: Shape, count: number, around: number, firstNumber = 0): MadeUpExport {
  const contentTypes = new Map<string, number>();
  const thinkingLines = new Map<string, number>();
  const seen = new Map<string, number>();
  const note = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

  const chance = (p: number) => random() < p;
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const hex = (length: number) => Array.from({ length }, () => '0123456789abcdef'.charAt(between(0, 15))).join('');
  const uuid = () => `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
  const text = (wordCount: number): string => {
    let out = '';
    for (let i = 0; i < wordCount; i++) out += (i === 0 ? '' : chance(0.06) ? '\n' : ' ') + pick(WORDS);
    return out;
  };

  const one = (n: number): Json => {
    const full = shape === 'full';
    const entries: Array<[string, Json]> = [];
    const parentOf = new Map<string, string | null>();
    const model = pick(MODELS);
    // Conversations reach back over every period of the hidden prompt, and never to before ChatGPT existed.
    let clock = around - between(0, chance(0.25) ? 1_200 : 150) * 86_400 - between(0, 86_399);
    let filesInExport = false;

    const stamp = (): number => {
      const gap = random();
      // Mostly quick replies, some long breaks, some messages at the very same moment, and now and
      // then the 30 minutes that still count as quick, to the millisecond.
      if (gap < 0.03) clock += 1_800;
      else if (gap < 0.04) clock = Math.round((clock + 1_800.001) * 1000) / 1000;
      else if (gap < 0.1) clock += 0;
      else clock = Math.round((clock + (gap < 0.3 ? between(1_801, 4 * 86_400) : between(1, 900)) + random()) * 1000) / 1000;
      // A child is sometimes a little older than its parent.
      return chance(0.03) ? Math.round((clock - between(1, 3)) * 1000) / 1000 : clock;
    };

    const put = (parent: string | null, message: Json | null, id = uuid()): string => {
      entries.push([id, { id, message: message === null ? null : { id, ...message }, parent }]);
      parentOf.set(id, parent);
      if (message !== null) note(contentTypes, String((message['content'] as Json)['content_type']));
      return id;
    };

    /** A message in the fields of this shape. */
    const message = (role: string, content: Json, o: { time?: number | null; metadata?: Json; recipient?: string; name?: string | null; channel?: string | null } = {}): Json => {
      const time = o.time === undefined ? stamp() : o.time;
      const base: Json = { author: full ? { role, name: o.name ?? null, metadata: {} } : { name: o.name ?? null, role }, create_time: time, content };
      if (full) Object.assign(base, { update_time: null, status: 'finished_successfully', end_turn: role === 'assistant' ? true : null, weight: 1, recipient: o.recipient ?? 'all', channel: o.channel ?? null });
      // The trimmed shape leaves `metadata` out on some messages.
      const metadata = o.metadata ?? {};
      if (full || Object.keys(metadata).length > 0 || !chance(0.3)) base['metadata'] = metadata;
      else note(seen, 'messages without metadata');
      return base;
    };
    const parts = (...items: unknown[]): Json => ({ content_type: items.some((item) => typeof item !== 'string') ? 'multimodal_text' : 'text', parts: items });

    const slug = (): Json => {
      const name = chance(0.85) ? model : pick(MODELS);
      const roll = random();
      if (roll < 0.03) return {};
      if (roll < 0.05) return { model_slug: null };
      if (roll < 0.06) return { model_slug: '', resolved_model_slug: name };
      if (full && roll < 0.1) return { resolved_model_slug: name, requested_model_slug: 'auto' };
      if (full && roll < 0.2) return { model_slug: name, resolved_model_slug: pick(MODELS), default_model_slug: 'auto' };
      return { model_slug: name };
    };
    const assistant = (parent: string, content: Json, o: { metadata?: Json; recipient?: string; time?: number | null; channel?: string } = {}): string => {
      const metadata: Json = { ...slug(), ...o.metadata };
      // The trimmed shape still carries the id of the hidden message that was taken out.
      if (!full && chance(0.4)) metadata['parent_id'] = uuid();
      // An answer without a time of its own is rare. The example export has one.
      const time = o.time === undefined && chance(0.01) ? null : o.time;
      if (time === null) note(seen, 'answers without a time');
      return put(parent, message('assistant', content, { ...o, time, metadata }));
    };

    const sources = (): Json => {
      const groups = Array.from({ length: between(1, 4) }, () => ({ type: 'search_result_group', domain: 'example.org', entries: Array.from({ length: between(0, 7) }, () => ({ type: 'search_result', url: 'https://example.org/page', title: text(3), snippet: text(8), attribution: 'example.org' })) }));
      note(seen, 'answers with a source list');
      return { search_result_groups: groups, content_references: [{ type: 'grouped_webpages', matched_text: '\ue200cite\ue202turn0search0\ue201' }] };
    };

    const thoughts = (parent: string): string =>
      assistant(parent, { content_type: 'thoughts', thoughts: Array.from({ length: between(1, 3) }, () => ({ summary: text(3), content: chance(0.5) ? text(between(5, 40)) : '', chunks: [], finished: true })), source_analysis_msg_id: uuid() }, { metadata: full ? { reasoning_status: 'is_reasoning' } : {} });
    const thinkingLine = (parent: string): string => {
      const [line] = pick(THINKING_LINES);
      note(thinkingLines, line);
      const metadata: Json = {};
      if (full) {
        metadata['reasoning_status'] = 'reasoning_ended';
        // Older exports give the time as a number. Now and then it is missing, and the text has to do.
        if (!chance(0.2)) {
          metadata['finished_duration_sec'] = chance(0.1) ? 0 : chance(0.3) ? between(1, 600) + 0.5 : between(1, 600);
          note(seen, 'thinking times as a number');
        }
      }
      return assistant(parent, { content_type: 'reasoning_recap', content: line }, { metadata });
    };

    /** A question, with what people attach to one. Returns its node id. */
    const question = (parent: string): string => {
      const items: unknown[] = [chance(0.03) ? text(between(3_000, 9_000)) : chance(0.008) ? text(between(30_000, 42_000)) : chance(0.03) ? '' : text(between(1, 70))];
      const attachments: Json[] = [];
      for (let k = chance(0.12) ? between(1, 3) : 0; k > 0; k--) {
        const id = `file_${hex(24)}`;
        const size = chance(0.75) ? { width: between(1, 6_000), height: between(1, 6_000) } : chance(0.5) ? { width: 0, height: 0 } : {};
        items.unshift({ content_type: 'image_asset_pointer', asset_pointer: `${full ? 'file-service' : 'sediment'}://${id}`, size_bytes: between(1_000, 9_000_000), ...size });
        // The list of attachments names the picture too, with or without its type.
        if (chance(0.8)) attachments.push({ id, name: 'photo.jpg', size: 1, ...(chance(0.5) ? { mime_type: 'image/jpeg' } : {}) });
        note(seen, 'pictures');
      }
      if (chance(0.05)) {
        items.push({ content_type: 'audio_transcription', text: text(between(0, 30)), direction: 'in', decoding_id: null });
        items.push({ content_type: 'real_time_user_audio_video_asset_pointer', audio_asset_pointer: { content_type: 'audio_asset_pointer', asset_pointer: `sediment://file_${hex(24)}`, format: 'wav', size_bytes: 1 }, frames_asset_pointers: [] });
        note(seen, 'voice transcripts');
      }
      for (let k = chance(0.16) ? between(1, 3) : 0; k > 0; k--) {
        const old = full && chance(0.3);
        const size = random();
        attachments.push({
          id: `file_${hex(24)}`, name: 'notes', size: between(100, 5_000_000),
          [old ? 'mimeType' : 'mime_type']: pick(['application/pdf', 'text/plain', 'text/csv', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
          ...(size < 0.45 ? { [old ? 'fileSizeTokens' : 'file_token_size']: chance(0.1) ? 0 : between(1, 41_000) } : size < 0.5 ? { file_token_size: null } : {}),
        });
        note(seen, 'attached files');
      }
      const metadata: Json = { ...(attachments.length ? { attachments } : {}), ...(!full && chance(0.03) ? { model_slug: 'auto' } : {}) };
      // One real export has a question dated in milliseconds.
      const milliseconds = chance(0.01);
      if (milliseconds) note(seen, 'questions dated in milliseconds');
      return put(parent, message('user', parts(...items), { time: milliseconds ? Math.round(stamp() * 1000) : stamp(), metadata }));
    };

    /** The tool call, the tool's reply and anything else older exports show before the text of an answer. */
    const toolSteps = (at: string): string => {
      const tool = pick(['web', 'web.run', 'browser', 'python', 'file_search', 'myfiles_browser', 'bio', 'dalle.text2im', 'canmore.create_textdoc']);
      note(seen, `tool ${tool}`);
      const result = (content: Json, time: number | null | undefined = chance(0.04) ? null : undefined) => put(at, message('tool', content, { name: tool, time, metadata: {} }));
      if (tool === 'file_search' || tool === 'myfiles_browser') {
        // The tool answers without being called by a message. Its text is the file. Sometimes it is blank.
        const blank = chance(0.3);
        if (!blank) filesInExport = true;
        at = result(chance(0.5) ? { content_type: 'tether_quote', url: 'file-x', domain: 'notes.pdf', title: 'notes.pdf', text: blank ? ' \n' : text(between(20, 400)), tether_id: null } : parts(blank ? '' : text(between(20, 400))));
        return at;
      }
      const call: Json = tool === 'python' ? { content_type: 'code', language: 'python', response_format_name: null, text: text(between(2, 30)) }
        : tool === 'browser' || tool.startsWith('web') ? (chance(0.5) ? { content_type: 'code', language: 'unknown', text: text(between(2, 8)) } : parts(text(between(2, 8))))
        : parts(text(between(3, 25)));
      at = assistant(at, call, { recipient: tool === 'web' && chance(0.5) ? 'web.search' : tool, metadata: tool.startsWith('web') ? { search_queries: [{ type: 'search', q: text(4) }] } : {} });
      if (chance(0.12)) {
        // The tool's reply is missing, so the call and the text after it are one run.
        note(seen, 'tool calls without a reply');
        return at;
      }
      if (tool === 'python') {
        at = result(chance(0.85) ? { content_type: 'execution_output', text: text(between(0, 90)) } : { content_type: 'system_error', name: 'Error', text: text(between(1, 30)) });
      } else if (tool === 'browser') {
        at = result(chance(0.6) ? { content_type: 'tether_browsing_display', result: chance(0.2) ? '' : text(between(20, 250)), summary: null, assets: [], tether_id: null }
          : { content_type: 'tether_quote', url: 'https://example.org', domain: 'example.org', title: text(3), text: text(between(10, 120)), tether_id: null });
      } else if (tool === 'dalle.text2im') {
        at = result(parts({ content_type: 'image_asset_pointer', asset_pointer: `file-service://file-${hex(24)}`, width: 1024, height: 1024, size_bytes: 1 }));
        at = result(parts(text(between(5, 20))));
      } else {
        at = result(parts(chance(0.6) ? '' : text(between(1, 15))));
      }
      return at;
    };

    /** One answer below `parent`. Returns the node the next question hangs on. */
    const answer = (parent: string): string => {
      let at = parent;
      const shown = random();
      if (shown < 0.18) at = thoughts(at);
      if (shown < 0.14 || (shown >= 0.18 && shown < 0.26)) at = thinkingLine(at);
      if (full && chance(0.22)) {
        at = toolSteps(at);
        // The thinking line of older exports often sits after the tool call of its answer.
        if (chance(0.3)) at = thinkingLine(thoughts(at));
        if (chance(0.15)) at = toolSteps(at);
      }
      const kind = random();
      if (kind < 0.05) {
        // An answer that was stopped before it had any text.
        at = assistant(at, parts(''));
        note(seen, 'empty answers');
      } else if (kind < 0.1) {
        // A spoken answer.
        at = assistant(at, parts({ content_type: 'audio_transcription', text: text(between(1, 60)), direction: 'out', decoding_id: null }, { content_type: 'audio_asset_pointer', asset_pointer: `sediment://file_${hex(24)}`, format: 'wav', size_bytes: 1 }));
      } else {
        const memory = !full && chance(0.05) ? { conversation_context_citation_metadata: [{ citation: { conversation_context_type: 'user_memory' } }] } : {};
        if (full && chance(0.1)) at = assistant(at, parts(text(between(1, 30))), { channel: 'commentary' });
        at = assistant(at, parts(text(between(1, 320)), ...(chance(0.05) ? [text(between(1, 40))] : [])), { metadata: { ...(chance(0.25) ? sources() : {}), ...memory }, channel: 'final' });
        if (chance(0.06)) at = assistant(at, parts(text(between(1, 60))), { metadata: chance(0.5) ? sources() : {} });
        if (chance(0.1)) {
          // The model says something, thinks again, and goes on: still one answer and one request.
          const between2 = random();
          at = between2 < 0.4 ? thinkingLine(at) : between2 < 0.7 ? thinkingLine(thoughts(at)) : between2 < 0.85 ? thoughts(at) : assistant(at, parts(''));
          at = assistant(at, parts(text(between(1, 120))), { metadata: chance(0.2) ? sources() : {} });
          note(seen, 'answers that go on after thinking');
        }
      }
      // A thinking line after the text of its answer, with nothing below it.
      if (chance(0.04)) thinkingLine(at);
      return at;
    };

    const root = put(null, null, shape === 'trimmed' ? 'client-created-root' : chance(0.9) ? uuid() : `${uuid()}_placeholder_parent`);
    let tip = root;
    const hidden = (content: Json, role = 'system', metadata: Json = {}) =>
      put(tip, message(role, content, { time: chance(0.85) ? null : stamp(), metadata: { is_visually_hidden_from_conversation: true, ...metadata } }));
    if (full) {
      if (chance(0.8)) tip = hidden(parts(''));
      if (chance(0.2)) {
        tip = hidden({ content_type: 'user_editable_context', user_profile: chance(0.2) ? '' : text(between(1, 60)), user_instructions: chance(0.3) ? '' : text(between(1, 120)) }, 'user', { is_user_system_message: true });
        note(seen, 'custom instructions');
      }
      if (chance(0.04)) tip = hidden({ content_type: 'app_pairing_content', workspaces: [], context_parts: [{ text: text(20) }], custom_instructions: '' }, 'user');
      if (chance(0.04)) tip = hidden({ content_type: 'model_editable_context', model_set_context: text(between(1, 80)) }, chance(0.5) ? 'system' : 'user');
    }
    // A kind of message nobody has seen yet. Older exports would show it as a tool's, newer ones as the model's.
    if (chance(0.02)) tip = put(tip, message(full ? 'tool' : 'assistant', { content_type: 'something_new', text: text(50), note: text(5) }, { name: full ? 'something.new' : null }));
    // Now and then the model speaks first.
    if (chance(0.03)) tip = answer(tip);

    const questions: string[] = [];
    const texts: string[] = [];
    for (let turns = between(1, 9); turns > 0; turns--) {
      const branch = random();
      if (branch < 0.09 && questions.length > 0) {
        // A regenerated answer: a second answer below the same question.
        tip = answer(pick(questions));
        note(seen, 'regenerated answers');
      } else if (branch < 0.16 && questions.length > 0) {
        // An edited question: a second question below the same parent.
        const q = question(parentOf.get(pick(questions)) ?? root);
        questions.push(q);
        tip = answer(q);
        note(seen, 'edited questions');
      } else if (branch < 0.18 && texts.length > 0) {
        // A fork in the middle of an answer.
        tip = assistant(pick(texts), parts(text(between(1, 40))), { metadata: chance(0.3) ? sources() : {} });
        note(seen, 'forks inside an answer');
      } else {
        const q = question(tip);
        questions.push(q);
        tip = answer(q);
      }
      texts.push(tip);
    }
    if (filesInExport) note(seen, 'conversations with file text');

    const kids = new Map<string, string[]>();
    for (const [id, parent] of parentOf) if (parent !== null) kids.set(parent, [...(kids.get(parent) ?? []), id]);
    const withKids = full ? 'filled' : pick(['absent', 'absent', 'empty']);
    for (const [id, node] of entries) {
      if (withKids === 'filled') node['children'] = kids.get(id) ?? [];
      else if (withKids === 'empty') node['children'] = [];
    }
    // Real files list the nodes by id, which is no order at all for the tree.
    if (chance(0.7)) entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    const id = uuid();
    return {
      title: chance(0.03) ? null : `Made-up conversation ${firstNumber + n}`,
      create_time: Math.round((clock - 4_000) * 1000) / 1000,
      update_time: Math.round((clock + between(0, 900)) * 1000) / 1000,
      mapping: Object.fromEntries(entries),
      current_node: tip,
      conversation_template_id: chance(0.1) ? `g-p-${hex(32)}` : null,
      default_model_slug: pick([null, 'auto', 'auto', model, 'gpt-5-6']),
      is_archived: chance(0.02),
      conversation_id: id,
      id,
    };
  };

  return { conversations: Array.from({ length: count }, (_, n) => one(n)), contentTypes, thinkingLines, seen };
}
