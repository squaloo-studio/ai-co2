// Helpers for the tests of this folder: made-up conversations, and a way to lay the reference's result
// and a Reading's totals side by side. Everything here is invented. No real export is involved.

import type { ModelUsage } from '../../../contracts/usage';
import { createAccount, type AccountOptions } from './account';
import type { CountTokens } from './count';
import type { ReferenceRows, ReferenceTotals } from './fixtures/reference.mjs';
import { NO_MODEL_NAME, totals, type Plan, type Reading, type Totals, type Window } from './reading';

/** One token per word, so that expected numbers can be worked out by hand. */
export const countWords: CountTokens = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);
export const words = (n: number): string => Array.from({ length: n }, () => 'w').join(' ');

export type Json = Record<string, unknown>;

/** A node of a conversation's mapping, as [id, node]. */
export const node = (id: string, parent: string | null, message: Json | null): [string, Json] => [id, { id, parent, message }];

export interface MessageOptions {
  /** content_type. 'text' takes its words from the count. */
  type?: string;
  /** create_time. */
  time?: unknown;
  model?: string;
  /** More fields of `content`. */
  content?: Json;
  metadata?: Json;
  recipient?: string;
  /** author.name, for tool messages. */
  name?: string;
}

/** A message of `wordCount` words. */
export function message(role: string, wordCount: number, options: MessageOptions = {}): Json {
  const type = options.type ?? 'text';
  return {
    author: { role, name: options.name ?? null },
    create_time: options.time,
    recipient: options.recipient ?? 'all',
    content: type === 'text' ? { content_type: 'text', parts: [words(wordCount)] } : { content_type: type, ...options.content },
    metadata: { ...(options.model ? { model_slug: options.model } : {}), ...options.metadata },
  };
}

export function conversation(nodes: Array<[string, Json]>, fields: Json = {}): Json {
  return { mapping: Object.fromEntries([node('root', null, null), ...nodes]), default_model_slug: 'gpt-5-6', ...fields };
}

/** Counts conversations and returns the reading. */
export function read(conversations: readonly unknown[], options: AccountOptions = {}): Reading {
  const account = createAccount({ countTokens: countWords, ...options });
  for (const c of conversations) account.add(c);
  return account.finish();
}

// ---------- side by side with the reference ----------

type Triple = [freshInput: number, cacheRead: number, output: number];
const round = (x: number) => Math.round(x * 1e6) / 1e6;

function table(rows: Iterable<{ model: string; freshInput: number; cacheRead: number; output: number }>): Record<string, Triple> {
  const out: Array<[string, Triple]> = [];
  for (const row of rows) {
    if (row.freshInput || row.cacheRead || row.output) out.push([row.model, [round(row.freshInput), round(row.cacheRead), round(row.output)]]);
  }
  return Object.fromEntries(out.sort(([a], [b]) => (a < b ? -1 : 1)));
}
const ofReference = (rows: ReferenceRows) => table(Object.entries(rows).map(([model, row]) => ({ model, ...row })));
// The reference files requests that name no model under "unknown".
const ofReading = (rows: ModelUsage[]) => table(rows.map((row) => (row.model === NO_MODEL_NAME ? { ...row, model: 'unknown' } : row)));

/** Rows, the six bases and the counts both sides have, in one shape. */
export interface Comparable {
  rows: Record<string, Triple>;
  thinking: Record<string, Triple>;
  systemPrompt: Record<string, Triple>;
  memory: Record<string, Triple>;
  search: Record<string, Triple>;
  files: Record<string, Triple>;
  cacheMisses: Record<string, Triple>;
  counts: Record<string, number>;
}

export function comparableReference(t: ReferenceTotals): Comparable {
  return {
    rows: ofReference(t.rows),
    thinking: ofReference(t.thinking),
    systemPrompt: ofReference(t.prompt),
    memory: ofReference(t.personal),
    search: ofReference(t.search),
    files: ofReference(t.files),
    cacheMisses: ofReference(t.misses),
    counts: {
      requests: t.counts.requests, cold: t.counts.cold, cut: t.counts.truncated,
      thinkingRecorded: t.counts.thinkingTimed, thinkingAssumed: t.counts.thinkingImputed,
      searchRequests: t.counts.searchAnswers, sources: t.counts.sources,
      filesWithCount: t.counts.filesExact, filesWithoutCount: t.counts.filesEstimated, images: t.counts.images,
    },
  };
}

