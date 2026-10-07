// This folder's counting and the reference, side by side, on 2,400 made-up conversations in both
// export shapes. The token rows and the six bases must agree for every model, for the 30 days and
// for the whole export, on both plans.
import { describe, expect, it, vi } from 'vitest';
import { createAccount } from './account';
import type { CountTokens } from './count';
import { readExport, type ReferenceRows, type ReferenceTotals } from './fixtures/reference.mjs';
import { CONTENT_TYPES, madeUpExport, THINKING_LINES, type MadeUpExport, type Shape } from './made-up-export';
import { dayIndex, dayName, NO_MODEL_NAME, PIECES, totals, type PieceId, type Plan, type Reading, type Totals } from './reading';
import { recapSeconds } from './rules';
import { countWords, seeded, type Json } from './test-kit';
import { countO200k } from './tokens';

// Each test counts thousands of conversations several times over. That takes more than the usual five seconds.
vi.setConfig({ testTimeout: 180_000 });

const DAY = 86_400;
const PLANS: ReadonlyArray<readonly [Plan, boolean]> = [['paid', true], ['free', false]];
/** The made-up times have milliseconds. This is the last moment of a day that such a time can have. */
const endOfDay = (day: number) => (day + 1) * DAY - 0.0005;

type Flat = Record<string, number>;
const put = (into: Flat, key: string, value: number): void => {
  const rounded = Math.round(value * 1e6) / 1e6;
  if (rounded !== 0) into[key] = Math.round(((into[key] ?? 0) + rounded) * 1e6) / 1e6;
};

function ofReference(t: ReferenceTotals): Flat {
  const out: Flat = {};
  const table = (name: string, rows: ReferenceRows) => {
    for (const [model, row] of Object.entries(rows)) {
      put(out, `${name} / ${model} / fresh input`, row.freshInput);
      put(out, `${name} / ${model} / cache read`, row.cacheRead);
      put(out, `${name} / ${model} / cache write`, row.cacheWrite);
      put(out, `${name} / ${model} / output`, row.output);
    }
  };
  table('rows', t.rows);
  table('thinking', t.thinking);
  table('systemPrompt', t.prompt);
  table('memory', t.personal);
  table('search', t.search);
  table('files', t.files);
  table('cacheMisses', t.misses);
  put(out, 'requests', t.counts.requests);
  put(out, 'cold requests', t.counts.cold);
  put(out, 'cut requests', t.counts.truncated);
  put(out, 'thinking recorded', t.counts.thinkingTimed);
  put(out, 'thinking assumed', t.counts.thinkingImputed);
  put(out, 'search requests', t.counts.searchAnswers);
  put(out, 'sources', t.counts.sources);
  put(out, 'files with count', t.counts.filesExact);
  put(out, 'files without count', t.counts.filesEstimated);
  put(out, 'images', t.counts.images);
  return out;
}

function ofTotals(t: Totals): Flat {
  const out: Flat = {};
  const table = (name: string, rows: Totals['hidden'][PieceId]) => {
    for (const row of rows) {
      // The reference files requests that name no model under "unknown".
      const model = row.model === NO_MODEL_NAME ? 'unknown' : row.model;
      put(out, `${name} / ${model} / fresh input`, row.freshInput);
      put(out, `${name} / ${model} / cache read`, row.cacheRead);
      put(out, `${name} / ${model} / cache write`, row.cacheWrite);
      put(out, `${name} / ${model} / output`, row.output);
    }
  };
  table('rows', t.rows);
  for (const piece of PIECES) table(piece, t.hidden[piece]);
  put(out, 'requests', t.requests);
  put(out, 'cold requests', t.coldRequests);
  put(out, 'cut requests', t.cutRequests);
  put(out, 'thinking recorded', t.thinkingRecorded);
  put(out, 'thinking assumed', t.thinkingAssumed);
  put(out, 'search requests', t.searchRequests);
  put(out, 'sources', t.sources);
  put(out, 'files with count', t.filesWithCount);
  put(out, 'files without count', t.filesWithoutCount);
  put(out, 'images', t.images);
  return out;
}

