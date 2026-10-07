// The cut tips: the catalogue, the rule that picks and orders them, and every sentence about a saving.
//
// A tip is one stated what-if: a function that turns the person's usage into another usage. It only
// takes tokens away, or counts them on a smaller model, so no tip of this catalogue can cost more.
// The estimator works out each tip's saving. Nothing here calculates a footprint.
//
// The work is cut in two so that the store makes one full call to the estimator and uses its result
// for everything else as well: buildTips before the call, pickTips after it.

import type { SourceId, Spread } from '../contracts/usage';
import type { MassUnit, Rich, SwitchView, TipView } from '../contracts/view';
import { mass, massSpan, massWithUnit, percent, plainNumber, tokenCount } from '../format';
import { moveShare, scaleTokens } from './estimate';
import type { Estimate, HiddenWork, Row, RowShare, TokenType, TokenUsage } from './estimate';

export type TipId =
  | 'cc-opus-to-sonnet' | 'cc-fable-to-sonnet' | 'cc-sonnet-to-haiku' | 'cc-clear' | 'cc-effort'
  | 'gpt-less-thinking' | 'gpt-new-chat' | 'gpt-shorter-answers';

/** Each tool's catalogue in its fixed order. The module always gets the tips in this order. */
export const TIP_ORDER: Readonly<Record<SourceId, readonly TipId[]>> = Object.freeze({
  'claude-code': Object.freeze(['cc-opus-to-sonnet', 'cc-fable-to-sonnet', 'cc-sonnet-to-haiku', 'cc-clear', 'cc-effort'] as const),
  chatgpt: Object.freeze(['gpt-less-thinking', 'gpt-new-chat', 'gpt-shorter-answers'] as const),
});

export function isTipId(source: SourceId, id: string): id is TipId {
  return TIP_ORDER[source].some((known) => known === id);
}

// ---------- the numbers a maintainer may want to change ----------

export const RULES: {
  /** At most this many tips under "Ways to cut". An applied tip beyond them is shown as one more. */
  readonly maxShown: number;
  /** A tip is too small when its middle saving is below this many kg (10 g, about 60 m in a petrol car). */
  readonly floorKg: number;
  /** A tip is too small when it lowers the middle estimate by less than this share. */
  readonly minMiddleDrop: number;
  /** "a month" is said for data that covers this many days. */
  readonly monthDays: readonly [number, number];
  /** A smallest saving above minus this share of the middle estimate is rounding noise, not a cost. */
  readonly noise: number;
} = Object.freeze({ maxShown: 3, floorKg: 0.01, minMiddleDrop: 0.05, monthDays: [28, 31] as const, noise: 1e-9 });

/** The share each what-if uses. It is in the words on the page too, never hidden. */
export const SHARES = Object.freeze({
  opusToSonnet: 0.5,
  fableToSonnet: 0.5,
  sonnetToHaiku: 0.25,
  clear: 1 / 3,
  effort: 0.2,
  lessThinking: 0.5,
  newChat: 0.5,
  shorterAnswers: 0.25,
});

// ---------- what goes in and what comes out ----------

/** A row as it goes to the module and to the tips. The module ignores `display` and `rereadFresh`. */
export interface UsageRow extends Row {
  /** `displayName` of the classifier, e.g. "Opus 5.5". */
  readonly display: string;
  /** ChatGPT only: the part of `freshInput` that is earlier conversation read again after a break. */
  readonly rereadFresh?: number;
}

export interface TipInput {
  readonly source: SourceId;
  readonly rows: readonly UsageRow[];
  /** The six pieces for ChatGPT, [] for Claude Code. Only their rows are read, never `on`. */
  readonly hidden: readonly HiddenWork[];
  /** ChatGPT: the export records at least one thinking time in the 30 days. false for Claude Code. */
  readonly thinkingRecorded: boolean;
  /**
   * ChatGPT: some of the thinking seconds are assumed, because an answer by a thinking model had no
   * time that could be read (`Totals.thinkingSecondsAssumed > 0`). Left out counts as false.
   */
  readonly thinkingPartlyAssumed?: boolean;
}

/** A built tip's own texts. Only this file reads them. */
export interface TipTexts {
  /** Worded from `result.shares.models`: a model tip names its family's share of the estimate. */
  readonly title: (shares: readonly RowShare[]) => string;
  /** The what-if as the start of the body sentence. */
  readonly lead: string;
  readonly how: Rich;
  readonly label: string;
  readonly afterLabel: string;
}