export function comparableTotals(t: Totals): Comparable {
  return {
    rows: ofReading(t.rows),
    thinking: ofReading(t.hidden.thinking),
    systemPrompt: ofReading(t.hidden.systemPrompt),
    memory: ofReading(t.hidden.memory),
    search: ofReading(t.hidden.search),
    files: ofReading(t.hidden.files),
    cacheMisses: ofReading(t.hidden.cacheMisses),
    counts: {
      requests: t.requests, cold: t.coldRequests, cut: t.cutRequests,
      thinkingRecorded: t.thinkingRecorded, thinkingAssumed: t.thinkingAssumed,
      searchRequests: t.searchRequests, sources: t.sources,
      filesWithCount: t.filesWithCount, filesWithoutCount: t.filesWithoutCount, images: t.images,
    },
  };
}

export const comparable = (reading: Reading, window: Window | 'all', plan: Plan): Comparable =>
  comparableTotals(totals(reading, window, plan));

/**
 * The reference's 30 days end at a second. A window here ends with a day. This is the second at which
 * the reference covers the same 30 days as a window whose last day has this index.
 */
export const referenceEnd = (lastDay: number): number => (lastDay + 1) * 86_400 - 0.5;

// ---------- made-up conversations ----------

/** A small seeded generator (mulberry32), so every run makes the same conversations. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MODELS = ['gpt-5-6', 'gpt-5-6', 'gpt-5-6', 'gpt-5-5', 'gpt-5-6-thinking', 'gpt-5-6-t-mini', 'gpt-5-3-mini', 'gpt-4o', 'o3', 'gpt-5-6-pro', 'gpt-5-2'];
/** Every wording of the thinking line the reports list, and one that cannot be read. */
export const RECAP_WORDINGS = [
  'Thought for 19s', 'Thought for 1m 12s', 'Thought for 5 seconds', 'Thought for 12 seconds', 'Thought for a couple of seconds',
  'Thought for a few seconds', 'Thought for a second', 'Thought for 2 minutes', 'Thought for a minute', 'Thought for 1h 2m 3s',
  'Thought about 3 hypotheses for 5s', 'Worked for 24s', 'Worked for 1m 15s', 'Worked for a couple of seconds', 'Worked for 2m 9s', 'Nachgedacht',
];
const MIME = ['application/pdf', 'text/plain', 'text/csv', 'image/png', 'application/vnd.ms-excel'];

/**
 * One made-up conversation with whole-second times around `around` (Unix seconds): branches, edited
 * questions, regenerated answers, tool calls, thinking lines in every wording, attachments, images,
 * searches, null times, hidden messages, and now and then a node with a missing parent or a loop.
 */
