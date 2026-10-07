import { describe, expect, it } from 'vitest';
import currentExpected from './fixtures/export.current-shape.expected.json?raw';
import currentShape from './fixtures/export.current-shape.json?raw';
import olderExpected from './fixtures/export.older-shape.expected.json?raw';
import olderShape from './fixtures/export.older-shape.json?raw';
import { createAccount } from './account';
import { dayName, totals, type Reading, type Totals } from './reading';

type Json = Record<string, unknown>;

/** A number from the expected file, by its path. */
function expected(file: string, path: string): number {
  let at: unknown = JSON.parse(file);
  for (const key of path.split('.')) at = (at as Json)[key];
  if (typeof at !== 'number') throw new Error(`no number at ${path}`);
  return at;
}

interface Example {
  name: string;
  file: string;
  expected: string;
  requests: Record<string, number>;
  requestsInside: Record<string, number>;
}

const EXAMPLES: Example[] = [
  {
    name: 'current shape',
    file: currentShape,
    expected: currentExpected,
    // One request per answer that has text. The empty answer of gpt-5-5 wrote nothing, so it is an answer and no request.
    requests: { 'gpt-5-6': 5, 'gpt-5-5-thinking': 1, 'gpt-5-6-t-mini': 1, 'gpt-5-5': 2 },
    requestsInside: { 'gpt-5-6': 5, 'gpt-5-6-t-mini': 1 },
  },
  {
    name: 'older shape',
    file: olderShape,
    expected: olderExpected,
    // The same, plus two tool calls that this shape still shows: the web search and the memory note.
    requests: { 'gpt-5-3': 6, 'gpt-5-2-thinking': 1, 'gpt-5-t-mini': 2, 'gpt-5-2': 2 },
    requestsInside: { 'gpt-5-3': 6, 'gpt-5-t-mini': 2 },
  },
];

function readExample(example: Example, change: (conversations: Json[]) => unknown[] = (c) => c): { reading: Reading; inside: Totals; all: Totals } {
  const about = JSON.parse(example.expected) as { now: string; cutoff: string };
  const now = Date.parse(about.now) / 1000;
  const account = createAccount({ now });
  for (const c of change(JSON.parse(example.file) as Json[])) account.add(c);
  const reading = account.finish();
  // The expected files count from the cutoff to the day of `now`, both included.
  const window = { from: about.cutoff.slice(0, 10), to: dayName(Math.floor(now / 86_400)) };
  return { reading, inside: totals(reading, window, 'paid'), all: totals(reading, 'all', 'paid') };
}

const byModel = (t: Totals) => Object.fromEntries(t.requestsByModel.map((row) => [row.model, row.requests]));