/** A tip that can apply to this person. It is a `Tip` of the module, so the list goes to `estimate` as it is. */
export interface BuiltTip {
  readonly id: TipId;
  readonly change: (usage: TokenUsage) => TokenUsage;
  readonly texts: TipTexts;
}

export interface PickInput {
  readonly source: SourceId;
  /** What buildTips gave, unchanged and in the same order. */
  readonly built: readonly BuiltTip[];
  /** A full call to estimate that got `built` as `tips`. Which tips are on is read from `result.tips[].applied`. */
  readonly result: Estimate;
  /** `ResultView.unit` as it is now. */
  readonly unit: MassUnit;
  /** The days the counts stand for, 1 to 30. Not the length of the window, which is always 30. */
  readonly coveredDays: number;
}

/** `label` and `note` are the switch's: "Sonnet for half of your Opus work", "Saves roughly 0.75–7.6 kg a month". */
export interface ShownTip {
  readonly view: TipView;
  readonly label: string;
  readonly note: string;
}

export interface PickedTips {
  /** In display order: at most three, plus any applied tip that ranks below them. */
  readonly shown: readonly ShownTip[];
  /** How many tips were built. */
  readonly tried: number;
  /** The sentence shown in place of tips. null when `shown` is not empty. */
  readonly noTipsNote: string | null;
  /** "With: {label}", "With {n} tips applied" or null. */
  readonly appliedLabel: string | null;
}

// ---------- what-ifs ----------
//
// Rules every what-if here keeps:
//   - It names exact models, the names the person had when the data came in. It never looks for a piece
//     of text in a name and never goes by size class: both would also catch rows another tip has moved,
//     and then two tips could give another result when their order changes.
//   - It only takes tokens away, or counts them on a smaller size class.
//   - It returns every piece of hidden work as it was, in the same order. The module refuses anything else.

/** The name the module gives a row that moveShare has moved. It differs for every row it came from. */
export const movedName = (model: string, toClass: string): string => `${model} (moved to ${toClass})`;

// The module's type for a row does not have the field, so it is read through a check.
function rereadOf(row: Row): number {
  return 'rereadFresh' in row && typeof row.rereadFresh === 'number' ? row.rereadFresh : 0;
}

/**
 * ChatGPT: a share of the earlier conversation that was read again after a break is not read.
 * Nothing else changes: a new chat after a break starts as cold as the old chat would have been.
 */
export function lessRereadingAfterBreaks({ share }: { readonly share: number }): (usage: TokenUsage) => TokenUsage {
  return (usage) => ({
    rows: usage.rows.map((row) => {
      const fresh = row.freshInput || 0;
      const reread = Math.min(rereadOf(row), fresh);
      if (!(reread > 0)) return row;
      const next: Row & { readonly rereadFresh: number } = { ...row, freshInput: fresh - reread * share, rereadFresh: reread * (1 - share) };
      return next;
    }),
    hidden: usage.hidden,
  });
}

// ---------- helpers for the texts ----------

const TOKEN_TYPES: readonly TokenType[] = ['freshInput', 'cacheWrite', 'cacheRead', 'output'];

const sum = (rows: readonly Row[], type: TokenType): number => rows.reduce((total, row) => total + (row[type] || 0), 0);
const allTokens = (rows: readonly Row[]): number => TOKEN_TYPES.reduce((total, type) => total + sum(rows, type), 0);

const FAMILIES = ['Fable', 'Mythos', 'Opus', 'Sonnet', 'Haiku'] as const;
export type Family = (typeof FAMILIES)[number];

/**
 * The Claude family, from the classifier's display name: "Opus 5.5" gives "Opus". null for anything
 * that is not a Claude model with a family word ("GPT-5", "Opusculum 2").
 */
export function familyOf(row: { readonly display?: string }): Family | null {
  const display = row.display || '';
  return FAMILIES.find((family) => display === family || display.startsWith(`${family} `)) ?? null;
}

/** The version in a display name: "Sonnet 4.6" gives [4, 6], "Opus 5" gives [5, 0]. null when there is none. */
export function versionOf(row: { readonly display?: string }): readonly [number, number] | null {
  const match = /^[A-Za-z]+ (\d+)(?:\.(\d+))?$/.exec(row.display || '');
  return match ? [Number(match[1]), Number(match[2] || 0)] : null;
}

