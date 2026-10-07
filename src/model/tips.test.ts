import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SourceId, Spread } from '../contracts/usage';
import type { MassUnit, Rich } from '../contracts/view';
import { mass, unitFor } from '../format';
import { estimate, moveShare, scaleTokens } from './estimate';
import type { AssumptionTable, Estimate, HiddenWork, Pins, Row, TokenUsage } from './estimate';
import {
  RULES,
  SAVES_NOTHING_BODY,
  SAVES_NOTHING_NOTE,
  TIP_ORDER,
  TRY_A_CHANGE,
  buildTips,
  costWords,
  duration,
  familyOf,
  hasEffortLevels,
  isTipId,
  lessRereadingAfterBreaks,
  movedName,
  noTipsWords,
  periodWords,
  pickTips,
  savingWords,
  shareWords,
  tipSwitches,
  versionOf,
} from './tips';
import type { BuiltTip, PickedTips, ShownTip, TooSmall, UsageRow } from './tips';

// ---------- the fixture ----------
//
// fixtures/tips.cases.verified.json was written by the checked reference of the catalogue. It holds 33
// made-up people, and for each one the texts the page must show: with no tip applied and, where there
// are tips, with the first one applied.

interface Person {
  name: string;
  source: SourceId;
  coveredDays: number;
  rows: UsageRow[];
  hidden?: HiddenWork[];
  pins?: Pins;
  table?: AssumptionTable;
  thinkingRecorded?: boolean;
}
interface ExpectedTip {
  id: string;
  applied: boolean;
  title: string;
  body: Rich;
  how: Rich;
  afterLabel: string;
  switchLabel: string;
  switchNote: string;
}
interface Expected {
  applied: string[];
  unit: MassUnit;
  noTipsNote: string | null;
  appliedLabel: string | null;
  tips: ExpectedTip[];
  switchIds: string[];
}
interface CasesFile {
  rules: { maxShown: number; floorKg: number; minMiddleDrop: number; monthDays: [number, number]; noise: number };
  cases: Array<{ name: string; input: Omit<Person, 'name'>; expect: Expected[] }>;
}

const file = JSON.parse(readFileSync(new URL('./fixtures/tips.cases.verified.json', import.meta.url), 'utf8')) as CasesFile;

// Two sentences were changed after the catalogue was checked. The fixture stays as the reference wrote
// it, and the two changes are made here, each named, so every other word is still compared with it.
//   1. A person with one family only: the title says "All", because the table beside it says 100%.
//   2. The new-chat tip no longer says that ChatGPT reads "the whole conversation": the page assumes a limit.
// A third change is in how a number is printed, not in a sentence: the reference printed a token count
// in whole millions ("5 million"), and the page now prints three meaningful digits ("5.02 million").
// The page's figure is read back as whole millions before the two are compared, so every word and the
// whole millions are still held to the fixture. The exact new figures have a test of their own below.
const ONE_FAMILY_ONLY: readonly string[] = [
  'A custom model name that only says "opus" (no version)',
  'A gateway that strips caching: everything is fresh input',
  'Fable user (the statistics fixture D)',
  'One long day of work, logs cover one day',
  'Sonnet only, short sessions, a lot of writing',
  'Sonnet user with enormous cache reads (long sessions, never cleared)',
];
// A fourth change: "On paid plans" stood beside "On Free and Go", and Go is a paid plan. The page now
// says "On eligible paid plans", which are OpenAI's own words for who has the Thinking slider.
const OLD_PLANS = '. On paid plans, the ';
const NEW_PLANS = '. On eligible paid plans, the ';
const OLD_NEW_CHAT = 'In an old chat, ChatGPT reads the whole conversation so far again with every message.';
const NEW_NEW_CHAT = 'In an old chat, ChatGPT reads the conversation so far again with every message, or as much of it as it keeps.';

function asThePageSaysNow(name: string, tip: ExpectedTip): ExpectedTip {
  const title = ONE_FAMILY_ONLY.includes(name) ? tip.title.replace(/^Almost all of your estimate comes from /, 'All of your estimate comes from ') : tip.title;
  const how = tip.how.map((part) => (typeof part === 'string' ? part.replace(OLD_NEW_CHAT, NEW_NEW_CHAT).replace(OLD_PLANS, NEW_PLANS) : part));
  return { ...tip, title, how };
}
const inWholeMillions = (title: string): string => title.replace(/([\d.]+) million tokens/, (_whole, figure: string) => `${Math.round(Number(figure))} million tokens`);
const PEOPLE: Person[] = file.cases.map((entry) => ({ name: entry.name, ...entry.input }));
const CC = PEOPLE.filter((person) => person.source === 'claude-code');
const GPT = PEOPLE.filter((person) => person.source === 'chatgpt');

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`test: no ${what}`);
  return value;
}
const person = (start: string): Person => must(PEOPLE.find((entry) => entry.name.startsWith(start)), `person "${start}"`);

// ---------- one person, worked out as the store does it ----------

interface Run {
  built: BuiltTip[];
  result: Estimate;
  now: Spread;
  unit: MassUnit;
  picked: PickedTips;
}

function inputOf(who: Person) {
  return { rows: who.rows, hidden: who.hidden ?? [], pins: who.pins ?? {}, table: who.table ?? null };
}

function run(who: Person, applied: readonly string[] = [], custom?: readonly BuiltTip[]): Run {
  const built = custom ? [...custom] : buildTips({ source: who.source, rows: who.rows, hidden: who.hidden ?? [], thinkingRecorded: who.thinkingRecorded !== false });
  const result = estimate({ ...inputOf(who), tips: built, applied: built.filter((tip) => applied.includes(tip.id)).map((tip) => tip.id) }, { biggestUnknown: false });
  const now = result.baseline ?? result.range;
  const unit = unitFor(now);
  return { built, result, now, unit, picked: pickTips({ source: who.source, built, result, unit, coveredDays: who.coveredDays }) };
}

const QUICK = { tips: false, biggestUnknown: false } as const;
const plain = (rich: Rich): string => rich.map((part) => (typeof part === 'string' ? part : 'mark' in part ? part.mark : 'code' in part ? part.code : part.strong)).join('');
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b), 1e-30);
const sameRange = (a: Spread, b: Spread): boolean => close(a.p5, b.p5) && close(a.mid, b.mid) && close(a.p95, b.p95);
const texts = (picked: PickedTips) => picked.shown.map((tip) => [tip.view.id, tip.view.title, plain(tip.view.body), tip.note]);
const numbersOf = (result: Estimate, id: string) => must(result.tips.find((entry) => entry.id === id), `numbers of ${id}`);

// ---------- what a sentence must not do ----------

