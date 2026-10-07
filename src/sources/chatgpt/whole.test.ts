// Both halves of the ChatGPT reader on whole files, as a person would drop them: real ZIP archives
// built here from the two invented example exports, opened by ./files and counted by ./account with
// the real tokenizer. Every count is laid beside the expected-count file of the example and beside
// the reference implementation of the counting rule.
//
// The second part sends the same files through the worker's own entry file and the page's own
// startReading, with a stand-in for the worker's global scope and for the browser's Worker.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import currentExpected from './account/fixtures/export.current-shape.expected.json?raw';
import currentShape from './account/fixtures/export.current-shape.json?raw';
import olderExpected from './account/fixtures/export.older-shape.expected.json?raw';
import olderShape from './account/fixtures/export.older-shape.json?raw';
import { createAccount } from './account/account';
import { readExport as referenceCount } from './account/fixtures/reference.mjs';
import { madeUpExport, type Shape } from './account/made-up-export';
import { dayFromName, dayIndex, dayName, planFromExport, totals, windowEndingAt, type Plan, type Reading, type Totals, type Window } from './account/reading';
import { comparableReference, comparableTotals, referenceEnd, seeded } from './account/test-kit';
import { countO200k } from './account/tokens';
import { readExport } from './files/read-export';
import type { ExportReport, NoticeCode } from './files/report';
import { conversations as smallConversations, file, json, utf8, zip } from './files/test-kit';
import { FILE_LIMITS, progressShare, startReading, windowOf, type ReadOutcome, type ReadProgress, type WarningCode } from './index';

vi.setConfig({ testTimeout: 60_000 });

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------- the examples ----------

interface Example {
  name: string;
  /** The export file exactly as it lies in the fixtures. */
  text: string;
  conversations: Json[];
  expected: Json;
  /** The time of reading the expected file is written for, in Unix seconds. */
  now: number;
  /** The window of the expected file: from the day of its cutoff to the day of `now`. */
  window: Window;
  /** Answers without text, by model. Each is an answer and no request. */
  emptyAnswers: Record<string, number>;
  /** Tool calls the export still shows, by model. Each is a request of its own inside an answer. All lie inside the 30 days. */
  toolCalls: Record<string, number>;
}

function at(root: unknown, path: string): unknown {
  let value = root;
  for (const key of path.split('.')) {
    if (!isJson(value) || !Object.hasOwn(value, key)) throw new Error(`the expected file has nothing at ${path}`);
    value = value[key];
  }
  return value;
}

function numberAt(root: unknown, path: string): number {
  const value = at(root, path);
  if (typeof value !== 'number') throw new Error(`the expected file has no number at ${path}`);
  return value;
}

/** A table of the expected file, such as answers per model. */
function numbersAt(root: unknown, path: string): Map<string, number> {
  const value = at(root, path);
  if (!isJson(value)) throw new Error(`the expected file has no table at ${path}`);
  const out = new Map<string, number>();
  for (const [key, n] of Object.entries(value)) if (typeof n === 'number') out.set(key, n);
  return out;
}

function example(name: string, text: string, expectedText: string, rest: Pick<Example, 'emptyAnswers' | 'toolCalls'>): Example {
  const parsed: unknown = JSON.parse(text);
  const expected: unknown = JSON.parse(expectedText);
  if (!Array.isArray(parsed) || !parsed.every(isJson) || !isJson(expected)) throw new Error(`the example "${name}" is not what it should be`);
  const now = Date.parse(String(at(expected, 'now'))) / 1000;
  const window = { from: String(at(expected, 'cutoff')).slice(0, 10), to: windowEndingAt(now).to };
  return { name, text, conversations: parsed, expected, now, window, ...rest };
}

const EXAMPLES: Example[] = [
  example('current shape', currentShape, currentExpected, {
    emptyAnswers: { 'gpt-5-5': 1 },
    toolCalls: {},
  }),
  example('older shape', olderShape, olderExpected, {
    emptyAnswers: { 'gpt-5-2': 1 },
    // This shape still shows the web search and the memory note as calls of their own.
    toolCalls: { 'gpt-5-3': 1, 'gpt-5-t-mini': 1 },
  }),
];

// ---------- the files a person can drop ----------

/** user.json in the shape of a real one. Only `chatgpt_plus_user` is read. */
const userJson = (plus: boolean) => json({ id: 'user-made-up', email: 'someone@example.invalid', chatgpt_plus_user: plus, birth_year: 1990 });

/** Bytes that do not pack, standing for a picture among the attachments. */
function attachment(bytes: number): Uint8Array<ArrayBuffer> {
  const random = seeded(bytes);
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = Math.floor(random() * 256);
  return out;
}

/**
 * An export ZIP as ChatGPT sends it: the entries in alphabetical order, the attachments after the
 * conversations, the manifest last.
 */
async function exportZip(conversationFiles: Array<[name: string, data: Uint8Array<ArrayBuffer>]>, plus: boolean): Promise<Uint8Array<ArrayBuffer>> {
  return zip([
    { name: 'chat.html', data: utf8('<html><body>Made-up page</body></html>') },
    ...conversationFiles.map(([name, data]) => ({ name, data })),
    { name: 'file-0000000000000000000000-made-up.dat', data: attachment(60_000), store: true },
    { name: 'user.json', data: userJson(plus) },
    { name: 'user_settings.json', data: json({ settings: {} }) },
    { name: 'export_manifest.json', data: json({ files: [] }) },
  ]);
}

/** The conversations as one file, exactly as the fixture has them. */
const oneFile = (e: Example): Array<[string, Uint8Array<ArrayBuffer>]> => [['conversations.json', utf8(e.text)]];
/** The same in two pieces, as larger exports come. The pieces are in no order of time. */
const twoPieces = (e: Example): Array<[string, Uint8Array<ArrayBuffer>]> => [
  ['conversations-000.json', json(e.conversations.slice(1))],
  ['conversations-001.json', json(e.conversations.slice(0, 1))],
];
const bytesOf = (pieces: Array<[string, Uint8Array<ArrayBuffer>]>): number => pieces.reduce((sum, [, data]) => sum + data.byteLength, 0);

