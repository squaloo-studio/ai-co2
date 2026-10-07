// Tries to make count-tokens.py and count-tokens.mjs give a wrong total or disagree: other time
// zones, clock changes, odd folders, files that are not logs, values of the wrong kind. Every log
// is made up and lives in a temporary folder. Where the time matters, the scripts get another
// clock from outside (see count-tokens.run.ts), so their text is run exactly as it is.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAnswer } from './answer';
import { addDays, dayIn, findPythons, line, row, runNode, runPython, sameCalendar, snapshot } from './count-tokens.run';
import type { Run, Setting } from './count-tokens.run';

const pythons = findPythons();

let root = '';
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ai-co2-attack-'));
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

type Content = string[] | Buffer;
let folders = 0;

/** Writes made-up logs into a new folder under the temporary folder and returns that folder. */
function folderWith(name: string, files: Record<string, Content>, changed?: Date): string {
  const folder = join(root, `${name}-${(folders += 1)}`);
  for (const [path, content] of Object.entries(files)) {
    const full = join(folder, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, Array.isArray(content) ? `${content.join('\n')}\n` : content);
    if (changed) utimesSync(full, changed, changed);
  }
  return folder;
}

type Runner = (setting: Omit<Setting, 'root'>) => Run;
const scripts: Array<[string, Runner]> = [
  ['count-tokens.mjs', (setting) => runNode({ root, ...setting })],
  ...pythons.map((python): [string, Runner] => [`count-tokens.py on Python ${python.version}`, (setting) => runPython(python, { root, ...setting })]),
];

/** The lines between the first and the last: one per model. */
const rowsOf = (run: Run) => run.lines.slice(1, -1);
const clean = (run: Run) => {
  expect(run.errors).toBe('');
  expect(run.status).toBe(0);
};

// ---------- the 30 days, wherever the computer is ----------

const MINUTE = 60_000;
const DAY = 86_400_000;

interface Place {
  zone: string;
  /** What the computer's clock says when the script runs. */
  now: string;
  why: string;
}

// All of these moments are in the past, so the rules for them are settled.
const places: Place[] = [
  { zone: 'Pacific/Kiritimati', now: '2026-09-30T23:30:00Z', why: '14 hours east of UTC' },
  { zone: 'Pacific/Pago_Pago', now: '2026-10-01T09:00:00Z', why: '11 hours west of UTC' },
  { zone: 'Asia/Kathmandu', now: '2026-09-15T18:20:00Z', why: '5 hours 45 minutes east of UTC, five minutes after midnight' },
  { zone: 'America/New_York', now: '2025-11-15T17:00:00Z', why: 'the clocks went back inside the window' },
  { zone: 'Europe/Berlin', now: '2026-04-10T08:00:00Z', why: 'the clocks went forward inside the window' },
  { zone: 'Australia/Lord_Howe', now: '2025-10-20T01:00:00Z', why: 'a clock change of half an hour inside the window' },
  { zone: 'America/Santiago', now: '2026-10-05T16:00:00Z', why: 'the first day has no midnight: the clocks jump from 00:00 to 01:00' },
  { zone: 'Africa/Cairo', now: '2026-05-23T10:00:00Z', why: 'the first day has no midnight: the clocks jump from 00:00 to 01:00' },
  { zone: 'America/Havana', now: '2025-12-01T17:00:00Z', why: 'the first hour of the first day comes twice' },
  { zone: 'Europe/Berlin', now: '2026-03-29T01:30:00Z', why: 'run on the day the clocks go forward' },
];

/** The first moment, to the millisecond, from which `inside` holds. `inside` must hold at `high` and not at `low`. */
function firstMoment(low: number, high: number, inside: (ms: number) => boolean): number {
  let a = low;
  let b = high;
  while (b - a > 1) {
    const middle = Math.floor((a + b) / 2);
    if (inside(middle)) b = middle;
    else a = middle;
  }
  return b;
}