// Mythos has no class here on purpose: no tip moves it, because the documentation names no command to go back to it.
const CLASS_OF_FAMILY: Readonly<Record<Family, string | null>> = { Fable: 'fable', Mythos: null, Opus: 'large', Sonnet: 'medium', Haiku: 'small' };

const inOwnClass = (row: UsageRow): boolean => {
  const family = familyOf(row);
  return family !== null && row.sizeClass === CLASS_OF_FAMILY[family];
};

/** The rows of one Claude family that have tokens. The size class must be the family's own. */
const rowsOfFamily = (rows: readonly UsageRow[], family: Family): UsageRow[] =>
  rows.filter((row) => familyOf(row) === family && inOwnClass(row) && allTokens([row]) > 0);

/**
 * Does `/effort` work on this model? Fable from 5, Opus from 4.6, Sonnet from 4.6. A name without a
 * version (an alias, a custom name) is left out.
 */
export function hasEffortLevels(row: { readonly display?: string }): boolean {
  const family = familyOf(row);
  const version = versionOf(row);
  if (!version) return false;
  if (family === 'Fable') return version[0] >= 5;
  if (family === 'Opus' || family === 'Sonnet') return version[0] > 4 || (version[0] === 4 && version[1] >= 6);
  return false;
}

/** "Opus 5.5" for one model, "Opus models" for several. */
function familyName(rows: readonly UsageRow[], family: Family): string {
  const names = [...new Set(rows.map((row) => row.display))];
  const [only] = names;
  return names.length === 1 && only !== undefined ? only : `${family} models`;
}

