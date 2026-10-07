import { describe, expect, it } from 'vitest';
import currentShape from './fixtures/export.current-shape.json?raw';
import olderShape from './fixtures/export.older-shape.json?raw';
import { readExport } from './fixtures/reference.mjs';
import { dayIndex, dayName } from './reading';
import { countO200k } from './tokens';
import { comparable, comparableReference, countWords, madeUpConversation, read, referenceEnd, seeded } from './test-kit';
import type { CountTokens } from './count';

const PLANS = [['paid', true], ['free', false]] as const;

/** The port and the reference on the same conversations: the window ending on `lastDay`, and the whole export. */
function expectSame(conversations: unknown[], countTokens: CountTokens, lastDay: number): void {
  const now = referenceEnd(lastDay) + 400 * 86_400;
  const reading = read(conversations, { countTokens, now });
  const window = { from: dayName(lastDay - 29), to: dayName(lastDay) };
  for (const [plan, plus] of PLANS) {
    const reference = readExport(conversations, { countTokens, plus, exportTime: referenceEnd(lastDay) });
    expect(comparable(reading, window, plan), `window ending ${window.to}, ${plan}`).toEqual(comparableReference(reference.window));
    expect(comparable(reading, 'all', plan), `full history, ${plan}`).toEqual(comparableReference(reference.all));
  }
}