describe.each(places)('the 30 days in $zone ($why)', ({ zone, now: nowText }) => {
  const now = new Date(nowText);
  const today = dayIn(zone, now);
  const firstDay = addDays(today, -29);
  // The rule the scripts must follow, said without any clock arithmetic: an entry counts when its
  // calendar day in this zone is one of the 30 days that end today.
  const counts = (ms: number) => {
    const day = dayIn(zone, new Date(ms));
    return day >= firstDay && day <= today;
  };
  const opens = firstMoment(now.getTime() - 31 * DAY, now.getTime(), (ms) => dayIn(zone, new Date(ms)) >= firstDay);
  const closes = firstMoment(now.getTime(), now.getTime() + 2 * DAY, (ms) => dayIn(zone, new Date(ms)) > today);

  const moments = new Set<number>();
  // Every half hour from two days before the window to two days after today.
  for (let ms = opens - 2 * DAY + 7 * MINUTE; ms < closes + 2 * DAY; ms += 30 * MINUTE) moments.add(ms);
  // Every minute for three hours around the moment the window opens, and around the end of today.
  for (const edge of [opens, closes]) for (let ms = edge - 180 * MINUTE; ms <= edge + 180 * MINUTE; ms += MINUTE) moments.add(ms);
  // The last and the first millisecond and second at each edge.
  for (const edge of [opens, closes]) for (const step of [-1000, -1, 0, 1, 999, 1000]) moments.add(edge + step);
  moments.add(now.getTime());

  const entries = [...moments].sort((a, b) => a - b);
  const expectedCount = entries.filter(counts).length;
  const want = [`ai-co2 v1 | ${firstDay} to ${today} | data ${firstDay} to ${today}`, row('inside', expectedCount, 0, 0, 0), `total | ${expectedCount}`];
  let made: string | undefined;
  const config = () =>
    (made ??= folderWith('place', { 'projects/-p/s.jsonl': entries.map((ms, i) => line(counts(ms) ? 'inside' : 'outside', `m${i}`, `r${i}`, new Date(ms), [1, 0, 0, 0])) }, now));

  it('is a real test: entries lie on both sides of both edges', () => {
    expect(counts(opens - 1)).toBe(false);
    expect(counts(opens)).toBe(true);
    expect(counts(closes - 1)).toBe(true);
    expect(counts(closes)).toBe(false);
    expect(expectedCount).toBeGreaterThan(29 * 48);
    expect(entries.length - expectedCount).toBeGreaterThan(4 * 48);
  });

  it('count-tokens.mjs counts exactly the entries of the 30 calendar days', () => {
    const got = runNode({ root, config: config(), zone, now });
    clean(got);
    expect(got.lines).toEqual(want);
  });

  for (const python of pythons) {
    // A Python that reads the zone differently from Node (no zone files, older ones, Windows) cannot be compared.
    const comparable = sameCalendar(python, zone, [opens, closes].flatMap((edge) => [-90, -60, -30, -1, 0, 1, 30, 60, 90].map((m) => new Date(edge + m * MINUTE))));
    it.skipIf(!comparable)(`count-tokens.py on Python ${python.version} counts exactly the entries of the 30 calendar days`, () => {
      const got = runPython(python, { root, config: config(), zone, now });
      clean(got);
      expect(got.lines).toEqual(want);
    });
  }
});

// ---------- where the logs are ----------

const DAYS_AGO = (n: number) => new Date(Date.now() - n * DAY);
const recent = DAYS_AGO(3);
let ids = 0;
/** One whole entry with its own ids. */
const one = (model: string, counts: [number, number, number, number] = [1, 2, 3, 4]) => line(model, `id${(ids += 1)}`, `req${ids}`, recent, counts);