function count(conversations: readonly unknown[], countTokens: CountTokens, now: number): Reading {
  const account = createAccount({ countTokens, now });
  for (const c of conversations) account.add(c);
  return account.finish();
}

/** Both on the same conversations: the 30 days ending with each of `lastDays`, and the whole export, on both plans. */
function expectSame(conversations: readonly unknown[], countTokens: CountTokens, lastDays: readonly number[], label: string): void {
  const reading = count(conversations, countTokens, endOfDay(Math.max(...lastDays)) + 2_000 * DAY);
  for (const lastDay of lastDays) {
    const window = { from: dayName(lastDay - 29), to: dayName(lastDay) };
    for (const [plan, plus] of PLANS) {
      const reference = readExport(conversations, { countTokens, plus, exportTime: endOfDay(lastDay) });
      expect(ofTotals(totals(reading, window, plan)), `${label}: 30 days to ${window.to}, ${plan}`).toEqual(ofReference(reference.window));
      expect(ofTotals(totals(reading, 'all', plan)), `${label}: whole export, ${plan}`).toEqual(ofReference(reference.all));
    }
  }
}

// Older exports end in spring 2026 and newer ones in autumn, as the real ones do.
const END: Record<Shape, number> = { full: dayIndex(Date.UTC(2026, 3, 6) / 1000), trimmed: dayIndex(Date.UTC(2026, 9, 7) / 1000) };
const SEED: Record<Shape, number> = { full: 2026_04_06, trimmed: 2026_10_07 };
const made = new Map<Shape, MadeUpExport>();
const madeUp = (shape: Shape): MadeUpExport => {
  let set = made.get(shape);
  if (!set) made.set(shape, (set = madeUpExport(seeded(SEED[shape]), shape, 1_200, endOfDay(END[shape]))));
  return set;
};
const SHAPES: Shape[] = ['full', 'trimmed'];

describe('the made-up conversations', () => {
  it('hold every content type the export report lists', () => {
    const all = new Map<string, number>();
    for (const shape of SHAPES) for (const [type, n] of madeUp(shape).contentTypes) all.set(type, (all.get(type) ?? 0) + n);
    for (const type of CONTENT_TYPES) expect(all.get(type) ?? 0, type).toBeGreaterThanOrEqual(15);
    // The trimmed shape has only what exports made since July 2026 have.
    expect([...madeUp('trimmed').contentTypes.keys()].sort()).toEqual(['multimodal_text', 'reasoning_recap', 'something_new', 'text', 'thoughts']);
  });

  it('hold every wording of the thinking line, in both shapes', () => {
    for (const shape of SHAPES) {
      const lines = madeUp(shape).thinkingLines;
      for (const [line] of THINKING_LINES) expect(lines.get(line) ?? 0, `${shape}: "${line}"`).toBeGreaterThanOrEqual(3);
    }
  });

  it('are read as the list says, wording by wording', () => {
    for (const [line, seconds] of THINKING_LINES) expect(recapSeconds(undefined, line), line).toBe(seconds);
  });

  it('hold the cases the counting rule is about', () => {
    const full = madeUp('full').seen;
    const trimmed = madeUp('trimmed').seen;
    for (const seen of [full, trimmed]) {
      for (const name of ['regenerated answers', 'edited questions', 'forks inside an answer', 'empty answers', 'pictures', 'attached files', 'voice transcripts', 'answers with a source list', 'answers without a time', 'questions dated in milliseconds', 'answers that go on after thinking']) {
        expect(seen.get(name) ?? 0, name).toBeGreaterThanOrEqual(10);
      }
    }
    for (const name of ['custom instructions', 'thinking times as a number', 'conversations with file text', 'tool web', 'tool web.run', 'tool browser', 'tool python', 'tool file_search', 'tool myfiles_browser', 'tool bio', 'tool dalle.text2im', 'tool canmore.create_textdoc', 'tool calls without a reply']) {
      expect(full.get(name) ?? 0, name).toBeGreaterThanOrEqual(10);
    }
    expect(trimmed.get('messages without metadata') ?? 0).toBeGreaterThanOrEqual(100);

    // Only user and assistant messages in the trimmed shape, and no list of children that could be trusted.
    const nodes = (shape: Shape) => madeUp(shape).conversations.flatMap((c) => Object.values(c['mapping'] as Record<string, Json>));
    const roles = (shape: Shape) => new Set(nodes(shape).flatMap((n) => (n['message'] === null ? [] : [((n['message'] as Json)['author'] as Json)['role']])));
    expect([...roles('trimmed')].sort()).toEqual(['assistant', 'user']);
    expect([...roles('full')].sort()).toEqual(['assistant', 'system', 'tool', 'user']);
    expect(nodes('trimmed').every((n) => n['children'] === undefined || (n['children'] as unknown[]).length === 0)).toBe(true);
    expect(nodes('full').length + nodes('trimmed').length).toBeGreaterThan(30_000);
  });
});

