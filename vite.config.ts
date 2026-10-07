/// <reference types="vitest/config" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * What the built page may load and do. Nothing is fetched at run time, scripts, styles, fonts and the
 * export reader's worker come from the site itself, and no form can post anywhere. The only image is
 * the favicon, a file of the site: the style sheets carry none, so no `data:` address is allowed.
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

const CHARSET_TAG = '<meta charset="utf-8" />';

/**
 * Puts the policy into the built index.html, right after the charset tag. Not in development: the
 * development server injects styles and its own client in ways the policy forbids.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'ai-co2:content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      // A page that goes out without its policy must not build at all.
      if (html.split(CHARSET_TAG).length !== 2) throw new Error('index.html must hold the charset tag exactly once: the policy goes right after it');
      const tags = [
        CHARSET_TAG,
        `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
        '<meta name="referrer" content="no-referrer" />',
      ];
      return html.replace(CHARSET_TAG, tags.join('\n    '));
    },
  };
}

/** How long one test may take, in milliseconds. */
export const TEST_TIMEOUT_MS = 30_000;

/** The name of the notices file in the built site. */
export const LICENCES_FILE = 'licences.txt';

const text = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trim();

function field(data: unknown, key: string): unknown {
  if (typeof data !== 'object' || data === null) return undefined;
  const value: unknown = Object.entries(data).find(([name]) => name === key)?.[1];
  return value;
}

/**
 * The licence of this project and of everything the built site carries from somewhere else. Every
 * package under "dependencies" ends up in the site (four libraries in the scripts, two fonts as
 * files), so the list is read from package.json and a new dependency cannot ship without its notice.
 */
export function licenceNotices(root: string): string {
  const packages = Object.keys(field(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), 'dependencies') ?? {}).sort();
  const parts = [
    'ai-co2',
    '======',
    '',
    text(join(root, 'LICENSE')),
    '',
    '',
    'What this site carries from others',
    '==================================',
    '',
    'The scripts of this site hold code from the libraries below, and the site serves the fonts below.',
    'Each is used under its own licence, which follows in full.',
  ];
  for (const name of packages) {
    const folder = join(root, 'node_modules', name);
    const about: unknown = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    const file = readdirSync(folder).find((entry) => /^(licen[cs]e|copying)/i.test(entry));
    if (file === undefined) throw new Error(`${name} has no licence file, so its notice cannot be shipped`);
    const heading = `${name} ${String(field(about, 'version'))} (${String(field(about, 'license'))})`;
    parts.push('', '', heading, '-'.repeat(heading.length), '', text(join(folder, file)));
  }
  return `${parts.join('\n')}\n`;
}

/** Ships the notices with the site. The minifier drops the comments that carry them inside the libraries. */
function licences(): Plugin {
  let root = process.cwd();
  return {
    name: 'ai-co2:licences',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: LICENCES_FILE, source: licenceNotices(root) });
    },
  };
}

export default defineConfig(({ command, mode }) => ({
  // Relative paths, so the built site works under /ai-co2/ or any other folder without a rebuild.
  base: './',
  define: {
    // The stand-in store with its made-up numbers (src/app/demo.ts, reached with ?demo=) exists in the
    // development server and in a build made with `--mode demo`. Every other build gets `false` here
    // and so holds none of it, whatever else the environment says.
    __AI_CO2_DEMO__: JSON.stringify(command === 'serve' || mode === 'demo'),
  },
  build: {
    target: 'es2022',
    // The helper that loads modules ahead of time in old browsers uses fetch, and the page's policy
    // allows no fetch at all. Without it the built page script holds none.
    modulePreload: { polyfill: false },
    // A build with the stand-in store gets a folder of its own, which git ignores, so it can never be
    // taken for the site to publish.
    outDir: mode === 'demo' ? 'dist-demo.local' : 'dist',
  },
  // An ES module worker is built as a file of its own and loaded from the site, never from a blob: address.
  worker: { format: 'es' },
  plugins: [contentSecurityPolicy(), licences()],
  test: {
    include: ['src/**/*.test.ts'],
    // Maths and parsing run in plain Node. A test that needs a page opts in with
    // `// @vitest-environment happy-dom` on its first line.
    environment: 'node',
    // Vitest's own limit is 5 seconds for a test. Some tests here read whole made-up exports or build
    // the site, and on a busy machine (a shared runner, or other work beside the tests) they pass in
    // more than that. A test that needs still longer sets its own limit.
    testTimeout: TEST_TIMEOUT_MS,
  },
}));
