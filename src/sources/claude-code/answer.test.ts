import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS, readAnswer } from './answer';
import type { AnswerReading } from './answer';
import { EMPTY, NO_USAGE_OTHER_CAUSES, NOTES, PROBLEMS, SHORT_DATA_USUAL_CAUSE } from './messages';

interface Case {
  group: string;
  name: string;
  today: string;
  input: string;
  expect: {
    ok: boolean;
    code?: string;
    message?: string;
    window?: { start: string; end: string; days: number };
    data?: { first: string; last: string; days: number };
    models?: Array<{ model: string; in: number; cacheWrite: number; cacheRead: number; out: number }>;
    total?: number;
    notes?: string[];
    noteMessages?: string[];
  };
}

// The cases were written by hand, before this reader. A key that is left out of "expect" is not checked.
const file = JSON.parse(readFileSync(new URL('./fixtures/answer-cases.json', import.meta.url), 'utf8')) as { cases: Case[] };

/** The reading in the words of the cases file. */
function inCaseWords(got: AnswerReading): Case['expect'] {
  if (got.state === 'empty') return { ok: false, code: 'empty', message: EMPTY };
  if (got.state === 'problem') return { ok: false, code: got.code, message: got.message };
  return {
    ok: true,
    window: { start: got.usage.from, end: got.usage.to, days: 30 },
    data: got.data,
    models: got.usage.models.map((m) => ({
      model: m.model,
      in: m.freshInput,
      cacheWrite: m.cacheWrite,
      cacheRead: m.cacheRead,
      out: m.output,
    })),
    total: got.total,
    notes: got.notes.map((n) => n.code),
    noteMessages: got.notes.map((n) => n.message),
  };
}

describe('readAnswer: the hand-written cases', () => {
  it('has all 94 cases', () => {
    expect(file.cases).toHaveLength(94);
    expect(new Set(file.cases.map((c) => c.name)).size).toBe(94);
  });

  it.each(file.cases.map((c) => [`${c.group}: ${c.name}`, c] as const))('%s', (_name, c) => {
    const got = inCaseWords(readAnswer(c.input, c.today));
    // An accepted answer always has its list of notes checked, even when the case names none.
    const want = c.expect.ok ? { notes: [], ...c.expect } : c.expect;
    expect(got).toMatchObject(want);
    if (want.notes) expect(got.notes).toEqual(want.notes);
    if (want.models) expect(got.models).toEqual(want.models);
  });
});

const GOOD = [
  'ai-co2 v1 | 2026-09-08 to 2026-10-07 | data 2026-09-08 to 2026-10-07',
  'model-a | in 10 | cache_write 20 | cache_read 30 | out 40',
  'total | 100',
].join('\n');