describe('the port gives what the reference gives', () => {
  it('on the current-shape example, with the real tokenizer', () => {
    const conversations = JSON.parse(currentShape) as unknown[];
    expectSame(conversations, countO200k, dayIndex(Date.UTC(2026, 9, 7) / 1000));
    expectSame(conversations, countO200k, dayIndex(Date.UTC(2026, 8, 25) / 1000));
  });

  it('on the older-shape example, with the real tokenizer', () => {
    const conversations = JSON.parse(olderShape) as unknown[];
    expectSame(conversations, countO200k, dayIndex(Date.UTC(2026, 3, 7) / 1000));
    expectSame(conversations, countO200k, dayIndex(Date.UTC(2026, 2, 25) / 1000));
  });

  it('on 400 made-up conversations', () => {
    const random = seeded(20261007);
    const end = Date.UTC(2026, 9, 7) / 1000;
    const conversations = Array.from({ length: 400 }, (_, n) => madeUpConversation(random, n, end));

    // The made-up set must really hold the cases it is there for.
    const nodes = conversations.flatMap((c) => Object.values(c['mapping'] as Record<string, { parent: string | null; message: Record<string, unknown> | null }>));
    const typeOf = (m: Record<string, unknown> | null) => (m?.['content'] as { content_type?: string } | undefined)?.content_type;
    expect(nodes.length).toBeGreaterThan(5_000);
    expect(nodes.filter((x) => typeOf(x.message) === 'reasoning_recap').length).toBeGreaterThan(300);
    expect(nodes.filter((x) => x.message?.['create_time'] === null).length).toBeGreaterThan(300);
    expect(nodes.filter((x) => (x.message?.['author'] as { role: string } | undefined)?.role === 'tool').length).toBeGreaterThan(200);

    for (const offset of [0, 3, 17, 45, 90]) expectSame(conversations, countWords, dayIndex(end) - offset);
    const whole = comparable(read(conversations), 'all', 'paid');
    expect(whole.counts['requests']).toBeGreaterThan(2_500);
    expect(whole.counts['cut']).toBeGreaterThan(0);
    for (const piece of ['thinking', 'systemPrompt', 'memory', 'search', 'files', 'cacheMisses'] as const) {
      expect(Object.keys(whole[piece]).length, piece).toBeGreaterThan(3);
    }
  });

  it('on a conversation with citation markers, names in odd places and times that are missing', () => {
    const end = Date.UTC(2026, 9, 7) / 1000;
    const t = end - 3 * 86_400;
    const cite = '\ue200cite\ue202turn0search0\ue201';
    const text = (role: string, parts: unknown[], time: number | null, metadata: Record<string, unknown> = {}) =>
      ({ author: { role, name: null }, create_time: time, recipient: 'all', content: { content_type: 'text', parts }, metadata });
    const thinking = (time: number | null, words: string, metadata: Record<string, unknown>) =>
      ({ author: { role: 'assistant', name: null }, create_time: time, recipient: 'all', content: { content_type: 'reasoning_recap', content: words }, metadata });
    const node = (id: string, parent: string | null, message: unknown) => [id, { id, parent, message }] as const;
    const c = {
      id: 'by-hand', create_time: t - 50, update_time: end - 60, default_model_slug: 'auto',
      mapping: Object.fromEntries([
        node('root', null, null),
        node('q1', 'root', text('user', ['one two three'], t)),
        node('r1', 'q1', thinking(t + 14, 'Thought for 14s', { model_slug: 'gpt-5-5-thinking' })),
        node('a1', 'r1', text('assistant', [`Paris ${cite} is ${cite} large \ue203`, `${cite}`], null)),
        node('q2', 'a1', text('user', ['four five'], null)),
        node('r2', 'q2', thinking(null, 'Worked for 2m 9s', {})),
        node('a2', 'r2', text('assistant', ['six seven eight'], null, { resolved_model_slug: 'gpt-5-5' })),
        node('q3', 'a2', text('user', ['nine'], t + 40 * 60)),
        node('a3', 'q3', text('assistant', [`ten ${cite}`], t + 41 * 60)),
        node('a3b', 'a3', text('assistant', ['eleven twelve'], t + 42 * 60, { model_slug: 'research' })),
        node('q4', 'a3b', text('user', ['thirteen'], t + 43 * 60)),
        node('a4', 'q4', text('assistant', ['fourteen'], t + 44 * 60)),
        node('lost', 'nowhere', text('assistant', ['fifteen sixteen'], null)),
      ]),
    };
    for (const countTokens of [countWords, countO200k]) expectSame([c], countTokens, dayIndex(end));
    const whole = comparable(read([c], { now: end }), 'all', 'paid');
    // Worked out by hand, one word one token, as [fresh input, cache read, output]:
    // request  model              output  new  previous answer  earlier prompt  time        after
    // lost     none                  2     0         0                0         t - 50      first: cold
    // a1       its thinking line     3     3         0                0         t + 14      64 s: warm
    // a2       its resolved name     3     2         3                3         t + 14      0 s: warm
    // a3, a3b  the later of the two  3     1         3                8         t + 41 min  cold
    // a4       the request before    1     1         3               12         t + 44 min  warm
    // None is under "auto". The two "research" requests have no thinking line: each gets the median of 14 and 129.
    expect(whole.rows).toEqual({ 'gpt-5-5-thinking': [3, 0, 3], 'gpt-5-5': [2 + 3, 3, 3], research: [1 + 3 + 8 + 1 + 3, 12, 3 + 1], unknown: [0, 0, 2] });
    expect(whole.thinking).toEqual({ 'gpt-5-5-thinking': [0, 0, 14], 'gpt-5-5': [0, 0, 129], research: [0, 0, 71.5 + 71.5] });
    expect(whole.counts).toMatchObject({ requests: 5, cold: 2, thinkingRecorded: 2, thinkingAssumed: 2 });
  });

  it('one conversation at a time, so a difference names its conversation', () => {
    const random = seeded(7);
    const end = Date.UTC(2026, 9, 7) / 1000;
    for (let n = 0; n < 300; n++) {
      const c = madeUpConversation(random, n, end);
      const reading = read([c], { now: end + 400 * 86_400 });
      const reference = readExport([c], { countTokens: countWords, plus: n % 2 === 0, exportTime: end });
      expect(comparable(reading, 'all', n % 2 === 0 ? 'paid' : 'free'), `conversation ${n}`).toEqual(comparableReference(reference.all));
    }
  });
});
