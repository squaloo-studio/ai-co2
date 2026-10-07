// The tokenizer cuts a text into pieces and then works on each piece with a cost that grows with the
// square of its length. These tests check, against the tokenizer's own pattern, that no text can
// make it work on a long piece, and that ordinary text is still counted in one go.
import { O200K_TOKEN_SPLIT_REGEX } from 'gpt-tokenizer/encodingParams/constants';
import { describe, expect, it, vi } from 'vitest';
import { createAccount } from './account';
import { totals } from './reading';
import { conversation, node, type Json } from './test-kit';
import { countO200k } from './tokens';

// Tens of thousands of texts go through here. On a busy machine that takes more than the usual five seconds.
vi.setConfig({ testTimeout: 120_000 });

const T = Date.UTC(2026, 8, 15, 12) / 1000;
const NOW = T + 86_400;
const NO_SPECIAL_TOKENS = { disallowedSpecial: new Set<string>() };
const question = (text: string): Json =>
  conversation([node('u1', 'root', { author: { role: 'user' }, create_time: T, content: { content_type: 'text', parts: [text] }, metadata: {} })]);

/** For each text, the parts of it that reach the tokenizer, in order. */
function handedOverAll(texts: readonly string[], maxRunChars: number): string[][] {
  const seen: string[] = [];
  const account = createAccount({ now: NOW, limits: { maxRunChars }, countTokens: (part) => (seen.push(part), 1) });
  account.add(conversation(texts.map((text, i) => node(`u${i}`, 'root', { author: { role: 'user' }, create_time: T, content: { content_type: 'text', parts: [text] }, metadata: {} }))));
  // The messages are counted in the order of the file, and the parts of one text add up to it.
  const out: string[][] = [];
  let at = 0;
  for (const text of texts) {
    const parts: string[] = [];
    for (let length = 0; length < text.length; at++) {
      const part = seen[at];
      if (part === undefined) throw new Error('fewer parts than text');
      parts.push(part);
      length += part.length;
    }
    if (parts.join('') !== text) throw new Error(`the parts of ${JSON.stringify(text.slice(0, 12))} do not add up to it`);
    out.push(parts);
  }
  if (at !== seen.length) throw new Error('more parts than text');
  return out;
}
const handedOver = (text: string, maxRunChars: number): string[] => handedOverAll([text], maxRunChars)[0] ?? [];

/** The longest piece the tokenizer would work on, in characters. */
function longestPiece(text: string): number {
  let longest = 0;
  for (const [piece] of text.matchAll(O200K_TOKEN_SPLIT_REGEX)) longest = Math.max(longest, piece.length);
  return longest;
}

// One or two of every kind of character the tokenizer's pattern tells apart, and of every kind this
// code tells apart: letters in both cases, a title-case letter, a letter with no case, a mark that
// sits on a letter, digits, signs, the slash and the line breaks a run of signs takes along, white
// space inside and outside ASCII, a character in two halves, half a character, a control character.
const ALPHABET = [
  'a', 'Z', 'é', 'Ö', 'ǅ', '字', 'ʰ', '\u0301', '7', '٣', '!', '\'', '/', '€', '。', '😀', '\ud83d', '\ude00',
  ' ', '\t', '\n', '\r', '\u00a0', '\u3000', '\u2028', '\u0085', '\u200b', '\ufeff', '\u0000',
];

