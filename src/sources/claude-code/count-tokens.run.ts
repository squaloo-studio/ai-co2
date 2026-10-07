// Test help for the two counting scripts. It finds every Python on this computer and runs a script
// the way the prompt asks Claude to run it: on standard input, against made-up logs in a temporary
// folder. The config folder, the home folder and XDG_CONFIG_HOME always point into that temporary
// folder, so a script can never reach a real log folder from here.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const pythonScript = readFileSync(join(here, 'count-tokens.py'), 'utf8');
export const nodeScript = readFileSync(join(here, 'count-tokens.mjs'), 'utf8');

// ---- which Pythons are here ----

export interface Python {
  command: string;
  /** For example "3.9.6". */
  version: string;
}

export const NO_PYTHON = 'SKIPPED: Python 3.8 or later is not installed, so count-tokens.py was not run';

/** Every different Python 3.8 or later on this computer. A Mac often has two: Apple's and a newer one. */
export function findPythons(): Python[] {
  const names = ['python3', 'python'];
  if (process.platform === 'darwin') {
    // Without Apple's developer tools, /usr/bin/python3 is a stand-in that opens an install window.
    // A test must not do that.
    const tools = spawnSync('xcode-select', ['-p'], { encoding: 'utf8' }).status === 0;
    const where = spawnSync('which', ['python3'], { encoding: 'utf8' });
    if (tools) names.push('/usr/bin/python3');
    else if (where.status !== 0 || where.stdout.trim() === '/usr/bin/python3') names.shift();
  }
  const found = new Map<string, Python>();
  for (const command of names) {
    const tried = spawnSync(command, ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3]); print(sys.executable)'], { encoding: 'utf8' });
    if (tried.status !== 0) continue;
    const [version = '', executable = ''] = tried.stdout.trim().split(/\r?\n/);
    const [major = 0, minor = 0] = version.split('.').map(Number);
    if (major !== 3 || minor < 8) continue;
    if (!found.has(`${version} ${executable}`)) found.set(`${version} ${executable}`, { command, version });
  }
  return [...found.values()];
}

// ---- made-up log lines ----

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface Extra {
  side?: boolean;
  session?: string;
  /** Replaces the time stamp, to try other spellings of it. */
  stamp?: string;
  /** Added to message.usage. */
  usage?: { [key: string]: Json };
  /** Added to the top level of the entry. */
  top?: { [key: string]: Json };
}

/** One log line, shaped like the ones Claude Code writes. Every value is invented. */
export function line(model: string, id: Json, request: string | null, when: Date, counts: [Json, Json, Json, Json], extra: Extra = {}): string {
  const [fresh, write, read, out] = counts;
  const entry: { [key: string]: Json } = {
    type: 'assistant',
    timestamp: extra.stamp ?? when.toISOString(),
    sessionId: extra.session ?? 's1',
    isSidechain: extra.side ?? false,
    version: '2.1.290',
    message: {
      id,
      model,
      role: 'assistant',
      usage: {
        input_tokens: fresh,
        cache_creation_input_tokens: write,
        cache_read_input_tokens: read,
        output_tokens: out,
        ...extra.usage,
      },
    },
  };
  if (request) entry.requestId = request;
  return JSON.stringify({ ...entry, ...extra.top });
}

/** What a script prints for one model. */
export const row = (name: string, fresh: number, write: number, read: number, out: number): string =>
  `${name} | in ${fresh} | cache_write ${write} | cache_read ${read} | out ${out}`;

// ---- days in a time zone ----

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** The calendar day, as YYYY-MM-DD, that a moment falls on in a time zone. Without a zone: this computer's. */
export function dayIn(zone: string | undefined, moment: Date): string {
  const key = zone ?? '';
  let format = dayFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormats.set(key, format);
  }
  const parts = format.formatToParts(moment);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** "2026-10-07" and -29 give "2026-09-08". */
export function addDays(day: string, days: number): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// ---- running a script ----

export interface Setting {
  /** The temporary folder of the test file. Everything a script can reach lies inside it. */
  root: string;
  /** CLAUDE_CONFIG_DIR. null leaves it unset, so the script looks under the home folder. */
  config: string | null;
  /** The home folder. Default: <root>/home. */
  home?: string;
  /** XDG_CONFIG_HOME. Default: <home>/.config, which is also where the scripts look without it. */
  xdg?: string;
  /** The time zone of the script's computer, for example "America/Santiago". Default: this computer's. */
  zone?: string;
  /** What the script's clock says. Default: the real time. */
  now?: Date;
  /** Makes Python report this version number, to try the script's own check for an old Python. */
  pythonSays?: string;
}

export interface Run {
  text: string;
  lines: string[];
  status: number | null;
  errors: string;
}

