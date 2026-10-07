import { describe, expect, it } from 'vitest';
import { ASSUMPTION_ROWS, MODEL_TABLE, SLIDERS } from './assumptions';
import { HIDDEN_SLOTS, estimate } from './estimate';
import type { Row } from './estimate';
import {
  CHANGED_BY_YOU,
  HIDDEN_PIECES,
  NO_BASES,
  NOTE_FREE_OR_GO,
  NOTE_FROM_EXPORT,
  NOTE_MEMORY_USED,
  NOTE_PLAN_NOT_SAID,
  NOTE_TYPICAL,
  SWITCH_GROUP,
  SWITCH_LABELS,
  hiddenWork,
  isSwitchId,
  piecesOn,
  switchDefaults,
  switchOn,
  switchViews,
} from './hidden';
import type { Bases, HiddenId, SwitchDefault, SwitchEvidence, SwitchId } from './hidden';

const BANNED = /offset|neutral|compensat|net[ -]zero|\bowe|\bdebt/i;

// An export where every switch has something to count.
const FULL: SwitchEvidence = { thinking: 'recorded', memoryInUse: true, searchOrFiles: true };
// An export with nothing but plain answers.
const BARE: SwitchEvidence = { thinking: 'none', memoryInUse: false, searchOrFiles: false };

const find = (defaults: SwitchDefault[], id: SwitchId): SwitchDefault => {
  const entry = defaults.find((one) => one.id === id);
  if (entry === undefined) throw new Error(`no switch ${id}`);
  return entry;
};