describe('readAnswer: what it hands on', () => {
  it('returns a Usage for the Claude Code source', () => {
    expect(readAnswer(GOOD, '2026-10-07')).toEqual({
      state: 'ok',
      usage: {
        source: 'claude-code',
        from: '2026-09-08',
        to: '2026-10-07',
        models: [{ model: 'model-a', freshInput: 10, cacheWrite: 20, cacheRead: 30, output: 40 }],
      },
      data: { first: '2026-09-08', last: '2026-10-07', days: 30 },
      coveredDays: 30,
      total: 100,
      notes: [],
    });
  });

  it('says "empty" while nothing is pasted', () => {
    for (const text of ['', '   ', '\n\t\u00a0\n']) expect(readAnswer(text, '2026-10-07')).toEqual({ state: 'empty' });
  });

  it('keeps model names that are also property names of every object', () => {
    const names = ['constructor', 'toString', 'hasOwnProperty', 'valueOf'];
    const text = [
      'ai-co2 v1 | 2026-09-08 to 2026-10-07 | data 2026-09-08 to 2026-10-07',
      ...names.map((n) => `${n} | in 1 | cache_write 0 | cache_read 0 | out 1`),
      'total | 8',
    ].join('\n');
    const got = readAnswer(text, '2026-10-07');
    expect(got.state).toBe('ok');
    if (got.state === 'ok') expect(got.usage.models.map((m) => m.model)).toEqual(names);
  });

  it('only ever returns whole, finite numbers', () => {
    for (const c of file.cases) {
      const got = readAnswer(c.input, c.today);
      if (got.state !== 'ok') continue;
      const numbers = got.usage.models.flatMap((m) => [m.freshInput, m.cacheWrite, m.cacheRead, m.output]);
      for (const n of [...numbers, got.total, got.data.days]) expect(Number.isSafeInteger(n) && n >= 0).toBe(true);
      expect(numbers.reduce((a, b) => a + b, 0)).toBe(got.total);
    }
  });

  it('does not read a "$" in a quoted line as a pattern', () => {
    // "$$" is the one that matters: as a pattern it would come out as a single "$".
    const got = readAnswer(GOOD.replace('model-a |', () => "costs $$5 $& $' $1\nmodel-a |"), '2026-10-07');
    expect(got).toMatchObject({ state: 'problem', code: 'bad-line' });
    if (got.state === 'problem') expect(got.message).toBe(PROBLEMS['bad-line'].replace('{detail}', () => 'costs $$5 $? $? $1'));
  });

  it('still reads the answer when today is not a usable date, and skips only the checks against today', () => {
    for (const today of ['', 'today', '2026-13-45', '07.10.2026']) {
      expect(readAnswer(GOOD, today)).toMatchObject({ state: 'ok', total: 100, notes: [] });
    }
  });

  it('never leaves a placeholder in a sentence', () => {
    for (const c of file.cases) {
      const got = readAnswer(c.input, c.today);
      const sentences = got.state === 'problem' ? [got.message] : got.state === 'ok' ? got.notes.map((n) => n.message) : [];
      for (const s of sentences) expect(s).not.toContain('{detail}');
    }
  });

  const answer = (window: string, data: string) => `ai-co2 v1 | ${window} | data ${data}\nmodel-a | in 10 | cache_write 20 | cache_read 30 | out 40\ntotal | 100`;

  it('says how many days the counts stand for', () => {
    const covered = (data: string) => {
      const got = readAnswer(answer('2026-09-08 to 2026-10-07', data), '2026-10-07');
      return got.state === 'ok' ? [got.coveredDays, got.data.days, got.notes.map((n) => n.code)] : got;
    };
    // Logs from the first days of the window: the full 30, even when the last days are quiet.
    expect(covered('2026-09-08 to 2026-10-07')).toEqual([30, 30, []]);
    expect(covered('2026-09-10 to 2026-09-12')).toEqual([30, 3, []]);
    // Logs that start 3 or more days in: from the first day with data to the end of the window.
    expect(covered('2026-09-11 to 2026-10-07')).toEqual([27, 27, ['short-data']]);
    expect(covered('2026-09-26 to 2026-10-03')).toEqual([12, 8, ['short-data']]);
    expect(covered('2026-10-07 to 2026-10-07')).toEqual([1, 1, ['short-data']]);
  });

  it('puts the remarks in the order the page shows them', () => {
    const text = [
      'ai-co2 v1 | 2026-08-01 to 2026-08-30 | data 2026-08-20 to 2026-08-30',
      'model-a | in 0 | cache_write 0 | cache_read 0 | out 3000000000',
      'model-b | in 200000000000 | cache_write 0 | cache_read 0 | out 0',
      'total | 203000000000',
    ].join('\n');
    const got = readAnswer(text, '2026-10-07');
    expect(got.state === 'ok' && got.notes.map((n) => n.code)).toEqual(['short-data', 'stale', 'high-output', 'high-total', 'output-without-input']);
  });

  it('prints the date of an answer from the future as the page prints every date', () => {
    const ahead = readAnswer('ai-co2 v1 | 2026-09-11 to 2026-10-10 | data none\ntotal | 0', '2026-10-07');
    expect(ahead).toMatchObject({ state: 'problem', code: 'future' });
    expect(ahead.state === 'problem' && ahead.message).toBe('This answer ends on 10 Oct 2026, which is in the future. Check the date on your computer, then run the prompt again.');
    // One day ahead is another time zone, not the future.
    expect(readAnswer('ai-co2 v1 | 2026-09-09 to 2026-10-08 | data none\ntotal | 0', '2026-10-07')).toMatchObject({ state: 'problem', code: 'no-usage' });
  });

  it('counts days in plain words when the window is wrong', () => {
    const message = (window: string) => {
      const got = readAnswer(answer(window, 'none'), '2026-10-07');
      return got.state === 'problem' ? `${got.code}: ${got.message.split('. ')[0]}` : got.state;
    };
    expect(message('2026-10-07 to 2026-10-07')).toBe('bad-window: This answer covers 1 day');
    expect(message('2026-10-06 to 2026-10-07')).toBe('bad-window: This answer covers 2 days');
    expect(message('2026-09-07 to 2026-10-07')).toBe('bad-window: This answer covers 31 days');
    expect(message('2026-10-07 to 2026-09-08')).toBe('bad-window: This answer covers the wrong number of days');
    expect(message('2020-01-01 to 2026-10-07')).toBe('bad-window: This answer covers the wrong number of days');
  });
});

