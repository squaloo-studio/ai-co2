// Sorts a raw model name into a size class. The name comes from a pasted answer or a dropped
// export, so it is untrusted text: it is only ever compared, never used as a key on a plain object.
//
// The rules are the table RULES below. The first one that matches wins, and they match whole
// words, so "opusplan" is not Opus. Both are easy to lose in an edit.

import type { ChatGptPlan, ClassifyOptions, ModelClass, SizeClass, UnknownReason } from './types';

// The longest real spelling is a cloud resource path of about 100 characters. Anything far beyond
// that is not a model name, and no rule looks at it.
const LONGEST_NAME = 256;
// The most the page is handed to show. Of a longer text it gets the start only.
const LONGEST_SHOWN = 100;
const SHOWN_WHEN_CUT = 60;

// Characters with no shape of their own: controls, zero-width and direction marks, half of a
// two-part character. In a sentence they could hide part of a name or turn the words after it around.
const UNSEEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}]/gu;

type Verdict = SizeClass | 'skip' | UnknownReason;

/** A name, cleaned once for every rule. */
interface Name {
  /** Trimmed, otherwise as it came in. Shown when the name is not recognised. */
  text: string;
  /** Lower case, "_" as "-", and "4.1" as "4-1". As long as `text` in lower case, place for place. */
  s: string;
  words: ReadonlySet<string>;
  gpt: Gpt | null;
  oSeries: OSeries | null;
}

/** "gpt-<number>", with an optional "o" and an optional second number, and what follows it. */
interface Gpt {
  major: number;
  minor: number | null;
  isO: boolean;
  /** The words after the version, in order. */
  tail: readonly string[];
  /** The API writes "gpt-5.6", ChatGPT writes "gpt-5-6". */
  dotForm: boolean;
  thinking: boolean;
}

/** "o1", "o3" or "o4" at the start of the name, or right after "openai". */
interface OSeries {
  word: string;
  tail: readonly string[];
}

interface Rule {
  id: string;
  when: (name: Name) => boolean;
  verdict: (name: Name, plan: ChatGptPlan | undefined) => Verdict;
  show: (name: Name) => string;
  thinking: (name: Name) => boolean;
  byPlan: boolean;
}

// ---------- the rules, in order ----------

const RULES: readonly Rule[] = [
  rule('S1', (n) => n.text === '<synthetic>', 'skip', { show: (n) => n.text }),
  rule('S2', (n) => n.text === '', 'empty', { show: '(no model name)' }),
  rule('S3', (n) => n.s === 'auto', 'auto', { show: 'Auto' }),

  // Claude: the family word decides, on any platform and in any version.
  claude('C1', 'fable', 'fable'),
  claude('C1', 'mythos', 'fable'),
  claude('C2', 'opus', 'large'),
  claude('C3', 'sonnet', 'medium'),
  claude('C4', 'haiku', 'small'),
  rule('C5', has('claude', 'instant'), 'small', { show: claudeInstantName }),
  rule('C6', has('claude'), 'unrecognised'),

  // For later: Gemini is not read by the page yet. The classes are here so a name is not a surprise later.
  rule('G1', has('gemini', 'flash', 'lite'), 'small', { show: geminiName('Flash-Lite') }),
  rule('G2', has('gemini', 'flash'), 'medium', { show: geminiName('Flash') }),
  rule('G3', has('gemini', 'pro'), 'large', { show: geminiName('Pro') }),
  rule('G4', has('gemini'), 'unrecognised'),

  // OpenAI: ChatGPT's names for a mode, then its GPT-3.5 names.
  rule('O1', (n) => n.s === 'research' || n.s === 'deep-research', 'large', { show: 'Deep research', thinking: true }),
  rule('O2', (n) => n.s === 'agent-mode', 'large', { show: 'Agent mode', thinking: true }),
  rule('O3', (n) => /^text-davinci-002-(render|plugins|browse)/.test(n.s), 'small', { show: gpt35Name }),

  // "gpt-<number>…": tier words first, so "gpt-5-5-mini" is small and a "mini pro" would be large.
  gpt('O4', tail('pro'), 'large'),
  gpt('O5', tail('nano', 'mini', 'luna'), 'small'),
  gpt('O6', tail('astra'), 'large'),
  gpt('O7', tail('terra'), 'medium'),
  // "Sol" was the top tier in GPT-5.6 and the middle tier in GPT-6, so a later one is not guessed.
  gpt('O8', tail('sol'), (g) => (g.major === 5 ? 'large' : g.major === 6 ? 'medium' : 'unrecognised')),
  gpt('O9', (g) => g.isO, (g) => (g.major === 4 ? 'medium' : 'unrecognised')),
  gpt('O9', (g) => g.major === 3, (g) => (g.minor === 5 ? 'small' : 'unrecognised')),
  gpt('O9', (g) => g.major === 4, (g) =>
    g.minor === null || g.minor === 5 ? 'large' : g.minor === 1 ? 'medium' : 'unrecognised'),
  gpt('O10', (g) => g.major === 5 && (g.minor === null || g.minor <= 4), 'medium'),
  gpt('O10', (g) => g.major === 5 && g.minor === 5, 'large'),
  // From GPT-5.6 on, the dotted API name and the manual thinking levels are the large model.
  gpt('O11', (g) => g.major === 5 && (g.dotForm || g.tail.includes('thinking')), 'large'),
  // "gpt-5-6", "gpt-5-6-instant": the name hides whether the small or the large model answered.
  gpt('O12', (g) => g.major === 5, (_g, plan) =>
    plan === 'plus-or-pro' ? 'large' : plan === 'free-or-go' ? 'small' : 'tier-hidden', { byPlan: true }),
  gpt('O13', () => true, 'tier-hidden'),

  rule('O14', (n) => n.oSeries !== null, oSeriesVerdict, { show: oSeriesName, thinking: true }),
  rule('O15', (n) => n.words.has('gpt') || n.words.has('chatgpt'), 'unrecognised'),
];

