// Builds the site the way it is published, and once more the way reviewers build it to see every
// state (`--mode demo`), and reads what came out. What a browser does with the built page (the
// policy at work, the worker, no request to another site) cannot be seen from here: a hidden
// browser is not among this project's tools, so that part is checked by a script outside the tests.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, LICENCES_FILE, licenceNotices } from '../vite.config';
import { SAMPLE_ANSWER } from './app/demo';
import { ALLOWED_ADDRESSES } from './links';
import { NETWORK } from './sources/chatgpt/files/offline';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEXT_FILES = new Set(['.html', '.js', '.css', '.svg', '.txt', '.json', '.map']);

interface Built {
  readonly folder: string;
  /** Every text file of the site by its path, with forward slashes. */
  readonly files: ReadonlyMap<string, string>;
  /** Every file name, fonts included. */
  readonly names: readonly string[];
}

function listed(folder: string, under = folder): string[] {
  return readdirSync(under, { withFileTypes: true }).flatMap((entry) => {
    const path = join(under, entry.name);
    return entry.isDirectory() ? listed(folder, path) : [relative(folder, path).split('\\').join('/')];
  });
}

/**
 * Runs the command `npm run build` runs, in a process of its own. The test runner sets NODE_ENV to
 * "test", and a build started inside it would not be the build that is published. `nodeEnv` stands
 * for whatever a person's shell may have set.
 */
function builtSite(mode: string, nodeEnv?: string): Built {
  const folder = mkdtempSync(join(tmpdir(), `ai-co2-${mode}-`));
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) if (name === 'NODE_ENV' || name.startsWith('VITE') || name === 'TEST') delete env[name];
  if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
  execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--mode', mode, '--outDir', folder, '--emptyOutDir', '--logLevel', 'silent'], {
    cwd: ROOT,
    env,
    stdio: 'pipe',
  });
  const names = listed(folder).sort();
  const files = new Map<string, string>();
  for (const name of names) if (TEXT_FILES.has(extname(name))) files.set(name, readFileSync(join(folder, name), 'utf8'));
  return { folder, files, names };
}

const need = (site: Built, name: string): string => {
  const text = site.files.get(name);
  if (text === undefined) throw new Error(`the built site has no ${name}`);
  return text;
};
const scripts = (site: Built): Array<[string, string]> => [...site.files].filter(([name]) => name.endsWith('.js'));
/** The script index.html starts, by the name the page gives it. */
function entryOf(site: Built): [string, string] {
  const name = /<script type="module"[^>]* src="\.\/([^"]+)"/.exec(need(site, 'index.html'))?.[1];
  if (name === undefined) throw new Error('index.html starts no script');
  return [name, need(site, name)];
}
const workerOf = (site: Built): Array<[string, string]> => scripts(site).filter(([name]) => /^assets\/worker-[\w-]+\.js$/.test(name));

/** The counts in the model lines of the example answer: numbers nobody would write by chance. */
const EXAMPLE_NUMBERS = SAMPLE_ANSWER.split('\n').filter((line) => line.includes(' | in ')).join(' ').match(/\d{6,}/g) ?? [];
const EXAMPLE_LABEL = 'Every figure on this page is made up';

let site: Built;
let demo: Built;
/** The published build again, from a shell that says it is a development machine. */
let fromDevShell: Built;

beforeAll(() => {
  site = builtSite('production');
  demo = builtSite('demo');
  fromDevShell = builtSite('production', 'development');
}, 180_000);

afterAll(() => {
  for (const built of [site, demo, fromDevShell]) if (built !== undefined) rmSync(built.folder, { recursive: true, force: true });
});