/** "Fable", "Opus and Sonnet", "Fable, Opus and Sonnet". */
const listWords = (words: readonly string[]): string =>
  (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

/**
 * A share as words: rounded to the nearest 5%. "Almost all" from 95%. null below 10%.
 * `whole`: nothing else has a share, so it is "All". The table beside the tip then says 100%.
 */
export function shareWords(share: number, whole = false): string | null {
  const pct = Math.round((share * 100) / 5) * 5;
  if (pct < 10) return null;
  if (whole) return 'All';
  if (pct >= 95) return 'Almost all';
  return `About ${percent(pct / 100)}`;
}

/** Seconds as "about 40 seconds", "about 25 minutes", "about 9.5 hours". */
export function duration(seconds: number): string {
  if (seconds < 90) {
    const s = Math.max(1, Math.round(seconds));
    return `about ${plainNumber(s)} ${s === 1 ? 'second' : 'seconds'}`;
  }
  if (seconds < 5400) return `about ${plainNumber(Math.round(seconds / 60))} minutes`;
  const hours = seconds / 3600;
  const shown = hours < 10 ? Math.round(hours * 2) / 2 : Math.round(hours);
  return `about ${plainNumber(shown)} hours`;
}

// The moves a Claude Code row can make. A what-if that names models (cc-effort) lists the moved names
// too, so it also finds the rows another tip has moved.
const MOVES: Readonly<Partial<Record<Family, Family>>> = { Opus: 'Sonnet', Fable: 'Sonnet', Sonnet: 'Haiku' };

const namesAsCountedAndMoved = (rows: readonly UsageRow[]): string[] => rows.flatMap((row) => {
  const family = familyOf(row);
  const to = family ? MOVES[family] : undefined;
  const toClass = to ? CLASS_OF_FAMILY[to] : null;
  return toClass ? [row.model, movedName(row.model, toClass)] : [row.model];
});

// ---------- the catalogue ----------

type Build = (input: TipInput) => Omit<BuiltTip, 'id'> | null;

const SWITCH_AT_START = ' Each choice also becomes your default for new sessions. Switch at the start of a task: after a switch, Claude reads the whole conversation again without its cache.';

interface ModelTipSpec {
  readonly family: 'Opus' | 'Fable' | 'Sonnet';
  readonly to: 'Sonnet' | 'Haiku';
  readonly toClass: string;
  readonly share: number;
  readonly shareWord: string;
  readonly how: Rich;
}

function modelTip({ family, to, toClass, share, shareWord, how }: ModelTipSpec): Build {
  return ({ rows: all }) => {
    const rows = rowsOfFamily(all, family);
    if (!rows.length) return null;
    const name = familyName(rows, family);
    const familyOfModel = new Map(all.map((row) => [row.model, familyOf(row)]));
    return {
      change: moveShare({ where: { models: rows.map((row) => row.model) }, toClass, share }),
      texts: {
        title: (shares) => {
          const ofFamily = shares.reduce((total, entry) => total + (familyOfModel.get(entry.model) === family ? entry.share : 0), 0);
          // The only family with a share: "All", as the table beside it says 100%.
          const whole = ofFamily > 0 && !shares.some((entry) => familyOfModel.get(entry.model) !== family && entry.share > 0);
          const words = shareWords(ofFamily, whole);
          return words ? `${words} of your estimate comes from ${name}` : `Part of your estimate comes from ${name}`;
        },
        // Several models read "your Opus work", never "your Opus models work".
        lead: `Moving ${shareWord} of your ${rows.length > 1 && name.endsWith(' models') ? family : name} work to ${to}`,
        how,
        label: `${to} for ${shareWord} of your ${family} work`,
        afterLabel: to,
      },
    };
  };
}

const fixedTitle = (title: string) => (): string => title;

const BUILDERS: Readonly<Record<TipId, Build>> = {
  'cc-opus-to-sonnet': modelTip({
    family: 'Opus', to: 'Sonnet', toClass: 'medium', share: SHARES.opusToSonnet, shareWord: 'half',
    how: ['Type ', { code: '/model sonnet' }, ' for routine work and ', { code: '/model opus' }, ` for a hard problem.${SWITCH_AT_START}`],
  }),
  'cc-fable-to-sonnet': modelTip({
    family: 'Fable', to: 'Sonnet', toClass: 'medium', share: SHARES.fableToSonnet, shareWord: 'half',
    how: ['Type ', { code: '/model sonnet' }, ' for routine work and ', { code: '/model fable' }, ` for your hardest tasks.${SWITCH_AT_START}`],
  }),
  'cc-sonnet-to-haiku': modelTip({
    family: 'Sonnet', to: 'Haiku', toClass: 'small', share: SHARES.sonnetToHaiku, shareWord: 'a quarter',
    how: ['For simple jobs that Claude hands to a subagent, put ', { code: 'model: haiku' }, ' in that subagent’s file. For a small task of your own, type ', { code: '/model haiku' }, ' at the start and ', { code: '/model sonnet' }, ' when you are done. Each choice also becomes your default for new sessions.'],
  }),

  'cc-clear': ({ rows }) => {
    const read = sum(rows, 'cacheRead');
    if (!(read > 0)) return null;
    const share = read / allTokens(rows);
    const pct = Math.round(share * 100);
    return {
      change: scaleTokens({ types: ['cacheRead'], factor: 1 - SHARES.clear }),
      texts: {
        // "Earlier text", not "earlier conversation": a cache read also holds the instructions, the tool
        // definitions and the project files, and /clear does not shorten those.
        title: fixedTitle(pct >= 50
          ? `${pct >= 99 ? 'Almost all' : percent(share)} of your tokens are earlier text being read again`
          : `${tokenCount(read)} of your tokens are earlier text being read again`),
        lead: 'A third less re-reading',
        how: ['Type ', { code: '/clear' }, ' when you switch to an unrelated task. Claude Code then starts a new conversation, so there is less to read again at every step. To stay on the same task with a shorter history, type ', { code: '/compact' }, ' at a natural break in your work.'],
        label: 'A third less re-reading',
        afterLabel: 'Less re-reading',
      },
    };
  },

  'cc-effort': ({ rows: all }) => {
    // Only models that have effort levels. Haiku has none, and neither have older Sonnet and Opus versions.
    const rows = all.filter((row) => hasEffortLevels(row) && inOwnClass(row) && (row.output || 0) > 0);
    if (!rows.length) return null;
    const who = listWords((['Fable', 'Opus', 'Sonnet'] as const).filter((family) => rows.some((row) => familyOf(row) === family)));
    return {
      change: scaleTokens({ where: { models: namesAsCountedAndMoved(rows) }, types: ['output'], factor: 1 - SHARES.effort }),
      texts: {
        title: fixedTitle(`${who} wrote ${tokenCount(sum(rows, 'output'))} tokens for you, thinking included`),
        lead: `A fifth less writing and thinking on ${who}`,
        how: ['Type ', { code: '/effort low' }, ' at the start of a simple task: Claude then thinks and writes less. How much less depends on the task. The level stays, also in later sessions, until you change it. ', { code: '/effort auto' }, ' goes back to the model’s own level.'],
        label: 'A fifth less writing and thinking',
        afterLabel: 'Less thinking',
      },
    };
  },

  'gpt-less-thinking': ({ hidden, thinkingRecorded, thinkingPartlyAssumed }) => {
    const piece = hidden.find((item) => item.id === 'thinking');
    const seconds = piece ? sum(piece.rows, 'output') : 0;
    if (!(seconds > 0)) return null;
    return {
      change: scaleTokens({ types: ['output'], factor: 1 - SHARES.lessThinking, hiddenId: 'thinking' }),
      texts: {
        // With no recorded time in the 30 days, every second is our assumption, and the title says so.
        // With some times recorded and some assumed, the sum is our count, not the export's.
        title: fixedTitle(!thinkingRecorded
          ? `We assume ChatGPT thought for ${duration(seconds)} before its answers`
          : thinkingPartlyAssumed
            ? `By our count, ChatGPT thought for ${duration(seconds)} before its answers`
            : `ChatGPT thought for ${duration(seconds)} before its answers`),
        lead: 'Half as much thinking',
        how: ['For everyday questions, pick ', { strong: 'Instant' }, '. On eligible paid plans, the ', { strong: 'Thinking' }, ' slider sets how much ChatGPT thinks. On Free and Go, use ', { strong: 'Think' }, ' only for harder questions.'],
        label: 'Half as much thinking',
        afterLabel: 'Less thinking',
      },
    };
  },

  'gpt-new-chat': ({ rows }) => {
    // Only what the reader marks as read again after a break. Without rereadFresh there is no tip.
    const read = rows.reduce((total, row) => total + Math.min(row.rereadFresh || 0, row.freshInput || 0), 0);
    if (!(read > 0)) return null;
    return {
      change: lessRereadingAfterBreaks({ share: SHARES.newChat }),
      texts: {
        title: fixedTitle(`By our count, ChatGPT re-read ${tokenCount(read)} tokens of old messages after a break`),
        lead: 'Half as much re-reading after a break',
        how: ['When you come back after more than half an hour, open a ', { strong: 'new chat' }, ' unless you need the old one. In an old chat, ChatGPT reads the conversation so far again with every message, or as much of it as it keeps. After a break we count that as a full fresh reading.'],
        label: 'Half as much re-reading after breaks',
        afterLabel: 'New chats',
      },
    };
  },

  'gpt-shorter-answers': ({ rows }) => {
    const output = sum(rows, 'output');
    if (!(output > 0)) return null;
    return {
      change: scaleTokens({ types: ['output'], factor: 1 - SHARES.shorterAnswers }),
      texts: {
        title: fixedTitle(`ChatGPT wrote ${tokenCount(output)} tokens for you`),
        lead: 'Answers a quarter shorter',
        how: ['In ', { strong: 'Settings' }, ', select ', { strong: 'Personalization' }, ' (in the phone app: ', { strong: 'Customize ChatGPT' }, '). In the ', { strong: 'Custom Instructions' }, ' field, add a line such as “Keep answers short unless I ask for detail.”'],
        label: 'Answers a quarter shorter',
        afterLabel: 'Shorter answers',
      },
    };
  },
};

/** The tips that can apply to this usage, in catalogue order. Pure. No call to estimate. */
export function buildTips(input: TipInput): BuiltTip[] {
  const built: BuiltTip[] = [];
  for (const id of TIP_ORDER[input.source]) {
    const tip = BUILDERS[id](input);
    if (tip) built.push({ id, ...tip });
  }
  return built;
}

// ---------- the sentences ----------

/** " a month", " over these 12 days" or " in this one day". `days` is the covered days. */
export function periodWords(days: number): string {
  if (days >= RULES.monthDays[0] && days <= RULES.monthDays[1]) return ' a month';
  return days === 1 ? ' in this one day' : ` over these ${plainNumber(days)} days`;
}

/**
 * The saving as words, in the result's own unit, or null when its high end prints as zero.
 *   - both ends print the same:                    "about B kg a month"
 *   - the low end is exactly zero:                 "between nothing and roughly B kg a month"
 *   - the low end is above zero but prints as "0": each end in the unit that suits it,
 *                                                  "roughly 3.3 g to 1.2 kg a month"
 *   - otherwise:                                   "roughly A–B kg a month"
 */
export function savingWords(saving: Spread, unit: MassUnit, days: number): string | null {
  const high = mass(Math.max(0, saving.p95), unit);
  if (high === '0') return null;
  const period = periodWords(days);
  // Exactly zero, or under 0.005 mg, which prints as zero in every unit.
  if (!(saving.p5 > 0) || massWithUnit(saving.p5).startsWith('0 ')) return `between nothing and roughly ${high} ${unit}${period}`;
  const low = mass(saving.p5, unit);
  if (low === '0') return `roughly ${massSpan(saving.p5, saving.p95)}${period}`;
  if (low === high) return `about ${high} ${unit}${period}`;
  return `roughly ${low}–${high} ${unit}${period}`;
}

/**
 * The words for a tip that is switched on and can cost more: some run has a saving below zero. No tip
 * of this catalogue can get here. The words are kept for a tip that is added later. They are the one
 * place where the page writes "up to".
 * When only a few runs cost more, the low end of the saving range is not below zero. The cost named
 * is then the largest in any run, for which "up to" is exact.
 */
export function costWords(saving: Spread, lowestSaving: number, unit: MassUnit): string {
  // An amount that would print as "0" in the result's unit is printed in the unit that suits it.
  const amount = (kg: number): string => (mass(kg, unit) === '0' ? massWithUnit(kg) : `${mass(kg, unit)} ${unit}`);
  if (!(saving.p95 > 0)) {
    const least = -saving.p95;
    const most = -saving.p5;
    if (!(least > 0) || massWithUnit(least).startsWith('0 ')) return `With your settings this costs between nothing and roughly ${amount(most)} more`;
    if (mass(least, unit) === '0') return `With your settings this costs roughly ${massSpan(least, most)} more`;
    if (mass(least, unit) === mass(most, unit)) return `With your settings this costs about ${amount(most)} more`;
    return `With your settings this costs roughly ${mass(least, unit)}–${mass(most, unit)} ${unit} more`;
  }
  const worst = saving.p5 < 0 ? -saving.p5 : -lowestSaving;
  return `Could save up to roughly ${amount(saving.p95)}, or cost up to roughly ${amount(worst)} more`;
}

export const SAVES_NOTHING_BODY = 'With your current settings this change saves nothing.';
export const SAVES_NOTHING_NOTE = 'Saves nothing with your current settings';

/** Why a tip is not offered. A saving that prints as zero counts as "floor". */
export type TooSmall = 'cost' | 'floor' | 'share';

const TOOL_NAME: Readonly<Record<SourceId, string>> = { 'claude-code': 'Claude Code', chatgpt: 'ChatGPT' };

/**
 * The sentence shown in place of tips. It counts only the changes that could be worked out for this
 * person, and it names the reasons that really applied.
 */
export function noTipsWords(source: SourceId, tried: number, reasons: ReadonlySet<TooSmall>, days: number, single = false): string {
  const tool = TOOL_NAME[source];
  if (tried === 0) return `None of the changes we know how to work out applies to your ${tool} numbers.`;
  const parts: string[] = [];
  // `single`: the person has set every assumption that matters, so there is one outcome and no "possible outcomes".
  if (reasons.has('floor')) parts.push(`would save less than ${massWithUnit(RULES.floorKg)}${periodWords(days)}${single ? '' : ' in at least half of the possible outcomes'}`);
  if (reasons.has('share')) parts.push(`would lower your ${single ? 'estimate' : 'middle estimate'} by less than ${percent(RULES.minMiddleDrop)}`);
  if (reasons.has('cost')) parts.push(single ? 'would cost more' : 'could cost more in some possible outcomes'); // no tip of this catalogue
  const reason = parts.join(', or ');
  return tried === 1
    ? `We tried 1 change on your ${tool} numbers and do not suggest it: it ${reason}.`
    : `We tried ${tried} changes on your ${tool} numbers and suggest none: each ${reason}.`;
}

// ---------- picking and ordering ----------

interface Candidate {
  readonly tip: BuiltTip;
  readonly saving: Spread;
  readonly lowestSaving: number;
  readonly after: Spread;
  readonly applied: boolean;
  readonly words: string | null;
  readonly canCost: boolean;
}

/** Which tips are shown, in which order, with which sentences. Pure. No call to estimate. */
export function pickTips(input: PickInput): PickedTips {
  const { source, built, result, unit, coveredDays: days } = input;
  const none = (): PickedTips => ({ shown: [], tried: 0, noTipsNote: noTipsWords(source, 0, new Set(), days, result.single), appliedLabel: null });
  if (!built.length) return none();
  // A call made while a slider moves has no tips. Its result must never get here.
  if (!result.tips.length) throw new Error('ai-co2: pickTips needs the result of a full call to estimate, with the saving of every tip');

  // "Now" is the range with no tip applied, whatever is switched on.
  const now = result.baseline ?? result.range;
  if (!(now.mid > 0)) return none();

  // Too small, or a possible cost: not offered. A tip that is switched on always stays: otherwise the
  // switch the person needs to go back would be gone.
  const candidates: Candidate[] = [];
  const reasons = new Set<TooSmall>();
  for (const tip of built) {
    const numbers = result.tips.find((entry) => entry.id === tip.id);
    if (!numbers) throw new Error(`ai-co2: pickTips: the result has no saving for the tip "${tip.id}"`);
    const words = savingWords(numbers.saving, unit, days);
    const middleDrop = (now.mid - numbers.after.mid) / now.mid;
    // The module already counts rounding noise as zero. The small margin is one more guard.
    const canCost = numbers.lowestSaving < -RULES.noise * now.mid;
    let why: TooSmall | null = null;
    if (canCost) why = 'cost';
    else if (words === null) why = 'floor';
    else if (numbers.saving.mid < RULES.floorKg) why = 'floor';
    else if (middleDrop < RULES.minMiddleDrop) why = 'share';
    if (why && !numbers.applied) {
      reasons.add(why);
      continue;
    }
    candidates.push({ tip, saving: numbers.saving, lowestSaving: numbers.lowestSaving, after: numbers.after, applied: numbers.applied, words, canCost });
  }

  // Biggest middle saving first. When two middle savings print the same: the higher high end first,
  // then catalogue order.
  const order = built.map((tip) => tip.id);
  candidates.sort((a, b) => {
    if (mass(a.saving.mid, unit) !== mass(b.saving.mid, unit)) return b.saving.mid - a.saving.mid;
    if (a.saving.p95 !== b.saving.p95) return b.saving.p95 - a.saving.p95;
    return order.indexOf(a.tip.id) - order.indexOf(b.tip.id);
  });
  const picked = [...candidates.slice(0, RULES.maxShown), ...candidates.slice(RULES.maxShown).filter((candidate) => candidate.applied)];

  const shown = picked.map((candidate): ShownTip => {
    const { tip, words } = candidate;
    let body: Rich;
    let note: string;
    if (candidate.canCost) {
      // Only for a tip that is on. It must not say "saves".
      note = costWords(candidate.saving, candidate.lowestSaving, unit);
      body = [`${note}.`];
    } else if (words === null) {
      body = [SAVES_NOTHING_BODY];
      note = SAVES_NOTHING_NOTE;
    } else {
      body = [`${tip.texts.lead} would save `, { mark: words }, '.'];
      note = `Saves ${words}`;
    }
    return {
      view: {
        id: tip.id,
        title: tip.texts.title(result.shares.models),
        body,
        how: [...tip.texts.how],
        applied: candidate.applied,
        now: { ...now },
        after: { ...candidate.after },
        afterLabel: tip.texts.afterLabel,
      },
      label: tip.texts.label,
      note,
    };
  });

  const on = shown.filter((tip) => tip.view.applied);
  const [onlyOn] = on;
  return {
    shown,
    tried: built.length,
    noTipsNote: shown.length ? null : noTipsWords(source, built.length, reasons, days, result.single),
    appliedLabel: on.length === 1 && onlyOn ? `With: ${onlyOn.label}` : on.length ? `With ${on.length} tips applied` : null,
  };
}

// ---------- the switches in the result card (Claude Code) ----------

export const TRY_A_CHANGE: { readonly title: string; readonly note: string } = Object.freeze({
  title: 'Try a change',
  note: 'Flip one to see what it changes. The details are under “Ways to cut”.',
});

/** One switch per shown tip, in the same order. */
export function tipSwitches(picked: PickedTips): SwitchView[] {
  return picked.shown.map((tip) => ({ id: tip.view.id, label: tip.label, note: tip.note, noteIcon: null, on: tip.view.applied }));
}
