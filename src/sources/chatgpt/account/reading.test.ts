import { describe, expect, it } from 'vitest';
import { createAccount } from './account';
import { dayFromName, dayIndex, dayName, PIECES, planFromExport, totals, windowEndingAt, type Reading } from './reading';
import { comparable, conversation, countWords, madeUpConversation, message, node, read, seeded } from './test-kit';

const END = Date.UTC(2026, 9, 7, 9) / 1000;

function madeUp(count = 150): Reading {
  const random = seeded(99);
  return read(Array.from({ length: count }, (_, n) => madeUpConversation(random, n, END)), { now: END + 30 * 86_400 });
}

describe('a reading', () => {
  it('is plain data: it survives being posted to the page unchanged', () => {
    const reading = madeUp();
    const posted = structuredClone(reading);
    expect(posted).toEqual(reading);
    expect(JSON.parse(JSON.stringify(reading))).toEqual(reading);
    expect(totals(posted, windowEndingAt(END), 'free')).toEqual(totals(reading, windowEndingAt(END), 'free'));
  });

  it('lists its days oldest first, once each', () => {
    const days = madeUp().days.map((day) => day.day);
    expect(days.length).toBeGreaterThan(60);
    expect([...days].sort()).toEqual(days);
    expect(new Set(days).size).toBe(days.length);
  });

  it('gives the time of its oldest and newest request', () => {
    const reading = madeUp();
    const withRequests = reading.days.filter((day) => day.models.length > 0);
    expect(dayName(dayIndex(reading.firstRequest ?? 0))).toBe(withRequests[0]?.day);
    expect(dayName(dayIndex(reading.lastRequest ?? 0))).toBe(withRequests[withRequests.length - 1]?.day);
    expect(reading.lastMessage ?? 0).toBeGreaterThanOrEqual(reading.firstRequest ?? Infinity);
  });

  it('holds warnings as codes and numbers only', () => {
    const reading = madeUp();
    expect(reading.warnings.length).toBeGreaterThan(0);
    for (const warning of reading.warnings) {
      expect(Object.keys(warning).sort()).toEqual(['code', 'count']);
      expect(warning.code).toMatch(/^[a-z-]+$/);
      expect(Number.isInteger(warning.count) && warning.count > 0).toBe(true);
    }
  });
});