describe.each(scripts)('%s finds the logs', (_name, run) => {
  it('in a config folder with square brackets, a star and a question mark in its name', () => {
    // Windows does not allow a star or a question mark in a folder name.
    const names = process.platform === 'win32' ? ['my [work] folder', 'Büro Zürich (1)'] : ['my [work] folder', 'what? *really*', 'Büro Zürich (1)'];
    for (const name of names) {
      const config = join(folderWith('named', { [`${name}/projects/-p/a.jsonl`]: [one('found')] }), name);
      const got = run({ config });
      clean(got);
      expect(rowsOf(got)).toEqual([row('found', 1, 2, 3, 4)]);
    }
  });

  it('under a home folder with square brackets in its name, when no config folder is set', () => {
    const home = join(folderWith('home-brackets', { 'home [1]/.claude/projects/-p/a.jsonl': [one('found')] }), 'home [1]');
    const got = run({ config: null, home });
    clean(got);
    expect(rowsOf(got)).toEqual([row('found', 1, 2, 3, 4)]);
  });

  it('in both default folders, and counts a request that is in both only once', () => {
    const home = join(
      folderWith('two-defaults', {
        'home/.claude/projects/-p/a.jsonl': [one('first-folder'), line('both', 'b1', 'b1', recent, [1, 0, 0, 0])],
        'home/.config/claude/projects/-p/b.jsonl': [one('second-folder'), line('both', 'b1', 'b1', recent, [1, 0, 0, 0])],
      }),
      'home',
    );
    const got = run({ config: null, home });
    clean(got);
    expect(rowsOf(got)).toEqual([row('first-folder', 1, 2, 3, 4), row('second-folder', 1, 2, 3, 4), row('both', 1, 0, 0, 0)]);
  });

  it('under XDG_CONFIG_HOME in place of ~/.config when that is set', () => {
    const base = folderWith('xdg', {
      'home/.claude/projects/-p/a.jsonl': [one('home-claude')],
      'home/.config/claude/projects/-p/b.jsonl': [one('not-read')],
      'elsewhere/claude/projects/-p/c.jsonl': [one('xdg')],
    });
    const got = run({ config: null, home: join(base, 'home'), xdg: join(base, 'elsewhere') });
    clean(got);
    expect(rowsOf(got)).toEqual([row('home-claude', 1, 2, 3, 4), row('xdg', 1, 2, 3, 4)]);
  });

  // Making links needs a special right on Windows.
  it.skipIf(process.platform === 'win32')('through links: nothing counted twice, no endless walk through a link to its own folder, nothing changed', () => {
    const config = folderWith('links', {
      'projects/-p/s1.jsonl': [one('linked')],
      'projects/-p/folder.jsonl/inner.jsonl': [one('in-a-folder-named-like-a-log', [5, 0, 0, 0])],
      'projects/-p/.hidden/h.jsonl': [one('hidden-folder')],
      'projects/-p/.hidden.jsonl': [one('hidden-file')],
      'projects/-p/s1.jsonl.bak': [one('other-ending')],
      'projects/top.jsonl': [one('top-level', [8, 0, 0, 0])],
      'outside/elsewhere.jsonl': [one('behind-a-link', [7, 0, 0, 0]), line('no-request-id', 'n1', null, recent, [9, 0, 0, 0])],
    });
    const p = join(config, 'projects/-p');
    symlinkSync('.', join(p, 'loop'));
    symlinkSync('s1.jsonl', join(p, 'copy.jsonl'));
    symlinkSync('nowhere.jsonl', join(p, 'broken.jsonl'));
    symlinkSync('self.jsonl', join(p, 'self.jsonl'));
    symlinkSync(join(config, 'outside'), join(p, 'out'));
    const before = snapshot(config);
    const got = run({ config });
    clean(got);
    expect(rowsOf(got)).toEqual([
      row('linked', 1, 2, 3, 4),
      row('no-request-id', 9, 0, 0, 0),
      row('top-level', 8, 0, 0, 0),
      row('behind-a-link', 7, 0, 0, 0),
      row('in-a-folder-named-like-a-log', 5, 0, 0, 0),
    ]);
    expect(snapshot(config)).toEqual(before);
  });

  // One link back to a folder ends by itself: the system gives up after some forty levels. Two links
  // double the paths at every level, so a walk that follows them all never ends.
  it.skipIf(process.platform === 'win32')('through links that lead back in more than one way: every folder is walked once, and the walk ends', () => {
    const config = folderWith('loops', {
      'projects/top.jsonl': [one('top-level', [8, 0, 0, 0])],
      'projects/-a/a.jsonl': [one('in-a', [7, 0, 0, 0])],
      'projects/-b/b.jsonl': [one('in-b', [6, 0, 0, 0])],
      'projects/-c/deep/c.jsonl': [one('in-c', [5, 0, 0, 0])],
    });
    const projects = join(config, 'projects');
    // Two links back to the top, two folders that link to each other, and a third way round.
    symlinkSync('.', join(projects, 'again'));
    symlinkSync(projects, join(projects, 'once-more'));
    symlinkSync(join(projects, '-b'), join(projects, '-a', 'to-b'));
    symlinkSync(join(projects, '-a'), join(projects, '-b', 'to-a'));
    symlinkSync('..', join(projects, '-c', 'deep', 'up'));
    symlinkSync(join(projects, '-c'), join(projects, '-b', 'to-c'));
    const before = snapshot(config);
    const started = Date.now();
    const got = run({ config });
    expect(Date.now() - started).toBeLessThan(20_000);
    clean(got);
    expect(rowsOf(got)).toEqual([row('top-level', 8, 0, 0, 0), row('in-a', 7, 0, 0, 0), row('in-b', 6, 0, 0, 0), row('in-c', 5, 0, 0, 0)]);
    expect(snapshot(config)).toEqual(before);
  });

  // With no CLAUDE_CONFIG_DIR both folders are read. When one is a link to the other, its logs are still read once.
  it.skipIf(process.platform === 'win32')('when ~/.config/claude is a link to ~/.claude', () => {
    const base = folderWith('same-folder-twice', { 'home/.claude/projects/-p/a.jsonl': [one('read-once')] });
    mkdirSync(join(base, 'home/.config'), { recursive: true });
    symlinkSync(join(base, 'home/.claude'), join(base, 'home/.config/claude'));
    const got = run({ config: null, home: join(base, 'home') });
    clean(got);
    expect(rowsOf(got)).toEqual([row('read-once', 1, 2, 3, 4)]);
  });

  it('and says "nothing found" when projects is a file, not a folder', () => {
    const got = run({ config: folderWith('projects-is-a-file', { projects: ['not a folder'] }) });
    clean(got);
    expect(got.lines.slice(1)).toEqual(['total | 0']);
    expect(got.lines[0]).toMatch(/\| data none$/);
  });
});

