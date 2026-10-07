// Names whose answer is known without asking the classifier: the checked names in another spelling,
// and versions that do not exist yet. Every name here is made up from parts, none is from a log.

import type { ClassifyOptions } from '../types';
import { cases } from './cases';
import type { Case } from './cases';

export interface Spelled {
  name: string;
  options: ClassifyOptions | undefined;
  /** How the name was made, for the message when it fails. */
  how: string;
  class: string;
  displayName: string;
  thinking: boolean;
  /** undefined: not checked. */
  reason: string | undefined;
}

type Change = readonly [how: string, change: (name: string) => string];

// ---------- the checked names, spelled another way ----------

const CAPITALS: readonly Change[] = [
  ['in capitals', (n) => n.toUpperCase()],
  ['with a capital on each word', (n) => n.replace(/[a-z]+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1))],
];
const NEVER_MATTERS: readonly Change[] = [
  ['with "_" for "-"', (n) => n.replace(/-/g, '_')],
  ['with spaces around it', (n) => `  ${n}\t`],
  ['with a line break after it', (n) => `${n}\n`],
];

const CLAUDE_BEFORE = [
  'anthropic/', 'my-gateway/', 'bedrock/', 'vertex_ai/', 'openrouter/anthropic/', 'anthropic.', 'us.anthropic.', 'eu.anthropic.',
  'jp.anthropic.', 'au.anthropic.', 'apac.anthropic.', 'global.anthropic.', 'us-gov.anthropic.',
  'arn:aws:bedrock:us-west-2:000000000000:inference-profile/us.anthropic.',
  'projects/demo/locations/us-east5/publishers/anthropic/models/',
];
const CLAUDE_AFTER = ['-20270115', '@20270115', '-v1:0', '-20270115-v1:0', '[1m]', '[1M]', '-latest'];
const GPT_BEFORE = ['openai/', 'azure/', 'openrouter/openai/', 'my-gateway/'];
const GPT_AFTER = ['-2027-01-15', '-20270115', '-latest', '-preview'];
const O_SERIES_BEFORE = ['openai/', 'OpenAI/', 'openai.'];
const O_SERIES_AFTER = ['-2027-01-15', '-20270115'];
const GEMINI_BEFORE = ['models/', 'google/', 'vertex_ai/', 'publishers/google/models/'];
const GEMINI_AFTER = ['-001', '-preview-0514', '-latest'];

/** Every pairing of a prefix and a suffix, and each one alone. */
function around(before: readonly string[], after: readonly string[]): Change[] {
  const changes: Change[] = [];
  for (const b of before) changes.push([`after "${b}"`, (n) => b + n]);
  for (const a of after) changes.push([`with "${a}"`, (n) => n + a]);
  for (const b of before) for (const a of after) changes.push([`after "${b}" with "${a}"`, (n) => b + n + a]);
  return changes;
}

// What Claude Code's counting script does to a name before it prints it (without its cut at 80
// characters): "[1m]" arrives here as "_1m_".
function asPrinted(name: string): string {
  const plain = name.replace(/[^A-Za-z0-9._:/@-]/g, '_');
  return /^[A-Za-z]/.test(plain) ? plain : `m_${plain}`;
}

const CLAUDE_CHANGES: Change[] = [
  ...around(CLAUDE_BEFORE, CLAUDE_AFTER),
  ['as the counting script prints it', asPrinted],
  ['with "[1m]", as the counting script prints it', (n) => asPrinted(`${n}[1m]`)],
];
const GPT_CHANGES = around(GPT_BEFORE, GPT_AFTER);
const O_SERIES_CHANGES = around(O_SERIES_BEFORE, O_SERIES_AFTER);
const GEMINI_CHANGES = around(GEMINI_BEFORE, GEMINI_AFTER);

/** The changes that leave this case's answer as it is. Which ones depends on what kind of name it is. */
function changesFor(c: Case): readonly Change[] {
  const changes: Change[] = [...NEVER_MATTERS];
  // "<synthetic>" is matched exactly, capitals included.
  if (c.class !== 'skip') changes.push(...CAPITALS);
  const known = c.class !== 'unknown' && c.class !== 'skip';
  if (known && /^(Opus|Sonnet|Haiku|Fable|Mythos)\b/.test(c.displayName)) changes.push(...CLAUDE_CHANGES);
  else if (/^(chat)?gpt-\d/.test(c.name)) changes.push(...GPT_CHANGES);
  else if (known && /^o[134](-|$)/.test(c.name)) changes.push(...O_SERIES_CHANGES);
  else if (known && c.displayName.startsWith('Gemini')) changes.push(...GEMINI_CHANGES);
  return changes;
}

export function respelledCases(): Spelled[] {
  const out: Spelled[] = [];
  for (const c of cases) {
    for (const [how, change] of changesFor(c)) {
      const name = change(c.name);
      out.push({
        name,
        options: c.options,
        how: `"${c.name}" ${how}`,
        class: c.class,
        // A name that is not recognised is shown as it came in, so its new spelling is what is shown.
        displayName: c.reason === 'unrecognised' ? name.trim() : c.displayName,
        thinking: c.thinking,
        reason: c.reason,
      });
    }
  }
  return out;
}

// ---------- versions that do not exist yet ----------

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

const MINORS = [null, 0, 1, 2, 5, 9, 10, 12];

/** "5", "5.5". Claude and GPT names write no ".0". */
function versionLabel(major: number, minor: number | null): string {
  return `${major}${minor === null || minor === 0 ? '' : `.${minor}`}`;
}