/**
 * Sorts a model name into a size class, or says that it is unknown, or that its row must be skipped.
 * `name` can be anything: only text and numbers count as a name. A name is never guessed.
 */
export function classifyModel(name: unknown, options?: ClassifyOptions): ModelClass {
  const text = textOf(name);
  if (text.length > LONGEST_NAME) return unrecognised(text, 'U0');
  const cleaned = readName(text);
  const plan = readPlan(options);
  for (const r of RULES) {
    if (!r.when(cleaned)) continue;
    const verdict = r.verdict(cleaned, plan);
    // A name no rule can place is shown as it came in, and says nothing about thinking.
    if (verdict === 'unrecognised') return unrecognised(cleaned.text, r.id);
    const common = {
      displayName: shown(r.show(cleaned)),
      thinking: r.thinking(cleaned),
      byPlan: r.byPlan,
      rule: r.id,
    };
    if (verdict === 'skip') return { ...common, class: 'skip' };
    if (verdict === 'empty' || verdict === 'auto' || verdict === 'tier-hidden') {
      return { ...common, class: 'unknown', reason: verdict };
    }
    return { ...common, class: verdict };
  }
  return unrecognised(cleaned.text, 'U1');
}

function unrecognised(text: string, ruleId: string): ModelClass {
  return { class: 'unknown', reason: 'unrecognised', displayName: shown(text), thinking: false, byPlan: false, rule: ruleId };
}

/**
 * Every display name leaves through here, friendly or not: one line, nothing that cannot be seen,
 * and never longer than LONGEST_SHOWN.
 */
function shown(text: string): string {
  const whole = text.length <= LONGEST_SHOWN;
  // The cut can land inside a two-part character. Its first half alone would print as a box.
  const part = whole ? text : text.slice(0, SHOWN_WHEN_CUT).replace(/[\uD800-\uDBFF]$/, '');
  return part.replace(/\s+/g, ' ').replace(UNSEEN, '\uFFFD') + (whole ? '' : '…');
}

// ---------- how a rule line is built ----------

interface Extras {
  /** The friendly name. Left out: the name as it came in. */
  show?: string | ((name: Name) => string);
  thinking?: boolean;
}

function rule(
  id: string,
  when: (name: Name) => boolean,
  verdict: Verdict | ((name: Name) => Verdict),
  extras: Extras = {},
): Rule {
  const { show, thinking = false } = extras;
  return {
    id,
    when,
    verdict: typeof verdict === 'function' ? verdict : () => verdict,
    show: typeof show === 'function' ? show : (n) => show ?? n.text,
    thinking: () => thinking,
    byPlan: false,
  };
}

/** A Claude family: one whole word decides the class, with or without "claude" in front. */
function claude(id: string, family: string, size: SizeClass): Rule {
  const show = claudeName(family);
  return rule(id, has(family), size, { show });
}