describe.each(EXAMPLES)('the invented example export, $name', (example) => {
  const want = (path: string) => expected(example.expected, path);

  it('gives the expected counts', () => {
    const { reading, inside, all } = readExample(example);

    expect(reading.conversations).toBe(want('conversations.total'));
    expect(all.conversations).toBe(want('conversations.total'));
    expect(inside.conversations).toBe(want('conversations.inside_30_days_by_any_message'));
    expect(reading.conversationsWithCustomInstructions).toBe(want('conversations.with_custom_instructions_visible'));

    expect(all.messages).toBe(want('messages.total'));
    expect(inside.messages).toBe(want('messages.inside_30_days'));
    expect(all.messages - inside.messages).toBe(want('messages.outside_30_days'));
    expect(reading.undated.messages).toBe(want('messages.dated_in_the_future'));
    const milliseconds = reading.warnings.find((w) => w.code === 'time-in-milliseconds')?.count ?? 0;
    expect(milliseconds).toBe(want('messages.with_millisecond_create_time'));

    expect(all.prompts).toBe(want('user_prompts.total'));
    expect(inside.prompts).toBe(want('user_prompts.inside_30_days'));
    expect(all.answers).toBe(want('answers.total'));
    expect(inside.answers).toBe(want('answers.inside_30_days'));
    expect(all.answers - inside.answers).toBe(want('answers.outside_30_days'));

    expect(all.thinkingRecorded).toBe(want('answers.thinking_by_evidence.count'));
    expect(inside.thinkingRecorded).toBe(want('answers.thinking_by_evidence.inside_30_days'));
    expect(all.thinkingSeconds).toBe(want('answers.thinking_by_evidence.seconds_from_export'));
    expect(inside.thinkingSeconds).toBe(want('answers.thinking_by_evidence.seconds_inside_30_days'));
    expect(all.thinkingAssumed).toBe(want('answers.thinking_by_slug_only.count'));
    expect(inside.thinkingAssumed).toBe(want('answers.thinking_by_slug_only.inside_30_days'));
    expect(reading.warnings.find((w) => w.code === 'thinking-time-unreadable')?.count ?? 0).toBe(want('answers.with_unknown_thinking_time'));

    expect(all.searchRequests).toBe(want('answers.with_web_search.count'));
    expect(inside.searchRequests).toBe(want('answers.with_web_search.inside_30_days'));

    expect(all.filesWithCount + all.filesWithoutCount + all.images).toBe(want('attachments.total'));
    expect(inside.filesWithCount + inside.filesWithoutCount + inside.images).toBe(want('attachments.inside_30_days'));
    expect(all.filesWithCount).toBe(want('attachments.with_token_size'));

    // Memory shows in both shapes: as a cited memory in the current one, as a memory being written in the older one.
    expect(want('answers.citing_memory.count') + want('answers.citing_memory.memory_writes_visible')).toBeGreaterThan(0);
    expect(reading.memorySeen).toBe(true);
    expect(inside.evidence).toEqual({ thinking: 'recorded', memoryInUse: true, searchOrFiles: true });
  });

  it('counts the token size the export gives for the PDF as new input, once', () => {
    const size = want('attachments.token_sizes_sum');
    const newInput = (reading: Reading) => reading.days.reduce((sum, day) => sum + day.models.reduce((s, m) => s + m.newInput, 0), 0);
    const withoutSize = readExample(example, (conversations) =>
      JSON.parse(JSON.stringify(conversations).replaceAll(`"file_token_size":${size}`, '"file_token_size":null')) as Json[]);
    expect(newInput(readExample(example).reading) - newInput(withoutSize.reading)).toBe(size);
    expect(withoutSize.all.filesWithoutCount).toBe(1);
  });

  it('has one request per run of the model', () => {
    const { inside, all } = readExample(example);
    expect(byModel(all)).toEqual(example.requests);
    expect(byModel(inside)).toEqual(example.requestsInside);
    expect(all.requests).toBe(Object.values(example.requests).reduce((a, b) => a + b, 0));
  });

  it('gives the same with an empty children list on every node', () => {
    const changed = readExample(example, (conversations) =>
      conversations.map((c) => ({ ...c, mapping: Object.fromEntries(Object.entries(c['mapping'] as Json).map(([id, n]) => [id, { ...(n as Json), children: [] }])) })));
    expect(changed).toEqual(readExample(example));
  });

  it('gives the same when the file is loaded twice', () => {
    const twice = readExample(example, (conversations) => [...conversations, ...conversations]);
    const once = readExample(example);
    expect(twice.reading.warnings).toContainEqual({ code: 'duplicate-conversation', count: 3 });
    expect({ ...twice.reading, warnings: once.reading.warnings }).toEqual(once.reading);
  });

  it('keeps no text of the export', () => {
    const { reading } = readExample(example);
    const kept = JSON.stringify(reading);
    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') strings.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value !== null && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(JSON.parse(example.file));
    const models = new Set(reading.days.flatMap((day) => day.models.map((m) => m.model)));
    const leaked = strings.filter((s) => s.length >= 8 && !models.has(s) && kept.includes(s));
    expect(leaked).toEqual([]);
  });
});