// ---------- what is in the files ----------

const withBytes = (text: string, bytes: number[]): Buffer => {
  const [before = '', after = ''] = text.split('X');
  return Buffer.concat([Buffer.from(before), Buffer.from(bytes), Buffer.from(`${after}\n`)]);
};
const noise = Buffer.from(Array.from({ length: 70_000 }, (_, i) => (i * 7919 + 13) % 256));

describe.each(scripts)('%s reads files that are not clean logs', (_name, run) => {
  it('skips what is not text, and still counts the good lines around it', () => {
    const config = folderWith('not-text', {
      'projects/-p/noise.jsonl': noise,
      'projects/-p/noise-then-a-line.jsonl': Buffer.concat([noise, Buffer.from('"usage"'), noise, Buffer.from(`\n${one('after-noise')}\n`)]),
      'projects/-p/zipped.jsonl': gzipSync(`${one('zipped')}\n`),
      'projects/-p/two-byte.jsonl': Buffer.from(`\ufeff${one('two-byte-text')}\n`, 'utf16le'),
      'projects/-p/nul.jsonl': Buffer.from(`${one('nul-at-the-end')}\0\n\0${one('nul-at-the-start')}\n${one('after-nul')}\n`),
      'projects/-p/windows.jsonl': Buffer.from(`${one('windows-1')}\r\n${one('windows-2')}\r\n`),
      'projects/-p/old-mac.jsonl': Buffer.from(`${one('old-mac-1')}\r${one('old-mac-2')}\r`),
      'projects/-p/no-line-end.jsonl': Buffer.from(one('no-line-end')),
      'projects/-p/empty.jsonl': Buffer.alloc(0),
      'projects/-p/blank-lines.jsonl': Buffer.from(`\n\n${one('blank-lines')}\n\n\n`),
      'projects/-p/bad-bytes.jsonl': withBytes(one('bad-bytes').replace('"type"', '"text":"X","type"'), [0xff, 0xfe, 0xc3, 0x28, 0xe2, 0x82]),
      'projects/-p/long.jsonl': [one('long-line').replace('"type"', `"text":"${'x'.repeat(3_000_000)}","type"`)],
      // A line separator inside a line is allowed in JSON and must not split the line.
      'projects/-p/separators.jsonl': [one('line-separator').replace('"type"', '"text":"one\u2028two\u2029three\u0085four","type"')],
    });
    const got = run({ config });
    clean(got);
    const names = ['after-noise', 'after-nul', 'bad-bytes', 'blank-lines', 'line-separator', 'long-line', 'no-line-end', 'old-mac-1', 'old-mac-2', 'windows-1', 'windows-2'];
    expect(rowsOf(got)).toEqual(names.map((name) => row(name, 1, 2, 3, 4)));
    expect(got.lines.at(-1)).toBe(`total | ${names.length * 10}`);
  });

  it('counts invalid bytes in a model name as one safe character each', () => {
    const config = folderWith('bad-names', {
      'projects/-p/a.jsonl': Buffer.concat([withBytes(one('nameX'), [0xff, 0xfe]), withBytes(one('cutX'), [0xe2, 0x82]), withBytes(one('longX'), [0xf0, 0x9f, 0x98])]),
    });
    const got = run({ config });
    clean(got);
    expect(rowsOf(got)).toEqual([row('cut_', 1, 2, 3, 4), row('long_', 1, 2, 3, 4), row('name__', 1, 2, 3, 4)]);
  });

  it('counts numbers of the wrong kind as nothing, and never as text or as a fraction', () => {
    // Written out as text, so that every number reaches the scripts exactly as it stands here.
    const raw = (model: string, fresh: string, write: string, read: string, out: string) =>
      `{"type":"assistant","timestamp":"${recent.toISOString()}","sessionId":"s1","requestId":"r-${model}","message":{"id":"i-${model}","model":"${model}","usage":{"input_tokens":${fresh},"cache_creation_input_tokens":${write},"cache_read_input_tokens":${read},"output_tokens":${out}}}}`;
    const config = folderWith('numbers', {
      'projects/-p/a.jsonl': [
        raw('largest-counted', '999999999999999', '1000000000000000', '1e15', '123'),
        raw('too-large', '9007199254740993', '18446744073709551616', '1e400', '5'),
        raw('fractions', '1.9', '1e3', '2.5e2', '0.99'),
        raw('negative-and-text', '-5', '-0.0', '0', '"7"'),
        raw('not-numbers', 'true', 'null', '[]', '{}'),
      ],
    });
    const got = run({ config });
    clean(got);
    expect(got.lines.slice(1)).toEqual([row('largest-counted', 999999999999999, 0, 0, 123), row('fractions', 1, 1000, 250, 0), row('too-large', 0, 0, 0, 5), 'total | 1000000000001378']);
    // The page then refuses it: no person uses that many tokens.
    expect(readAnswer(got.text, dayIn(undefined, new Date()))).toMatchObject({ state: 'problem', code: 'bad-number' });
  });

  it('skips entries with a missing or wrong part, and keeps every entry that is whole', () => {
    // One whole entry in three parts, so that any part can be given a value of the wrong kind.
    type Loose = { [key: string]: unknown };
    const whole = () => {
      const usage: Loose = { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 };
      const message: Loose = { id: 'id', model: 'm', role: 'assistant', usage };
      const top: Loose = { type: 'assistant', timestamp: recent.toISOString(), sessionId: 's1', isSidechain: false, requestId: 'r', message };
      return { top, message, usage };
    };
    const changed = (change: (entry: ReturnType<typeof whole>) => void) => {
      const entry = whole();
      change(entry);
      return JSON.stringify(entry.top);
    };
    const wrong: unknown[] = [null, true, 0, -3, '', 'text', [], [1], {}, { a: 1 }];
    const lines: string[] = ['{}', '[]', 'null', '"usage"', '{"usage":1}', '', '   ', '{"message":{"usage":{}}}', '{"type":"assistant","message":{"usage":{"input_tokens":999999'];
    let n = 0;
    for (const value of wrong) {
      const own = (e: ReturnType<typeof whole>, model: string) => {
        e.message.id = `w${(n += 1)}`;
        e.top.requestId = `w${n}`;
        e.message.model = model;
      };
      // None of these is an entry: skipped.
      lines.push(changed((e) => { e.top.message = value; e.top.note = '"usage"'; }));
      lines.push(changed((e) => { e.message.usage = value; e.top.note = '"usage"'; }));
      lines.push(changed((e) => { e.top.timestamp = value; }));
      if (value !== 'text' && value !== '') lines.push(changed((e) => { e.message.model = value; }));
      // Each of these is a whole entry with one odd part: counted, 10 tokens each.
      lines.push(changed((e) => { own(e, 'odd-side-flag'); e.top.isSidechain = value; }));
      lines.push(changed((e) => { own(e, 'odd-steps'); e.usage.iterations = value; }));
      lines.push(changed((e) => { own(e, 'odd-step'); e.usage.iterations = [value, { type: value, input_tokens: 100 }]; }));
      lines.push(changed((e) => { own(e, 'odd-number'); e.usage.cache_read_input_tokens = value; }));
    }
    const got = run({ config: folderWith('wrong-kinds', { 'projects/-p/a.jsonl': lines }) });
    clean(got);
    const k = wrong.length;
    expect(got.lines.slice(1)).toEqual([row('odd-side-flag', k, 2 * k, 3 * k, 4 * k), row('odd-step', k, 2 * k, 3 * k, 4 * k), row('odd-steps', k, 2 * k, 3 * k, 4 * k), row('odd-number', k, 2 * k, 0, 4 * k), `total | ${37 * k}`]);
  });
});