describe('no text makes the tokenizer work on a long piece', () => {
  const maxRun = 24;
  // A sign's piece can run on into line breaks and slashes, and a word can start with one other
  // character and end in a short form like 're: twice the limit, and a little.
  const bound = 2 * maxRun + 4;

  it('holds for every repeated pattern of up to three kinds of character', () => {
    const patterns: string[] = [];
    for (const a of ALPHABET) {
      patterns.push(a);
      for (const b of ALPHABET) {
        patterns.push(a + b);
        for (const c of ALPHABET) patterns.push(a + b + c);
      }
    }
    expect(patterns.length).toBeGreaterThan(25_000);
    // The start of a text matters too: once with a word before the run, once without.
    const texts = patterns.flatMap((pattern) => [pattern.repeat(Math.ceil(200 / pattern.length)), `go ${pattern.repeat(Math.ceil(200 / pattern.length))} on`]);
    const tooLong: string[] = [];
    handedOverAll(texts, maxRun).forEach((parts, i) => {
      const longest = Math.max(...parts.map(longestPiece));
      if (longest > bound) tooLong.push(`${JSON.stringify(patterns[i >> 1])}: a piece of ${longest} characters`);
    });
    expect(tooLong).toEqual([]);
  });

  it('holds for a run of one kind followed by a long run of another', () => {
    const pairs = ALPHABET.flatMap((a) => ALPHABET.map((b) => [a, b] as const));
    const texts = pairs.flatMap(([a, b]) => [a.repeat(150) + b.repeat(150), (a + b).repeat(40) + b.repeat(150), `${a.repeat(30)}${b}`.repeat(8)]);
    const tooLong: string[] = [];
    handedOverAll(texts, maxRun).forEach((parts, i) => {
      const longest = Math.max(...parts.map(longestPiece));
      if (longest > bound) tooLong.push(`${JSON.stringify(pairs[Math.floor(i / 3)])}: a piece of ${longest} characters`);
    });
    expect(tooLong).toEqual([]);
  });

  it('holds for every ASCII character and every kind of white space, next to each kind of character', () => {
    const ascii = Array.from({ length: 128 }, (_, code) => String.fromCharCode(code));
    // Every character a regular expression takes for white space, found by asking one.
    const whiteSpace = Array.from({ length: 0x10000 }, (_, code) => String.fromCharCode(code)).filter((c) => /\s/u.test(c));
    expect(whiteSpace.length).toBeGreaterThan(20);
    const pairs = [...ascii, ...whiteSpace].flatMap((a) => ['a', 'Z', '!', '/', ' ', '\n', '\r', '字', 'é', '\u0301', '€', '7'].map((b) => [a, b] as const));
    const texts = pairs.flatMap(([a, b]) => [(a + b).repeat(100), a.repeat(150) + b.repeat(150), `${b}${a.repeat(60)}`.repeat(4)]);
    const tooLong: string[] = [];
    handedOverAll(texts, maxRun).forEach((parts, i) => {
      const longest = Math.max(...parts.map(longestPiece));
      if (longest > bound) tooLong.push(`${JSON.stringify(pairs[Math.floor(i / 3)])}: a piece of ${longest} characters`);
    });
    expect(tooLong).toEqual([]);
  });

  it('never cuts a character in two', () => {
    for (const text of ['😀'.repeat(200), `a${'😀'.repeat(200)}`, '👩‍💻'.repeat(80)]) {
      for (const part of handedOver(text, maxRun)) {
        expect(/^[\udc00-\udfff]/.test(part) || /[\ud800-\udbff]$/.test(part)).toBe(false);
      }
    }
  });

  it('is quick on the real tokenizer where it used to crawl', () => {
    // Each of these is one piece for the tokenizer. Uncut, 40,000 characters of any of them take seconds.
    const texts = ['aé'.repeat(60_000), 'a\u0301'.repeat(60_000), `!${'\n/'.repeat(60_000)}`, '!€'.repeat(60_000), ' \u00a0'.repeat(60_000), '\r\n/'.repeat(40_000), 'é!'.repeat(60_000), '字a'.repeat(60_000)];
    const account = createAccount({ now: NOW });
    const started = performance.now();
    for (const [i, text] of texts.entries()) account.add({ ...question(text), id: `c${i}` });
    expect(performance.now() - started).toBeLessThan(8_000);
    const reading = account.finish();
    expect(reading.warnings).toEqual([]);
    expect(totals(reading, 'all', 'paid').messages).toBe(texts.length);
  });
});

describe('ordinary text goes to the tokenizer in one piece', () => {
  const sentences = [
    'An ordinary sentence, with a comma; then a semicolon: and "quotes" (with brackets) – done. '.repeat(30),
    'Das ist ein gewöhnlicher Satz mit Umlauten: Äpfel, Öl und Übermut, außerdem Straße. '.repeat(30),
    'Voilà une phrase française, avec des accents: été, où, ça, naïve, cœur. '.repeat(30),
    'Это обычное предложение на русском языке, с запятыми и точкой. '.repeat(30),
    'Tämä on tavallinen suomenkielinen lause, jossa on pitkiä yhdyssanoja. '.repeat(30),
    'function add(a, b) {\n  return a + b; // 1 + 2 === 3\n}\n\n'.repeat(40),
    '| name | value |\n| --- | --- |\n| alpha | 1,024 |\n| beta | 3.14159 |\n'.repeat(30),
    'https://example.org/a/very/long/path/with-many-parts_and_words?first=1&second=two#part '.repeat(30),
    'Emoji in a sentence 😀 are fine 👩‍💻 too, and so is a dash — or an ellipsis … '.repeat(30),
  ];

  it.each(sentences.map((text) => [text.slice(0, 40), text]))('%s…', (_name, text) => {
    expect(text.length).toBeGreaterThan(1_500);
    expect(handedOver(text, 512)).toEqual([text]);
  });

  it('and so the count is exactly the tokenizer\'s', () => {
    for (const text of sentences) {
      const account = createAccount({ now: NOW });
      account.add({ ...question(text), mapping: { ...(question(text)['mapping'] as Json), a1: { id: 'a1', parent: 'u1', message: { author: { role: 'assistant' }, create_time: T, content: { content_type: 'text', parts: ['ok'] }, metadata: {} } } } });
      const t = totals(account.finish(), 'all', 'paid');
      expect(t.rows[0]?.freshInput).toBe(countO200k(text, NO_SPECIAL_TOKENS));
    }
  });
});

describe('text without spaces is counted in parts, close to the tokenizer\'s own count', () => {
  const count = (text: string): number => {
    const account = createAccount({ now: NOW });
    account.add({ ...question(text), mapping: { ...(question(text)['mapping'] as Json), a1: { id: 'a1', parent: 'u1', message: { author: { role: 'assistant' }, create_time: T, content: { content_type: 'text', parts: ['ok'] }, metadata: {} } } } });
    return totals(account.finish(), 'all', 'paid').rows[0]?.freshInput ?? 0;
  };

  it.each([
    ['Chinese sentences', '今天天气很好，我们一起去公园散步吧。然后回家喝茶，看一本书。'.repeat(120)],
    ['Japanese sentences', 'きょうはいい天気ですね。公園を散歩して、それからお茶を飲みましょう。'.repeat(120)],
    ['a sequence of letters', 'acgtgattacaggcttaacg'.repeat(300)],
    ['a line of dashes', '-'.repeat(6_000)],
  ])('%s: at most one token more per 512 characters', (_name, text) => {
    const exact = countO200k(text, NO_SPECIAL_TOKENS);
    const counted = count(text);
    expect(Math.abs(counted - exact)).toBeLessThanOrEqual(Math.ceil(text.length / 512));
    expect(counted).toBeGreaterThan(0);
  });
});