export function madeUpConversation(random: () => number, n: number, around: number): Json {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const chance = (p: number) => random() < p;
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));

  const entries: Array<[string, Json]> = [];
  const users: string[] = [];
  const assistants: string[] = [];
  let serial = 0;
  let clock = Math.floor(around - between(0, 100) * 86_400 + between(0, 86_399));
  const model = pick(MODELS);
  const tick = () => {
    clock += chance(0.25) ? between(1_801, 3 * 86_400) : between(1, 900);
    return chance(0.08) ? null : clock;
  };
  const put = (parent: string | null, msg: Json | null): string => {
    const id = `c${n}-n${serial++}`;
    entries.push(node(id, parent, msg));
    return id;
  };
  const slugOf = (): Json => {
    const slug = chance(0.85) ? model : pick(MODELS);
    if (chance(0.06)) return {};
    return chance(0.05) ? { resolved_model_slug: slug } : { model_slug: slug };
  };
  const assistant = (parent: string, count: number, extra: MessageOptions = {}): string => {
    const id = put(parent, { ...message('assistant', count, { time: tick(), ...extra }), metadata: { ...slugOf(), ...extra.metadata } });
    assistants.push(id);
    return id;
  };
  const recap = (parent: string): string => {
    const metadata: Json = chance(0.15) ? { finished_duration_sec: between(0, 300) + (chance(0.3) ? 0.5 : 0) } : {};
    return assistant(parent, 0, { type: 'reasoning_recap', content: { content: pick(RECAP_WORDINGS) }, metadata });
  };
  const sources = (): Json =>
    chance(0.5) ? {} : { search_result_groups: Array.from({ length: between(1, 4) }, () => ({ domain: 'example.org', entries: Array.from({ length: between(0, 6) }, () => ({ title: 't' })) })) };

  const question = (parent: string): string => {
    const size = chance(0.04) ? between(3_000, 9_000) : chance(0.01) ? between(30_000, 45_000) : between(1, 60);
    const parts: unknown[] = [words(size)];
    const attachments: Json[] = [];
    if (chance(0.12)) {
      const id = `file-${n}-${serial}`;
      parts.unshift({ content_type: 'image_asset_pointer', asset_pointer: `sediment://${id}`, ...(chance(0.8) ? { width: between(1, 5_000), height: between(1, 5_000) } : {}) });
      if (chance(0.7)) attachments.push({ id, name: 'photo', ...(chance(0.5) ? { mime_type: 'image/jpeg' } : {}) });
    }
    if (chance(0.05)) parts.push({ content_type: 'audio_transcription', text: words(between(1, 30)), direction: 'in' });
    for (let k = chance(0.15) ? between(1, 3) : 0; k > 0; k--) {
      const old = chance(0.2);
      const size = chance(0.5) ? { [old ? 'fileSizeTokens' : 'file_token_size']: between(0, 20_000) } : {};
      attachments.push({ id: `file-${n}-${serial}-${k}`, name: 'file', [old ? 'mimeType' : 'mime_type']: pick(MIME), ...size });
    }
    const id = put(parent, {
      author: { role: 'user', name: null },
      create_time: tick(),
      content: { content_type: parts.length > 1 ? 'multimodal_text' : 'text', parts },
      metadata: attachments.length ? { attachments } : {},
    });
    users.push(id);
    return id;
  };

  /** One answer below `parent`, in one of the shapes exports show. Returns the node a follow-up hangs on. */
  const answer = (parent: string): string => {
    let at = parent;
    if (chance(0.2)) at = assistant(at, 0, { type: 'thoughts', content: { thoughts: [{ summary: 's', content: words(20) }] } });
    if (chance(0.25)) at = recap(at);
    const shape = random();
    if (shape < 0.15) {
      // A tool call, its result, and the answer after it.
      const tool = pick(['python', 'web.run', 'browser', 'bio', 'file_search']);
      at = assistant(at, between(2, 12), tool === 'python' ? { type: 'code', content: { text: words(between(2, 12)) }, recipient: tool } : { recipient: tool });
      const result =
        tool === 'python' ? message('tool', 0, { type: 'execution_output', content: { text: words(between(0, 80)) }, name: tool, time: tick() })
        : tool === 'browser' ? message('tool', 0, { type: 'tether_browsing_display', content: { result: words(between(0, 200)) }, name: tool, time: tick() })
        : message('tool', tool === 'file_search' ? between(0, 300) : 0, { name: tool, time: tick() });
      at = put(at, result);
      if (chance(0.3)) at = recap(at);
      at = assistant(at, between(1, 200), { metadata: sources() });
    } else if (shape < 0.2) {
      at = assistant(at, 0);
    } else {
      at = assistant(at, between(1, 300), { metadata: { ...sources(), ...(chance(0.05) ? { conversation_context_citation_metadata: [] } : {}) } });
      if (chance(0.1)) at = assistant(at, between(1, 50), { metadata: sources() });
      if (chance(0.05)) recap(at);
    }
    return at;
  };

  let tip = put(null, null);
  if (chance(0.3)) tip = put(tip, { ...message('system', 0, { time: null }), content: { content_type: 'text', parts: [''] } });
  if (chance(0.15)) {
    tip = put(tip, message('user', 0, { type: 'user_editable_context', time: null, content: { user_profile: words(between(0, 40)), user_instructions: words(between(0, 80)) } }));
  }
  if (chance(0.03)) tip = put(tip, message('system', 0, { type: 'model_editable_context', time: null, content: { model_set_context: words(5) } }));

  for (let turns = between(1, 12); turns > 0; turns--) {
    const branch = random();
    if (branch < 0.08 && users.length > 0) {
      // A regenerated answer: a second answer below the same question.
      tip = answer(pick(users));
    } else if (branch < 0.14 && assistants.length > 0) {
      // An edited question, or a fork in the middle of an answer.
      const from = pick(assistants);
      tip = chance(0.7) ? answer(question(from)) : assistant(from, between(1, 40), { metadata: sources() });
    } else {
      tip = answer(question(tip));
    }
  }
  if (chance(0.04)) put(`c${n}-missing`, message('assistant', between(1, 30), { time: tick(), model }));
  if (chance(0.03)) {
    entries.push(node(`c${n}-loop-a`, `c${n}-loop-b`, message('user', 5, { time: clock })));
    entries.push(node(`c${n}-loop-b`, `c${n}-loop-a`, message('assistant', 5, { time: clock, model })));
  }
  if (chance(0.3)) {
    // The order of the file must not matter for what is found, so some come shuffled.
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const [x, y] = [entries[i], entries[j]];
      if (x && y) [entries[i], entries[j]] = [y, x];
    }
  }

  return {
    id: `conversation-${n}`,
    conversation_id: `conversation-${n}`,
    title: `Made-up conversation ${n}`,
    create_time: clock - 5_000,
    update_time: clock + between(0, 600),
    current_node: tip,
    default_model_slug: pick([null, 'auto', model, 'gpt-5-6']),
    mapping: Object.fromEntries(entries),
  };
}
