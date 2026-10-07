import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readAnswer } from './answer';
import { NODE_SCRIPT, PROMPT, SCRIPT } from './prompt';

// Read straight from disk, so the test does not lean on the way the page takes the files in.
const onDisk = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url));

const OPEN = '\n```python\n';
const CLOSE = '```\n';

describe('the prompt', () => {
  it('holds count-tokens.py byte for byte', () => {
    const file = onDisk('count-tokens.py');
    expect(Buffer.from(SCRIPT, 'utf8').equals(file)).toBe(true);
    const bytes = Buffer.from(PROMPT, 'utf8');
    const at = bytes.indexOf(file);
    expect(at).toBeGreaterThan(0);
    // Once, and only once.
    expect(bytes.indexOf(file, at + 1)).toBe(-1);
  });

  it('is the instructions, one code block with the script, and nothing after it', () => {
    const at = PROMPT.indexOf(OPEN);
    expect(PROMPT.slice(at + OPEN.length)).toBe(SCRIPT + CLOSE);
    const instructions = PROMPT.slice(0, at);
    expect(instructions).not.toContain('```');
    expect(instructions.startsWith('Please count my Claude Code token use for the last 30 days.')).toBe(true);
    expect(instructions.endsWith('Never guess a number.\n')).toBe(true);
    // The script must not be able to end its own code block early.
    expect(SCRIPT).not.toContain('```');
    expect(SCRIPT).not.toContain('AI_CO2_END');
    expect(SCRIPT.endsWith('\n')).toBe(true);
  });

  const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

  it('has the fact-checked instructions, to the byte', () => {
    // The wording before the script is the one that was fact-checked, with one addition from the
    // review that followed: the sentence about which files are read names XDG_CONFIG_HOME, because
    // the script reads that folder in place of ~/.config when it is set. Nobody has seen yet what
    // Claude does with other wording, so a change here has to be made on purpose.
    const instructions = PROMPT.slice(0, PROMPT.indexOf(OPEN));
    expect(instructions).toContain('under ~/.claude/projects and ~/.config/claude/projects (or the folder XDG_CONFIG_HOME names), or under CLAUDE_CONFIG_DIR if that is set.');
    expect(instructions).toHaveLength(1408);
    expect(sha256(instructions)).toBe('2d326920731525ca615428315dcdbb96b5e17ce628e55e20258a08bdbddc2def');
  });

  it('has the reviewed script, to the byte', () => {
    // The script is the fact-checked one (5,983 characters) with the repairs from the two reviews
    // that followed. None changes a rule or what is printed:
    //  - the window opens at the right moment on a day whose midnight is skipped by a clock change
    //    (Python 3.9.6, the one Apple ships, put it an hour early),
    //  - a config or home folder with [ ] in its name is found,
    //  - a Python older than 3.8 stops with a sentence. It used to print "data none" and a total of 0,
    //  - links that lead back to a folder in more than one way no longer make the walk endless:
    //    every folder is walked once,
    //  - rule 1 names XDG_CONFIG_HOME, which the code has always read.
    // The page and the README say the script is 120 lines, so it stays 120 lines.
    // When the script changes on purpose, check the new text, run the tests, then update these.
    expect(SCRIPT).toHaveLength(6490);
    expect(SCRIPT.split('\n')).toHaveLength(121); // 120 lines and the line end of the last one
    expect(sha256(SCRIPT)).toBe('dab6cf8231b7eee3eb43648aa4a67e3af58d1239841da367bcb3dfabc3dddb52');
    expect(PROMPT).toHaveLength(7913);
    expect(sha256(PROMPT)).toBe('7c1980fe2caf0a8f749ba1395da822957a4be9cc677026cf0d7720cff2834c12');
  });

  it('is plain text that survives copy and paste', () => {
    // Printable ASCII and line feeds only: no tabs, no carriage returns, no look-alike characters.
    expect(PROMPT).toMatch(/^[\x20-\x7E\n]+$/);
    expect(NODE_SCRIPT).toMatch(/^[\x20-\x7E\n]+$/);
  });

  it('says only what the script does', () => {
    // The prompt promises that the script writes nothing and connects to nothing.
    for (const word of ['socket', 'urllib', 'http', 'requests', 'subprocess', 'os.system', 'os.remove', 'unlink', 'shutil', 'eval(', 'exec(']) {
      expect(SCRIPT).not.toContain(word);
    }
    expect(SCRIPT.match(/\bopen\(/g)).toEqual(['open(']);
    expect(SCRIPT).toContain('with open(path, encoding="utf-8", errors="replace") as lines:');
    expect(SCRIPT.match(/^(?:import|from) .*$/gm)).toEqual([
      'import json, os, re, sys',
      'from datetime import date, datetime, time, timedelta',
    ]);
    // "sys" is there for one thing only: to stop on a Python that is too old.
    expect(SCRIPT.match(/\bsys\.\w+/g)).toEqual(['sys.version_info', 'sys.exit']);
  });

  it('stops on an old Python before it does anything else', () => {
    const code = SCRIPT.split('\n').filter((l) => l !== '' && !l.startsWith('#'));
    expect(code.slice(0, 3)).toEqual([
      'import json, os, re, sys',
      'from datetime import date, datetime, time, timedelta',
      'if sys.version_info < (3, 8): sys.exit("This script needs Python 3.8 or later.")',
    ]);
    // The comment at the top promises the same version.
    expect(SCRIPT).toContain('Works with Python 3.8+.');
  });

  it('is told apart from an answer when it is pasted back', () => {
    expect(readAnswer(PROMPT, '2026-10-07')).toMatchObject({ state: 'problem', code: 'pasted-prompt' });
  });
});

describe('the Node version', () => {
  it('is the file count-tokens.mjs, and that file is the fact-checked one, to the byte', () => {
    expect(Buffer.from(NODE_SCRIPT, 'utf8').equals(onDisk('count-tokens.mjs'))).toBe(true);
    // The fact-checked one (6,437 characters) with the same two repairs as the Python script:
    // every folder is walked once, and rule 1 names XDG_CONFIG_HOME.
    expect(NODE_SCRIPT).toHaveLength(6638);
    expect(createHash('sha256').update(NODE_SCRIPT, 'utf8').digest('hex')).toBe('33e6b5c090d8ea7540593f14fb602b5ed9d91e931b04f6a384463a0d47829450');
  });

  it('states the same seven rules as the Python script', () => {
    const rules = (text: string, mark: string) => {
      const lines = text.split('\n');
      const first = lines.findIndex((l) => l.startsWith(`${mark} Rules:`));
      const last = lines.findIndex((l) => l.startsWith(`${mark}  7.`));
      return lines.slice(first, last + 1).map((l) => l.slice(mark.length));
    };
    expect(rules(SCRIPT, '#')).toHaveLength(16);
    expect(rules(NODE_SCRIPT, '//')).toEqual(rules(SCRIPT, '#'));
    // Rule 1 says where the files are, with every folder the code looks in.
    expect(rules(SCRIPT, '#').slice(1, 3).join(' ').replace(/\s+/g, ' ')).toContain('<config> is $CLAUDE_CONFIG_DIR if set, otherwise ~/.claude and ~/.config/claude (or $XDG_CONFIG_HOME/claude).');
    expect(SCRIPT).toContain('os.environ.get("XDG_CONFIG_HOME")');
    expect(NODE_SCRIPT).toContain('process.env.XDG_CONFIG_HOME');
  });

  it('opens no connection and writes no file', () => {
    for (const word of ['http', 'fetch(', 'node:net', 'child_process', 'writeFile', 'appendFile', 'createWriteStream', 'unlink', 'rmSync', 'eval(']) {
      expect(NODE_SCRIPT).not.toContain(word);
    }
  });
});