/** The container the privacy portal sends: the export is a ZIP among other things inside it. */
async function container(inner: Array<[name: string, data: Uint8Array<ArrayBuffer>]>, store: boolean): Promise<Uint8Array<ArrayBuffer>> {
  return zip([
    { name: 'report.html', data: utf8('<html><body>Made-up report</body></html>') },
    { name: 'User Online Activity/Ads__0f3a9c-ads-0001.zip', data: await zip([{ name: 'ads.json', data: json([]) }]), store: true },
    ...inner.map(([name, data]) => ({ name: `User Online Activity/${name}`, data, store })),
    { name: 'User Online Activity/Files__0f3a9c-files-0001.zip', data: await zip([{ name: 'file-made-up.dat', data: attachment(20_000), store: true }]), store: true },
    { name: 'User Profile/profile.json', data: json({ name: 'Made-up Person' }) },
  ]);
}

interface Route {
  name: string;
  files(example: Example, plus: boolean): Promise<File[]>;
  /** What the file report must say, given the bytes of JSON in one copy of the conversations. */
  totals(jsonBytes: { oneFile: number; twoPieces: number }): ExportReport['totals'];
  notices: NoticeCode[];
  /** false when user.json is lost on this route, so the plan stays unknown. */
  plan: boolean;
  /** Conversations that arrive twice. */
  duplicates: number;
}

const ROUTES: Route[] = [
  {
    name: 'one ZIP, as ChatGPT sends it',
    files: async (e, plus) => [file('chatgpt-export-made-up.zip', await exportZip(oneFile(e), plus))],
    totals: (bytes) => ({ archives: 1, conversationFiles: 1, filesWithProblems: 0, bytes: bytes.oneFile, handed: 3, skipped: 0, userFiles: 1 }),
    notices: [],
    plan: true,
    duplicates: 0,
  },
  {
    name: 'a ZIP with the conversations in two files',
    files: async (e, plus) => [file('chatgpt-export-made-up.zip', await exportZip(twoPieces(e), plus))],
    totals: (bytes) => ({ archives: 1, conversationFiles: 2, filesWithProblems: 0, bytes: bytes.twoPieces, handed: 3, skipped: 0, userFiles: 1 }),
    notices: [],
    plan: true,
    duplicates: 0,
  },
  {
    name: 'the privacy portal container, with the export stored inside',
    files: async (e, plus) => [
      file('OpenAI-export.zip', await container([['Conversations__0f3a9c-chatgpt-0001.zip', await exportZip(twoPieces(e), plus)]], true)),
    ],
    totals: (bytes) => ({ archives: 2, conversationFiles: 2, filesWithProblems: 0, bytes: bytes.twoPieces, handed: 3, skipped: 0, userFiles: 1 }),
    notices: [],
    plan: true,
    duplicates: 0,
  },
  {
    name: 'the container, with the export packed inside and in two parts',
    files: async (e, plus) => {
      const [first, second] = twoPieces(e);
      if (!first || !second) throw new Error('two pieces expected');
      return [
        file(
          'OpenAI-export.zip',
          await container(
            [
              ['Conversations__0f3a9c-chatgpt-0001-part-0001.zip', await exportZip([first], plus)],
              ['Conversations__0f3a9c-chatgpt-0001-part-0002.zip', await zip([{ name: second[0], data: second[1] }, { name: 'file-made-up.dat', data: attachment(30_000) }])],
            ],
            false,
          ),
        ),
      ];
    },
    totals: (bytes) => ({ archives: 3, conversationFiles: 2, filesWithProblems: 0, bytes: bytes.twoPieces, handed: 3, skipped: 0, userFiles: 1 }),
    notices: [],
    plan: true,
    duplicates: 0,
  },
  {
    name: 'the files of an unzipped export, dropped loose',
    files: async (e, plus) => [...twoPieces(e).map(([name, data]) => file(name, data)), file('user.json', userJson(plus)), file('chat.html', utf8('<html></html>'))],
    totals: (bytes) => ({ archives: 0, conversationFiles: 2, filesWithProblems: 0, bytes: bytes.twoPieces, handed: 3, skipped: 0, userFiles: 1 }),
    notices: ['ignored'],
    plan: true,
    duplicates: 0,
  },
  {
    name: 'a ZIP whose download was cut off in the attachments',
    files: async (e, plus) => {
      const whole = await exportZip(oneFile(e), plus);
      // The cut lies in the stored attachment: after the conversations, before user.json and the table of contents.
      return [file('chatgpt-export-made-up.zip', whole.slice(0, whole.byteLength - 30_000))];
    },
    totals: (bytes) => ({ archives: 1, conversationFiles: 1, filesWithProblems: 0, bytes: bytes.oneFile, handed: 3, skipped: 0, userFiles: 0 }),
    notices: ['rescued'],
    plan: false,
    duplicates: 0,
  },
  {
    name: 'the ZIP and a loose copy of its conversations, dropped together',
    files: async (e, plus) => [file('chatgpt-export-made-up.zip', await exportZip(oneFile(e), plus)), file('conversations.json', utf8(e.text))],
    totals: (bytes) => ({ archives: 1, conversationFiles: 2, filesWithProblems: 0, bytes: 2 * bytes.oneFile, handed: 6, skipped: 3, userFiles: 1 }),
    notices: [],
    plan: true,
    duplicates: 3,
  },
];

// ---------- reading ----------

interface Got {
  reading: Reading;
  report: ExportReport;
  /** The window of the expected file. */
  inside: Totals;
  all: Totals;
}