describe('the stand-in store stays out of the published site', () => {
  it('has examples to look for, and finds them in the build made for reviewers', () => {
    expect(EXAMPLE_NUMBERS.length).toBeGreaterThanOrEqual(12);
    // Compared as yes or no: a failed comparison of texts would print two megabytes of script.
    const all = scripts(demo).map(([, text]) => text).join('\n');
    for (const number of EXAMPLE_NUMBERS) expect(all.includes(number), number).toBe(true);
    expect(all.includes(EXAMPLE_LABEL)).toBe(true);
    // The switch in the address: the entry script of that build asks for it.
    expect(/\.get\(["'`]demo["'`]\)/.test(entryOf(demo)[1])).toBe(true);
    expect(scripts(demo).length).toBeGreaterThan(scripts(site).length);
  });

  it('holds none of its numbers, its label or its switch in the published build', () => {
    for (const built of [site, fromDevShell]) {
      for (const [name, text] of built.files) {
        for (const number of EXAMPLE_NUMBERS) expect(text.includes(number), `${name} holds ${number}`).toBe(false);
        expect(text.includes(EXAMPLE_LABEL), `${name} holds the example label`).toBe(false);
        expect(text.includes('demo='), `${name} holds "demo="`).toBe(false);
      }
      // The worker carries the tokenizer's word list, which has "demo" among its pieces of words.
      // Everything else is the page's own code and must not hold the word at all.
      const worker = new Set(workerOf(built).map(([name]) => name));
      for (const [name, text] of scripts(built)) if (!worker.has(name)) expect(/demo/i.test(text), `${name} holds "demo"`).toBe(false);
      expect(/demo/i.test(need(built, 'index.html'))).toBe(false);
    }
  });

  it('builds the same files whatever the shell says about the machine', () => {
    const kinds = (built: Built): string[] => built.names.map((name) => name.replace(/-[\w-]{8}\.(js|css|woff2)$/, '.$1'));
    expect(kinds(fromDevShell)).toEqual(kinds(site));
    expect(need(fromDevShell, 'index.html')).toContain('Content-Security-Policy');
  });

  it('gives the build for reviewers a folder of its own that git ignores', async () => {
    const config = await import('../vite.config');
    const settings = (mode: string, command: 'build' | 'serve'): unknown => (typeof config.default === 'function' ? config.default({ mode, command }) : config.default);
    expect(settings('production', 'build')).toMatchObject({ build: { outDir: 'dist' }, define: { __AI_CO2_DEMO__: 'false' } });
    expect(settings('development', 'build')).toMatchObject({ build: { outDir: 'dist' }, define: { __AI_CO2_DEMO__: 'false' } });
    expect(settings('demo', 'build')).toMatchObject({ build: { outDir: 'dist-demo.local' }, define: { __AI_CO2_DEMO__: 'true' } });
    expect(settings('development', 'serve')).toMatchObject({ define: { __AI_CO2_DEMO__: 'true' } });
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n')).toContain('*.local');
  });
});

describe('the addresses the built site holds', () => {
  const ADDRESS = /https?:\/\/[^\s"'`<>\\)]+/g;

  it('are all on the list, in the published build and in the one for reviewers', () => {
    const allowed = new Set(ALLOWED_ADDRESSES);
    for (const built of [site, demo]) {
      let seen = 0;
      for (const [name, text] of built.files) {
        // The notices are the libraries' own text, compared word for word below.
        if (name === LICENCES_FILE) continue;
        for (const address of text.match(ADDRESS) ?? []) {
          seen += 1;
          expect(allowed.has(address), `${name} holds ${address}`).toBe(true);
        }
      }
      expect(seen).toBeGreaterThan(20);
    }
  });

  it('has a list with no address twice and none that is not https, the icon name aside', () => {
    expect(new Set(ALLOWED_ADDRESSES).size).toBe(ALLOWED_ADDRESSES.length);
    expect(ALLOWED_ADDRESSES.filter((address) => !address.startsWith('https://'))).toEqual(['http://www.w3.org/2000/svg']);
  });

  it('names every file of its own by a relative path, so the site works in any folder', () => {
    const page = need(site, 'index.html');
    const named = [...page.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((match) => match[1] ?? '');
    expect(named.length).toBeGreaterThan(10);
    for (const address of named) expect(address.startsWith('./') || address.startsWith('#') || address.startsWith('https://'), address).toBe(true);
    for (const [name, text] of site.files) if (name.endsWith('.css')) expect(/url\(\s*["']?\//.test(text), name).toBe(false);
  });
});

describe('the policy of the built page', () => {
  it('stands first in the head, right after the charset tag, word for word', () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'",
    );
    for (const built of [site, demo]) {
      const head = need(built, 'index.html').split('<head>')[1] ?? '';
      const tags = head.match(/<meta[^>]*>/g) ?? [];
      expect(tags.slice(0, 3)).toEqual([
        '<meta charset="utf-8" />',
        `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
        '<meta name="referrer" content="no-referrer" />',
      ]);
      expect(head.trimStart().startsWith('<meta charset="utf-8" />')).toBe(true);
    }
  });

  it('is not in the page the development server hands out', () => {
    expect(readFileSync(join(ROOT, 'index.html'), 'utf8')).not.toMatch(/Content-Security-Policy/i);
  });

  it('finds nothing in the page that it would block', () => {
    const page = need(site, 'index.html');
    expect(page).not.toMatch(/<style[\s>]/i);
    expect(page).not.toMatch(/\sstyle\s*=/i);
    expect(page).not.toMatch(/\son[a-z]+\s*=/i);
    expect(page).not.toMatch(/javascript:/i);
    // One script, and it is a file of the site.
    const tags = page.match(/<script[^>]*>/g) ?? [];
    expect(tags.length).toBe(1);
    expect(tags[0]).toMatch(/ src="\.\/assets\/[\w-]+\.js"/);
    expect(page).not.toMatch(/<(iframe|object|embed|form|base)[\s>]/i);
    // Fonts and the style sheet's one small image: files of the site, or a data: address.
    for (const [name, text] of site.files) {
      if (!name.endsWith('.css')) continue;
      for (const match of text.matchAll(/url\(\s*["']?([^"')]+)/g)) expect(/^(data:image\/|\.\/|[\w-]+\.woff2)/.test(match[1] ?? ''), `${name}: ${match[1]}`).toBe(true);
    }
  });
});

describe('what the built scripts can do', () => {
  const NEVER = [
    'fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'importScripts',
    'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'serviceWorker',
    'innerHTML', 'insertAdjacentHTML', 'outerHTML', 'document.write', 'eval(', 'new Function', 'createObjectURL', 'WebAssembly',
  ];

  it('holds no way to send, store or run text, in the page or in the worker', () => {
    expect(scripts(site).length).toBeGreaterThanOrEqual(3);
    // The worker names the ways to connect once: in the list of what it gives up before it reads a file.
    const givenUp = new RegExp(`\\[${NETWORK.map((name) => `[\`'"]${name}[\`'"]`).join(',')}\\]`);
    const [workerName, worker] = workerOf(site)[0] ?? ['', ''];
    expect(givenUp.test(worker), `${workerName} holds the list of what it gives up`).toBe(true);
    for (const [name, text] of scripts(site)) {
      const rest = name === workerName ? text.replace(givenUp, '[]') : text;
      for (const word of NEVER) expect(rest.includes(word), `${name} holds ${word}`).toBe(false);
    }
  });

  it('writes one thing to the console: that an estimate failed, with nothing of the person in it', () => {
    const [, entry] = entryOf(site);
    expect(entry.match(/console\.\w+\([^)]*\)/g)).toEqual(['console.error(`ai-co2: the estimate could not be worked out`)']);
    for (const [name, text] of workerOf(site)) expect(/console\.(log|info|debug|warn|error)\(/.test(text), name).toBe(false);
  });

  it('keeps the export reader in a worker file of its own, loaded from the site', () => {
    const [name, entry] = entryOf(site);
    const workers = workerOf(site);
    expect(workers.length).toBe(1);
    const [workerName, worker] = workers[0] ?? ['', ''];
    expect(entry.includes(workerName.replace('assets/', ''))).toBe(true);
    expect(/new Worker\(new URL\(/.test(entry)).toBe(true);
    expect(entry.includes('type:`module`')).toBe(true);
    expect(/blob:|data:text\/javascript|data:application\/javascript/.test(entry)).toBe(false);
    // The tokenizer's word list is some two megabytes. It belongs to the worker, which is fetched
    // when the first export is read, and never to the script the page starts with.
    expect(entry.length, name).toBeLessThan(400_000);
    expect(worker.length, workerName).toBeGreaterThan(1_000_000);
    // What the worker loads later is a file beside it. The ZIP library also carries a hook for a
    // packing method someone adds by its address; none is ever added here, so nothing reaches it.
    const loads = [...worker.matchAll(/import\(([^)]*)\)/g)].map((match) => match[1] ?? '');
    const hook = loads.filter((load) => load.includes('webpackIgnore'));
    expect(hook.length).toBeLessThanOrEqual(1);
    for (const load of loads) if (!hook.includes(load)) expect(load).toMatch(/^[`'"]\.\/[\w-]+\.js[`'"]$/);
    expect(loads.length - hook.length).toBeGreaterThanOrEqual(1);
  });
});

describe('the licences that go out with the site', () => {
  it('ships the notice of every library and font the site carries, as the packages have them', () => {
    const notices = need(site, LICENCES_FILE);
    expect(notices).toBe(licenceNotices(ROOT));
    expect(need(demo, LICENCES_FILE)).toBe(notices);
    const packages: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const names = Object.keys(typeof packages === 'object' && packages !== null && 'dependencies' in packages ? (packages.dependencies ?? {}) : {});
    expect(names.sort()).toEqual(['@fontsource-variable/jetbrains-mono', '@fontsource-variable/schibsted-grotesk', '@streamparser/json', '@zip.js/zip.js', 'fflate', 'gpt-tokenizer']);
    for (const name of names) expect(notices).toContain(`\n${name} `);
    // zip.js is BSD-3-Clause, which asks for its copyright line and its three conditions.
    expect(notices).toContain('BSD 3-Clause License');
    expect(notices).toContain('Copyright (c) 2023, Gildas Lormeau');
    expect(notices).toContain('Redistributions in binary form must reproduce the above copyright notice');
    expect(notices.match(/SIL OPEN FONT LICENSE Version 1\.1/g)?.length).toBe(2);
    // The MIT text four times: this project and three libraries.
    expect(notices.match(/Permission is hereby granted, free of charge, to any person obtaining a copy\s+of this software/g)?.length).toBe(4);
    expect(notices).not.toMatch(/Mozilla Public License/i);
  });

  it('ships no data file of another project', () => {
    expect(site.names.filter((name) => name.endsWith('.json'))).toEqual([]);
    expect(site.names.filter((name) => !/^(index\.html|favicon\.svg|licences\.txt|assets\/[\w.-]+\.(js|css|woff2))$/.test(name))).toEqual([]);
  });
});