/** Everything that reads wrong in one sentence. `cost` is true for the two cost sentences, the one place for "up to". */
function wrongIn(text: string, where: string, cost = false): string[] {
  const wrong: string[] = [];
  const say = (ok: boolean, what: string): void => { if (!ok) wrong.push(`${where}: ${what} in "${text}"`); };
  say(text.length > 0, 'no text');
  say(!/NaN|undefined|null|Infinity|\[object/.test(text), 'a broken value');
  say(!/[-−]\s?\d/.test(text.replace(/\d–\d/g, 'x')), 'a negative number');
  say(!/\s{2,}/.test(text) && text === text.trim(), 'stray spaces');
  say(!/(^|[^\d.,])0–|–0 |roughly 0 |about 0 |and roughly 0 /.test(text), 'a zero end');
  say(!/offset|neutral|compensat|net zero|\bowe|\bdebt|guilt|should have|wasted?\b/i.test(text), 'a word the page does not use');
  if (!cost) say(!/up to/i.test(text), '"up to"');
  say(!/\b1 (times|seconds|minutes|hours|days|changes|tips)\b| of your (Opus|Sonnet|Fable) models work| a month a month|these 1 days/.test(text), 'grammar');
  return wrong;
}

const SAVING_BODY = / would save (roughly [\d.,]+( m?g| kg)? ?(–|to )[\d.,]+ (mg|g|kg)|about [\d.,]+ (mg|g|kg)|between nothing and roughly [\d.,]+ (mg|g|kg))( a month| over these \d+ days| in this one day)\.$/;

/** Everything that is wrong with the picked tips of one person. Empty when all is well. */
function wrongWith(done: Run, label: string): string[] {
  const { picked, result, now, unit } = done;
  const wrong: string[] = [];
  const say = (ok: boolean, what: string): void => { if (!ok) wrong.push(`${label}: ${what}`); };
  if (picked.shown.length) say(picked.noTipsNote === null, 'a note although there are tips');
  else wrong.push(...wrongIn(must(picked.noTipsNote, 'note'), `${label} noTipsNote`));
  say(picked.shown.filter((tip) => !tip.view.applied).length <= RULES.maxShown, 'too many tips');
  for (const tip of picked.shown) {
    const { view } = tip;
    const numbers = numbersOf(result, view.id);
    const body = plain(view.body);
    const cost = /cost/.test(tip.note);
    for (const [text, where] of [[view.title, 'title'], [body, 'body'], [plain(view.how), 'how'], [tip.label, 'label'], [tip.note, 'note'], [view.afterLabel, 'afterLabel']] as const) {
      wrong.push(...wrongIn(text, `${label} ${view.id} ${where}`, cost));
    }
    say(view.title.length <= 80, `${view.id}: the title has ${view.title.length} characters`);
    say(tip.label.length <= 40 && view.afterLabel.length <= 16, `${view.id}: a label is too long`);
    say(!view.how.some((part) => typeof part === 'string' && part.startsWith('How:')), `${view.id}: "How:" is the page's word`);
    say(view.now.mid === now.mid && view.now.p5 === now.p5 && view.now.p95 === now.p95, `${view.id}: "now" is not the range with no tip`);
    say(view.after.mid === numbers.after.mid, `${view.id}: "after" is not the range with this tip alone`);
    if (view.applied) continue;
    // A tip that is offered: it states its what-if and a saving above both thresholds, and never costs more.
    say(SAVING_BODY.test(body), `${view.id}: the body reads "${body}"`);
    say(tip.note === `Saves ${plain(view.body.slice(1, 2))}`, `${view.id}: the switch note and the body state another saving`);
    say(numbers.lowestSaving >= -RULES.noise * now.mid, `${view.id}: can cost more`);
    say(numbers.saving.mid >= RULES.floorKg && numbers.saving.p95 > 0, `${view.id}: a saving under the floor`);
    say((now.mid - numbers.after.mid) / now.mid >= RULES.minMiddleDrop, `${view.id}: lowers the middle estimate too little`);
    say(view.after.p5 <= now.p5 && view.after.mid <= now.mid && view.after.p95 <= now.p95, `${view.id}: the "after" bar is above "now"`);
  }
  for (let i = 1; i < picked.shown.length; i++) {
    const a = numbersOf(result, must(picked.shown[i - 1], 'tip').view.id).saving.mid;
    const b = numbersOf(result, must(picked.shown[i], 'tip').view.id).saving.mid;
    if (i < RULES.maxShown) say(a >= b || mass(a, unit) === mass(b, unit), 'not ordered by the middle saving');
  }
  const switches = tipSwitches(picked);
  say(switches.length === picked.shown.length && switches.every((item, i) => item.id === picked.shown[i]?.view.id && item.note === picked.shown[i]?.note && item.noteIcon === null && item.on === picked.shown[i]?.view.applied), 'the switches are not the shown tips');
  // No tip of the catalogue can cost more, with any slider setting.
  for (const tip of done.built) say(numbersOf(result, tip.id).lowestSaving >= -RULES.noise * now.mid, `${tip.id}: its smallest saving is a cost`);
  return wrong;
}

// ---------- the catalogue as data ----------

describe('the catalogue', () => {
  it('has five tips for Claude Code and three for ChatGPT, in their fixed order', () => {
    expect(TIP_ORDER['claude-code']).toEqual(['cc-opus-to-sonnet', 'cc-fable-to-sonnet', 'cc-sonnet-to-haiku', 'cc-clear', 'cc-effort']);
    expect(TIP_ORDER.chatgpt).toEqual(['gpt-less-thinking', 'gpt-new-chat', 'gpt-shorter-answers']);
  });

  it('has ids that are unique and never those of a hidden-work switch', () => {
    const ids = [...TIP_ORDER['claude-code'], ...TIP_ORDER.chatgpt];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(['thinking', 'instructions-memory', 'search-files', 'plan-paid']).not.toContain(id);
    expect(ids.every((id) => id.startsWith('cc-') || id.startsWith('gpt-'))).toBe(true);
  });

  it('knows a tip id only for its own tool', () => {
    expect(isTipId('claude-code', 'cc-clear')).toBe(true);
    expect(isTipId('chatgpt', 'cc-clear')).toBe(false);
    expect(isTipId('chatgpt', 'gpt-new-chat')).toBe(true);
    expect(isTipId('claude-code', 'gpt-new-chat')).toBe(false);
    expect(isTipId('claude-code', 'thinking')).toBe(false);
    expect(isTipId('claude-code', 'toString')).toBe(false);
  });

  it('keeps the rules of the reference', () => {
    expect(RULES).toEqual({ maxShown: 3, floorKg: 0.01, minMiddleDrop: 0.05, monthDays: [28, 31], noise: 1e-9 });
    expect(file.rules).toMatchObject(RULES);
  });

  it('words the block in the result card', () => {
    expect(TRY_A_CHANGE).toEqual({ title: 'Try a change', note: 'Flip one to see what it changes. The details are under “Ways to cut”.' });
  });

  it('shows every tip to at least one made-up person', () => {
    const shown = new Set(PEOPLE.flatMap((who) => run(who).picked.shown.map((tip) => tip.view.id)));
    for (const id of [...TIP_ORDER['claude-code'], ...TIP_ORDER.chatgpt]) expect(shown.has(id), id).toBe(true);
  });
});

// ---------- the 33 people ----------

describe('the made-up people of the checked catalogue', () => {
  it('are all there', () => {
    // The people whose title changed have one family and nothing else, and each is in the fixture.
    for (const name of ONE_FAMILY_ONLY) {
      const who = person(name);
      expect(who.name).toBe(name);
      expect(new Set(who.rows.map((row) => familyOf(row))).size, name).toBe(1);
    }
    expect(PEOPLE.length).toBe(33);
    expect(CC.length).toBe(18);
    expect(GPT.length).toBe(15);
  });

  for (const entry of file.cases) {
    const who: Person = { name: entry.name, ...entry.input };
    for (const want of entry.expect) {
      it(`${entry.name}: ${want.applied.length ? `with ${want.applied.join(', ')} on` : 'nothing applied'}`, () => {
        const done = run(who, want.applied);
        const { picked } = done;
        expect(done.unit).toBe(want.unit);
        expect(picked.shown.map((tip): ExpectedTip => ({
          id: tip.view.id,
          applied: tip.view.applied,
          title: inWholeMillions(tip.view.title),
          body: tip.view.body,
          how: tip.view.how,
          afterLabel: tip.view.afterLabel,
          switchLabel: tip.label,
          switchNote: tip.note,
        }))).toEqual(want.tips.map((tip) => asThePageSaysNow(entry.name, tip)));
        expect(picked.noTipsNote).toBe(want.noTipsNote);
        expect(picked.appliedLabel).toBe(want.appliedLabel);
        // Only Claude Code has the tips as switches in the result card.
        if (who.source === 'claude-code') expect(tipSwitches(picked).map((item) => item.id)).toEqual(want.switchIds);
        else expect(want.switchIds).toEqual([]);
        expect(wrongWith(done, entry.name)).toEqual([]);
      });
    }
  }
});

describe('token counts in the titles', () => {
  it('are printed with three meaningful digits, as the table beside them prints its rows', () => {
    const titles = (start: string): string[] => run(person(start)).picked.shown.map((tip) => tip.view.title).filter((title) => /million|billion/.test(title));
    expect(titles('Heavy Opus user (the statistics fixture A)')).toEqual(['Opus and Sonnet wrote 5.49 million tokens for you, thinking included']);
    expect(titles('Fable user (the statistics fixture D)')).toEqual(['Fable wrote 1.00 million tokens for you, thinking included']);
    expect([...titles('Plus user with very long chats'), ...titles('Heavy user: 4,000 questions')]).toEqual([
      'By our count, ChatGPT re-read 3.74 million tokens of old messages after a break',
      'ChatGPT wrote 3.40 million tokens for you',
    ]);
  });
});

// ---------- every what-if ----------

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

const TYPES = ['freshInput', 'cacheWrite', 'cacheRead', 'output'] as const;
const sumOf = (rows: readonly Row[], type: (typeof TYPES)[number]): number => rows.reduce((total, row) => total + (row[type] || 0), 0);
const SIZE: Record<string, number> = { small: 0, unknown: 1, medium: 1, large: 2, fable: 3 };

describe('every what-if, for every made-up person', () => {
  for (const who of PEOPLE) {
    it(who.name, () => {
      const built = buildTips({ source: who.source, rows: who.rows, hidden: who.hidden ?? [], thinkingRecorded: true });
      expect(built.map((tip) => tip.id)).toEqual(TIP_ORDER[who.source].filter((id) => built.some((tip) => tip.id === id)));
      for (const tip of built) {
        const usage: TokenUsage = deepFreeze(structuredClone({ rows: who.rows, hidden: who.hidden ?? [] }));
        const changed = tip.change(usage); // an edit of the frozen input throws
        const pieces = (list: readonly HiddenWork[]) => list.map((item) => [item.id, item.on, item.slot, item.amount]);
        expect(pieces(changed.hidden), `${tip.id}: the pieces of hidden work`).toEqual(pieces(usage.hidden));
        const allRows = (u: TokenUsage): Row[] => [...u.rows, ...u.hidden.flatMap((item) => item.rows)];
        for (const row of allRows(changed)) for (const type of TYPES) expect((row[type] || 0) >= 0 && Number.isFinite(row[type] || 0), `${tip.id}: ${type} of ${row.model}`).toBe(true);
        // Never a token more: by type, over the visible rows and over each piece.
        for (const type of TYPES) {
          expect(sumOf(changed.rows, type), `${tip.id}: ${type}`).toBeLessThanOrEqual(sumOf(usage.rows, type) * (1 + 1e-12));
          usage.hidden.forEach((item, i) => expect(sumOf(must(changed.hidden[i], 'piece').rows, type), `${tip.id}: ${type} of ${item.id}`).toBeLessThanOrEqual(sumOf(item.rows, type) * (1 + 1e-12)));
        }
        const fields = new Set(allRows(usage).flatMap((row) => Object.keys(row)));
        expect(allRows(changed).every((row) => Object.keys(row).every((key) => fields.has(key))), `${tip.id}: adds a field`).toBe(true);
        // No row moves to a bigger size class, and a model the page does not know never moves.
        const before = new Map(usage.rows.map((row) => [row.model, row.sizeClass]));
        for (const row of changed.rows) {
          const from = /^(.+) \(moved to [a-z]+\)$/.exec(row.model);
          const was = must(before.get(from?.[1] ?? row.model), `row ${row.model} before ${tip.id}`);
          expect(must(SIZE[row.sizeClass], 'size')).toBeLessThanOrEqual(must(SIZE[was], 'size'));
          expect(row.sizeClass === was || was !== 'unknown').toBe(true);
        }
      }
    });
  }
});

// ---------- on and off, and two at once ----------

describe('switching tips on and off', () => {
  for (const who of PEOPLE) {
    it(`${who.name}: on, off, and two at once`, { timeout: 30_000 }, () => {
      const start = run(who);
      const [first, second] = start.picked.shown;
      if (!first) return;
      const a = numbersOf(start.result, first.view.id);

      // One tip on: the shown range is that tip's "after" range, and no sentence of any tip changes.
      const on = run(who, [first.view.id]);
      expect(sameRange(on.result.range, a.after)).toBe(true);
      expect(on.result.baseline).toEqual(start.result.range);
      expect(on.unit).toBe(start.unit);
      expect(on.picked.shown.map((tip) => tip.view.id)).toEqual(start.picked.shown.map((tip) => tip.view.id));
      expect(must(on.picked.shown[0], 'tip').view.applied).toBe(true);
      expect(texts(on.picked)).toEqual(texts(start.picked));
      expect(on.picked.shown.map((tip) => [tip.view.now, tip.view.after])).toEqual(start.picked.shown.map((tip) => [tip.view.now, tip.view.after]));
      expect(on.picked.appliedLabel).toBe(`With: ${first.label}`);

      // Off again: the exact earlier numbers, to the last digit, and the same View.
      const off = run(who);
      expect(off.result.range).toEqual(start.result.range);
      expect(off.result.dots).toEqual(start.result.dots);
      expect(off.result.baseline).toBeNull();
      expect(off.result.tips).toEqual(start.result.tips);
      expect(off.picked).toEqual(start.picked);

      if (!second) return;
      const b = numbersOf(start.result, second.view.id);
      const both = run(who, [second.view.id, first.view.id]);
      // Each sentence stays as it is: a saving is worked out for its tip alone.
      expect(texts(both.picked)).toEqual(texts(start.picked));
      expect(both.picked.appliedLabel).toBe('With 2 tips applied');
      expect(both.unit).toBe(start.unit);
      // The result shows both changes together, and the second tip still lowers it.
      expect(both.result.range.mid).toBeLessThan(a.after.mid);
      expect(both.result.range.mid).toBeLessThan(b.after.mid);
      // Savings do not add up exactly: two tips can act on the same tokens.
      const share = (start.now.mid - both.result.range.mid) / (a.saving.mid + b.saving.mid);
      expect(share).toBeGreaterThan(0.85);
      expect(share).toBeLessThan(1.12);
      // And off again, one after the other.
      expect(run(who, [second.view.id]).result.baseline).toEqual(start.result.range);
      expect(run(who).picked).toEqual(start.picked);
    });
  }

  it('gives the same result for every pair of tips in either list order, and for all at once', { timeout: 60_000 }, () => {
    let pairs = 0;
    for (const who of PEOPLE) {
      const input = inputOf(who);
      const built = buildTips({ source: who.source, rows: who.rows, hidden: who.hidden ?? [], thinkingRecorded: true });
      for (let i = 0; i < built.length; i++) {
        for (let j = i + 1; j < built.length; j++) {
          const a = must(built[i], 'tip');
          const b = must(built[j], 'tip');
          const ids = [a.id, b.id];
          const one = estimate({ ...input, tips: [a, b], applied: ids }, QUICK);
          const two = estimate({ ...input, tips: [b, a], applied: ids }, QUICK);
          pairs++;
          expect(sameRange(one.range, two.range), `${ids.join(' + ')} for ${who.name}`).toBe(true);
          // No pair cancels out: the second tip never raises the range again.
          const alone = estimate({ ...input, tips: [a], applied: [a.id] }, QUICK);
          expect(one.range.mid).toBeLessThanOrEqual(alone.range.mid * (1 + 1e-12));
          expect(one.range.p95).toBeLessThanOrEqual(alone.range.p95 * (1 + 1e-12));
        }
      }
      if (!built.length) continue;
      const ids = built.map((tip) => tip.id);
      const all = estimate({ ...input, tips: built, applied: ids }, QUICK);
      const reversed = estimate({ ...input, tips: [...built].reverse(), applied: ids }, QUICK);
      expect(all.range.mid).toBeGreaterThan(0);
      expect(all.range.mid).toBeLessThan(must(all.baseline, 'baseline').mid);
      expect(close(all.range.mid, reversed.range.mid) && close(all.range.p95, reversed.range.p95), `all tips on for ${who.name}`).toBe(true);
    }
    expect(pairs).toBeGreaterThan(50);
  });
});

// ---------- sliders, sizes and covered days ----------

describe('with other settings and other sizes', () => {
  it('never costs more and reads right with each slider at low, typical and high', { timeout: 120_000 }, () => {
    const wrong: string[] = [];
    for (const who of PEOPLE) {
      const ids = ['energy', 'freshInput', 'cacheWrite', 'cacheRead', 'pue', 'grid', 'hardware', ...(who.hidden ?? []).filter((item) => item.on !== false).map((item) => `hidden:${item.id}`)];
      for (const id of ids) {
        for (const position of [0, 0.5, 1]) {
          const set: Person = { ...who, pins: { ...(who.pins ?? {}), [id]: position } };
          wrong.push(...wrongWith(run(set), `${who.name}, ${id} at ${position}`));
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('reads right from a thousandth to a thousand times the usage', { timeout: 120_000 }, () => {
    const wrong: string[] = [];
    for (const who of PEOPLE) {
      for (const factor of [0.001, 0.003, 0.01, 0.03, 0.1, 0.2, 0.3, 0.5, 0.7, 2, 3, 10, 100, 1000]) {
        const scale = <T extends Row>(rows: readonly T[]): T[] => rows.map((row) => {
          // Every number of a row is a token count. No field is added.
          const next: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) if (typeof value === 'number') next[key] = value * factor;
          return { ...row, ...next };
        });
        const scaled: Person = { ...who, rows: scale(who.rows), hidden: (who.hidden ?? []).map((item) => ({ ...item, rows: scale(item.rows) })) };
        wrong.push(...wrongWith(run(scaled), `${who.name} ×${factor}`));
      }
    }
    expect(wrong).toEqual([]);
  });

  it('says "a month" only from 28 covered days', { timeout: 60_000 }, () => {
    const wrong: string[] = [];
    for (const who of PEOPLE) {
      const { built, result, unit } = run(who);
      for (const coveredDays of [1, 2, 12, 27, 28, 30, 31]) {
        const picked = pickTips({ source: who.source, built, result, unit, coveredDays });
        const done: Run = { built, result, now: result.range, unit, picked };
        wrong.push(...wrongWith(done, `${who.name}, ${coveredDays} days`));
        const want = coveredDays >= 28 ? ' a month' : coveredDays === 1 ? ' in this one day' : ` over these ${coveredDays} days`;
        for (const tip of picked.shown) {
          expect(plain(tip.view.body).endsWith(`${want}.`), plain(tip.view.body)).toBe(true);
          expect(tip.note.endsWith(want), tip.note).toBe(true);
        }
        if (!picked.shown.length && picked.tried && /less than 10 g/.test(must(picked.noTipsNote, 'note'))) expect(picked.noTipsNote).toContain(`10 g${want} in at least half`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

// ---------- a tip that is on never leaves ----------

describe('a tip that is switched on', () => {
  it('stays when its saving goes to zero, and says so', () => {
    const thinker = must(GPT[0], 'person');
    const off: Person = { ...thinker, hidden: (thinker.hidden ?? []).map((item) => (item.id === 'thinking' ? { ...item, on: false } : item)) };
    const offered = run(off);
    expect(offered.picked.shown.some((tip) => tip.view.id === 'gpt-less-thinking')).toBe(false);
    // It was built, so it still counts as a change that was tried.
    expect(offered.built.some((tip) => tip.id === 'gpt-less-thinking')).toBe(true);
    expect(offered.picked.tried).toBe(offered.built.length);
    const stays = must(run(off, ['gpt-less-thinking']).picked.shown.find((tip) => tip.view.id === 'gpt-less-thinking'), 'tip');
    expect(stays.view.applied).toBe(true);
    expect(stays.view.body).toEqual(['With your current settings this change saves nothing.']);
    expect(stays.note).toBe('Saves nothing with your current settings');
    expect(SAVES_NOTHING_BODY).toBe('With your current settings this change saves nothing.');
    expect(SAVES_NOTHING_NOTE).toBe('Saves nothing with your current settings');
  });

  it('stays when a slider makes it too small', () => {
    const tiny: Person = { ...must(CC[0], 'person'), pins: { cacheRead: 0 } };
    expect(run(tiny).picked.shown.some((tip) => tip.view.id === 'cc-clear')).toBe(false);
    const clear = must(run(tiny, ['cc-clear']).picked.shown.find((tip) => tip.view.id === 'cc-clear'), 'tip');
    expect(clear.view.applied).toBe(true);
    expect(wrongIn(clear.note, 'note')).toEqual([]);
    expect(wrongIn(plain(clear.view.body), 'body')).toEqual([]);
  });

  it('is shown as a fourth entry, with its switch, when it ranks below the best three', () => {
    const four = person('Fable and Opus together');
    const start = run(four);
    expect(start.built.length).toBe(4);
    expect(start.picked.shown.length).toBe(3);
    const fourth = must(start.built.find((tip) => !start.picked.shown.some((shown) => shown.view.id === tip.id)), 'fourth tip');
    const withFourth = run(four, [fourth.id]);
    expect(withFourth.picked.shown.map((tip) => tip.view.id)).toEqual([...start.picked.shown.map((tip) => tip.view.id), fourth.id]);
    expect(tipSwitches(withFourth.picked).map((item) => [item.id, item.on])).toEqual([...start.picked.shown.map((tip) => [tip.view.id, false]), [fourth.id, true]]);
    expect(withFourth.picked.appliedLabel).toBe(`With: ${must(withFourth.picked.shown[3], 'tip').label}`);
  });

  interface Step { on?: string; off?: string; pin?: Pins; resetPins?: true; pieceOff?: string; pieceOn?: string }

  function visit(who: Person, steps: Step[]): void {
    const start = run(who);
    let pins: Pins = { ...(who.pins ?? {}) };
    let applied: string[] = [];
    let hidden = who.hidden;
    for (const step of steps) {
      if (step.pin) pins = { ...pins, ...step.pin };
      if (step.resetPins) pins = { ...(who.pins ?? {}) };
      if (step.on) applied = [...applied, step.on];
      if (step.off) applied = applied.filter((id) => id !== step.off);
      if (step.pieceOff) hidden = hidden?.map((item) => (item.id === step.pieceOff ? { ...item, on: false } : item));
      if (step.pieceOn) hidden = hidden?.map((item) => (item.id === step.pieceOn ? { ...item, on: true } : item));
      const now: Person = { ...who, pins, hidden };
      const done = run(now, applied);
      const where = `${who.name}, after ${JSON.stringify(step)}`;
      expect(applied.every((id) => done.picked.shown.some((tip) => tip.view.id === id && tip.view.applied)), `${where}: an applied tip left the list`).toBe(true);
      expect(tipSwitches(done.picked).filter((item) => item.on).map((item) => item.id).sort(), where).toEqual([...applied].sort());
      expect(wrongWith(done, where)).toEqual([]);
      const label = applied.length === 0 ? null : applied.length === 1 ? `With: ${must(done.picked.shown.find((tip) => tip.view.id === applied[0]), 'tip').label}` : `With ${applied.length} tips applied`;
      expect(done.picked.appliedLabel, where).toBe(label);
    }
    expect(applied).toEqual([]);
    const end = run({ ...who, pins, hidden });
    expect(end.result.range).toEqual(start.result.range);
    expect(end.picked).toEqual(start.picked);
  }

  it('never leaves the list through a whole visit, and the end equals the start (Claude Code)', { timeout: 30_000 }, () => {
    visit(must(CC[0], 'person'), [
      { on: 'cc-clear' }, { pin: { cacheRead: 0 } }, { on: 'cc-opus-to-sonnet' }, { pin: { energy: 1 } }, { on: 'cc-effort' }, { pin: { grid: 0, hardware: 1 } },
      { off: 'cc-clear' }, { resetPins: true }, { on: 'cc-sonnet-to-haiku' }, { off: 'cc-opus-to-sonnet' }, { off: 'cc-effort' }, { off: 'cc-sonnet-to-haiku' },
    ]);
    visit(must(CC[4], 'person'), [
      { on: 'cc-effort' }, { on: 'cc-fable-to-sonnet' }, { on: 'cc-opus-to-sonnet' }, { on: 'cc-clear' }, { pin: { cacheRead: 1 } }, { pin: { energy: 0 } },
      { resetPins: true }, { off: 'cc-effort' }, { off: 'cc-fable-to-sonnet' }, { off: 'cc-opus-to-sonnet' }, { off: 'cc-clear' },
    ]);
  });

  it('never leaves the list through a whole visit, and the end equals the start (ChatGPT)', { timeout: 30_000 }, () => {
    visit(must(GPT[11], 'person'), [
      { on: 'gpt-less-thinking' }, { pieceOff: 'thinking' }, { on: 'gpt-shorter-answers' }, { pin: { 'hidden:prompt': 1 } }, { pieceOff: 'prompt' }, { pieceOff: 'personal' },
      { on: 'gpt-new-chat' }, { pin: { freshInput: 0 } }, { pieceOn: 'thinking' }, { pieceOn: 'prompt' }, { pieceOn: 'personal' }, { resetPins: true },
      { off: 'gpt-less-thinking' }, { off: 'gpt-shorter-answers' }, { off: 'gpt-new-chat' },
    ]);
  });
});

// ---------- a tip that can cost more ----------
//
// No tip of the catalogue can. So one is made up: 40% fewer cache reads for 25% more cache writes. It
// stands in the place of cc-clear, because a built tip has a catalogue id.

describe('a tip that can cost more', () => {
  const heavy = must(CC[0], 'person');
  const trade: BuiltTip = {
    id: 'cc-clear',
    change: (usage) => scaleTokens({ types: ['cacheWrite'], factor: 1.25 })(scaleTokens({ types: ['cacheRead'], factor: 0.6 })(usage)),
    texts: { title: () => 'A made-up tip that trades cache reads for cache writes', lead: 'This made-up trade', how: ['Nothing.'], label: 'A made-up trade', afterLabel: 'Trade' },
  };
  const withTrade = (who: Person): BuiltTip[] => buildTips({ source: who.source, rows: who.rows, hidden: [], thinkingRecorded: false }).map((tip) => (tip.id === 'cc-clear' ? trade : tip));

  it('is not offered', () => {
    const off = run(heavy, [], withTrade(heavy));
    expect(numbersOf(off.result, 'cc-clear').lowestSaving).toBeLessThan(0);
    expect(off.picked.shown.some((tip) => tip.view.id === 'cc-clear')).toBe(false);
  });

  it('stays when it is on, and does not say "saves"', () => {
    const shown = must(run(heavy, ['cc-clear'], withTrade(heavy)).picked.shown.find((tip) => tip.view.id === 'cc-clear'), 'tip');
    expect(shown.view.applied).toBe(true);
    expect(shown.note).toMatch(/^Could save up to roughly [\d.,]+ kg, or cost up to roughly [\d.,]+ kg more$/);
    expect(shown.note).not.toMatch(/[Ss]aves /);
    expect(shown.view.body).toEqual([`${shown.note}.`]);
    const low = must(run({ ...heavy, pins: { cacheRead: 0 } }, ['cc-clear'], withTrade(heavy)).picked.shown.find((tip) => tip.view.id === 'cc-clear'), 'tip');
    expect(low.note).toMatch(/^With your settings this costs (roughly|about) /);
    expect(low.view.body).toEqual([`${low.note}.`]);
  });

  it('has its own reason in the sentence shown in place of tips', () => {
    const light = person('Light Haiku user');
    const alone = run(light, [], [trade]);
    expect(alone.picked.shown).toEqual([]);
    expect(alone.picked.noTipsNote).toBe('We tried 1 change on your Claude Code numbers and do not suggest it: it could cost more in some possible outcomes.');
  });

  it('is worded case by case', () => {
    const cases: Array<[Spread, number, MassUnit, string]> = [
      [{ p5: -0.312, mid: 1.34, p95: 8.46 }, -3.74, 'kg', 'Could save up to roughly 8.5 kg, or cost up to roughly 0.31 kg more'],
      [{ p5: 0.1, mid: 1, p95: 3 }, -0.5, 'kg', 'Could save up to roughly 3 kg, or cost up to roughly 0.5 kg more'],
      [{ p5: -1.41, mid: -0.345, p95: -0.0335 }, -3, 'kg', 'With your settings this costs roughly 0.03–1.4 kg more'],
      [{ p5: -1.41, mid: -0.345, p95: -0.0021 }, -3, 'kg', 'With your settings this costs roughly 2.1 g to 1.4 kg more'],
      [{ p5: -0.4, mid: -0.4, p95: -0.4 }, -0.4, 'kg', 'With your settings this costs about 0.4 kg more'],
      [{ p5: -0.4, mid: -0.1, p95: 0 }, -0.9, 'kg', 'With your settings this costs between nothing and roughly 0.4 kg more'],
      [{ p5: -0.002, mid: 0.2, p95: 0.004 }, -0.003, 'kg', 'Could save up to roughly 4 g, or cost up to roughly 2 g more'],
    ];
    for (const [saving, lowest, unit, want] of cases) {
      expect(costWords(saving, lowest, unit)).toBe(want);
      expect(wrongIn(want, 'cost', true)).toEqual([]);
    }
  });
});

// ---------- the words ----------

describe('the words for a saving', () => {
  it('cover every form', () => {
    const cases: Array<[Spread, MassUnit, number, string | null]> = [
      [{ p5: 1.04, mid: 3, p95: 7.2 }, 'kg', 30, 'roughly 1–7.2 kg a month'],
      [{ p5: 12.2, mid: 20, p95: 41.7 }, 'kg', 30, 'roughly 12–42 kg a month'],
      [{ p5: 0.0291, mid: 0.03, p95: 0.0304 }, 'g', 30, 'roughly 29–30 g a month'],
      [{ p5: 0.03, mid: 0.03, p95: 0.03 }, 'g', 30, 'about 30 g a month'],
      [{ p5: 0.3, mid: 0.9, p95: 2.2 }, 'kg', 12, 'roughly 0.3–2.2 kg over these 12 days'],
      [{ p5: 0.3, mid: 0.9, p95: 2.2 }, 'kg', 1, 'roughly 0.3–2.2 kg in this one day'],
      [{ p5: 0.0312, mid: 0.2, p95: 0.97 }, 'kg', 30, 'roughly 0.03–0.97 kg a month'],
      // The low end is above zero and prints as "0" in the result's unit: each end in the unit that suits it.
      [{ p5: 0.0033, mid: 0.035, p95: 0.28 }, 'kg', 30, 'roughly 3.3–280 g a month'],
      [{ p5: 0.0033, mid: 0.2, p95: 1.24 }, 'kg', 30, 'roughly 3.3 g to 1.2 kg a month'],
      [{ p5: 0.000002, mid: 0.00035, p95: 0.0028 }, 'g', 30, 'roughly 2 mg to 2.8 g a month'],
      // The low end is exactly zero, or rounding below it.
      [{ p5: 0, mid: 0.2, p95: 3.56 }, 'kg', 31, 'between nothing and roughly 3.6 kg a month'],
      [{ p5: -1e-15, mid: 0.2, p95: 3.56 }, 'kg', 31, 'between nothing and roughly 3.6 kg a month'],
      [{ p5: 0.000000004, mid: 0.2, p95: 3.56 }, 'kg', 30, 'between nothing and roughly 3.6 kg a month'],
      // The high end prints as zero: no words.
      [{ p5: 0, mid: 0.001, p95: 0.004 }, 'kg', 30, null],
      [{ p5: 0, mid: 0, p95: 0 }, 'g', 30, null],
      [{ p5: -0.2, mid: -0.1, p95: -0.01 }, 'kg', 30, null],
    ];
    for (const [saving, unit, days, want] of cases) {
      expect(savingWords(saving, unit, days)).toBe(want);
      if (want !== null) expect(wrongIn(want, 'saving')).toEqual([]);
    }
  });

  it('name the period from the covered days', () => {
    expect(periodWords(1)).toBe(' in this one day');
    expect(periodWords(2)).toBe(' over these 2 days');
    expect(periodWords(12)).toBe(' over these 12 days');
    expect(periodWords(27)).toBe(' over these 27 days');
    expect(periodWords(28)).toBe(' a month');
    expect(periodWords(30)).toBe(' a month');
    expect(periodWords(31)).toBe(' a month');
    expect(periodWords(32)).toBe(' over these 32 days');
  });

  it('say a share, a length of time, a family and a version', () => {
    expect([shareWords(0.82), shareWords(0.97), shareWords(0.04), shareWords(0.926), shareWords(0.924), shareWords(0.08)]).toEqual(['About 80%', 'Almost all', null, 'Almost all', 'About 90%', 'About 10%']);
    expect([duration(0), duration(1), duration(40), duration(89), duration(1500), duration(34200), duration(40500)]).toEqual(['about 1 second', 'about 1 second', 'about 40 seconds', 'about 89 seconds', 'about 25 minutes', 'about 9.5 hours', 'about 11 hours']);
    expect(['Opus 5.5', 'Opus', 'GPT-5', 'Opusculum 2', 'Mythos Preview', ''].map((display) => familyOf({ display }))).toEqual(['Opus', 'Opus', null, null, 'Mythos', null]);
    expect(familyOf({})).toBeNull();
    expect(['Sonnet 4.6', 'Opus 5', 'Opus', 'Mythos Preview'].map((display) => versionOf({ display }))).toEqual([[4, 6], [5, 0], null, null]);
    const effort = (display: string): boolean => hasEffortLevels({ display });
    expect(['Fable 5.1', 'Fable 5', 'Opus 5.5', 'Opus 4.6', 'Sonnet 4.6', 'Sonnet 5'].every(effort)).toBe(true);
    expect(['Sonnet 4.5', 'Opus 4.5', 'Haiku 4.5', 'Opus', 'Mythos 5.1', 'GPT-5'].some(effort)).toBe(false);
  });
});

describe('the sentence shown in place of tips', () => {
  const all: TooSmall[][] = [['floor'], ['share'], ['floor', 'share'], ['cost']];

  it('has the words of every case, for each tool', () => {
    expect(noTipsWords('claude-code', 0, new Set(), 30)).toBe('None of the changes we know how to work out applies to your Claude Code numbers.');
    expect(noTipsWords('chatgpt', 0, new Set(), 30)).toBe('None of the changes we know how to work out applies to your ChatGPT numbers.');
    expect(noTipsWords('chatgpt', 3, new Set<TooSmall>(['floor']), 30)).toBe('We tried 3 changes on your ChatGPT numbers and suggest none: each would save less than 10 g a month in at least half of the possible outcomes.');
    expect(noTipsWords('claude-code', 2, new Set<TooSmall>(['share']), 30)).toBe('We tried 2 changes on your Claude Code numbers and suggest none: each would lower your middle estimate by less than 5%.');
    expect(noTipsWords('claude-code', 2, new Set<TooSmall>(['share', 'floor']), 12)).toBe('We tried 2 changes on your Claude Code numbers and suggest none: each would save less than 10 g over these 12 days in at least half of the possible outcomes, or would lower your middle estimate by less than 5%.');
    expect(noTipsWords('claude-code', 1, new Set<TooSmall>(['floor']), 1)).toBe('We tried 1 change on your Claude Code numbers and do not suggest it: it would save less than 10 g in this one day in at least half of the possible outcomes.');
    expect(noTipsWords('chatgpt', 1, new Set<TooSmall>(['share']), 30)).toBe('We tried 1 change on your ChatGPT numbers and do not suggest it: it would lower your middle estimate by less than 5%.');
  });

  it('speaks of no "possible outcomes" and of no "middle estimate" when there is one outcome', () => {
    expect(noTipsWords('chatgpt', 3, new Set<TooSmall>(['floor']), 30, true)).toBe('We tried 3 changes on your ChatGPT numbers and suggest none: each would save less than 10 g a month.');
    expect(noTipsWords('claude-code', 2, new Set<TooSmall>(['share', 'floor']), 12, true)).toBe('We tried 2 changes on your Claude Code numbers and suggest none: each would save less than 10 g over these 12 days, or would lower your estimate by less than 5%.');
    expect(noTipsWords('claude-code', 1, new Set<TooSmall>(['share']), 30, true)).toBe('We tried 1 change on your Claude Code numbers and do not suggest it: it would lower your estimate by less than 5%.');
    expect(noTipsWords('claude-code', 0, new Set(), 30, true)).toBe(noTipsWords('claude-code', 0, new Set(), 30));
    for (const reasons of all) expect(noTipsWords('chatgpt', 2, new Set(reasons), 30, true)).not.toMatch(/possible outcomes|middle estimate/);
    // The made-up person with every slider set and too little use for a tip gets that form from pickTips.
    const light = person('Light Haiku user');
    const pins = Object.fromEntries(['energy', 'freshInput', 'cacheWrite', 'cacheRead', 'pue', 'grid', 'hardware'].map((id) => [id, 0.5]));
    const one = run({ ...light, pins });
    expect(one.result.single).toBe(true);
    expect(one.picked.shown).toEqual([]);
    expect(one.picked.noTipsNote).not.toMatch(/possible outcomes|middle estimate/);
    expect(run(light).picked.noTipsNote).toMatch(/possible outcomes|middle estimate/);
  });

  it('never holds a word the page does not use', () => {
    const wrong: string[] = [];
    for (const source of ['claude-code', 'chatgpt'] as const) {
      wrong.push(...wrongIn(noTipsWords(source, 0, new Set(), 30), 'note'));
      for (const tried of [1, 2, 5]) for (const reasons of all) for (const days of [1, 2, 27, 30]) for (const single of [false, true]) wrong.push(...wrongIn(noTipsWords(source, tried, new Set(reasons), days, single), 'note'));
    }
    expect(wrong).toEqual([]);
  });

  it('counts the built tips, not the catalogue', () => {
    const light = run(person('Light Haiku user'));
    expect(light.picked.shown).toEqual([]);
    expect(light.picked.tried).toBe(light.built.length);
    expect(light.picked.noTipsNote).toContain(`We tried ${light.built.length === 1 ? '1 change' : `${light.built.length} changes`} on your Claude Code numbers`);
    expect(tipSwitches(light.picked)).toEqual([]);
  });
});

// ---------- what the tips name, and what they leave alone ----------

describe('what the tips name', () => {
  const builtFor = (who: Person): BuiltTip[] => buildTips({ source: who.source, rows: who.rows, hidden: who.hidden ?? [], thinkingRecorded: true });
  const tipOf = (who: Person, id: string): BuiltTip => must(builtFor(who).find((tip) => tip.id === id), id);

  it('leaves a mid-size model that is not Sonnet alone, and offers no /effort without effort levels', () => {
    const gateway = person('GPT-5 through a gateway');
    const after = tipOf(gateway, 'cc-sonnet-to-haiku').change({ rows: gateway.rows, hidden: [] });
    expect(after.rows.filter((row) => row.model.startsWith('gpt-5')).map((row) => row.sizeClass)).toEqual(['medium']);
    expect(after.rows.length).toBe(3);
    expect(builtFor(gateway).some((tip) => tip.id === 'cc-effort')).toBe(false);
  });

  it('leaves Mythos alone', () => {
    const mythos = person('Mythos next to Fable');
    const moved = tipOf(mythos, 'cc-fable-to-sonnet').change({ rows: mythos.rows, hidden: [] });
    expect(moved.rows.filter((row) => row.model.includes('mythos')).length).toBe(1);
    expect(moved.rows.filter((row) => row.model.includes('fable')).length).toBe(2);
  });

  it('gives a name without a version the model tip and no /effort tip', () => {
    const ids = builtFor(person('A custom model name')).map((tip) => tip.id);
    expect(ids).toContain('cc-opus-to-sonnet');
    expect(ids).not.toContain('cc-effort');
  });

  it('never changes the model of one the page does not know', () => {
    expect(builtFor(person('A model the page does not know')).map((tip) => tip.id)).toEqual(['cc-clear']);
    // A family name in a class that is not the family's own is left alone too.
    const odd: Person = { name: 'odd', source: 'claude-code', coveredDays: 30, rows: [{ model: 'x', display: 'Opus 5.5', sizeClass: 'unknown', freshInput: 10, cacheRead: 0, output: 500 }] };
    expect(builtFor(odd)).toEqual([]);
  });

  it('finds the rows another tip has moved, by their exact names', () => {
    const heavy = must(CC[0], 'person');
    const both = tipOf(heavy, 'cc-effort').change(tipOf(heavy, 'cc-opus-to-sonnet').change({ rows: heavy.rows, hidden: [] }));
    expect(movedName('claude-opus-5-5', 'medium')).toBe('claude-opus-5-5 (moved to medium)');
    expect(both.rows.some((row) => row.model === movedName('claude-opus-5-5', 'medium'))).toBe(true);
    const output = both.rows.filter((row) => row.model.startsWith('claude-opus-5-5')).reduce((total, row) => total + (row.output || 0), 0);
    expect(close(output, (must(heavy.rows[0], 'row').output || 0) * 0.8)).toBe(true);
    // The same name as moveShare gives, so the list of cc-effort and the module agree.
    const moved = moveShare({ where: { models: ['claude-opus-5-5'] }, toClass: 'medium', share: 0.5 })({ rows: heavy.rows, hidden: [] });
    expect(moved.rows.map((row) => row.model)).toContain(movedName('claude-opus-5-5', 'medium'));
  });

  it('words a family of several models, and a small share', () => {
    const two = run(person('Two Opus versions and Sonnet'));
    const opus = must(two.picked.shown.find((tip) => tip.view.id === 'cc-opus-to-sonnet'), 'tip');
    expect(opus.view.title).toMatch(/ of your estimate comes from Opus models$/);
    expect(plain(opus.view.body)).toMatch(/^Moving half of your Opus work to Sonnet would save /);
    const opusTip = tipOf(person('Two Opus versions and Sonnet'), 'cc-opus-to-sonnet');
    expect(opusTip.texts.title([{ model: 'claude-opus-5-5', sizeClass: 'large', kg: 1, share: 0.03 }, { model: 'claude-opus-5', sizeClass: 'large', kg: 1, share: 0.04 }])).toBe('Part of your estimate comes from Opus models');
    expect(opusTip.texts.title([{ model: 'claude-opus-5-5', sizeClass: 'large', kg: 1, share: 0.6 }, { model: 'claude-opus-5', sizeClass: 'large', kg: 1, share: 0.37 }, { model: 'claude-sonnet-5-5', sizeClass: 'medium', kg: 1, share: 0.03 }])).toBe('Almost all of your estimate comes from Opus models');
  });

  it('says whether the thinking time is recorded or assumed', () => {
    const thinker = must(GPT[0], 'person');
    const title = (thinkingRecorded: boolean, thinkingPartlyAssumed?: boolean): string =>
      must(buildTips({ source: 'chatgpt', rows: thinker.rows, hidden: thinker.hidden ?? [], thinkingRecorded, ...(thinkingPartlyAssumed === undefined ? {} : { thinkingPartlyAssumed }) })[0], 'tip').texts.title([]);
    expect(title(true)).toBe('ChatGPT thought for about 11 hours before its answers');
    expect(title(true, false)).toBe('ChatGPT thought for about 11 hours before its answers');
    expect(title(false)).toBe('We assume ChatGPT thought for about 11 hours before its answers');
    // Some times recorded, some assumed: the sum is not what the export records.
    expect(title(true, true)).toBe('By our count, ChatGPT thought for about 11 hours before its answers');
    // Nothing recorded: every second is assumed, whatever the second flag says.
    expect(title(false, true)).toBe('We assume ChatGPT thought for about 11 hours before its answers');
  });

  it('says "All" for the only family with a share, as the table beside it says 100%', () => {
    const opusTip = tipOf(person('Two Opus versions and Sonnet'), 'cc-opus-to-sonnet');
    const share = (model: string, sizeClass: string, value: number) => ({ model, sizeClass, kg: value, share: value });
    expect(opusTip.texts.title([share('claude-opus-5-5', 'large', 1)])).toBe('All of your estimate comes from Opus models');
    expect(opusTip.texts.title([share('claude-opus-5-5', 'large', 0.6), share('claude-opus-5', 'large', 0.4), share('claude-sonnet-5-5', 'medium', 0)])).toBe('All of your estimate comes from Opus models');
    // Another family with any share at all: not "All", even when the table rounds to 100%.
    expect(opusTip.texts.title([share('claude-opus-5-5', 'large', 0.999), share('claude-sonnet-5-5', 'medium', 0.001)])).toBe('Almost all of your estimate comes from Opus models');
    expect(opusTip.texts.title([share('claude-opus-5-5', 'large', 0.825), share('claude-sonnet-5-5', 'medium', 0.175)])).toBe('About 85% of your estimate comes from Opus models');
    expect([shareWords(1), shareWords(1, true), shareWords(0.04, true)]).toEqual(['Almost all', 'All', null]);
  });

  it('says that ChatGPT keeps only part of a long chat, as the note under the result does', () => {
    const tip = must(buildTips({ source: 'chatgpt', rows: [{ model: 'a', display: 'A', sizeClass: 'large', freshInput: 1000, output: 10, rereadFresh: 400 }], hidden: [], thinkingRecorded: false }).find((entry) => entry.id === 'gpt-new-chat'), 'tip');
    expect(plain(tip.texts.how)).toBe('When you come back after more than half an hour, open a new chat unless you need the old one. In an old chat, ChatGPT reads the conversation so far again with every message, or as much of it as it keeps. After a break we count that as a full fresh reading.');
    expect(plain(tip.texts.how)).not.toMatch(/whole conversation/);
  });

  it('prints every number as the rest of the page does', () => {
    expect(duration(36000000)).toBe('about 10,000 hours');
    expect(periodWords(1234)).toBe(' over these 1,234 days');
    const reader = (cacheRead: number): string => must(buildTips({ source: 'claude-code', rows: [{ model: 'claude-opus-5-5', display: 'Opus 5.5', sizeClass: 'large', freshInput: 1000 - cacheRead, cacheRead }], hidden: [], thinkingRecorded: false }).find((entry) => entry.id === 'cc-clear'), 'tip').texts.title([]);
    expect([reader(826), reader(500), reader(990)]).toEqual(['83% of your tokens are earlier text being read again', '50% of your tokens are earlier text being read again', 'Almost all of your tokens are earlier text being read again']);
  });

  it('takes away only what was read again after a break', () => {
    const rows: UsageRow[] = [
      { model: 'a', display: 'A', sizeClass: 'large', freshInput: 1000, cacheRead: 50, output: 10, rereadFresh: 400 },
      { model: 'b', display: 'B', sizeClass: 'large', freshInput: 100, cacheRead: 50, output: 10, rereadFresh: 900 },
      { model: 'c', display: 'C', sizeClass: 'large', freshInput: 100, cacheRead: 50, output: 10 },
    ];
    const usage: TokenUsage = deepFreeze({ rows, hidden: [] });
    const after = lessRereadingAfterBreaks({ share: 0.5 })(usage);
    expect(after.rows).toEqual([
      { ...rows[0], freshInput: 800, rereadFresh: 200 },
      // Never more than the fresh input itself.
      { ...rows[1], freshInput: 50, rereadFresh: 50 },
      rows[2],
    ]);
    expect(after.rows[2]).toBe(usage.rows[2]);
    expect(after.hidden).toBe(usage.hidden);
    expect(buildTips({ source: 'chatgpt', rows: [must(rows[2], 'row')], hidden: [], thinkingRecorded: false }).map((tip) => tip.id)).toEqual(['gpt-shorter-answers']);
  });
});

// ---------- the seam to the store ----------

describe('pickTips at its seam', () => {
  const heavy = must(CC[0], 'person');

  it('refuses the result of a call made while a slider moves', () => {
    const built = buildTips({ source: 'claude-code', rows: heavy.rows, hidden: [], thinkingRecorded: false });
    const fast = estimate({ rows: heavy.rows, tips: built }, QUICK);
    expect(() => pickTips({ source: 'claude-code', built, result: fast, unit: 'kg', coveredDays: 30 })).toThrow(/^ai-co2:/);
    // A result that got another tip list is refused too.
    const other = estimate({ rows: heavy.rows, tips: built.slice(0, 1) }, { biggestUnknown: false });
    expect(() => pickTips({ source: 'claude-code', built, result: other, unit: 'kg', coveredDays: 30 })).toThrow(/^ai-co2:/);
  });

  it('gives no tips and the first sentence when nothing was built', () => {
    for (const source of ['claude-code', 'chatgpt'] as const) {
      expect(buildTips({ source, rows: [], hidden: [], thinkingRecorded: false })).toEqual([]);
      const result = estimate({ rows: [] }, QUICK);
      expect(pickTips({ source, built: [], result, unit: 'mg', coveredDays: 30 })).toEqual({
        shown: [],
        tried: 0,
        noTipsNote: `None of the changes we know how to work out applies to your ${source === 'chatgpt' ? 'ChatGPT' : 'Claude Code'} numbers.`,
        appliedLabel: null,
      });
    }
  });

  it('reads which tips are on from the result, and takes the unit it is given', () => {
    const done = run(heavy, ['cc-effort']);
    const applied = (picked: PickedTips): string[] => picked.shown.filter((tip: ShownTip) => tip.view.applied).map((tip) => tip.view.id);
    expect(applied(done.picked)).toEqual(['cc-effort']);
    // The store hands over the chart's unit. In grams the same savings read in grams.
    const grams = pickTips({ source: 'claude-code', built: done.built, result: done.result, unit: 'g', coveredDays: 30 });
    expect(grams.shown.map((tip) => tip.view.id)).toEqual(done.picked.shown.map((tip) => tip.view.id));
    for (const tip of grams.shown) expect(tip.note).toMatch(/^Saves roughly [\d.,]+–[\d.,]+ g a month$/);
  });

  it('hands out views that share nothing with the catalogue', () => {
    const one = run(heavy).picked;
    const two = run(heavy).picked;
    const first = must(one.shown[0], 'tip');
    first.view.how.push('changed');
    first.view.now.mid = -1;
    expect(must(two.shown[0], 'tip').view.how).not.toContain('changed');
    expect(must(run(heavy).picked.shown[0], 'tip').view.how).not.toContain('changed');
  });
});