/** A rule for names with "gpt-<number>". Thinking is read from the tail the same way for all of them. */
function gpt(
  id: string,
  when: (g: Gpt) => boolean,
  verdict: Verdict | ((g: Gpt, plan: ChatGptPlan | undefined) => Verdict),
  extras: { byPlan?: boolean } = {},
): Rule {
  return {
    id,
    when: (n) => n.gpt !== null && when(n.gpt),
    verdict: (n, plan) =>
      n.gpt === null ? 'unrecognised' : typeof verdict === 'function' ? verdict(n.gpt, plan) : verdict,
    show: (n) => (n.gpt === null ? n.text : gptName(n.gpt)),
    thinking: (n) => n.gpt !== null && n.gpt.thinking,
    byPlan: extras.byPlan ?? false,
  };
}

/** The name has every one of these whole words. */
function has(...wanted: string[]): (name: Name) => boolean {
  return (n) => wanted.every((word) => n.words.has(word));
}

/** The words after the GPT version have at least one of these. */
function tail(...wanted: string[]): (g: Gpt) => boolean {
  return (g) => wanted.some((word) => g.tail.includes(word));
}

// ---------- cleaning the name ----------

function textOf(raw: unknown): string {
  // Only text and numbers are names. Nothing is ever called on the value itself, so an object
  // with its own toString cannot put words into a name.
  return typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
}

function readName(text: string): Name {
  const lower = text.toLowerCase();
  const s = lower.replace(/_/g, '-').replace(/(\d)\.(?=\d)/g, '$1-');
  const words = wordsOf(s);
  return { text, s, words: new Set(words), gpt: readGpt(lower, s), oSeries: readOSeries(words) };
}

function wordsOf(s: string): string[] {
  return s.split(/[^a-z0-9]+/).filter((word) => word !== '');
}

function readPlan(options: unknown): ChatGptPlan | undefined {
  // An own property only: nothing inherited can set the plan.
  if (typeof options !== 'object' || options === null || !Object.hasOwn(options, 'plan')) return undefined;
  const plan: unknown = (options as { plan?: unknown }).plan;
  return plan === 'plus-or-pro' || plan === 'free-or-go' ? plan : undefined;
}

function readGpt(lower: string, s: string): Gpt | null {
  // "gpt" as a word of its own, or as "chatgpt" ("chatgpt-4o-latest"). "minigpt-4" and "rugpt-3.5"
  // are other makers' models.
  const found = /(?:^|[^a-z0-9])(?:chat)?gpt-(\d{1,2})(o)?(?![0-9a-z])(?:-(\d{1,2})(?![0-9a-z]))?/.exec(s);
  if (found === null) return null;
  const end = found.index + found[0].length;
  let major = Number(found[1]);
  let minor = found[3] === undefined ? null : Number(found[3]);
  const isO = found[2] !== undefined;
  // The second number ends what was found, so the character before it is the "." or the "-".
  const dotForm = found[3] !== undefined && lower.charAt(end - found[3].length - 1) === '.';
  // Azure writes GPT-3.5 as "gpt-35-turbo".
  if (!isO && major === 35 && minor === null) {
    major = 3;
    minor = 5;
  }
  const words = wordsOf(s.slice(end));
  const tMini = words.some((word, i) => word === 't' && words[i + 1] === 'mini');
  return {
    major,
    minor,
    isO,
    tail: words,
    dotForm,
    thinking: words.includes('thinking') || words.includes('pro') || tMini,
  };
}

function readOSeries(words: readonly string[]): OSeries | null {
  const at = words.findIndex((word) => word === 'o1' || word === 'o3' || word === 'o4');
  const word = words[at];
  if (word === undefined) return null;
  // "deepseek-o1" is another company's model. Only "openai" may stand in front.
  if (!words.slice(0, at).every((before) => before === 'openai')) return null;
  return { word, tail: words.slice(at + 1) };
}

// ---------- friendly names ----------

// A function, not a const: the rule table above is built before the lines down here run.
function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** "5", "5" → " 5.5". Claude ids write no ".0", so "claude-opus-4-0" is "Opus 4". */
function version(major: string | undefined, minor: string | undefined, zeroShown: boolean): string {
  if (major === undefined) return '';
  return ' ' + major + (minor !== undefined && (zeroShown || minor !== '0') ? '.' + minor : '');
}