const CLAUDE_FAMILIES = [
  ['opus', 'large'], ['sonnet', 'medium'], ['haiku', 'small'], ['fable', 'fable'], ['mythos', 'fable'],
] as const;

/** Claude versions 3 to 12.12 of every family, in the spellings Anthropic and the cloud platforms use. */
export function futureClaudeNames(): Spelled[] {
  const out: Spelled[] = [];
  for (const [family, size] of CLAUDE_FAMILIES) {
    for (let major = 3; major <= 12; major++) {
      for (const minor of MINORS) {
        const hyphens = minor === null ? `${major}` : `${major}-${minor}`;
        const dot = minor === null ? `${major}` : `${major}.${minor}`;
        const id = `claude-${family}-${hyphens}`;
        const names = [
          id, `${id}-20270115`, `${id}@20270115`, `claude-${family}-${dot}`, `anthropic.${id}`,
          `anthropic.${id}-20270115-v1:0`, `us.anthropic.${id}`, `global.anthropic.${id}-v1:0`,
          `arn:aws:bedrock:eu-central-1:000000000000:inference-profile/eu.anthropic.${id}`,
          `projects/demo/locations/us-east5/publishers/anthropic/models/${id}@20270115`,
          `my-gateway/${id}`, `${id}[1m]`, id.toUpperCase(), id.replace(/-/g, '_'),
          // Claude 3 put the number first.
          `claude-${hyphens}-${family}-20270115`,
        ];
        // Without "claude-" in front, only a one-digit version is read as a version ("opus-47-prod" is not Opus 47).
        if (major < 10) names.push(`Claude ${capital(family)} ${dot}`, `${family}-${hyphens}`);
        for (const name of names) {
          out.push({
            name, options: undefined, how: `${family} ${dot}`,
            class: size, displayName: `${capital(family)} ${versionLabel(major, minor)}`, thinking: false, reason: undefined,
          });
        }
      }
    }
  }
  return out;
}

// Words that decide on their own in any GPT version: [in the name, class, as shown, says thinking].
const GPT_TIERS = [
  ['mini', 'small', 'mini', false], ['nano', 'small', 'nano', false], ['luna', 'small', 'Luna', false],
  ['terra', 'medium', 'Terra', false], ['astra', 'large', 'Astra', false], ['pro', 'large', 'Pro', true],
] as const;
const PLANS = [{ plan: 'plus-or-pro' }, { plan: 'free-or-go' }, undefined] as const;

/** GPT-5 to GPT-9.12 with each tier word, and the plain names from GPT-5.6 on, which hide their tier. */
export function futureGptNames(): Spelled[] {
  const out: Spelled[] = [];
  const add = (name: string, cls: string, displayName: string, thinking: boolean, reason?: string, options?: ClassifyOptions) =>
    out.push({ name, options, how: displayName, class: cls, displayName, thinking, reason });
  /** The spellings of one model: ChatGPT's hyphens, the API's dot, a gateway, a date, capitals, Work mode. */
  const spell = (major: number, minor: number | null, rest: string): string[] => {
    const hyphens = `gpt-${major}${minor === null ? '' : `-${minor}`}${rest}`;
    const dot = `gpt-${major}${minor === null ? '' : `.${minor}`}${rest}`;
    return [hyphens, dot, `openai/${dot}`, `${hyphens}-2027-01-15`, hyphens.toUpperCase(), hyphens.replace(/-/g, '_'), `${dot}-wm`];
  };

  for (let major = 5; major <= 9; major++) {
    for (const minor of MINORS) {
      const version = `GPT-${versionLabel(major, minor)}`;
      for (const [word, size, label, thinking] of GPT_TIERS) {
        for (const name of spell(major, minor, `-${word}`)) add(name, size, `${version} ${label}`, thinking);
      }
      // "Sol" was the top tier in GPT-5.6 and the middle tier in GPT-6. A later one is not guessed.
      for (const name of spell(major, minor, '-sol')) {
        if (major === 5) add(name, 'large', `${version} Sol`, false);
        else if (major === 6) add(name, 'medium', `${version} Sol`, false);
        else add(name, 'unknown', name, false, 'unrecognised');
      }
      if (major >= 6) {
        for (const name of spell(major, minor, '')) add(name, 'unknown', version, false, 'tier-hidden');
        for (const name of spell(major, minor, '-thinking')) add(name, 'unknown', `${version} Thinking`, true, 'tier-hidden');
      }
    }
  }

  for (let minor = 6; minor <= 12; minor++) {
    const version = `GPT-5.${minor}`;
    for (const options of PLANS) {
      const byPlan = options === undefined ? 'unknown' : options.plan === 'plus-or-pro' ? 'large' : 'small';
      const reason = options === undefined ? 'tier-hidden' : undefined;
      for (const name of [`gpt-5-${minor}`, `GPT-5-${minor}`, `gpt_5_${minor}`, `openai/gpt-5-${minor}`, `gpt-5-${minor}-2027-01-15`]) {
        add(name, byPlan, version, false, reason, options);
        add(`${name}-instant`, byPlan, `${version} Instant`, false, reason, options);
      }
      // The dot is the API's spelling of the large model, and the thinking levels use the large model.
      for (const name of [`gpt-5.${minor}`, `GPT-5.${minor}`, `gpt_5.${minor}`, `openai/gpt-5.${minor}`, `gpt-5.${minor}-2027-01-15`]) {
        add(name, 'large', version, false, undefined, options);
      }
      for (const name of [`gpt-5-${minor}-thinking`, `gpt-5.${minor}-thinking`, `gpt_5_${minor}_thinking`]) {
        add(name, 'large', `${version} Thinking`, true, undefined, options);
      }
    }
  }
  return out;
}
