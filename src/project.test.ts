// The files around the code: the build settings, the README and the list of sources. They are text a
// person reads to find their way or to check a number, so a test holds them to the code they describe.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config, { CONTENT_SECURITY_POLICY, LICENCES_FILE, TEST_TIMEOUT_MS } from '../vite.config';
import { SCENARIOS } from './app/demo';
import { ASSUMPTION_ROWS, CITATIONS, ENERGY_ROWS, SOURCE_LINKS } from './model/assumptions';
import type { AssumptionRow } from './model/assumptions';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (name: string): string => readFileSync(join(ROOT, name), 'utf8');

/** Every file under a folder, by its path from the repository root. */
function filesUnder(folder: string): string[] {
  return readdirSync(join(ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

describe('the build settings', () => {
  it('give every test 30 seconds, so a busy machine does not fail a test that is right', () => {
    expect(TEST_TIMEOUT_MS).toBe(30_000);
    for (const mode of ['test', 'production', 'demo']) {
      for (const command of ['serve', 'build'] as const) {
        expect(config({ command, mode, isSsrBuild: false, isPreview: false }).test?.testTimeout, `${command} ${mode}`).toBe(TEST_TIMEOUT_MS);
      }
    }
  });

  it('allow images from the site itself and from nowhere else', () => {
    const parts = CONTENT_SECURITY_POLICY.split('; ');
    expect(parts.filter((part) => part.startsWith('img-src'))).toEqual(["img-src 'self'"]);
    expect(CONTENT_SECURITY_POLICY).not.toContain('data:');
    expect(CONTENT_SECURITY_POLICY).not.toContain('blob:');
  });

  it('can do so, because no style sheet and no markup of the page carries a data: address', () => {
    const sheets = filesUnder('src/styles').filter((name) => name.endsWith('.css'));
    expect(sheets.length).toBeGreaterThan(3);
    for (const name of [...sheets, 'index.html', 'public/favicon.svg']) {
      // "data:" after a quote, a bracket or an equals sign is an address. `--data: …` is a colour token.
      expect(/(?:url\(\s*|["'=])data:/i.test(read(name)), name).toBe(false);
    }
  });
});

describe('SOURCES.md', () => {
  const sources = read('SOURCES.md');
  const rows: Array<[string, AssumptionRow]> = [
    ...Object.entries(ENERGY_ROWS).map(([size, row]): [string, AssumptionRow] => [`energy:${size}`, row]),
    ...Object.entries(ASSUMPTION_ROWS),
  ];
  /** The two citations that point at another entry's link with "that …" and so cannot stand alone. */
  const REWORDED: Readonly<Record<string, readonly string[]>> = {
    'hidden:prompt': ['https://github.com/asgeirtj/system_prompts_leaks', 'https://github.com/jujumilk3/leaked-system-prompts'],
    'hidden:personal': ['https://embracethered.com/blog/posts/2025/chatgpt-how-does-chat-history-memory-preferences-work/'],
  };

  /** The entry of one assumption: from its heading to the next heading. */
  function entryOf(label: string): string {
    const start = sources.indexOf(`### ${label}\n`);
    expect(start, label).toBeGreaterThanOrEqual(0);
    const end = sources.indexOf('\n#', start + 4);
    return sources.slice(start, end < 0 ? undefined : end);
  }

  it('has one entry per row of the table of assumptions, in the table’s order', () => {
    expect(rows).toHaveLength(Object.keys(CITATIONS).length);
    const headings = [...sources.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
    expect(headings.slice(0, rows.length)).toEqual(rows.map(([, row]) => row.label));
    // After them, the two fixed numbers that have no slider.
    expect(headings).toHaveLength(rows.length + 2);
  });

  it('gives each entry the source line and the link the page shows, word for word', () => {
    for (const [, row] of rows) {
      const entry = entryOf(row.label);
      expect(entry).toContain(`- **Source line:** ${row.source}\n`);
      expect(entry).toContain(`- **Link:** ${row.sourceUrl ?? 'none'}\n`);
      expect(entry.includes('- **Thin evidence:** yes'), row.label).toBe(row.soft);
    }
  });

  it('gives each entry its full citation', () => {
    for (const [key, row] of rows) {
      const entry = entryOf(row.label);
      const citation = Object.entries(CITATIONS).find(([name]) => name === key)?.[1];
      expect(citation, key).toBeDefined();
      const reworded = REWORDED[key];
      if (reworded !== undefined) for (const address of reworded) expect(entry, key).toContain(address);
      else if (citation === '') expect(entry, key).toContain('- **Citation:** none.');
      else expect(entry, key).toContain(`- **Citation:** ${citation}\n`);
    }
  });

  it('reads on its own: no entry points at "that collection" or "that write-up"', () => {
    expect(Object.keys(REWORDED).sort()).toEqual(
      Object.entries(CITATIONS).filter(([, text]) => /\bthat (collection|write-up)\b/.test(text)).map(([key]) => key).sort(),
    );
    expect(sources).not.toMatch(/\bthat (collection|write-up)\b/i);
  });

  it('names every source address the page links to', () => {
    for (const address of SOURCE_LINKS) expect(sources, address).toContain(address);
  });

  it('says the values are checked on the day the table says', () => {
    expect(new Set(rows.map(([, row]) => row.checked))).toEqual(new Set(['2026-10-07']));
    expect(sources).toContain('Every entry was checked on 7 October 2026.');
  });
});

describe('README.md', () => {
  const readme = read('README.md');
  const table = readme.slice(readme.indexOf('### Where things live'), readme.indexOf('### The path a number takes'));

  it('names every folder and every file at the top of src in "Where things live"', () => {
    expect(table.length).toBeGreaterThan(500);
    for (const entry of readdirSync(join(ROOT, 'src'), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.test.ts')) continue;
      // A folder may be named through its sub-folders, as `src/sources/chatgpt/` is.
      const name = entry.isDirectory() ? `\`src/${entry.name}/` : `\`src/${entry.name}\``;
      expect(table, name).toContain(name);
    }
  });

  it('says that src/app is the logic, and that only demo.ts is a stand-in', () => {
    const row = table.split('\n').find((line) => line.startsWith('| `src/app/` |')) ?? '';
    expect(row).toContain('The logic behind the page');
    expect(row).toContain('`demo.ts` is a stand-in with made-up numbers');
    expect(row).toContain('not part of the published site');
    expect(readme).not.toContain('A stand-in for the logic');
  });

  it('maps the path a number takes to files and functions that exist', () => {
    const path = readme.slice(readme.indexOf('### The path a number takes'), readme.indexOf('### Tests'));
    const steps: Array<[string, RegExp]> = [
      ['state.ts', /export function reduce\(/],
      ['usage.ts', /export function count\(/],
      ['calc.ts', /export function recalc\(/],
      ['derive.ts', /export function deriveView\(/],
      ['store.ts', /export function createStore\(/],
    ];
    for (const [file, declared] of steps) {
      expect(path, file).toContain(`\`${file}\``);
      expect(declared.test(read(`src/app/${file}`)), file).toBe(true);
    }
    for (const file of ['derive-data.ts', 'derive-result.ts', 'derive-method.ts', 'words.ts']) {
      expect(path, file).toContain(file);
      expect(read(`src/app/${file}`).length, file).toBeGreaterThan(0);
    }
    // "The only place in the store that does": no other file of the store calls the estimate.
    const callers = filesUnder('src/app').filter((name) => !/(\.test|test-kit|demo)\.ts$/.test(name) && /\bestimate\(/.test(read(name)));
    expect(callers).toEqual(['src/app/calc.ts']);
  });

  it('says how to see the stand-in store, with names the code has', () => {
    expect(readme).toContain('`npx vite build --mode demo`');
    expect(readme).toContain('`dist-demo.local/`');
    expect(readme).toContain('`?demo=cc-done`');
    expect(SCENARIOS).toContain('cc-done');
    expect(read('.gitignore').split('\n')).toContain('*.local');
    expect(config({ command: 'build', mode: 'demo', isSsrBuild: false, isPreview: false }).build?.outDir).toBe('dist-demo.local');
    expect(config({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false }).build?.outDir).toBe('dist');
  });

  it('names the notices file the build writes, and the list of sources', () => {
    expect(readme).toContain(`\`dist/${LICENCES_FILE}\``);
    expect(readme).toContain('[`SOURCES.md`](SOURCES.md)');
  });
});