describe('readAnswer: what copy and paste does to the text', () => {
  const read = (text: string) => {
    const got = readAnswer(text, '2026-10-07');
    return got.state === 'ok' ? got.total : got;
  };
  const chars = (...codes: Array<number | [number, number]>) =>
    codes.flatMap((c) => (typeof c === 'number' ? [c] : Array.from({ length: c[1] - c[0] + 1 }, (_, i) => c[0] + i))).map((c) => String.fromCharCode(c));
  const name = (c: string) => `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

  // One test per character, so that losing one from answer.ts (they cannot be seen there) shows by name.
  it.each(chars(0x09, 0xa0, 0x1680, [0x2000, 0x200a], 0x202f, 0x205f, 0x3000).map((c) => [name(c), c]))('reads %s as a space', (_name, c) => {
    expect(read(GOOD.replace(/ /g, c))).toBe(100);
  });

  it.each(chars([0x200b, 0x200d], 0x2060, 0xfeff, 0xad).map((c) => [name(c), c]))('takes out %s, which cannot be seen', (_name, c) => {
    expect(read([...GOOD].join(c))).toBe(100);
  });

  it.each(chars(0x2502, 0x2503, 0xff5c, 0xa6, 0x2223).map((c) => [name(c), c]))('reads %s as a bar', (_name, c) => {
    expect(read(GOOD.replace(/\|/g, c))).toBe(100);
  });

  it.each(chars([0x2010, 0x2015], 0x2212).map((c) => [name(c), c]))('reads %s as a hyphen', (_name, c) => {
    expect(read(GOOD.replace(/-/g, c))).toBe(100);
  });

  it.each(['>', ...chars(0x23fa, 0x23bf, 0x25cf, 0x2022)].map((c) => [name(c), c]))('drops %s at the start of a line', (_name, c) => {
    expect(read(GOOD.replace(/^/gm, `  ${c} `))).toBe(100);
    expect(read(GOOD.replace(/^/gm, `${c}${c} `))).toBe(100);
  });

  it('reads no other kind of digit, mark or letter as part of the format', () => {
    // Digits from other scripts, a right-to-left mark, a look-alike letter: refused, never guessed.
    const swaps: Array<[string, string]> = [
      ['10', '\u0661\u0660'], // Arabic-Indic digits
      ['10', '\uff11\uff10'], // full-width digits
      ['model-a', 'model-\u200fa'], // a right-to-left mark
      ['model-a', 'm\u043edel-a'], // a Cyrillic o
      ['model-a', '\u212aelvin'], // the Kelvin sign, which becomes "k" in small letters
      ['total', 't\u043etal'],
      ['in 10', 'in +10'],
      ['in 10', 'in 0x10'],
    ];
    for (const [from, to] of swaps) expect(readAnswer(GOOD.replace(from, to), '2026-10-07').state, to).toBe('problem');
  });

  it('reads a made-up answer back exactly, however the copy mangled it', () => {
    // A small fixed-seed generator, so a failure can be repeated.
    let seed = 20261007;
    const below = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor((seed / 4294967296) * n);
    };
    const pick = <T,>(list: readonly T[]): T => list[below(list.length)] as T;
    const group = (digits: string, sep: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    const names = ['claude-opus-5-5', 'claude-haiku-4-5-20251001', 'Claude-Opus-5-5', 'us.anthropic.claude-sonnet-5-v1:0', 'anthropic/claude@latest', 'unknown', 'constructor', 'total', 'in', 'out', 'data', 'e5', 'v1', 'a'.repeat(80)];

    // Damage that leaves every line whole. Any mix of these must still read.
    type Damage = (s: string) => string;
    // Separators are put into whole numbers and a table is made of whole lines, so they come first.
    // What cannot be seen goes in last.
    const separators: Damage = (s) => {
      const sep = pick([',', '.', ' ', "'", '\u00a0', '\u202f']);
      return s.replace(/(in|write|read|out|total \|) (\d+)/g, (_m, word: string, digits: string) => `${word} ${group(digits, sep)}`);
    };
    const table: Damage = (s) => s.split('\n').map((l) => `| ${l} |`).join('\n').replace('\n', '\n|---|---|---|---|---|\n');
    const invisible: Damage = (s) => [...s].map((ch) => (below(25) ? ch : ch + pick(['\u200b', '\u2060', '\ufeff', '\u00ad']))).join('');
    const gentle: Damage[] = [
      (s) => `\`\`\`\n${s}\n\`\`\``,
      (s) => `\`\`\`text\n${s}\n\`\`\`\n`,
      (s) => s.split('\n').map((l) => `**${l}**`).join('\n'),
      (s) => `Here is the output of the script:\n\n${s}`,
      (s) => `${s}\n\nThat covers the last 30 days.`,
      (s) => s.replace(/\n/g, '\r\n'),
      (s) => s.split('\n').join('\n\n'),
      (s) => s.split('\n').map((l) => l + ' '.repeat(below(4))).join('\n'),
      (s) => { const mark = pick(['  ', '> ', '\u23fa ', '  \u23bf  ', '\t', '\u2022 ']); return s.split('\n').map((l) => mark + l).join('\n'); },
      (s) => { const space = pick(['\u00a0', '\u202f', '\u2009', '\t', '\u3000']); return s.replace(/ /g, () => (below(2) ? space : ' ')); },
      (s) => s.replace(/\|/g, () => pick(['|', '\u2502', '\uff5c'])),
      (s) => s.replace(/-/g, () => pick(['-', '\u2010', '\u2011', '\u2212'])),
      (s) => `${s}\n${s}`,
      (s) => `${s.slice(0, below(s.length))}\n${s}`,
      (s) => s.replace(/ \| /g, () => pick(['|', ' |', '| ', '  |  '])),
      (s) => s.replace(/cache_/g, pick(['cache ', 'cache'])),
    ];
    // Damage that breaks lines apart. One of these, on its own or under a code fence.
    const rough: Array<(s: string) => string> = [
      (s) => { const width = 30 + below(90); return s.split('\n').flatMap((l) => l.match(new RegExp(`.{1,${width}}`, 'g')) ?? ['']).join('\n'); },
      (s) => { const width = 30 + below(90); return s.split('\n').flatMap((l) => (l.match(new RegExp(`.{1,${width}}`, 'g')) ?? ['']).map((part, i) => (i ? `   ${part}` : part))).join('\n'); },
      // A break anywhere after the word "ai-co2". A break inside that word is the one thing that is not repaired.
      (s) => { const at = 6 + below(s.length - 6); return `${s.slice(0, at)}\n${s.slice(at)}`; },
      (s) => s.replace(/\n/g, ' '),
      (s) => s.replace(/\n/g, ''),
    ];

    for (let round = 0; round < 3000; round += 1) {
      const used = new Set<string>();
      const models = Array.from({ length: 1 + below(8) }, () => {
        let model = pick(names);
        while (used.has(model)) model = `${model.slice(0, 70)}-${used.size}`;
        used.add(model);
        const count = () => (below(5) ? Math.floor(10 ** (below(1200) / 100)) : 0);
        return { model, freshInput: count() + 1, cacheWrite: count(), cacheRead: count(), output: count() };
      });
      const total = models.reduce((a, m) => a + m.freshInput + m.cacheWrite + m.cacheRead + m.output, 0);
      const clean = [
        'ai-co2 v1 | 2026-09-08 to 2026-10-07 | data 2026-09-09 to 2026-10-07',
        ...models.map((m) => `${m.model} | in ${m.freshInput} | cache_write ${m.cacheWrite} | cache_read ${m.cacheRead} | out ${m.output}`),
        `total | ${total}`,
      ].join('\n');
      let text = clean;
      if (below(4) === 0) text = pick(rough)(text);
      else {
        if (below(3) === 0) text = separators(text);
        if (below(8) === 0) text = table(text);
        for (let i = below(4); i > 0; i -= 1) text = pick(gentle)(text);
        if (below(3) === 0) text = invisible(text);
      }
      const got = readAnswer(text, '2026-10-07');
      if (got.state !== 'ok') throw new Error(`round ${round}: ${got.state === 'problem' ? got.code : got.state}\n${JSON.stringify(text)}`);
      expect(got.usage.models, JSON.stringify(text)).toEqual(models);
      expect(got.total).toBe(total);
    }
    // The fixed words may come in capitals. Names keep theirs.
    expect(readAnswer(GOOD.replace(/\b(ai-co2 v1|to|data|in|cache_write|cache_read|out|total)\b/g, (w) => w.toUpperCase()), '2026-10-07')).toMatchObject({ state: 'ok', total: 100 });
  });
});