// ---------- one request in many places ----------

describe.each(scripts)('%s counts each request once', (_name, run) => {
  it('when the same ids are in several files and folders', () => {
    const config = folderWith('copies', {
      // One request in five files: the copy with the highest output wins, 10 + 20 + 30 + 40.
      'projects/-p1/a.jsonl': [line('m', 'dup', 'rdup', recent, [10, 20, 30, 5]), line('m', 'dup2', 'rdup2', recent, [1, 1, 1, 1])],
      'projects/-p1/b.jsonl': [line('m', 'dup', 'rdup', recent, [10, 20, 30, 40])],
      'projects/-p2/z.jsonl': [line('m', 'dup', 'rdup', recent, [10, 20, 30, 40]), line('m', 'dup', 'rdup', new Date(recent.getTime() + 5), [10, 20, 30, 7])],
      // A side conversation: a copy of "dup", and a replay of "dup2" under a new request id (dropped).
      'projects/-p2/s/subagents/deeper/agent-1.jsonl': [line('m', 'dup', 'rdup', recent, [10, 20, 30, 40], { side: true }), line('m', 'dup2', 'rother', recent, [9, 9, 9, 9], { side: true })],
      'projects/-p3/s.orphaned-1-x.jsonl': [line('m', 'dup', 'rdup', recent, [10, 20, 30, 39], { session: 'other' })],
      // The same message id under two request ids, both in main conversations: two requests.
      'projects/-p4/a.jsonl': [line('n', 'same', 'r-one', recent, [1, 0, 0, 1]), line('n', 'same', 'r-two', recent, [2, 0, 0, 2])],
      // The same message id under two request ids, only ever in side conversations: both kept.
      'projects/-p5/s/subagents/agent-2.jsonl': [line('o', 'side-only', 'rs1', recent, [3, 0, 0, 3], { side: true }), line('o', 'side-only', 'rs2', recent, [4, 0, 0, 4], { side: true })],
    });
    const got = run({ config });
    clean(got);
    expect(got.lines.slice(1)).toEqual([row('m', 11, 21, 31, 41), row('o', 7, 0, 0, 7), row('n', 3, 0, 0, 3), 'total | 124']);
  });

  it('and adds the steps that the top-level numbers leave out, each under its own model', () => {
    const config = folderWith('steps', {
      'projects/-p/a.jsonl': [
        line('answerer', 'F1', 'F1', recent, [10, 0, 0, 10], {
          top: { advisorModel: 'adviser' },
          usage: {
            iterations: [
              { type: 'message', model: 'declined', input_tokens: 100 },
              { type: 'message', input_tokens: 1000 }, // a declined attempt that names no model
              { type: 'fallback_message', model: 'answerer', input_tokens: 10, output_tokens: 10 }, // the top-level numbers again
              { type: 'advisor_message', input_tokens: 10000 }, // no model: the entry's advisor model
              { type: 'compaction', input_tokens: 100000 }, // no model: the request's own
              { type: 'something_new', model: 'new', input_tokens: 7777 }, // a kind of step nobody knows: not added
              { input_tokens: 8888 },
            ],
          },
        }),
        // Nothing counted on this day, so it is not a day with data.
        line('zero', 'Z1', 'Z1', DAYS_AGO(20), [0, 0, 0, 0], { usage: { iterations: [{ type: 'compaction', input_tokens: 0 }] } }),
      ],
    });
    const got = run({ config });
    clean(got);
    const day = dayIn(undefined, recent);
    expect(got.lines[0]).toMatch(new RegExp(`\\| data ${day} to ${day}$`));
    expect(got.lines.slice(1)).toEqual([row('answerer', 100010, 0, 0, 10), row('adviser', 10000, 0, 0, 0), row('unknown', 1000, 0, 0, 0), row('declined', 100, 0, 0, 0), 'total | 111120']);
  });
});

// ---------- a Python that is too old ----------

describe.each(pythons)('count-tokens.py on Python $version', (python) => {
  // Before Python 3.7 the script cannot read a time stamp. Without its own check it would skip
  // every line and print "data none" and a total of 0: a wrong answer that looks like a right one.
  it.each(['3.6.8', '3.7.17', '2.7.18'])('stops with a sentence, and prints no answer, when Python says it is %s', (pythonSays) => {
    const config = folderWith('old-python', { 'projects/-p/a.jsonl': [one('m')] });
    const got = runPython(python, { root, config, pythonSays });
    expect(got.text).toBe('');
    expect(got.status).not.toBe(0);
    expect(got.errors.trim()).toBe('This script needs Python 3.8 or later.');
  });

  it('runs when Python says it is 3.8', () => {
    const config = folderWith('old-python', { 'projects/-p/a.jsonl': [one('m')] });
    const got = runPython(python, { root, config, pythonSays: '3.8.0' });
    clean(got);
    expect(rowsOf(got)).toEqual([row('m', 1, 2, 3, 4)]);
  });
});