describe('totals', () => {
  it('add up: windows that share no day sum to the window that spans them', () => {
    const reading = madeUp();
    const whole = totals(reading, { from: '2026-07-01', to: '2026-10-07' }, 'paid');
    const parts = [
      totals(reading, { from: '2026-07-01', to: '2026-08-11' }, 'paid'),
      totals(reading, { from: '2026-08-12', to: '2026-08-12' }, 'paid'),
      totals(reading, { from: '2026-08-13', to: '2026-10-07' }, 'paid'),
    ];
    for (const field of ['messages', 'prompts', 'answers', 'requests', 'coldRequests', 'cutRequests', 'sources', 'images', 'thinkingRecorded'] as const) {
      expect(parts.reduce((sum, part) => sum + part[field], 0), field).toBe(whole[field]);
    }
    const tokens = (t: typeof whole) => t.rows.reduce((sum, row) => sum + row.freshInput + row.cacheRead + row.output, 0);
    expect(parts.reduce((sum, part) => sum + tokens(part), 0)).toBe(tokens(whole));
    expect(whole.requests).toBeGreaterThan(500);
  });

  it('cover the whole export with "all", undated requests included', () => {
    const reading = madeUp();
    const everyDay = totals(reading, { from: '2000-01-01', to: '2100-01-01' }, 'paid');
    const all = totals(reading, 'all', 'paid');
    expect(all.requests).toBe(everyDay.requests + reading.undated.models.reduce((sum, m) => sum + m.requests, 0));
    expect(all.conversations).toBe(reading.conversations);
  });

  it('change with the plan without reading anything again', () => {
    const reading = madeUp();
    const paid = totals(reading, 'all', 'paid');
    const free = totals(reading, 'all', 'free');
    const read = (t: typeof paid, type: 'freshInput' | 'cacheRead' | 'output') => t.rows.reduce((sum, row) => sum + row[type], 0);
    expect(read(free, 'output')).toBe(read(paid, 'output'));
    expect(read(free, 'cacheRead')).toBeLessThan(read(paid, 'cacheRead'));
    expect(read(free, 'freshInput')).toBeLessThan(read(paid, 'freshInput'));
    expect(free.cutRequests).toBeGreaterThan(paid.cutRequests);
    expect(free.hidden.thinking).toEqual(paid.hidden.thinking);
    expect(free.hidden.memory).toEqual(paid.hidden.memory);
    expect(free.hidden.cacheMisses).not.toEqual(paid.hidden.cacheMisses);
    expect([free.requests, free.messages, free.conversations]).toEqual([paid.requests, paid.messages, paid.conversations]);
  });

  it('give the cache-miss base as exactly the cache reads of the rows', () => {
    const t = totals(madeUp(), 'all', 'paid');
    const cached = Object.fromEntries(t.rows.filter((row) => row.cacheRead > 0).map((row) => [row.model, row.cacheRead]));
    expect(Object.fromEntries(t.hidden.cacheMisses.map((row) => [row.model, row.freshInput]))).toEqual(cached);
  });

  it('give all six bases, in the order the maths takes them', () => {
    const t = totals(madeUp(), 'all', 'paid');
    expect(Object.keys(t.hidden)).toEqual([...PIECES]);
    expect(PIECES).toEqual(['thinking', 'systemPrompt', 'memory', 'search', 'files', 'cacheMisses']);
    for (const piece of PIECES) for (const row of t.hidden[piece]) expect(row.cacheWrite).toBe(0);
  });

  it('list the rows with the most tokens first and every model that ran', () => {
    const t = totals(madeUp(), 'all', 'paid');
    const size = t.rows.map((row) => row.freshInput + row.cacheRead + row.output);
    expect([...size].sort((a, b) => b - a)).toEqual(size);
    expect(t.requestsByModel.map((row) => row.model)).toEqual(t.rows.map((row) => row.model));
    expect(t.requestsByModel.reduce((sum, row) => sum + row.requests, 0)).toBe(t.requests);
  });

  it('are empty for a window with nothing in it, and for an empty export', () => {
    const empty = totals(madeUp(), { from: '2020-01-01', to: '2020-01-30' }, 'paid');
    expect([empty.conversations, empty.messages, empty.requests, empty.rows.length]).toEqual([0, 0, 0, 0]);
    expect(empty.evidence).toMatchObject({ thinking: 'none', searchOrFiles: false });
    const nothing = createAccount({ countTokens: countWords }).finish();
    expect(nothing).toMatchObject({ conversations: 0, days: [], firstRequest: null, lastRequest: null, lastMessage: null, plusUser: null, memorySeen: false, warnings: [] });
    expect(totals(nothing, 'all', 'free').rows).toEqual([]);
  });

  it('count a conversation in a window when one of its messages falls into it', () => {
    const T = Date.UTC(2026, 8, 1, 12) / 1000;
    const c = conversation([
      node('u1', 'root', message('user', 1, { time: T })), node('a1', 'u1', message('assistant', 1, { time: T })),
      node('u2', 'a1', message('user', 1, { time: T + 20 * 86_400 })), node('a2', 'u2', message('assistant', 1, { time: T + 20 * 86_400 })),
    ], { id: 'c' });
    const reading = read([c], { now: T + 30 * 86_400 });
    const inWindow = (from: string, to: string) => totals(reading, { from, to }, 'paid').conversations;
    expect([inWindow('2026-09-01', '2026-09-01'), inWindow('2026-09-02', '2026-09-20'), inWindow('2026-09-21', '2026-09-30'), inWindow('2026-08-01', '2026-10-30')]).toEqual([1, 0, 1, 1]);
  });

  it('refuse a window that is not two days', () => {
    const reading = madeUp(3);
    for (const day of ['', '2026-9-7', '2026-02-30', '07.10.2026', '2026-10-07T00:00:00Z']) {
      expect(() => totals(reading, { from: day, to: '2026-10-07' }, 'paid')).toThrow(RangeError);
    }
    expect(dayName(dayFromName('2024-02-29'))).toBe('2024-02-29');
  });
});

describe('the plan from the export', () => {
  it('is free only when user.json says so', () => {
    const plan = (user?: unknown) => {
      const account = createAccount({ countTokens: countWords });
      if (user !== undefined) account.setUser(user);
      return planFromExport(account.finish());
    };
    expect([plan({ chatgpt_plus_user: false }), plan({ chatgpt_plus_user: true }), plan(), plan({})]).toEqual(['free', 'paid', 'paid', 'paid']);
  });
});

describe('the same conversations in another order', () => {
  it('give the same reading', () => {
    const random = seeded(5);
    const conversations = Array.from({ length: 80 }, (_, n) => madeUpConversation(random, n, END));
    const forward = read(conversations, { now: END + 30 * 86_400 });
    const backward = read([...conversations].reverse(), { now: END + 30 * 86_400 });
    expect(comparable(backward, 'all', 'paid')).toEqual(comparable(forward, 'all', 'paid'));
    expect(backward.days.map((day) => [day.day, day.messages, day.prompts, day.answers, day.recaps])).toEqual(forward.days.map((day) => [day.day, day.messages, day.prompts, day.answers, day.recaps]));
  });
});