describe('the six pieces', () => {
  it('are the table of the spec: slot, id, what the base is counted as, and the switch', () => {
    expect(HIDDEN_PIECES.map((piece) => [piece.slot, piece.id, piece.countedAs, piece.switchId])).toEqual([
      [0, 'thinking', ['output'], 'thinking'],
      [1, 'prompt', ['cacheRead'], 'instructions-memory'],
      [2, 'personal', ['cacheRead', 'freshInput'], 'instructions-memory'],
      [3, 'search', ['freshInput'], 'search-files'],
      [4, 'files', ['freshInput'], 'search-files'],
      [5, 'misses', ['freshInput'], null],
    ]);
  });

  it('carry the three amounts of the spec', () => {
    expect(Object.fromEntries(HIDDEN_PIECES.map((piece) => [piece.id, piece.amount]))).toEqual({
      thinking: [20, 60, 150],
      prompt: [12000, 25000, 35000],
      personal: [500, 3000, 10000],
      search: [100, 600, 2500],
      files: [500, 5000, 40000],
      misses: [0.02, 0.1, 1],
    });
  });

  it('take each amount from the row of its slider, not from a copy', () => {
    for (const piece of HIDDEN_PIECES) expect(piece.amount).toBe(ASSUMPTION_ROWS[`hidden:${piece.id}`].triple);
  });

  it('fill every slot of the estimator’s pattern once', () => {
    expect(HIDDEN_PIECES).toHaveLength(HIDDEN_SLOTS);
    expect(HIDDEN_PIECES.map((piece) => piece.slot)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('have one slider each, in the same order as ChatGPT’s list', () => {
    expect(SLIDERS.chatgpt.filter((id) => id.startsWith('hidden:'))).toEqual(HIDDEN_PIECES.map((piece) => `hidden:${piece.id}`));
  });

  it('name the reader’s key for each', () => {
    expect(Object.fromEntries(HIDDEN_PIECES.map((piece) => [piece.readerKey, piece.id]))).toEqual({
      thinking: 'thinking',
      systemPrompt: 'prompt',
      memory: 'personal',
      search: 'search',
      files: 'files',
      cacheMisses: 'misses',
    });
  });

  it('are frozen, and so is the empty set of bases', () => {
    expect(Object.isFrozen(HIDDEN_PIECES)).toBe(true);
    for (const piece of HIDDEN_PIECES) expect(Object.isFrozen(piece)).toBe(true);
    expect(Object.isFrozen(NO_BASES)).toBe(true);
    for (const piece of HIDDEN_PIECES) expect(NO_BASES[piece.id]).toEqual([]);
  });
});

describe('the words of the switches', () => {
  it('has the title and the note of the group word for word', () => {
    expect(SWITCH_GROUP).toEqual({
      title: 'Hidden work in ChatGPT',
      note: "Exports don't show it, so it's estimated on top. Flip one to see what it adds. The last switch is your plan: it sets which size of GPT-5.6 is counted, and how much earlier conversation counts as read again.",
    });
  });

  it('has the four labels word for word', () => {
    expect(SWITCH_LABELS).toEqual({
      thinking: 'Thinking',
      'instructions-memory': 'Hidden instructions and memory',
      'search-files': 'Search results and file contents',
      'plan-paid': 'Plus or Pro plan',
    });
  });

  it('has every note word for word', () => {
    expect(NOTE_FROM_EXPORT).toBe('Set from your export');
    expect(NOTE_TYPICAL).toBe('Typical setting');
    expect(NOTE_MEMORY_USED).toBe('Set from your export: memory was used');
    expect(NOTE_FREE_OR_GO).toBe('Set from your export: Free or Go');
    expect(NOTE_PLAN_NOT_SAID).toBe('Your files did not say. Switch this off if you are on Free or Go.');
    expect(CHANGED_BY_YOU).toBe('Changed by you.');
  });

  it('uses none of the banned words', () => {
    const strings = [SWITCH_GROUP.title, SWITCH_GROUP.note, ...Object.values(SWITCH_LABELS), NOTE_FROM_EXPORT, NOTE_TYPICAL, NOTE_MEMORY_USED, NOTE_FREE_OR_GO, NOTE_PLAN_NOT_SAID, CHANGED_BY_YOU];
    for (const text of strings) expect(text).not.toMatch(BANNED);
  });

  it('knows a switch id from any other text', () => {
    for (const id of ['thinking', 'instructions-memory', 'search-files', 'plan-paid']) expect(isSwitchId(id)).toBe(true);
    for (const id of ['', 'prompt', 'misses', 'hidden:thinking', 'cc-clear', 'gpt-less-thinking', 'Thinking', 'toString']) expect(isSwitchId(id)).toBe(false);
  });
});

describe('the switches as the export sets them', () => {
  it('always gives all four, in the same order, with their labels', () => {
    for (const evidence of [FULL, BARE]) {
      const defaults = switchDefaults(evidence, null);
      expect(defaults.map((entry) => entry.id)).toEqual(['thinking', 'instructions-memory', 'search-files', 'plan-paid']);
      for (const entry of defaults) expect(entry.label).toBe(SWITCH_LABELS[entry.id]);
    }
  });

  it('thinking: on and "Set from your export" when the 30 days hold a recorded thinking time', () => {
    expect(find(switchDefaults({ ...BARE, thinking: 'recorded' }, null), 'thinking')).toMatchObject({ shown: true, on: true, note: 'Set from your export', noteIcon: 'export' });
  });

  it('thinking: on and "Typical setting" when only a model name says so', () => {
    expect(find(switchDefaults({ ...BARE, thinking: 'model-name' }, null), 'thinking')).toMatchObject({ shown: true, on: true, note: 'Typical setting', noteIcon: 'typical' });
  });

  it('thinking: not shown when neither is the case', () => {
    expect(find(switchDefaults({ ...FULL, thinking: 'none' }, null), 'thinking').shown).toBe(false);
  });

  it('instructions and memory: "Set from your export: memory was used" when an answer shows memory in use', () => {
    expect(find(switchDefaults({ ...BARE, memoryInUse: true }, null), 'instructions-memory')).toMatchObject({
      shown: true,
      on: true,
      note: 'Set from your export: memory was used',
      noteIcon: 'export',
    });
  });

  it('instructions and memory: on and "Typical setting" otherwise, and always shown', () => {
    expect(find(switchDefaults(BARE, null), 'instructions-memory')).toMatchObject({ shown: true, on: true, note: 'Typical setting', noteIcon: 'typical' });
  });

  it('search and files: on and "Set from your export" with a web source or a file without a size', () => {
    expect(find(switchDefaults({ ...BARE, searchOrFiles: true }, null), 'search-files')).toMatchObject({ shown: true, on: true, note: 'Set from your export', noteIcon: 'export' });
  });

  it('search and files: not shown otherwise', () => {
    expect(find(switchDefaults({ ...FULL, searchOrFiles: false }, null), 'search-files').shown).toBe(false);
  });

  it('plan: on and "Set from your export" when the export says Plus', () => {
    expect(find(switchDefaults(BARE, true), 'plan-paid')).toMatchObject({ shown: true, on: true, note: 'Set from your export', noteIcon: 'export' });
  });

  it('plan: off and "Set from your export: Free or Go" when the export says not Plus', () => {
    expect(find(switchDefaults(FULL, false), 'plan-paid')).toMatchObject({ shown: true, on: false, note: 'Set from your export: Free or Go', noteIcon: 'export' });
  });

  it('plan: on, and says the files did not say, when the plan file was not in the drop', () => {
    expect(find(switchDefaults(FULL, null), 'plan-paid')).toMatchObject({
      shown: true,
      on: true,
      note: 'Your files did not say. Switch this off if you are on Free or Go.',
      noteIcon: 'typical',
    });
  });

  it('does not let one piece of evidence change another switch', () => {
    const thinkingOf = (evidence: SwitchEvidence, plus: boolean | null) => find(switchDefaults(evidence, plus), 'thinking');
    expect(thinkingOf({ ...FULL, memoryInUse: false, searchOrFiles: false }, false)).toEqual(thinkingOf(FULL, true));
  });
});

describe('the switches in the result card', () => {
  it('shows all four when each has something to count', () => {
    expect(switchViews(switchDefaults(FULL, true), [])).toEqual([
      { id: 'thinking', label: 'Thinking', note: 'Set from your export', noteIcon: 'export', on: true },
      { id: 'instructions-memory', label: 'Hidden instructions and memory', note: 'Set from your export: memory was used', noteIcon: 'export', on: true },
      { id: 'search-files', label: 'Search results and file contents', note: 'Set from your export', noteIcon: 'export', on: true },
      { id: 'plan-paid', label: 'Plus or Pro plan', note: 'Set from your export', noteIcon: 'export', on: true },
    ]);
  });

  it('leaves out a switch with nothing to count: two stay for a bare export', () => {
    expect(switchViews(switchDefaults(BARE, false), [])).toEqual([
      { id: 'instructions-memory', label: 'Hidden instructions and memory', note: 'Typical setting', noteIcon: 'typical', on: true },
      { id: 'plan-paid', label: 'Plus or Pro plan', note: 'Set from your export: Free or Go', noteIcon: 'export', on: false },
    ]);
  });

  it('reads "Changed by you." with no icon after a flip, and turns the switch round', () => {
    const views = switchViews(switchDefaults(FULL, false), ['thinking', 'plan-paid']);
    expect(views[0]).toEqual({ id: 'thinking', label: 'Thinking', note: 'Changed by you.', noteIcon: null, on: false });
    expect(views[3]).toEqual({ id: 'plan-paid', label: 'Plus or Pro plan', note: 'Changed by you.', noteIcon: null, on: true });
    expect(views[1]?.note).toBe('Set from your export: memory was used');
  });

  it('brings the note and the icon back when the switch is flipped back', () => {
    const defaults = switchDefaults(FULL, null);
    expect(switchViews(defaults, [])).toEqual(switchViews(switchDefaults(FULL, null), []));
    const flippedBack: SwitchId[] = [];
    expect(switchViews(defaults, flippedBack)[0]).toMatchObject({ note: 'Set from your export', noteIcon: 'export', on: true });
  });

  it('never shows a switch that is left out, flipped or not', () => {
    expect(switchViews(switchDefaults(BARE, null), ['thinking', 'search-files']).map((view) => view.id)).toEqual(['instructions-memory', 'plan-paid']);
  });

  it('says where each switch stands: its default, turned round by a flip', () => {
    const defaults = switchDefaults(FULL, false);
    expect(switchOn(defaults, [], 'thinking')).toBe(true);
    expect(switchOn(defaults, ['thinking'], 'thinking')).toBe(false);
    expect(switchOn(defaults, [], 'plan-paid')).toBe(false);
    expect(switchOn(defaults, ['plan-paid'], 'plan-paid')).toBe(true);
    expect(switchOn(defaults, ['thinking'], 'search-files')).toBe(true);
  });

  it('takes a switch as on when there are no defaults yet', () => {
    expect(switchOn([], [], 'plan-paid')).toBe(true);
    expect(switchOn([], ['plan-paid'], 'plan-paid')).toBe(false);
  });
});

describe('which pieces are counted', () => {
  const ALL_ON: Record<HiddenId, boolean> = { thinking: true, prompt: true, personal: true, search: true, files: true, misses: true };

  it('counts all six by default', () => {
    expect(piecesOn(switchDefaults(FULL, true), [])).toEqual(ALL_ON);
  });

  it('switches off the pieces of a flipped switch, and only those', () => {
    const defaults = switchDefaults(FULL, true);
    expect(piecesOn(defaults, ['thinking'])).toEqual({ ...ALL_ON, thinking: false });
    expect(piecesOn(defaults, ['instructions-memory'])).toEqual({ ...ALL_ON, prompt: false, personal: false });
    expect(piecesOn(defaults, ['search-files'])).toEqual({ ...ALL_ON, search: false, files: false });
    expect(piecesOn(defaults, ['thinking', 'instructions-memory', 'search-files'])).toEqual({ thinking: false, prompt: false, personal: false, search: false, files: false, misses: true });
  });

  it('never switches the cache-miss piece off, and the plan switch covers no piece', () => {
    const defaults = switchDefaults(FULL, false);
    expect(piecesOn(defaults, ['plan-paid'])).toEqual(ALL_ON);
    expect(piecesOn(defaults, ['thinking', 'instructions-memory', 'search-files', 'plan-paid']).misses).toBe(true);
  });

  it('counts a piece whose switch is not shown, flipped or not: the whole history may hold some', () => {
    const defaults = switchDefaults(BARE, null);
    expect(piecesOn(defaults, [])).toEqual(ALL_ON);
    expect(piecesOn(defaults, ['thinking', 'search-files'])).toEqual(ALL_ON);
  });

  it('counts everything when there are no switches at all', () => {
    expect(piecesOn([], [])).toEqual(ALL_ON);
  });
});

describe('the pieces as the estimator takes them', () => {
  const row = (counts: Partial<Row>): Row[] => [{ model: 'gpt-5', sizeClass: 'medium', ...counts }];
  const bases: Bases = {
    thinking: row({ output: 400 }),
    prompt: row({ cacheRead: 30 }),
    personal: row({ cacheRead: 20, freshInput: 10 }),
    search: row({ freshInput: 12 }),
    files: row({ freshInput: 2 }),
    misses: row({ freshInput: 50_000 }),
  };
  const visible = row({ freshInput: 40_000, cacheRead: 200_000, output: 30_000 });
  const on = piecesOn(switchDefaults(FULL, true), []);

  it('hands over all six with id, slot, switch, amount and rows, in slot order', () => {
    expect(hiddenWork(bases, { ...on, search: false })).toEqual(
      HIDDEN_PIECES.map((piece) => ({ id: piece.id, slot: piece.slot, on: piece.id !== 'search', amount: piece.amount, rows: bases[piece.id] })),
    );
  });

  it('keeps a piece in its place when it is off or has nothing to count', () => {
    const pieces = hiddenWork(NO_BASES, { thinking: false, prompt: false, personal: false, search: false, files: false, misses: false });
    expect(pieces.map((piece) => [piece.id, piece.slot, piece.on, piece.rows.length])).toEqual(HIDDEN_PIECES.map((piece) => [piece.id, piece.slot, false, 0]));
  });

  it('is taken by the estimator as it is, and adds to the result', () => {
    const without = estimate({ rows: visible, table: MODEL_TABLE }, { tips: false });
    const withAll = estimate({ rows: visible, hidden: hiddenWork(bases, on), table: MODEL_TABLE }, { tips: false });
    const empty = estimate({ rows: visible, hidden: hiddenWork(NO_BASES, on), table: MODEL_TABLE }, { tips: false });
    expect(withAll.range.mid).toBeGreaterThan(without.range.mid);
    expect(empty.range).toEqual(without.range);
  });

  it('counts nothing for a switch that is off: the result is the one without those pieces', () => {
    const defaults = switchDefaults(FULL, true);
    const off = estimate({ rows: visible, hidden: hiddenWork(bases, piecesOn(defaults, ['instructions-memory'])), table: MODEL_TABLE }, { tips: false });
    const gone = estimate({ rows: visible, hidden: hiddenWork({ ...bases, prompt: [], personal: [] }, on), table: MODEL_TABLE }, { tips: false });
    expect(off.range).toEqual(gone.range);
    expect(off.inert).toEqual(expect.arrayContaining(['hidden:prompt', 'hidden:personal']));
    expect(off.inert).not.toContain('hidden:thinking');
  });

  it('lets each slider of a counted piece be set to its typical value at the middle of its track', () => {
    const pins = Object.fromEntries(HIDDEN_PIECES.map((piece) => [`hidden:${piece.id}`, { value: piece.amount[1] }]));
    const result = estimate({ rows: visible, hidden: hiddenWork(bases, on), pins, table: MODEL_TABLE }, { tips: false });
    for (const piece of HIDDEN_PIECES) expect(result.pins[`hidden:${piece.id}`]).toBe(0.5);
  });
});