const sums = (e: Example, reading: Reading, plan: Plan = 'paid'): Pick<Got, 'inside' | 'all'> => ({
  inside: totals(reading, e.window, plan),
  all: totals(reading, 'all', plan),
});

/** The reader of ./files and the counting of ./account together, as the worker runs them. */
async function read(e: Example, files: File[]): Promise<Got> {
  const account = createAccount({ now: e.now, calendar: 'utc' });
  const report = await readExport(files, account);
  const reading = account.finish();
  return { reading, report, ...sums(e, reading) };
}

/** The same conversations handed to the counting side without any file. */
function countDirectly(conversations: readonly unknown[], now: number): Reading {
  const account = createAccount({ now, calendar: 'utc' });
  for (const c of conversations) account.add(c);
  return account.finish();
}

const warning = (reading: Reading, code: WarningCode): number => reading.warnings.find((w) => w.code === code)?.count ?? 0;

/**
 * A reading without what only the files can tell (the plan, and what came twice), and with its
 * conversations in a fixed order: their order means nothing and follows the order of the files.
 */
const counted = (reading: Reading): unknown => ({
  ...reading,
  plusUser: null,
  warnings: reading.warnings.filter((w) => w.code !== 'duplicate-conversation'),
  conversationDays: reading.conversationDays.map((days) => days.join(' ')).sort(),
});

// ---------- the expected-count files ----------

/** Every count of the expected file that the reading carries as a number of its own. */
const COUNTS: ReadonlyArray<readonly [path: string, got: (g: Got, e: Example) => number]> = [
  ['window_days', (_g, e) => dayFromName(windowEndingAt(e.now).to) - dayFromName(windowEndingAt(e.now).from) + 1],
  ['conversations.total', (g) => g.reading.conversations],
  ['conversations.with_custom_instructions_visible', (g) => g.reading.conversationsWithCustomInstructions],
  ['conversations.inside_30_days_by_any_message', (g) => g.inside.conversations],
  ['messages.total', (g) => g.all.messages],
  ['messages.inside_30_days', (g) => g.inside.messages],
  ['messages.outside_30_days', (g) => g.all.messages - g.inside.messages],
  ['messages.with_millisecond_create_time', (g) => warning(g.reading, 'time-in-milliseconds')],
  ['messages.dated_in_the_future', (g) => g.reading.undated.messages],
  ['user_prompts.total', (g) => g.all.prompts],
  ['user_prompts.inside_30_days', (g) => g.inside.prompts],
  ['user_prompts.outside_30_days', (g) => g.all.prompts - g.inside.prompts],
  ['answers.total', (g) => g.all.answers],
  ['answers.inside_30_days', (g) => g.inside.answers],
  ['answers.outside_30_days', (g) => g.all.answers - g.inside.answers],
  ['answers.thinking_by_evidence.count', (g) => g.all.thinkingRecorded],
  ['answers.thinking_by_evidence.inside_30_days', (g) => g.inside.thinkingRecorded],
  ['answers.thinking_by_evidence.seconds_from_export', (g) => g.all.thinkingSeconds],
  ['answers.thinking_by_evidence.seconds_inside_30_days', (g) => g.inside.thinkingSeconds],
  ['answers.thinking_by_slug_only.count', (g) => g.all.thinkingAssumed],
  ['answers.thinking_by_slug_only.inside_30_days', (g) => g.inside.thinkingAssumed],
  ['answers.with_web_search.count', (g) => g.all.searchRequests],
  ['answers.with_web_search.inside_30_days', (g) => g.inside.searchRequests],
  ['answers.with_unknown_thinking_time', (g) => warning(g.reading, 'thinking-time-unreadable')],
  ['attachments.total', (g) => g.all.filesWithCount + g.all.filesWithoutCount + g.all.images],
  ['attachments.inside_30_days', (g) => g.inside.filesWithCount + g.inside.filesWithoutCount + g.inside.images],
  ['attachments.with_token_size', (g) => g.all.filesWithCount],
];

/** Counts of the expected file that a test of its own below compares, because they need more than one number. */
const COMPARED_BELOW = [
  'answers.by_model',
  'answers.by_model_inside_30_days',
  'answers.by_model_outside_30_days',
  'answers.empty',
  'answers.citing_memory',
  'messages.per_conversation',
  'attachments.token_sizes_sum',
  'attachments.by_mime_type',
];

/**
 * Counts of the expected file that the reading does not carry, because the page's maths never asks
 * for them. Nothing can be laid beside them here.
 */
const NOT_CARRIED = [
  'conversations.archived',
  'conversations.in_a_project',
  'messages.by_role',
  'messages.on_current_path',
  'messages.off_current_path',
  'messages.with_null_create_time',
  'messages.hidden_context',
  'messages.parent_id_naming_a_node_not_in_the_file',
  'answers.on_current_path',
  'answers.off_current_path',
  'answers.with_web_search.search_queries_visible',
  'assistant_messages_by_model',
  'attachments.user_prompts_with_attachments',
  // Characters are not kept: the reading has tokens.
  'text_chars',
];

/** The path of every number in the expected file. */
function numberPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'number') return [prefix];
  if (!isJson(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => numberPaths(child, prefix === '' ? key : `${prefix}.${key}`));
}