describe.each(SHAPES)('2,400 made-up conversations against the reference: the %s shape', (shape) => {
  it('agrees on the rows and the six bases, for five windows and the whole export, on both plans', () => {
    const { conversations } = madeUp(shape);
    expectSame(conversations, countWords, [0, 1, 9, 31, 120].map((back) => END[shape] - back), shape);

    // The comparison must be about something: every piece has rows, the ceiling cuts, and both plans differ.
    const reading = count(conversations, countWords, endOfDay(END[shape]) + DAY);
    const paid = totals(reading, 'all', 'paid');
    const free = totals(reading, 'all', 'free');
    const window = totals(reading, { from: dayName(END[shape] - 29), to: dayName(END[shape]) }, 'paid');
    expect(paid.requests).toBeGreaterThan(5_000);
    expect(window.requests).toBeGreaterThan(300);
    expect(window.requests).toBeLessThan(paid.requests / 2);
    for (const piece of PIECES) expect(paid.hidden[piece].length, piece).toBeGreaterThan(5);
    expect(paid.cutRequests).toBeGreaterThan(0);
    expect(free.cutRequests).toBeGreaterThan(paid.cutRequests);
    expect(paid.thinkingRecorded).toBeGreaterThan(200);
    expect(paid.thinkingAssumed).toBeGreaterThan(200);
    expect(paid.coldRequests).toBeGreaterThan(1_200);
    expect(paid.requests - paid.coldRequests).toBeGreaterThan(1_200);
  });

  it('agrees one conversation at a time, so a difference names its conversation', () => {
    const { conversations } = madeUp(shape);
    const now = endOfDay(END[shape]) + 2_000 * DAY;
    const window = { from: dayName(END[shape] - 29), to: dayName(END[shape]) };
    const different: string[] = [];
    conversations.forEach((c, n) => {
      const reading = count([c], countWords, now);
      for (const [plan, plus] of PLANS) {
        const reference = readExport([c], { countTokens: countWords, plus, exportTime: endOfDay(END[shape]) });
        const same = JSON.stringify(sorted(ofTotals(totals(reading, 'all', plan)))) === JSON.stringify(sorted(ofReference(reference.all)))
          && JSON.stringify(sorted(ofTotals(totals(reading, window, plan)))) === JSON.stringify(sorted(ofReference(reference.window)));
        if (!same) different.push(`${shape} conversation ${n}, ${plan}`);
      }
    });
    expect(different).toEqual([]);
  });

  it('agrees with the real tokenizer too', () => {
    const { conversations } = madeUpExport(seeded(SEED[shape] + 1), shape, 150, endOfDay(END[shape]));
    expectSame(conversations, countO200k, [END[shape], END[shape] - 40], `${shape}, o200k_base`);
  });
});

function sorted(flat: Flat): Array<[string, number]> {
  return Object.entries(flat).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