/** "claude-opus-5-5" → "Opus 5.5", "claude-3-5-haiku-20241022" → "Haiku 3.5". Dates and platforms are dropped. */
function claudeName(family: string): (name: Name) => string {
  const label = capital(family);
  // A number ends where its word ends. In "claude-fable-5_1m_", which is how the counting script
  // prints "claude-fable-5[1m]", the "1" belongs to the 1M marker and Fable 5 is not Fable 5.1.
  const number = '(\\d{1,2})(?![0-9a-z])(?:-(\\d{1,2})(?![0-9a-z]))?';
  const orders = [
    new RegExp(`claude-${family}-${number}`),
    new RegExp(`claude-${number}-${family}`),
    // "Claude Opus 5.5", "opus-5-5": the family word and a version, without "claude-" in front.
    new RegExp(`(?:^|[^a-z0-9])${family}[- ](\\d)(?![0-9a-z])(?:-(\\d{1,2})(?![0-9a-z]))?`),
  ];
  return (n) => {
    for (const order of orders) {
      const found = order.exec(n.s);
      if (found !== null) return label + version(found[1], found[2], false);
    }
    return n.words.has('preview') ? label + ' Preview' : label;
  };
}

function claudeInstantName(n: Name): string {
  const found = /claude-instant-(\d)(?:-(\d))?/.exec(n.s);
  return 'Claude Instant' + (found === null ? '' : version(found[1], found[2], true));
}

function geminiName(tier: string): (name: Name) => string {
  return (n) => {
    const found = /gemini-(\d{1,2})(?![0-9a-z])(?:-(\d{1,2})(?![0-9a-z]))?/.exec(n.s);
    return 'Gemini' + (found === null ? '' : version(found[1], found[2], true)) + ' ' + tier;
  };
}

function gpt35Name(n: Name): string {
  const tags: ReadonlyArray<[word: string, tag: string]> = [
    ['paid', 'Plus'],
    ['mobile', 'mobile'],
    ['plugins', 'plugins'],
    ['browse', 'browsing'],
  ];
  const tag = tags.find(([word]) => n.words.has(word));
  return 'GPT-3.5' + (tag === undefined ? '' : ` (${tag[1]})`);
}

// Maps, not plain objects: a word such as "constructor" must find nothing.
const GPT_WORD: ReadonlyMap<string, string> = new Map([
  ['thinking', 'Thinking'], ['instant', 'Instant'], ['pro', 'Pro'], ['mini', 'mini'], ['nano', 'nano'],
  ['sol', 'Sol'], ['terra', 'Terra'], ['luna', 'Luna'], ['astra', 'Astra'],
  ['codex', 'Codex'], ['max', 'Max'], ['turbo', 'Turbo'], ['chat', 'Chat'],
]);
const GPT_TAG: ReadonlyMap<string, string> = new Map([
  ['auto', 'auto'], ['browsing', 'browsing'], ['plugins', 'plugins'], ['dalle', 'DALL·E'],
  ['gizmo', 'custom GPT'], ['mobile', 'mobile'], ['canmore', 'canvas'],
]);
const GPT_DROPPED: ReadonlySet<string> = new Set(['latest', 'preview', 'wm', 'free']);

/** "GPT-5.2 Thinking", "GPT-4o mini", "GPT-4 (browsing)": model words after the version, feature tags in brackets. */
function gptName(g: Gpt): string {
  const base = `GPT-${g.major}${g.isO ? 'o' : ''}${g.minor !== null && g.minor !== 0 ? '.' + g.minor : ''}`;
  const words: string[] = [];
  const tags: string[] = [];
  for (let i = 0; i < g.tail.length; i++) {
    const word = g.tail[i];
    const next = g.tail[i + 1];
    if (word === undefined) continue;
    if (/^v?\d+$/.test(word)) continue; // dates and revisions
    if (word === 'a' && next === 't') continue; // "a-t-mini"
    if (word === 't' && next === 'mini') {
      words.push('Thinking');
      continue;
    }
    if (word === 'code' && next === 'interpreter') {
      tags.push('code interpreter');
      i++;
      continue;
    }
    if (GPT_DROPPED.has(word)) continue;
    const known = GPT_WORD.get(word);
    if (known !== undefined) words.push(known);
    else tags.push(GPT_TAG.get(word) ?? word);
  }
  return [base, ...words].join(' ') + (tags.length > 0 ? ` (${tags.join(' ')})` : '');
}

function oSeriesVerdict(n: Name): Verdict {
  if (n.oSeries === null) return 'unrecognised';
  const { tail: after } = n.oSeries;
  return after.includes('pro') ? 'large' : after.includes('mini') ? 'small' : 'medium';
}

const O_SERIES_KEPT: ReadonlySet<string> = new Set(['mini', 'high', 'medium', 'low', 'preview', 'pro']);

function oSeriesName(n: Name): string {
  if (n.oSeries === null) return n.text;
  const { word, tail: after } = n.oSeries;
  const name = [word, ...after.filter((w) => O_SERIES_KEPT.has(w))].join('-');
  return after.includes('deep') && after.includes('research') ? name + ' deep research' : name;
}
