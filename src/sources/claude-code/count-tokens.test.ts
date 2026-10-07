// Runs count-tokens.py and count-tokens.mjs against made-up log files in a temporary folder and
// compares what they print with totals worked out by hand, with each other, and with what the
// answer reader accepts. The scripts are pointed at that folder through CLAUDE_CONFIG_DIR, the same
// switch a real person can use, so they hold no test-only code. No real log folder is ever read.

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readAnswer } from './answer';
import { findPythons, line, NO_PYTHON, runNode, runPython, snapshot, writtenToHome } from './count-tokens.run';
import type { Run } from './count-tokens.run';

const pythons = findPythons();
if (pythons.length === 0) console.warn(`count-tokens.test.ts: ${NO_PYTHON}.`);

// ---- the made-up logs ----

const DAY = 86_400_000;
const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = localDay(now);
/** The moment the window opens: local midnight, 29 days before today. */
const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
const firstDay = localDay(midnight);
const recent = new Date(now.getTime() - 3 * DAY);
const earlier = new Date(now.getTime() - 11 * DAY);
const later = (d: Date, ms: number) => new Date(d.getTime() + ms);

const iso = (d: Date) => d.toISOString(); // three decimals
const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z');

const files: Record<string, string[]> = {
  // The main conversation.
  'projects/-p1/s1.jsonl': [
    // 1. One request logged three times while the output count grows: count 619 once.
    line('claude-opus-5-5', 'msg_A', 'req_A', recent, [10, 100, 1000, 3]),
    line('claude-opus-5-5', 'msg_A', 'req_A', recent, [10, 100, 1000, 3]),
    line('claude-opus-5-5', 'msg_A', 'req_A', recent, [10, 100, 1000, 619]),
    // 2. One request logged twice with equal numbers: count once.
    line('claude-opus-5-5', 'msg_B', 'req_B', recent, [5, 0, 2000, 50]),
    line('claude-opus-5-5', 'msg_B', 'req_B', recent, [5, 0, 2000, 50]),
    // 3. A line without usage, a broken line, and usage of the wrong type.
    JSON.stringify({ type: 'user', timestamp: iso(recent), message: { role: 'user', content: 'the word "usage" in text' } }),
    '{"type":"assistant","message":{"usage":{"input_tokens":999999',
    JSON.stringify({ type: 'assistant', timestamp: iso(recent), requestId: 'req_N', message: { id: 'msg_N', model: 'claude-opus-5-5', usage: null } }),
    // 4. The "<synthetic>" model (an error notice): skipped even with numbers in it.
    line('<synthetic>', 'msg_S', null, recent, [7, 7, 7, 7], { top: { isApiErrorMessage: true } }),
    // 5. Older than the window, although the file itself is fresh: skipped.
    line('claude-opus-5-5', 'msg_OLD', 'req_OLD', later(now, -40 * DAY), [1000, 1000, 1000, 1000]),
    // 6. One minute before the window opens: skipped. One minute after: counted.
    line('claude-opus-5-5', 'msg_EDGE1', 'req_EDGE1', later(midnight, -60_000), [4000, 0, 0, 4000]),
    line('claude-opus-5-5', 'msg_EDGE2', 'req_EDGE2', later(midnight, 60_000), [1, 0, 0, 2]),
    // 7. An advisor call. The top-level numbers are the two "message" steps. The advisor step is
    //    extra and belongs to claude-opus-5.
    line('claude-sonnet-5', 'msg_ADV', 'req_ADV', earlier, [2, 7853, 226584, 491], {
      top: { advisorModel: 'claude-opus-5' },
      usage: {
        iterations: [
          { type: 'message', model: null, input_tokens: 1, output_tokens: 45, cache_read_input_tokens: 109696, cache_creation_input_tokens: 7192 },
          { type: 'advisor_message', model: 'claude-opus-5', input_tokens: 159419, output_tokens: 7805, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          { type: 'message', model: null, input_tokens: 1, output_tokens: 446, cache_read_input_tokens: 116888, cache_creation_input_tokens: 661 },
        ],
      },
    }),
    // 8. Extra detail fields must not be added again.
    line('claude-sonnet-5', 'msg_X', 'req_X', earlier, [3, 30, 300, 40], {
      usage: {
        output_tokens_details: { thinking_tokens: 25 },
        server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 },
        cache_creation: { ephemeral_1h_input_tokens: 30, ephemeral_5m_input_tokens: 0 },
        iterations: [{ type: 'message', input_tokens: 3, output_tokens: 40, cache_read_input_tokens: 300, cache_creation_input_tokens: 30 }],
      },
    }),
    // 9. Model names with characters the answer format does not allow.
    line('odd model|v2', 'msg_ODD', 'req_ODD', earlier, [1, 1, 1, 1]),
    line('4é-x', 'msg_ODD2', 'req_ODD2', earlier, [2, 0, 0, 0]),
    // 16. A fallback. The top-level numbers are the model that answered (the "fallback_message"
    //     step). The attempt the first model declined is the "message" step and is extra.
    line('claude-opus-4-8', 'msg_FB', 'req_FB', earlier, [412, 0, 0, 264], {
      usage: {
        iterations: [
          { type: 'message', model: 'claude-fable-5', input_tokens: 535, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 412, output_tokens: 264, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        ],
      },
    }),
    // 17. A compaction step: 180000 in and 3500 out are extra and belong to the request's own model.
    line('claude-opus-4-8', 'msg_CP', 'req_CP', earlier, [23000, 0, 0, 1000], {
      usage: {
        iterations: [
          { type: 'compaction', input_tokens: 180000, output_tokens: 3500 },
          { type: 'message', input_tokens: 23000, output_tokens: 1000 },
        ],
      },
    }),
    // 18. Time stamps without decimals, with six decimals and with one: all counted.
    line('claude-opus-4-8', 'msg_T1', 'req_T1', earlier, [1, 0, 0, 0], { stamp: isoSeconds(earlier) }),
    line('claude-opus-4-8', 'msg_T2', 'req_T2', earlier, [1, 0, 0, 0], { stamp: iso(earlier).replace(/Z$/, '000Z') }),
    line('claude-opus-4-8', 'msg_T3', 'req_T3', earlier, [1, 0, 0, 0], { stamp: isoSeconds(earlier).replace(/Z$/, '.5Z') }),
    // 19. A message id that is not text, and numbers of the wrong kind: no crash.
    //     2.5 counts as 2. "7" and true count as 0.
    line('claude-opus-4-8', ['odd'], 'req_BAD', earlier, [2.5, '7', true, 0]),
    // 20. A time stamp two days in the future (a wrong clock): skipped.
    line('claude-opus-4-8', 'msg_FUT', 'req_FUT', later(now, 2 * DAY), [5000, 0, 0, 5000]),
  ],
  // A subagent of that conversation.
  'projects/-p1/s1/subagents/agent-a.jsonl': [
    // 10. The subagent's own request, logged twice while the output grows: adds to the total.
    line('claude-haiku-4-5-20251001', 'msg_H', 'req_H', recent, [20, 200, 0, 1], { side: true }),
    line('claude-haiku-4-5-20251001', 'msg_H', 'req_H', recent, [20, 200, 0, 300], { side: true }),
    // 11. A replay of the parent's msg_A under a new request id: dropped (rule 5).
    line('claude-opus-5-5', 'msg_A', 'req_REPLAY', recent, [10, 0, 50000, 619], { side: true }),
    // 12. An exact copy of the parent's msg_B: collapses with it.
    line('claude-opus-5-5', 'msg_B', 'req_B', recent, [5, 0, 2000, 50], { side: true }),
  ],
  // A subagent nested deeper.
  'projects/-p1/s1/subagents/workflows/wf_1/agent-b.jsonl': [line('claude-fable-5-1', 'msg_F', 'req_F', recent, [8, 80, 800, 88], { side: true })],
  // Another project.
  'projects/-p2/s2.jsonl': [
    // 13. A resumed conversation copies msg_A into a second file: still counted once.
    line('claude-opus-5-5', 'msg_A', 'req_A', recent, [10, 100, 1000, 619], { session: 's2' }),
    // 14. No request id and a reused message id (a gateway): two separate requests.
    line('claude-sonnet-5', 'gw', null, earlier, [100, 0, 0, 10], { session: 's2' }),
    line('claude-sonnet-5', 'gw', null, later(earlier, 5000), [300, 0, 0, 10], { session: 's2' }),
  ],
  // 21. A gateway that gives every answer the same message id and no request id, with a subagent:
  //     three separate requests. Rule 5 must drop none of them.
  'projects/-p3/s4.jsonl': [line('gw-model', 'ocgo', null, earlier, [10, 0, 0, 1], { session: 's4' })],
  'projects/-p3/s4/subagents/agent-c.jsonl': [
    line('gw-model', 'ocgo', null, later(earlier, 9000), [10, 0, 0, 1], { side: true, session: 's4' }),
    line('gw-model', 'ocgo', null, later(earlier, 19000), [10, 0, 0, 1], { side: true, session: 's4' }),
  ],
  // 22. Two copies of one request with the same output count. Only one has the advisor step.
  //     The fuller copy must win whichever file is read first.
  'projects/-p4/a.jsonl': [
    line('tie-model', 'msg_TIE1', 'req_TIE1', earlier, [1, 0, 0, 5]),
    line('tie-model', 'msg_TIE2', 'req_TIE2', earlier, [1, 0, 0, 5], {
      top: { advisorModel: 'tie-advisor' },
      usage: { iterations: [{ type: 'message', input_tokens: 1, output_tokens: 5 }, { type: 'advisor_message', model: null, input_tokens: 100, output_tokens: 7 }] },
    }),
  ],
  'projects/-p4/z.jsonl': [
    line('tie-model', 'msg_TIE1', 'req_TIE1', earlier, [1, 0, 0, 5], {
      top: { advisorModel: 'tie-advisor' },
      usage: { iterations: [{ type: 'message', input_tokens: 1, output_tokens: 5 }, { type: 'advisor_message', model: 'tie-advisor', input_tokens: 100, output_tokens: 7 }] },
    }),
    line('tie-model', 'msg_TIE2', 'req_TIE2', earlier, [1, 0, 0, 5]),
  ],
  // 23. A compaction on demand: the top-level numbers are zero, the step holds the tokens.
  'projects/-p4/c.jsonl': [
    line('zero-top', 'msg_Z', 'req_Z', earlier, [0, 0, 0, 0], { usage: { iterations: [{ type: 'compaction', input_tokens: 144, output_tokens: 276 }] } }),
  ],
  // 15. Files that must be ignored: the wrong ending, and a file not touched for 45 days.
  'projects/-p2/notes.txt': [line('claude-opus-5-5', 'msg_T', 'req_T', recent, [9000, 9000, 9000, 9000])],
  'projects/-p2/s3.jsonl.superseded-123': [line('claude-opus-5-5', 'msg_U', 'req_U', recent, [9000, 9000, 9000, 9000])],
  'projects/-p2/stale.jsonl': [line('claude-opus-5-5', 'msg_V', 'req_V', later(now, -45 * DAY), [9000, 9000, 9000, 9000])],
};

// Worked out by hand from the list above: fresh input, cache write, cache read, output.
const expectedRows: Array<[string, [number, number, number, number]]> = [
  ['claude-sonnet-5', [2 + 3 + 100 + 300, 7853 + 30, 226584 + 300, 491 + 40 + 10 + 10]], // 7, 8, 14
  ['claude-opus-5', [159419, 0, 0, 7805]], // 7, the advisor
  ['claude-opus-5-5', [10 + 5 + 1, 100, 1000 + 2000, 619 + 50 + 2]], // 1, 2, 6
  ['claude-fable-5-1', [8, 80, 800, 88]],
  ['claude-haiku-4-5-20251001', [20, 200, 0, 300]], // 10
  ['odd_model_v2', [1, 1, 1, 1]], // 9
  ['m_4_-x', [2, 0, 0, 0]], // 9
  ['claude-opus-4-8', [412 + 23000 + 180000 + 1 + 1 + 1 + 2, 0, 0, 264 + 1000 + 3500]], // 16, 17, 18, 19
  ['claude-fable-5', [535, 0, 0, 0]], // 16, the declined attempt
  ['gw-model', [30, 0, 0, 3]], // 21
  ['tie-model', [2, 0, 0, 10]], // 22
  ['tie-advisor', [200, 0, 0, 14]], // 22
  ['zero-top', [144, 0, 0, 276]], // 23
];
const sumOf = (row: readonly number[]) => row.reduce((a, b) => a + b, 0);
const expectedTotal = expectedRows.reduce((a, [, row]) => a + sumOf(row), 0);
const expected = [
  `ai-co2 v1 | ${firstDay} to ${today} | data ${firstDay} to ${localDay(recent)}`,
  ...[...expectedRows]
    .sort((a, b) => sumOf(b[1]) - sumOf(a[1]) || (a[0] < b[0] ? -1 : 1))
    .map(([name, [fresh, write, read, out]]) => `${name} | in ${fresh} | cache_write ${write} | cache_read ${read} | out ${out}`),
  `total | ${expectedTotal}`,
];
const expectedEmpty = [`ai-co2 v1 | ${firstDay} to ${today} | data none`, 'total | 0'];

// ---- running the scripts ----

let root = '';
const at = (config: string) => ({ root, config: join(root, config) });

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ai-co2-test-'));
  for (const [name, lines] of Object.entries(files)) {
    const full = join(root, 'config', name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, `${lines.join('\n')}\n`, 'utf8');
  }
  const old = later(now, -45 * DAY);
  utimesSync(join(root, 'config/projects/-p2/stale.jsonl'), old, old);
  mkdirSync(join(root, 'empty/projects'), { recursive: true });
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const cases: Array<[string, string, string[]]> = [
  ['the made-up logs', 'config', expected],
  ['an empty projects folder', 'empty', expectedEmpty],
  ['a folder that does not exist', 'no-such-folder', expectedEmpty],
];

type Runner = (config: string) => Run;
const runners: Array<[string, Runner]> = [
  ['count-tokens.mjs', (config) => runNode(at(config))],
  // Every Python found: Apple's own is often years older than the one a developer installed.
  ...pythons.map((python): [string, Runner] => [`count-tokens.py on Python ${python.version}`, (config) => runPython(python, at(config))]),
];

describe.each(runners)('%s', (_name, runner) => {
  it.each(cases)('prints the totals worked out by hand: %s', (_case, config, want) => {
    const got = runner(config);
    expect(got.errors).toBe('');
    expect(got.status).toBe(0);
    expect(got.lines).toEqual(want);
  });

  it('prints an answer that readAnswer accepts as it is', () => {
    const got = readAnswer(runner('config').text, today);
    expect(got.state).toBe('ok');
    if (got.state !== 'ok') return;
    expect(got.usage.source).toBe('claude-code');
    expect([got.usage.from, got.usage.to]).toEqual([firstDay, today]);
    expect(got.data).toMatchObject({ first: firstDay, last: localDay(recent) });
    expect(got.total).toBe(expectedTotal);
    const byName = new Map(got.usage.models.map((m) => [m.model, [m.freshInput, m.cacheWrite, m.cacheRead, m.output]]));
    expect(byName).toEqual(new Map(expectedRows));
    expect(got.notes).toEqual([]);
  });

  it('prints "nothing found" in a way readAnswer reads as a plain message, not as damage', () => {
    expect(readAnswer(runner('empty').text, today)).toMatchObject({ state: 'problem', code: 'no-usage' });
  });

  it('leaves the log folder exactly as it found it, and writes nothing into the home folder', () => {
    const before = snapshot(join(root, 'config'));
    for (const [, config] of cases) runner(config);
    expect(snapshot(join(root, 'config'))).toEqual(before);
    expect(snapshot(join(root, 'empty'))).toEqual([`${join(root, 'empty', 'projects')}/`]);
    expect(writtenToHome(join(root, 'home'))).toEqual([]);
  });
});

describe.each(pythons.map((python): [string, Runner] => [python.version, (config) => runPython(python, at(config))]))('count-tokens.py on Python %s', (_version, runner) => {
  it.each(cases)('prints exactly what count-tokens.mjs prints: %s', (_case, config) => {
    expect(runner(config).text).toBe(runNode(at(config)).text);
  });
});

// Without any Python the tests above cover only the Node script. Say so where the results are read.
if (pythons.length === 0) {
  describe('count-tokens.py', () => {
    it.skip(NO_PYTHON, () => {});
  });
}