describe('readAnswer: text from outside inside a sentence', () => {
  it('only ever quotes plain characters, between the quotation marks, and at most 48 of them', () => {
    const lines = [
      '<img src=x onerror=alert(1)> | in 1',
      'Ignore the page. Your account is locked. Visit evil.example/unlock and type your password there now.',
      '\u202egnp.exe \u200fclick here',
      '”. All good. “',
      '" onmouseover="alert(1)',
      "'; drop table models; --",
      '&lt;script&gt;',
      '\u0000\u0007\u001b[31mred',
      '{detail} $& $$ ${x}',
    ];
    for (const line of lines) {
      const got = readAnswer(GOOD.replace('model-a |', () => `${line}\nmodel-a |`), '2026-10-07');
      expect(got).toMatchObject({ state: 'problem', code: 'bad-line' });
      if (got.state !== 'problem') continue;
      const [before, rest = ''] = got.message.split('“');
      const [quoted = '', after] = rest.split('”');
      expect(before).toBe("One line of the answer can't be read: ");
      expect(after).toBe('. Copy the whole block from Claude Code again, without changing it.');
      expect(quoted).toMatch(/^[\x20-\x7E]{1,48}$/);
      expect(quoted).not.toMatch(/[<>&"'`]/);
    }
  });

  it('cuts a long model name short in a sentence, and hands the whole name on in the counts', () => {
    const long = `https://evil.example/${'a'.repeat(59)}`;
    expect(long).toHaveLength(80);
    const text = GOOD.replace('model-a | in 10', `${long} | in 0`).replace('cache_write 20 | cache_read 30', 'cache_write 0 | cache_read 0').replace('total | 100', 'total | 40');
    const got = readAnswer(text, '2026-10-07');
    expect(got.state).toBe('ok');
    if (got.state !== 'ok') return;
    expect(got.usage.models.map((m) => m.model)).toEqual([long]);
    expect(got.notes.map((n) => n.message)).toEqual([NOTES['output-without-input'].replace('{detail}', long.slice(0, 48))]);
    const twice = readAnswer(text.replace(/\n/, `\n${long} | in 0 | cache_write 0 | cache_read 0 | out 0\n`), '2026-10-07');
    expect(twice).toMatchObject({ state: 'problem', code: 'duplicate-model', message: PROBLEMS['duplicate-model'].replace('{detail}', long.slice(0, 48)) });
  });
});

describe('the sentences', () => {
  const all = [EMPTY, NO_USAGE_OTHER_CAUSES, SHORT_DATA_USUAL_CAUSE, ...Object.values(PROBLEMS), ...Object.values(NOTES)];

  it('never claim anything about emissions with the words the project avoids', () => {
    for (const s of all) expect(s).not.toMatch(/offset|neutral|compensat/i);
  });

  it('end as finished sentences', () => {
    for (const s of all) expect(s).toMatch(/\.$/);
  });

  it('are plain text: no markup, no code marks, nothing that cannot be seen', () => {
    for (const s of all) expect(s).toMatch(/^[\x20-\x7E“”]+$/);
    for (const s of all) expect(s).not.toMatch(/[<>`*_]{2}|`/);
  });

  it('have at most one place for a detail', () => {
    for (const s of all) expect(s.split('{detail}').length).toBeLessThanOrEqual(2);
    for (const s of [EMPTY, NO_USAGE_OTHER_CAUSES, SHORT_DATA_USUAL_CAUSE]) expect(s).not.toContain('{detail}');
  });
});

describe('readAnswer: hostile input', () => {
  const n = LIMITS.maxChars;
  const head = 'ai-co2 v1 | 2026-09-08 to 2026-10-07 | data 2026-09-08 to 2026-10-07\n';
  const fill = (unit: string, room: number) => unit.repeat(Math.ceil(room / unit.length)).slice(0, room);
  const hostile: Array<[string, string]> = [
    ['a long run of spaces', head + fill(' ', n - head.length - 12) + '\ntotal | 0'],
    ['a long run of spaces and no total', head + fill(' ', n - head.length)],
    ['a long run of line breaks', head + fill('\n', n - head.length - 12) + '\ntotal | 0'],
    ['a long run of letters', head + fill('a', n - head.length - 12) + '\ntotal | 0'],
    ['a long run of digits', head + 'm | in ' + fill('1', n - head.length - 30) + '\ntotal | 0'],
    ['grouped digits without end', head + 'm | in 1' + fill(',234', n - head.length - 30) + '\ntotal | 0'],
    ['half model lines', head + fill('a | in 1 | cache_write 1 | cache_read 1 | out ', n - head.length - 12) + '\ntotal | 0'],
    ['names at their longest', head + fill('a'.repeat(80) + ' ', n - head.length - 12) + '\ntotal | 0'],
    ['header starts without end', fill('ai-co2 v1 |', n)],
    ['eight headers, each with a long tail', fill(head + fill(' | ', 2400), n)],
    ['quote marks and bullets', fill('> ⏺ ', n)],
    ['spaces before a bar', fill(' ', n - 1) + '|'],
    ['dates without end', 'ai-co2 v1 | ' + fill('2026-09-08 to ', n - 12)],
    ['special spaces', head + fill('\u00a0\u2003\u200b', n - head.length - 12) + '\ntotal | 0'],
  ];

  it.each(hostile)('stays fast and gives a sentence: %s', (_name, text) => {
    expect(text.length).toBeLessThanOrEqual(n);
    const started = performance.now();
    const got = readAnswer(text, '2026-10-07');
    const took = performance.now() - started;
    expect(got.state).toBe('problem');
    // About 30 ms on one laptop at worst (a long run of letters). The limit is loose so a busy machine does not fail it.
    expect(took).toBeLessThan(500);
  });

  it('answers every hand-written case at once', () => {
    for (const c of file.cases) {
      const started = performance.now();
      readAnswer(c.input, c.today);
      expect(performance.now() - started, c.name).toBeLessThan(500);
    }
  });

  it('refuses anything longer without reading it', () => {
    expect(readAnswer(GOOD + ' '.repeat(n), '2026-10-07')).toMatchObject({ state: 'problem', code: 'too-long' });
  });

  it('never throws and never accepts a wrong sum, whatever is pasted', () => {
    // A small fixed-seed generator, so a failure can be repeated.
    let seed = 20261007;
    const random = (below: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % below;
    };
    const pieces = [
      'ai-co2 v1 | ', 'ai-co2 v2 | ', '2026-09-08 to 2026-10-07', ' | data ', 'none', '2026-09-31', '\n', ' ', '|', ' | in ',
      ' | cache_write ', ' | cache_read ', ' | out ', 'total | ', 'model-a', 'constructor', '__proto__', '1', '20', '300', '1,000',
      '9'.repeat(16), '1.5', '-3', '1e9', '<b>', '`', '*', '⎿', '\u00a0', 'AI_CO2_END', '\r\n', '0',
    ];
    for (let round = 0; round < 4000; round += 1) {
      let text = '';
      for (let i = random(40); i >= 0; i -= 1) text += pieces[random(pieces.length)] ?? '';
      const got = readAnswer(text, '2026-10-07');
      if (got.state === 'problem') expect(got.message).not.toMatch(/[<>`]|\{detail\}/);
      if (got.state !== 'ok') continue;
      const sum = got.usage.models.reduce((a, m) => a + m.freshInput + m.cacheWrite + m.cacheRead + m.output, 0);
      expect(sum).toBe(got.total);
      expect(sum).toBeGreaterThan(0);
      for (const m of got.usage.models) expect(m.model).toMatch(/^[A-Za-z][A-Za-z0-9._:/@-]{0,79}$/);
    }
  });

  it('gives a reading, not an error, for values that are not text', () => {
    const notText: unknown[] = [undefined, null, 42, {}, ['ai-co2 v1 |']];
    for (const value of notText) {
      // The paste box only ever holds text. This is here for a caller that gets it wrong.
      const got = readAnswer(value as string, value as string);
      expect(got).toEqual({ state: 'empty' });
    }
  });
});