// The scripts take the time from the computer's clock. These two small files, loaded before a
// script starts, give it another clock, so the script text itself stays exactly as it is.
const PYTHON_CLOCK = `# Test help only: another "today" for count-tokens.py, and another version number for one test.
import collections, datetime, os, sys
_now = os.environ.get("AI_CO2_TEST_NOW")
if _now:
    class _Date(datetime.date):
        @classmethod
        def today(cls):
            moment = datetime.datetime.fromtimestamp(float(_now))
            return cls(moment.year, moment.month, moment.day)
    datetime.date = _Date
_says = os.environ.get("AI_CO2_TEST_PYTHON")
if _says:
    _info = collections.namedtuple("version_info", "major minor micro releaselevel serial")
    sys.version_info = _info(*[int(part) for part in _says.split(".")], "final", 0)
`;
const NODE_CLOCK = `// Test help only: another "now" for count-tokens.mjs.
const now = Number(process.env.AI_CO2_TEST_NOW) * 1000;
if (now) {
  const Real = Date;
  globalThis.Date = class extends Real {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
}
`;

function clockFolder(root: string): string {
  const folder = join(root, 'clock');
  if (!existsSync(folder)) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'sitecustomize.py'), PYTHON_CLOCK, 'utf8');
    writeFileSync(join(folder, 'clock.mjs'), NODE_CLOCK, 'utf8');
  }
  return folder;
}

function run(command: string, args: string[], script: string, setting: Setting, more: NodeJS.ProcessEnv): Run {
  const home = setting.home ?? join(setting.root, 'home');
  mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: setting.xdg ?? join(home, '.config'), ...more };
  if (setting.config === null) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = setting.config;
  if (setting.zone) env.TZ = setting.zone;
  if (setting.now) env.AI_CO2_TEST_NOW = String(setting.now.getTime() / 1000);
  // The script is passed on standard input, the way the prompt asks Claude to run it.
  const done = spawnSync(command, args, { input: script, encoding: 'utf8', env, timeout: 60_000 });
  const text = (done.stdout ?? '').replace(/\r\n/g, '\n');
  return { text, lines: text.trimEnd().split('\n'), status: done.status, errors: done.stderr ?? '' };
}

export function runNode(setting: Setting): Run {
  const clock = setting.now ? ['--import', pathToFileURL(join(clockFolder(setting.root), 'clock.mjs')).href] : [];
  return run(process.execPath, [...clock, '--input-type=module', '-'], nodeScript, setting, {});
}

export function runPython(python: Python, setting: Setting): Run {
  const more: NodeJS.ProcessEnv = {};
  if (setting.now || setting.pythonSays) {
    more.PYTHONPATH = [clockFolder(setting.root), process.env.PYTHONPATH].filter(Boolean).join(delimiter);
    if (setting.pythonSays) more.AI_CO2_TEST_PYTHON = setting.pythonSays;
  }
  return run(python.command, ['-'], pythonScript, setting, more);
}

/**
 * true when this Python puts every one of these moments on the same calendar day as this Node does.
 * They differ on a computer without time zone files, with older ones, and on Windows, where Python
 * does not take a zone by name. A comparison of the two scripts would then say nothing.
 */
export function sameCalendar(python: Python, zone: string, moments: Date[]): boolean {
  const code = 'import sys, time; print(" ".join(time.strftime("%Y-%m-%d", time.localtime(int(a))) for a in sys.argv[1:]))';
  const seconds = moments.map((m) => String(Math.floor(m.getTime() / 1000)));
  const asked = spawnSync(python.command, ['-c', code, ...seconds], { encoding: 'utf8', env: { ...process.env, TZ: zone } });
  if (asked.status !== 0) return false;
  const days = asked.stdout.trim().split(' ');
  return moments.every((m, i) => days[i] === dayIn(zone, new Date(Math.floor(m.getTime() / 1000) * 1000)));
}

// ---- has anything changed? ----

/** Every file, folder and link under a folder with its size, time of last change and contents. */
export function snapshot(folder: string): string[] {
  const seen: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) seen.push(`${full} -> ${readlinkSync(full)}`);
      else if (stat.isDirectory()) {
        seen.push(`${full}/`);
        walk(full);
      } else seen.push(`${full} ${stat.size} ${stat.mtimeMs} ${createHash('sha256').update(readFileSync(full)).digest('hex')}`);
    }
  };
  walk(folder);
  return seen;
}

/**
 * What was written into the home folder, apart from Python's own cache. Apple's Python keeps
 * compiled copies of its own library under Library/Caches/com.apple.python, whatever script it
 * runs. That is Python's doing, not the script's.
 */
export function writtenToHome(home: string): string[] {
  if (!existsSync(home)) return [];
  return snapshot(home).filter((entry) => !entry.endsWith('/') && !entry.includes(join('Library', 'Caches', 'com.apple.python')));
}