const under = (path: string, prefixes: readonly string[]): boolean => prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}.`));

// ---------- the reference ----------

const PLANS: ReadonlyArray<readonly [Plan, boolean]> = [['paid', true], ['free', false]];

/**
 * The token rows, the six bases and the counts of this reader beside the reference's, on both plans:
 * for the 30 days up to and with `lastDay`, and for the whole export. `end` is the last moment of
 * that day as the reference takes it.
 */
function expectTheReferenceRows(reading: Reading, conversations: readonly unknown[], lastDay: number, end: number, label: string): void {
  const window = { from: dayName(lastDay - 29), to: dayName(lastDay) };
  for (const [plan, plus] of PLANS) {
    const reference = referenceCount(conversations, { countTokens: countO200k, plus, exportTime: end });
    expect(comparableTotals(totals(reading, window, plan)), `${label}: the 30 days, ${plan}`).toEqual(comparableReference(reference.window));
    expect(comparableTotals(totals(reading, 'all', plan)), `${label}: the whole export, ${plan}`).toEqual(comparableReference(reference.all));
  }
}

const theZip = async (e: Example, plus = true): Promise<File> => file('chatgpt-export-made-up.zip', await exportZip(oneFile(e), plus));
const table = (counts: Map<string, number>): Record<string, number> => Object.fromEntries([...counts].filter(([, n]) => n !== 0).sort(([a], [b]) => (a < b ? -1 : 1)));
const sumOf = (counts: Record<string, number>): number => Object.values(counts).reduce((a, b) => a + b, 0);

describe.each(EXAMPLES)('the invented example export as whole files, $name', (e) => {
  const want = (path: string): number => numberAt(e.expected, path);
  const jsonBytes = { oneFile: bytesOf(oneFile(e)), twoPieces: bytesOf(twoPieces(e)) };

  it.each(ROUTES)('$name: every count is the expected one', async (route) => {
    const got = await read(e, await route.files(e, true));

    for (const [path, count] of COUNTS) expect(count(got, e), path).toBe(want(path));

    // The same reading as without any file in between.
    expect(counted(got.reading)).toEqual(counted(countDirectly(e.conversations, e.now)));
    expect(warning(got.reading, 'duplicate-conversation')).toBe(route.duplicates);
    expect(got.reading.plusUser).toBe(route.plan ? true : null);

    expectTheReferenceRows(got.reading, e.conversations, dayIndex(e.now), referenceEnd(dayIndex(e.now)), route.name);

    expect(got.report.totals).toEqual(route.totals(jsonBytes));
    expect(got.report.notices.map((notice) => notice.code)).toEqual(route.notices);
    expect(got.report.files.map((f) => f.problem)).toEqual(got.report.files.map(() => null));
  });

  it('compares every number of the expected file, or says why not', () => {
    const paths = numberPaths(e.expected);
    expect(paths.length).toBeGreaterThan(50);
    for (const path of paths) {
      const places = [COUNTS.some(([compared]) => compared === path), under(path, COMPARED_BELOW), under(path, NOT_CARRIED)];
      expect(places.filter(Boolean), path).toHaveLength(1);
    }
    for (const [path] of COUNTS) expect(paths, path).toContain(path);
  });

  it('has one request for every answer with text, and one more for every tool call the export still shows', async () => {
    const got = await read(e, [await theZip(e)]);
    const requests = (t: Totals): Map<string, number> => new Map(t.requestsByModel.map((row) => [row.model, row.requests]));
    /** Answers per model from the expected file, with some taken away and some added. */
    const fromAnswers = (path: string, less: Record<string, number>, more: Record<string, number>): Record<string, number> => {
      const out = numbersAt(e.expected, path);
      for (const [model, n] of Object.entries(less)) out.set(model, (out.get(model) ?? 0) - n);
      for (const [model, n] of Object.entries(more)) out.set(model, (out.get(model) ?? 0) + n);
      return table(out);
    };
    expect(table(requests(got.all))).toEqual(fromAnswers('answers.by_model', e.emptyAnswers, e.toolCalls));
    expect(table(requests(got.inside))).toEqual(fromAnswers('answers.by_model_inside_30_days', {}, e.toolCalls));
    const outside = requests(got.all);
    for (const [model, n] of requests(got.inside)) outside.set(model, (outside.get(model) ?? 0) - n);
    expect(table(outside)).toEqual(fromAnswers('answers.by_model_outside_30_days', e.emptyAnswers, {}));

    expect(sumOf(e.emptyAnswers)).toBe(want('answers.empty'));
    expect(got.all.answers - (got.all.requests - sumOf(e.toolCalls))).toBe(want('answers.empty'));
  });

  it('counts each conversation by itself as the expected file lists it', async () => {
    for (const conversation of e.conversations) {
      const title = String(conversation['title']);
      const got = await read(e, [file('one-conversation.zip', await exportZip([['conversations.json', json([conversation])]], true))]);
      expect(got.reading.conversations, title).toBe(1);
      expect(got.all.messages, title).toBe(want(`messages.per_conversation.${title}.total`));
      expect(got.inside.messages, title).toBe(want(`messages.per_conversation.${title}.inside_30_days`));
    }
  });

  it('sees memory in use, in the way this shape shows it', async () => {
    const got = await read(e, [await theZip(e)]);
    // A cited memory in the current shape, a memory being written in the older one.
    expect(got.all.memoryMessages).toBe(want('answers.citing_memory.count') + want('answers.citing_memory.memory_writes_visible'));
    expect(got.all.memoryMessages).toBeGreaterThan(0);
    expect(got.reading.memorySeen).toBe(true);
    expect(got.inside.evidence).toEqual({ thinking: 'recorded', memoryInUse: true, searchOrFiles: true });
  });

  it('counts pictures as images and the other attachments as files', async () => {
    const got = await read(e, [await theZip(e)]);
    let pictures = 0;
    let others = 0;
    for (const [type, n] of numbersAt(e.expected, 'attachments.by_mime_type')) {
      if (type.startsWith('image/')) pictures += n;
      else others += n;
    }
    expect(got.all.images).toBe(pictures);
    expect(got.all.filesWithCount + got.all.filesWithoutCount).toBe(others);
  });

  it('counts the token size the export gives for the PDF as new input, once', async () => {
    const size = want('attachments.token_sizes_sum');
    const compact = JSON.stringify(e.conversations);
    expect(compact).toContain(`"file_token_size":${size}`);
    const withoutSize: unknown = JSON.parse(compact.replaceAll(`"file_token_size":${size}`, '"file_token_size":null'));
    const newInput = (reading: Reading): number =>
      [...reading.days, reading.undated].reduce((sum, day) => sum + day.models.reduce((inDay, model) => inDay + model.newInput, 0), 0);

    const withSize = await read(e, [await theZip(e)]);
    const without = await read(e, [file('chatgpt-export-made-up.zip', await exportZip([['conversations.json', json(withoutSize)]], true))]);
    expect(newInput(withSize.reading) - newInput(without.reading)).toBe(size);
    expect([withSize.all.filesWithCount, withSize.all.filesWithoutCount]).toEqual([1, 0]);
    expect([without.all.filesWithCount, without.all.filesWithoutCount]).toEqual([0, 1]);
  });

  it('gives the same with an empty children list on every node', async () => {
    const withChildren = e.conversations.map((conversation) => {
      const mapping = conversation['mapping'];
      if (!isJson(mapping)) throw new Error('a conversation of the example has no mapping');
      return { ...conversation, mapping: Object.fromEntries(Object.entries(mapping).map(([id, node]) => [id, isJson(node) ? { ...node, children: [] } : node])) };
    });
    const changed = await read(e, [file('chatgpt-export-made-up.zip', await exportZip([['conversations.json', json(withChildren)]], true))]);
    expect(changed.reading).toEqual((await read(e, [await theZip(e)])).reading);
  });

  it('gives the same counts for the expected file\'s window and for the 30 calendar days that end today', async () => {
    const { reading } = await read(e, [await theZip(e)]);
    expect(totals(reading, windowEndingAt(e.now), 'paid')).toEqual(totals(reading, e.window, 'paid'));
  });

  it('takes the plan from user.json, and leaves it open without one', async () => {
    const plus = await read(e, [await theZip(e, true)]);
    const free = await read(e, [await theZip(e, false)]);
    const unknown = await read(e, [file('conversations.json', utf8(e.text))]);
    expect([plus.reading.plusUser, free.reading.plusUser, unknown.reading.plusUser]).toEqual([true, false, null]);
    expect([planFromExport(plus.reading), planFromExport(free.reading), planFromExport(unknown.reading)]).toEqual(['paid', 'free', 'paid']);
    expect([plus.report.totals.userFiles, free.report.totals.userFiles, unknown.report.totals.userFiles]).toEqual([1, 1, 0]);
    // The flag is all that user.json changes.
    expect(counted(free.reading)).toEqual(counted(plus.reading));
  });
});

// ---------- what the two halves say about the same files ----------

/** Every number anywhere in a value. */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  return isJson(value) ? Object.values(value).flatMap(numbersIn) : [];
}

describe('a drop with copies, junk and a hostile conversation', () => {
  const e = EXAMPLES[0];
  if (!e) throw new Error('no example');
  const [first] = e.conversations;
  if (!first) throw new Error('the example has no conversation');

  // The first conversation again, changed and saved later: the newer copy must replace the one in the ZIP.
  const newerCopy = { ...first, update_time: e.now - 60, mapping: {} };
  const JUNK = [1, 'x', null, {}, { id: 'no-mapping', mapping: 'x' }];
  // Written as text: an object in code cannot hold a field named "__proto__" as a real export can.
  const hostile = `{
    "id": "hostile-made-up", "create_time": ${e.now - 3_600}, "update_time": ${e.now - 3_000}, "default_model_slug": "constructor",
    "mapping": {
      "__proto__": { "id": "__proto__", "parent": null, "message": null },
      "constructor": { "id": "constructor", "parent": "__proto__", "message": { "author": { "role": "user" }, "create_time": ${e.now - 3_600}, "content": { "content_type": "text", "parts": ["A made-up question?"] } } },
      "toString": { "id": "toString", "parent": "constructor", "message": { "author": { "role": "assistant" }, "create_time": 1e999, "content": { "content_type": "text", "parts": ["A made-up answer."] }, "metadata": { "model_slug": "__proto__" } } },
      "loop-a": { "id": "loop-a", "parent": "loop-b", "message": { "author": { "role": "user" }, "content": { "content_type": "text", "parts": ["never reached"] } } },
      "loop-b": { "id": "loop-b", "parent": "loop-a", "message": null }
    }
  }`;
  const loose = utf8(`[${[...e.conversations, newerCopy, ...JUNK].map((value) => JSON.stringify(value)).join(',')},${hostile}]`);

  it('counts each conversation once, and both halves agree on what was passed over', async () => {
    const got = await read(e, [await theZip(e), file('conversations.json', loose)]);
    const { totals: files } = got.report;

    // 3 in the ZIP. In the loose file: 3 copies, 1 newer copy, 5 that are no conversation, 1 hostile one.
    expect(files).toMatchObject({ archives: 1, conversationFiles: 2, filesWithProblems: 0, handed: 13, skipped: 8, userFiles: 1 });
    expect(got.reading.conversations).toBe(4);
    expect(warning(got.reading, 'duplicate-conversation')).toBe(4);
    expect(warning(got.reading, 'not-a-conversation')).toBe(JUNK.length);
    // What the file report calls "skipped" is every copy that lost and everything that is no
    // conversation. A copy that won was taken, so the notes about copies come from the warnings.
    expect(files.handed - files.skipped).toBe(got.reading.conversations + 1);
    expect(files.skipped).toBe(3 + warning(got.reading, 'not-a-conversation'));

    // The newer copy has no messages left, so its conversation gives nothing any more.
    const parsedHostile: unknown = JSON.parse(hostile);
    expect(counted(got.reading)).toEqual(counted(countDirectly([...e.conversations.slice(1), newerCopy, ...JUNK, parsedHostile], e.now)));

    // The hostile one: its answer has a time that is no number and a model name that is no name.
    expect(got.all.requestsByModel).toContainEqual({ model: 'constructor', requests: 1 });
    expect(warning(got.reading, 'model-name-ignored')).toBe(1);
    expect(warning(got.reading, 'unreachable-message')).toBe(2);
    for (const value of [got.reading, got.inside, got.all, totals(got.reading, 'all', 'free'), got.report]) {
      const numbers = numbersIn(value);
      expect(numbers.length).toBeGreaterThan(10);
      expect(numbers.filter((n) => !Number.isFinite(n) || n < 0)).toEqual([]);
    }
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
});

// ---------- the 30 days ----------

describe('the last 30 days, from the time the read was given', () => {
  const DAY = 86_400;
  // 22:00 on 7 Oct 2026, so that three hours later is already tomorrow.
  const now = Date.UTC(2026, 9, 7, 22) / 1000;
  /** A made-up conversation of one question and one answer at `time`. */
  const turn = (id: string, time: number): Json => ({
    id,
    conversation_id: id,
    title: `Made-up chat ${id}`,
    create_time: time,
    update_time: time + 30,
    current_node: 'a',
    mapping: {
      root: { id: 'root', parent: null, message: null },
      q: { id: 'q', parent: 'root', message: { author: { role: 'user' }, create_time: time, content: { content_type: 'text', parts: ['A made-up question?'] }, metadata: {} } },
      a: { id: 'a', parent: 'q', message: { author: { role: 'assistant' }, create_time: time + 30, content: { content_type: 'text', parts: ['A made-up answer.'] }, metadata: { model_slug: 'gpt-5-6' } } },
    },
  });
  const startOfToday = Date.UTC(2026, 9, 7) / 1000;
  const conversations = [
    turn('the-day-before-the-first', startOfToday - 29 * DAY - 120),
    turn('the-first-day', startOfToday - 29 * DAY + 10),
    turn('today', now - 3_600),
    turn('three-hours-ahead', now + 3 * 3_600),
    turn('two-days-ahead', now + 2 * DAY),
  ];

  it('are 29 whole days and today, and can take in a clock that is a few hours behind', async () => {
    const account = createAccount({ now, calendar: 'utc' });
    await readExport([file('chatgpt-export-made-up.zip', await exportZip([['conversations.json', json(conversations)]], true))], account);
    const reading = account.finish();

    const thirty = windowOf(reading, now);
    expect(thirty).toEqual({ from: '2026-09-08', to: '2026-10-07' });
    expect(totals(reading, thirty, 'paid').requests).toBe(2);

    // A request stamped a few hours ahead lies on tomorrow's date. A window that keeps its first day
    // and ends a day later takes it in. One stamped more than a day ahead is on no day at all.
    const withTomorrow = { from: thirty.from, to: windowOf(reading, now + DAY).to };
    expect(withTomorrow).toEqual({ from: '2026-09-08', to: '2026-10-08' });
    expect(totals(reading, withTomorrow, 'paid').requests).toBe(3);
    expect(totals(reading, 'all', 'paid').requests).toBe(5);
    expect(warning(reading, 'request-in-future')).toBe(1);
    expect(reading.undated.models.map((model) => model.requests)).toEqual([1]);
  });
});

// ---------- a larger export ----------

describe('a made-up export of 250 conversations, in pieces of 100 as real exports come', () => {
  // Older exports end in spring 2026 and newer ones in autumn, as the real ones do.
  const LAST_DAY: Record<Shape, number> = { full: dayIndex(Date.UTC(2026, 3, 6) / 1000), trimmed: dayIndex(Date.UTC(2026, 9, 7) / 1000) };
  /** The made-up times have milliseconds. This is the last moment of a day that such a time can have. */
  const endOf = (day: number): number => (day + 1) * 86_400 - 0.0005;

  it.each<Shape>(['trimmed', 'full'])('comes out of the ZIP as it went in: the %s shape', async (shape) => {
    const end = endOf(LAST_DAY[shape]);
    const { conversations } = madeUpExport(seeded(LAST_DAY[shape]), shape, 250, end);
    const pieces: Array<[string, Uint8Array<ArrayBuffer>]> = [];
    for (let from = 0; from < conversations.length; from += 100) {
      pieces.push([`conversations-${String(pieces.length).padStart(3, '0')}.json`, json(conversations.slice(from, from + 100))]);
    }
    // Far enough ahead that no made-up time lies in the future, which the reference does not know.
    const now = end + 2_000 * 86_400;

    const account = createAccount({ now, calendar: 'utc' });
    const report = await readExport([file('chatgpt-export-made-up.zip', await exportZip(pieces, false))], account);
    const reading = account.finish();

    // Words in other scripts, emoji, citation marks and control-token strings all pass through the
    // unpacking and the parser unchanged: the counts are those of the conversations handed over directly.
    expect(counted(reading)).toEqual(counted(countDirectly(conversations, now)));
    expect(reading.plusUser).toBe(false);
    expect(reading.conversations).toBe(250);
    expectTheReferenceRows(reading, conversations, LAST_DAY[shape], end, shape);

    expect(report.totals).toEqual({ archives: 1, conversationFiles: 3, filesWithProblems: 0, bytes: bytesOf(pieces), handed: 250, skipped: 0, userFiles: 1 });
    expect(report.files.map((f) => [f.path.at(-1), f.handed, f.problem])).toEqual([
      ['conversations-000.json', 100, null],
      ['conversations-001.json', 100, null],
      ['conversations-002.json', 50, null],
    ]);
    expect(report.notices).toEqual([]);
    expect(totals(reading, 'all', 'paid').requests).toBeGreaterThan(1_000);
  });
});

// ---------- through the worker ----------

interface StandInScope {
  /** Hands a message to the worker's code, as the page's postMessage does. */
  send(message: unknown): void;
  /** Everything the worker's code posted, copied as on its way between two threads. */
  posted: unknown[];
  /** Resolves when the worker's code has posted its last message. */
  lastWord: Promise<void>;
}

let loading: Promise<unknown> = Promise.resolve();

/**
 * Loads the worker's own entry file against a stand-in for its global scope. The file reads `self`
 * once, when it is loaded, so the loads go one at a time and each gets a scope of its own.
 */
function runWorkerFile(onPost: (copy: unknown) => void = () => {}): StandInScope {
  const inbox = new EventTarget();
  const posted: unknown[] = [];
  let said: () => void = () => {};
  let broke: (reason: unknown) => void = () => {};
  const lastWord = new Promise<void>((resolve, reject) => {
    said = resolve;
    broke = reject;
  });
  const scope = {
    postMessage(message: unknown): void {
      const copy: unknown = structuredClone(message);
      posted.push(copy);
      onPost(copy);
      if (isJson(copy) && copy['type'] !== 'progress') said();
    },
    addEventListener(type: string, listener: (event: Event) => void): void {
      inbox.addEventListener(type, listener);
    },
  };
  const loaded = loading.then(async () => {
    vi.stubGlobal('self', scope);
    vi.resetModules();
    await import('./files/worker');
  });
  loading = loaded.catch(broke);
  return {
    send: (message) => void loaded.then(() => inbox.dispatchEvent(new MessageEvent('message', { data: message })), broke),
    posted,
    lastWord,
  };
}

/** A stand-in for the browser's Worker: the worker's real code behind it, and every message copied on its way. */
class StandInWorker {
  static made: StandInWorker[] = [];
  readonly address: string;
  readonly options: WorkerOptions | undefined;
  /** What the page sent, as it arrives in the worker. */
  readonly sent: unknown[] = [];
  readonly scope: StandInScope;
  terminated = false;
  readonly #toPage = new EventTarget();

  constructor(address: string | URL, options?: WorkerOptions) {
    this.address = String(address);
    this.options = options;
    // A worker that was ended is gone: nothing it would still say arrives.
    this.scope = runWorkerFile((copy) => {
      if (!this.terminated) this.#toPage.dispatchEvent(new MessageEvent('message', { data: copy }));
    });
    StandInWorker.made.push(this);
  }

  postMessage(message: unknown): void {
    // Node copies a File into a Blob without a name, so the files are handed over as they are.
    // The rest is copied as a browser copies it: a function among the options throws here.
    const { files, ...rest } = isJson(message) ? message : {};
    const copy = { ...structuredClone(rest), files };
    this.sent.push(copy);
    this.scope.send(copy);
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.#toPage.addEventListener(type, listener);
  }
}

const routeNamed = (start: string): Route => {
  const route = ROUTES.find((candidate) => candidate.name.startsWith(start));
  if (!route) throw new Error(`no route named ${start}`);
  return route;
};

const lastMade = (): StandInWorker => {
  const worker = StandInWorker.made.at(-1);
  if (!worker) throw new Error('no worker was started');
  return worker;
};

describe('the same files through the worker', () => {
  beforeAll(() => {
    vi.stubGlobal('Worker', StandInWorker);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it.each(EXAMPLES)('the worker file answers a request with the reading and the report: $name', async (e) => {
    const files = await routeNamed('the privacy portal container').files(e, true);
    const worker = runWorkerFile();
    worker.send({ type: 'read', files, options: { now: e.now, calendar: 'utc' } });
    await worker.lastWord;

    const direct = await read(e, files);
    const last = worker.posted.at(-1);
    expect(last).toEqual({ type: 'done', reading: direct.reading, report: direct.report });
    // Progress first, a few times a second, then the one last message.
    const before = worker.posted.slice(0, -1);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((message) => isJson(message) && message['type'] === 'progress')).toBe(true);
    expect(before.at(-1)).toMatchObject({ progress: { conversations: 3, bytesRead: direct.report.totals.bytes } });
  });

  it.each(EXAMPLES)('the worker file counts from the time it is given, not from its own clock: $name', async (e) => {
    // Read 200 days too early, every message of the example lies in the future and gets no day.
    const early = e.now - 200 * 86_400;
    const worker = runWorkerFile();
    worker.send({ type: 'read', files: [await theZip(e)], options: { now: early, calendar: 'utc' } });
    await worker.lastWord;

    const last = worker.posted.at(-1);
    const reading = isJson(last) ? last['reading'] : null;
    expect(reading).toMatchObject({ conversations: 3, days: [], undated: { messages: numberAt(e.expected, 'messages.total') } });
    const account = createAccount({ now: early, calendar: 'utc' });
    await readExport([await theZip(e)], account);
    expect(reading).toEqual(account.finish());
  });

  it.each(EXAMPLES)('startReading gives the page the expected counts: $name', async (e) => {
    const files = await routeNamed('the container, with the export packed inside').files(e, false);
    const progress: ReadProgress[] = [];
    const job = startReading(files, (p) => progress.push(p), { now: e.now, calendar: 'utc' });
    const outcome: ReadOutcome = await job.result;
    if (!outcome.ok) throw new Error(`the read failed: ${outcome.code}`);

    const worker = lastMade();
    expect(worker.address).toMatch(/\/files\/worker\.ts$/);
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.sent).toEqual([{ type: 'read', files, options: { now: e.now, calendar: 'utc' } }]);
    // The job ends its worker with the last message: that frees the tokenizer and the open files.
    expect(worker.terminated).toBe(true);

    const got: Got = { reading: outcome.reading, report: outcome.report, ...sums(e, outcome.reading) };
    for (const [path, count] of COUNTS) expect(count(got, e), path).toBe(numberAt(e.expected, path));
    expect(planFromExport(outcome.reading)).toBe('free');
    expectTheReferenceRows(outcome.reading, e.conversations, dayIndex(e.now), referenceEnd(dayIndex(e.now)), e.name);
    const direct = await read(e, files);
    expect(outcome).toEqual({ ok: true, reading: direct.reading, report: direct.report });

    const last = progress.at(-1);
    expect(last).toMatchObject({ conversations: 3, bytesRead: direct.report.totals.bytes });
    expect(last === undefined ? -1 : progressShare(last)).toBe(0.99);
  });

  it('startReading counts in the person\'s own calendar from the moment of the call, unless told otherwise', async () => {
    const before = Date.now() / 1000;
    const job = startReading([file('conversations.json', json(smallConversations(0, 2)))], () => {});
    const outcome = await job.result;
    const after = Date.now() / 1000;

    const sent = lastMade().sent[0];
    const options = isJson(sent) ? sent['options'] : null;
    if (!isJson(options)) throw new Error('no options were sent');
    expect(Object.keys(options).sort()).toEqual(['calendar', 'now']);
    expect(options['calendar']).toBe('local');
    expect(options['now']).toBeGreaterThanOrEqual(before);
    expect(options['now']).toBeLessThanOrEqual(after);
    expect(outcome.ok && outcome.reading.calendar).toBe('local');
    expect(outcome.ok && outcome.reading.conversations).toBe(2);
  });

  it('a read that gives no result ends with a code', async () => {
    const tooMany = Array.from({ length: FILE_LIMITS.maxDroppedFiles + 1 }, (_, n) => file(`part-${String(n).padStart(3, '0')}.zip`, json([])));
    expect(await startReading(tooMany, () => {}).result).toEqual({ ok: false, code: 'too-many-files' });
    expect(lastMade().terminated).toBe(true);
  });

  it('cancel ends the worker at once, and nothing it still says arrives', async () => {
    // Large enough that the read is far from done when the first progress message arrives.
    const large = file('chatgpt-export-made-up.zip', await zip([{ name: 'conversations.json', data: json(smallConversations(0, 3_000, 100)) }]));
    let heard = 0;
    let job: ReturnType<typeof startReading> | null = null;
    job = startReading(
      [large],
      () => {
        heard++;
        job?.cancel();
      },
      { now: 1_790_300_000, calendar: 'utc' },
    );
    expect(await job.result).toEqual({ ok: false, code: 'cancelled' });
    const worker = lastMade();
    expect(worker.terminated).toBe(true);
    expect(heard).toBe(1);

    // A real worker is gone now. The stand-in's code cannot be stopped, so it reads on to its end:
    // what it posts from here on must not reach the page.
    await worker.scope.lastWord;
    const last = worker.scope.posted.at(-1);
    expect(last).toMatchObject({ type: 'done', reading: { conversations: 3_000 } });
    expect(worker.scope.posted.length).toBeGreaterThan(2);
    expect(heard).toBe(1);
    job.cancel();
    expect(await job.result).toEqual({ ok: false, code: 'cancelled' });
  });
});

// ---------- what the page downloads ----------

const SOURCES = import.meta.glob<string>('./**/*.ts', { query: '?raw', import: 'default', eager: true });

interface Loaded {
  /** Packages loaded together with the file. */
  packages: string[];
  /** Packages loaded later, on demand. */
  later: string[];
  /** Files started as a worker: fetched when the worker starts, not with the page. */
  workers: string[];
  /** Files outside this folder. */
  outside: string[];
}

/** What a file loads when it runs, itself and through the files it imports. An import of types loads nothing. */
function loadedBy(entry: string): Loaded {
  const out: Loaded = { packages: [], later: [], workers: [], outside: [] };
  const seen = new Set<string>();
  const queue = [entry];
  const note = (list: string[], name: string): void => {
    if (!list.includes(name)) list.push(name);
  };
  const resolve = (from: string, specifier: string): string | null => {
    const parts = from.split('/').slice(0, -1);
    for (const part of specifier.split('/')) {
      if (part === '..') {
        if (parts.length <= 1) return null;
        parts.pop();
      } else if (part !== '.') parts.push(part);
    }
    const path = parts.join('/');
    return [path, `${path}.ts`, `${path}/index.ts`].find((candidate) => Object.hasOwn(SOURCES, candidate)) ?? null;
  };
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const source = SOURCES[file];
    if (source === undefined) throw new Error(`no source for ${file}`);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const follow = (specifier: string | undefined, packages: string[]): void => {
      if (specifier === undefined) return;
      if (!specifier.startsWith('.')) return note(packages, specifier);
      const target = resolve(file, specifier.replace(/\?raw$/, ''));
      if (target === null) note(out.outside, specifier);
      else if (!specifier.endsWith('?raw')) queue.push(target);
    };
    for (const match of code.matchAll(/^(?:import|export)\s+(type\s)?[^'";]*?\bfrom\s+'([^']+)'/gm)) {
      if (match[1] === undefined) follow(match[2], out.packages);
    }
    for (const match of code.matchAll(/^import\s+'([^']+)'/gm)) follow(match[1], out.packages);
    for (const match of code.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) follow(match[1], out.later);
    for (const match of code.matchAll(/new URL\(\s*'([^']+)'\s*,\s*import\.meta\.url\s*\)/g)) {
      const target = match[1] === undefined ? null : resolve(file, match[1]);
      if (target !== null) note(out.workers, target);
    }
  }
  return out;
}

describe('what the page loads', () => {
  it('is none of the libraries: they are all in the worker\'s file', () => {
    expect(loadedBy('./index.ts')).toEqual({ packages: [], later: [], workers: ['./files/worker.ts'], outside: [] });
    const worker = loadedBy('./files/worker.ts');
    expect(worker.packages.sort()).toEqual(['@streamparser/json', '@zip.js/zip.js/lib/zip-core-custom.js', 'gpt-tokenizer/encoding/o200k_base']);
    // Only needed for a packed ZIP inside a ZIP and for a cut-off download, so most people never fetch it.
    expect(worker.later).toEqual(['fflate']);
    expect(worker.workers).toEqual([]);
  });
});
