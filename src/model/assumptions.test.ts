import { describe, expect, it } from 'vitest';
import type { AssumptionView } from '../contracts/view';
import { assumptionValue } from '../format';
import { positionOf, valueAt } from '../track';
import {
  ASSUMPTION_ROWS,
  CITATIONS,
  DEFAULT_LEAD,
  ENERGY_ORDER,
  ENERGY_ROWS,
  MARKET_GRID,
  MODEL_TABLE,
  NOTE_NO_EFFECT,
  NOTE_SWITCHED_OFF,
  SLIDERS,
  SOURCE_LINKS,
  assumptionViews,
  isSliderId,
  leadSize,
  rowOf,
} from './assumptions';
import type { AssumptionRow, EnergyClass, SliderFacts, SliderId } from './assumptions';
import { SLIDER_IDS, TABLE, estimate } from './estimate';

// The table of the build spec, section 2.1, typed out once more: group, label, unit, decimals, low,
// typical, high, sentence, source line, link, soft.
type Expected = readonly [string, string, string, number, number, number, number, string, string, string | null, boolean];

const ENERGY = 'Energy';
const INPUT = 'Input and cache';
const SITE = 'Data centre, grid and hardware';
const HIDDEN = 'Hidden work in ChatGPT';

const SPEC_ENERGY: Record<EnergyClass, Expected> = {
  small: [
    ENERGY,
    'Energy to write 1,000 tokens, small models',
    ' Wh',
    2,
    0.05,
    0.1,
    0.4,
    "How much electricity a small model uses to write 1,000 tokens. No company publishes this, so the range comes from an open-source estimate based on the model's guessed size.",
    'EcoLogits 0.11.1 (an estimate; 0.11.2 is the newest release)',
    'https://ecologits.ai/latest/methodology/llm_inference/',
    false,
  ],
  medium: [
    ENERGY,
    'Energy to write 1,000 tokens, mid-size models',
    ' Wh',
    1,
    0.2,
    0.6,
    2.2,
    'How much electricity a mid-size model uses to write 1,000 tokens. Published estimates differ by about ten times, and the range shows that.',
    'Epoch AI (2025) for the middle, which already includes some data-centre overhead; EcoLogits 0.11.1 for the high end; the low end has thin support',
    'https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use',
    false,
  ],
  large: [
    ENERGY,
    'Energy to write 1,000 tokens, large models',
    ' Wh',
    1,
    0.5,
    1.0,
    5.4,
    'How much electricity a large model uses to write 1,000 tokens. The low end and middle follow a 2026 study of well-run servers, the high end a cautious open-source estimate.',
    'Oviedo et al., Joule (2026) for the low end and middle, which already include data-centre overhead; EcoLogits 0.11.1 for the high end',
    'https://arxiv.org/abs/2509.20241',
    false,
  ],
  fable: [
    ENERGY,
    'Energy to write 1,000 tokens, Fable',
    ' Wh',
    1,
    0.5,
    1.0,
    10.8,
    'Fable is treated as a large model with a higher top end, because it costs two to two and a half times as much as Opus (list prices on 7 Oct 2026) and is thought to be about twice the size. Nobody outside Anthropic has measured it.',
    "Our assumption: twice the large high end. EcoLogits 0.11.2's own formula gives up to 18 Wh",
    'https://platform.claude.com/docs/en/about-claude/pricing',
    true,
  ],
  unknown: [
    ENERGY,
    "Energy to write 1,000 tokens, models we don't know",
    ' Wh',
    2,
    0.05,
    0.6,
    5.4,
    'We could not tell how big this model is, so its range runs from the low end of small models to the high end of large ones.',
    'Our assumption: the small low end, the mid-size middle and the large high end',
    null,
    true,
  ],
};

const SPEC_OTHERS: Record<Exclude<SliderId, 'energy'>, Expected> = {
  freshInput: [
    INPUT,
    'Reading a new token, compared with writing one',
    '',
    2,
    0.03,
    0.15,
    0.35,
    'Reading a token takes far less energy than writing one. Studies put it between 3% and 35%, and it may be more in very long conversations.',
    "Delavande et al. (2026), Caravaca et al. (2025), Epoch AI (2025). Epoch's own numbers give 0.66 for a 100,000-token input",
    'https://arxiv.org/abs/2511.05597',
    false,
  ],
  cacheWrite: [
    INPUT,
    'Storing a token for re-use, compared with writing one',
    '',
    2,
    0.03,
    0.15,
    0.45,
    'Storing text for re-use is assumed to cost about the same as reading it fresh. No published study has measured this.',
    'Our assumption: equal to fresh input, with a top end taken from a price ratio, not from a measurement',
    'https://platform.claude.com/docs/en/about-claude/pricing',
    true,
  ],
  cacheRead: [
    INPUT,
    'Re-reading a stored token, compared with writing one',
    '',
    2,
    0.001,
    0.015,
    0.1,
    'Re-reading stored text is much cheaper than reading it fresh, but only one small study has measured how much. Among the numbers that apply to everyone, this is the least certain: its high value is 100 times its low value.',
    'The low end and middle follow price ratios. The one measurement (Irminsul, 2026, short texts) implies 0.004 and 0.02 to 0.06',
    'https://arxiv.org/abs/2605.05696',
    true,
  ],
  pue: [
    SITE,
    'Data-centre overhead',
    '',
    2,
    1.09,
    1.14,
    1.17,
    'Data centres use extra electricity for cooling and power supply: 9% extra at Google, 14% at Amazon and 17% at Microsoft, by their own 2025 reports.',
    'Google, Amazon and Microsoft, 2025 figures for their whole fleets',
    'https://datacenters.google/efficiency/',
    false,
  ],
  grid: [
    SITE,
    'CO₂ per unit of electricity',
    ' g/kWh',
    0,
    270,
    350,
    460,
    'How much CO2 comes with each unit of electricity. The low end is the Virginia and Carolinas grid, the middle is the US average, and the high end is the world average.',
    'US EPA eGRID2023 for the low end and middle (power plants only); Ember 2026 for the high end (whole life cycle)',
    'https://www.epa.gov/egrid/summary-data',
    false,
  ],
  hardware: [
    SITE,
    'Making the hardware, as a factor on top',
    '',
    3,
    1.1,
    1.115,
    1.13,
    "Making the chips and servers adds roughly a tenth on top, by Google's studies of its own AI hardware.",
    "Schneider et al. (2025) and Elsworth et al. (2025), both about Google's own hardware. The middle value is our choice",
    'https://arxiv.org/abs/2502.01671',
    true,
  ],
  'hidden:thinking': [
    HIDDEN,
    'Thinking tokens per second of thinking',
    ' tokens',
    0,
    20,
    60,
    150,
    'Your export records how long ChatGPT thought before each answer, but not how much it wrote while thinking; we assume 60 tokens for each second, and it could be 20 to 150.',
    'Output speeds measured by Artificial Analysis. The step from seconds to tokens is our assumption',
    'https://artificialanalysis.ai/models/gpt-5',
    true,
  ],
  'hidden:prompt': [
    HIDDEN,
    'Hidden instructions, tokens each time ChatGPT answers',
    ' tokens',
    0,
    12000,
    25000,
    35000,
    'Before every answer ChatGPT reads instructions from OpenAI that you never see; copies published by users are about 25,000 tokens long, and we allow 12,000 to 35,000.',
    "Copies of ChatGPT's instructions published by users, counted by us. They cannot be verified",
    'https://github.com/asgeirtj/system_prompts_leaks',
    true,
  ],
  'hidden:personal': [
    HIDDEN,
    'Memory and custom instructions, tokens each time ChatGPT answers',
    ' tokens',
    0,
    500,
    3000,
    10000,
    'If memory is on, ChatGPT also reads what it has saved about you before every answer; nobody has published how long that is, so 3,000 tokens is our estimate from a few published examples, within 500 to 10,000.',
    'Added up by us from a few published examples. Not a measurement',
    'https://embracethered.com/blog/posts/2025/chatgpt-how-does-chat-history-memory-preferences-work/',
    true,
  ],
  'hidden:search': [
    HIDDEN,
    'Web text read, tokens per source',
    ' tokens',
    0,
    100,
    600,
    2500,
    'Your export lists the web sources behind an answer but not the text ChatGPT read from them; we assume 600 tokens per source, and it could be 100 to 2,500.',
    'One official figure: OpenAI bills 8,000 tokens per search on two small models. The rest is our estimate',
    'https://developers.openai.com/api/docs/pricing',
    true,
  ],
  'hidden:files': [
    HIDDEN,
    'Uploaded file with no size in the export, tokens per file',
    ' tokens',
    0,
    500,
    5000,
    40000,
    'For some of your uploaded files the export does not say how long they are; we assume 5,000 tokens each, within 500 to 40,000.',
    'Our own count of 35 files in four public exports',
    null,
    true,
  ],
  'hidden:misses': [
    HIDDEN,
    'Share of quick replies where re-use fails',
    '',
    2,
    0.02,
    0.1,
    1.0,
    'When you reply within half an hour, ChatGPT can probably reuse its earlier reading of the conversation instead of reading it afresh; we assume this fails for 1 reply in 10, and it could be anywhere from 1 in 50 to every time.',
    'Our assumption. OpenAI documents re-use for its developer service, not for ChatGPT',
    'https://developers.openai.com/api/docs/guides/prompt-caching',
    true,
  ],
};

function asExpected(row: AssumptionRow): Expected {
  const [low, typical, high] = row.triple;
  return [row.group, row.label, row.unit, row.decimals, low, typical, high, row.explanation, row.source, row.sourceUrl, row.soft];
}

const ENERGY_CLASSES = Object.keys(SPEC_ENERGY) as EnergyClass[];
const OTHER_IDS = Object.keys(SPEC_OTHERS) as Array<Exclude<SliderId, 'energy'>>;
const ALL_ROWS: AssumptionRow[] = [...Object.values(ENERGY_ROWS), ...Object.values(ASSUMPTION_ROWS)];

// Never as a claim about emissions, and nothing about what anyone owes.
const BANNED = /offset|neutral|compensat|net[ -]zero|\bowe|\bdebt/i;

const NO_RESULT = { pins: {}, used: [], inert: [], off: [], absent: [] } as const;
const facts = (over: Partial<SliderFacts>): SliderFacts => ({ source: 'claude-code', lead: 'large', ...NO_RESULT, ...over });
const byId = (views: AssumptionView[], id: string): AssumptionView => {
  const view = views.find((entry) => entry.id === id);
  if (view === undefined) throw new Error(`no slider ${id}`);
  return view;
};

describe('the rows of the table', () => {
  it.each(ENERGY_CLASSES)('energy, %s: every cell as the spec gives it', (size) => {
    expect(asExpected(ENERGY_ROWS[size])).toEqual(SPEC_ENERGY[size]);
  });

  it.each(OTHER_IDS)('%s: every cell as the spec gives it', (id) => {
    expect(asExpected(ASSUMPTION_ROWS[id])).toEqual(SPEC_OTHERS[id]);
  });

  it('has exactly the rows of the spec', () => {
    expect(Object.keys(ENERGY_ROWS).sort()).toEqual([...ENERGY_CLASSES].sort());
    expect(Object.keys(ASSUMPTION_ROWS).sort()).toEqual([...OTHER_IDS].sort());
  });

  it('prints the word of each size before its value', () => {
    expect(ENERGY_CLASSES.map((size) => ENERGY_ROWS[size].partLabel)).toEqual(['small', 'mid-size', 'large', 'Fable', 'unknown']);
  });

  it('was checked on 7 Oct 2026, every row', () => {
    for (const row of ALL_ROWS) expect(row.checked).toBe('2026-10-07');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ENERGY_ROWS)).toBe(true);
    expect(Object.isFrozen(ENERGY_ROWS.large)).toBe(true);
    expect(Object.isFrozen(ASSUMPTION_ROWS)).toBe(true);
    expect(Object.isFrozen(ASSUMPTION_ROWS['hidden:prompt'].triple)).toBe(true);
  });

  it('gives every value three different numbers, low below typical below high, with a low above zero', () => {
    for (const row of ALL_ROWS) {
      const [low, typical, high] = row.triple;
      expect(low).toBeGreaterThan(0);
      expect(typical).toBeGreaterThan(low);
      expect(high).toBeGreaterThan(typical);
    }
  });
});

describe('the numbers are the estimator’s own', () => {
  it('takes the four known sizes from the estimator’s table, not a copy', () => {
    for (const size of ['small', 'medium', 'large', 'fable'] as const) expect(ENERGY_ROWS[size].triple).toBe(TABLE.energy[size]);
  });

  it('takes the six other fixed sliders from the estimator’s table, not a copy', () => {
    for (const id of ['freshInput', 'cacheWrite', 'cacheRead', 'pue', 'grid', 'hardware'] as const) {
      expect(ASSUMPTION_ROWS[id].triple).toBe(TABLE[id]);
    }
  });

  it('builds the unknown row from the small low end, the mid-size middle and the large high end', () => {
    expect(ENERGY_ROWS.unknown.triple).toEqual([TABLE.energy.small[0], TABLE.energy.medium[1], TABLE.energy.large[2]]);
    expect(ENERGY_ROWS.unknown.triple).toEqual([0.05, 0.6, 5.4]);
  });

  it('hands the estimator its own table plus the unknown row', () => {
    expect(MODEL_TABLE).toEqual({ ...TABLE, energy: { ...TABLE.energy, unknown: [0.05, 0.6, 5.4] } });
    expect(Object.isFrozen(MODEL_TABLE)).toBe(true);
    expect(Object.isFrozen(MODEL_TABLE.energy)).toBe(true);
    expect(MODEL_TABLE.energy.unknown).toBe(ENERGY_ROWS.unknown.triple);
  });

  it('lets the estimator count a model of unknown size, which its own table refuses', () => {
    const rows = [{ model: 'some-new-model', sizeClass: 'unknown', output: 1_000_000 }];
    expect(() => estimate({ rows })).toThrow(/^ai-co2:/);
    const result = estimate({ rows, table: MODEL_TABLE });
    expect(result.range.p5).toBeGreaterThan(0);
    expect(result.range.p95).toBeGreaterThan(result.range.p5);
  });

  it('gives the same result as the estimator’s own table for the known sizes', () => {
    const rows = [{ model: 'claude-opus-5-5', sizeClass: 'large', output: 2_000_000, cacheRead: 90_000_000 }];
    expect(estimate({ rows, table: MODEL_TABLE }).range).toEqual(estimate({ rows }).range);
  });

  it('has a row for every fixed slider of the estimator', () => {
    for (const id of SLIDER_IDS) expect(isSliderId(id)).toBe(true);
  });

  it('keeps 70 g per kWh for the market-based line', () => {
    expect(MARKET_GRID).toBe(70);
  });
});

describe('the sentences agree with the numbers', () => {
  const said = (id: Exclude<SliderId, 'energy'>, typical: string, span: string) => {
    const row = ASSUMPTION_ROWS[id];
    const print = (x: number) => x.toLocaleString('en');
    expect(typical).toBe(print(row.triple[1]));
    expect(span).toBe(`${print(row.triple[0])} to ${print(row.triple[2])}`);
    expect(row.explanation).toContain(typical);
    expect(row.explanation).toContain(span);
  };

  it('names the typical value and the two ends in each hidden-work sentence', () => {
    said('hidden:thinking', '60', '20 to 150');
    said('hidden:prompt', '25,000', '12,000 to 35,000');
    said('hidden:personal', '3,000', '500 to 10,000');
    said('hidden:search', '600', '100 to 2,500');
    said('hidden:files', '5,000', '500 to 40,000');
  });

  it('says 1 in 10, 1 in 50 and every time for the share of failed re-use', () => {
    expect(ASSUMPTION_ROWS['hidden:misses'].triple).toEqual([1 / 50, 1 / 10, 1]);
  });

  it('says 100 times for the cache read, and that is its high over its low', () => {
    const [low, , high] = ASSUMPTION_ROWS.cacheRead.triple;
    expect(high / low).toBeCloseTo(100, 9);
  });

  it('says 3% to 35% for fresh input, and 9%, 14% and 17% for the overhead', () => {
    expect(ASSUMPTION_ROWS.freshInput.triple[0]).toBe(0.03);
    expect(ASSUMPTION_ROWS.freshInput.triple[2]).toBe(0.35);
    expect(ASSUMPTION_ROWS.pue.triple.map((x) => Math.round((x - 1) * 100))).toEqual([9, 14, 17]);
  });

  it('says twice the large high end for Fable', () => {
    expect(ENERGY_ROWS.fable.triple[2]).toBe(2 * ENERGY_ROWS.large.triple[2]);
  });

  it('prints the cache-read weight as the spec says: 0.0010, 0.015, 0.10', () => {
    const row = ASSUMPTION_ROWS.cacheRead;
    expect(row.triple.map((x) => assumptionValue(x, row.decimals))).toEqual(['0.0010', '0.015', '0.10']);
  });
});

describe('which sliders each tool shows', () => {
  it('Claude Code: seven, in the spec’s order', () => {
    expect(SLIDERS['claude-code']).toEqual(['energy', 'freshInput', 'cacheWrite', 'cacheRead', 'pue', 'grid', 'hardware']);
  });

  it('ChatGPT: no cache write, then the six pieces of hidden work', () => {
    expect(SLIDERS.chatgpt).toEqual([
      'energy',
      'freshInput',
      'cacheRead',
      'pue',
      'grid',
      'hardware',
      'hidden:thinking',
      'hidden:prompt',
      'hidden:personal',
      'hidden:search',
      'hidden:files',
      'hidden:misses',
    ]);
  });

  it('shows the large row for Claude Code and the mid-size row for ChatGPT before there is a result', () => {
    expect(DEFAULT_LEAD).toEqual({ 'claude-code': 'large', chatgpt: 'medium' });
  });

  it('orders the sizes fable, large, medium, small, unknown', () => {
    expect(ENERGY_ORDER).toEqual(['fable', 'large', 'medium', 'small', 'unknown']);
  });

  it('knows a slider id from any other text', () => {
    for (const id of [...SLIDERS['claude-code'], ...SLIDERS.chatgpt]) expect(isSliderId(id)).toBe(true);
    for (const id of ['', 'Energy', 'hidden:', 'hidden:energy', 'hidden:plan', 'thinking', '__proto__', 'constructor', 'toString', 'plan-paid']) {
      expect(isSliderId(id)).toBe(false);
    }
  });

  it('gives the lead size’s row for energy and the slider’s own row otherwise', () => {
    expect(rowOf('energy', 'fable')).toBe(ENERGY_ROWS.fable);
    expect(rowOf('energy', 'unknown')).toBe(ENERGY_ROWS.unknown);
    expect(rowOf('grid', 'fable')).toBe(ASSUMPTION_ROWS.grid);
    expect(rowOf('hidden:misses', 'small')).toBe(ASSUMPTION_ROWS['hidden:misses']);
  });

  it('has the two notes word for word', () => {
    expect(NOTE_SWITCHED_OFF).toBe('This is switched off in your result.');
    expect(NOTE_NO_EFFECT).toBe('This changes nothing for your data.');
  });
});

describe('the source links', () => {
  it('holds every link of a row and the two of the car, each once', () => {
    for (const row of ALL_ROWS) if (row.sourceUrl !== null) expect(SOURCE_LINKS).toContain(row.sourceUrl);
    expect(SOURCE_LINKS).toContain('https://www.eea.europa.eu/en/datahub/datahubitem-view/fa8b1229-3db6-495d-b18e-9c9b3267c02b');
    expect(SOURCE_LINKS).toContain('https://theicct.org/publication/real-world-co2-emission-values-vehicles-europe-jun26/');
    expect(new Set(SOURCE_LINKS).size).toBe(SOURCE_LINKS.length);
    // 15 rows have a link, two of them the same one, and the car adds two.
    expect(SOURCE_LINKS).toHaveLength(16);
  });

  it('starts every link with https://', () => {
    for (const link of SOURCE_LINKS) expect(link).toMatch(/^https:\/\/[a-z0-9.-]+\//);
  });

  it('has no link for the two rows that are our own count or assumption', () => {
    expect(ENERGY_ROWS.unknown.sourceUrl).toBeNull();
    expect(ASSUMPTION_ROWS['hidden:files'].sourceUrl).toBeNull();
  });

  it('keeps a citation for every row that has a source outside the project', () => {
    for (const size of ENERGY_CLASSES) expect(typeof CITATIONS[`energy:${size}`]).toBe('string');
    for (const id of OTHER_IDS) expect(typeof CITATIONS[id]).toBe('string');
    expect(Object.keys(CITATIONS)).toHaveLength(ENERGY_CLASSES.length + OTHER_IDS.length);
    const without = Object.entries(CITATIONS).filter(([, text]) => text === '').map(([key]) => key);
    expect(without).toEqual(['energy:unknown', 'hidden:files']);
  });
});

describe('the lead size of the energy slider', () => {
  const kg = (entries: Array<[EnergyClass, number]>) => new Map(entries);

  it('is the used size with the most kilograms', () => {
    expect(leadSize('large', false, kg([['small', 1], ['medium', 3], ['large', 2]]))).toBe('medium');
  });

  it('goes to the first of fable, large, medium, small, unknown on a tie', () => {
    expect(leadSize('small', false, kg([['unknown', 2], ['small', 2], ['medium', 2]]))).toBe('medium');
    expect(leadSize('small', false, kg([['large', 2], ['fable', 2]]))).toBe('fable');
    expect(leadSize('medium', false, kg([['unknown', 1], ['small', 1]]))).toBe('small');
  });

  it('stays while the slider is set and the size is still used', () => {
    expect(leadSize('small', true, kg([['small', 0.1], ['large', 9]]))).toBe('small');
  });

  it('is picked again when the slider is set and the size is no longer used', () => {
    expect(leadSize('small', true, kg([['small', 0], ['large', 9], ['medium', 1]]))).toBe('large');
    expect(leadSize('fable', true, kg([['medium', 1]]))).toBe('medium');
  });

  it('is picked again when the slider is not set', () => {
    expect(leadSize('small', false, kg([['small', 0.1], ['large', 9]]))).toBe('large');
  });

  it('stays when nothing is used', () => {
    expect(leadSize('medium', false, kg([]))).toBe('medium');
    expect(leadSize('fable', true, kg([['large', 0], ['small', Number.NaN]]))).toBe('fable');
  });
});

describe('the sliders before there is a result', () => {
  it('no tool yet: the seven Claude Code sliders, the large row, no parts, no notes', () => {
    const views = assumptionViews(facts({ source: null }));
    expect(views.map((view) => view.id)).toEqual(SLIDERS['claude-code']);
    const energy = byId(views, 'energy');
    expect(energy.label).toBe('Energy to write 1,000 tokens, large models');
    expect([energy.low, energy.typical, energy.high, energy.value]).toEqual([0.5, 1, 5.4, 1]);
    for (const view of views) {
      expect(view.parts).toBeUndefined();
      expect(view.note).toBeNull();
      expect(view.pinned).toBe(false);
      expect(view.value).toBe(view.typical);
    }
  });

  it('Claude Code chosen: the same seven', () => {
    expect(assumptionViews(facts({ source: 'claude-code', lead: DEFAULT_LEAD['claude-code'] }))).toEqual(assumptionViews(facts({ source: null })));
  });

  it('ChatGPT chosen: the mid-size row and all six hidden-work sliders', () => {
    const views = assumptionViews(facts({ source: 'chatgpt', lead: DEFAULT_LEAD.chatgpt }));
    expect(views.map((view) => view.id)).toEqual(SLIDERS.chatgpt);
    expect(byId(views, 'energy').label).toBe('Energy to write 1,000 tokens, mid-size models');
    expect(views.filter((view) => view.group === 'Hidden work in ChatGPT')).toHaveLength(6);
    for (const view of views) {
      expect(view.parts).toBeUndefined();
      expect(view.note).toBeNull();
    }
  });

  it('arrives grouped: a heading never comes back once another has started', () => {
    for (const source of ['claude-code', 'chatgpt'] as const) {
      const groups = assumptionViews(facts({ source })).map((view) => view.group);
      const runs = groups.filter((group, index) => group !== groups[index - 1]);
      expect(new Set(runs).size).toBe(runs.length);
    }
    expect([...new Set(assumptionViews(facts({ source: 'chatgpt' })).map((view) => view.group))]).toEqual([ENERGY, INPUT, SITE, HIDDEN]);
  });

  it('shows a slider that was moved before the data came in as set', () => {
    const views = assumptionViews(facts({ source: null, pins: { grid: 0 } }));
    const grid = byId(views, 'grid');
    expect(grid.pinned).toBe(true);
    expect(grid.value).toBe(270);
  });

  it('carries every field of the row into the view', () => {
    const grid = byId(assumptionViews(facts({})), 'grid');
    expect(grid).toEqual({
      id: 'grid',
      group: SITE,
      label: 'CO₂ per unit of electricity',
      unit: ' g/kWh',
      decimals: 0,
      low: 270,
      typical: 350,
      high: 460,
      value: 350,
      pinned: false,
      explanation: SPEC_OTHERS.grid[7],
      note: null,
      source: SPEC_OTHERS.grid[8],
      sourceUrl: 'https://www.epa.gov/egrid/summary-data',
      checked: '2026-10-07',
      soft: false,
    });
  });
});

describe('the energy slider with a result', () => {
  const printed = (view: AssumptionView) =>
    (view.parts ?? []).map((part) => `${part.label} ${assumptionValue(part.value, part.decimals)}${view.unit}`).join(' · ');

  it('only Haiku: the small row, no parts', () => {
    const energy = byId(assumptionViews(facts({ lead: 'small', used: ['small'] })), 'energy');
    expect(energy.label).toBe('Energy to write 1,000 tokens, small models');
    expect([energy.low, energy.typical, energy.high]).toEqual([0.05, 0.1, 0.4]);
    expect(energy.parts).toBeUndefined();
  });

  it('only Fable: the Fable row, whose right end is 10.8 Wh', () => {
    const energy = byId(assumptionViews(facts({ lead: 'fable', used: ['fable'] })), 'energy');
    expect(energy.high).toBe(10.8);
    expect(energy.soft).toBe(true);
    expect(energy.explanation).toMatch(/^Fable is treated as a large model/);
    expect(energy.parts).toBeUndefined();
  });

  // The spec's example reads "mid-size 0.6 Wh · small 0.10 Wh". The parts carry exactly that: 0.6 with one
  // decimal at least, 0.1 with two. assumptionValue then prints two meaningful digits, so the page shows "0.60".
  it('GPT-5 and GPT-5 mini: the mid-size row, with the parts "mid-size 0.6" and "small 0.10"', () => {
    const energy = byId(assumptionViews(facts({ source: 'chatgpt', lead: 'medium', used: ['small', 'medium'] })), 'energy');
    expect(energy.label).toBe('Energy to write 1,000 tokens, mid-size models');
    expect(energy.parts).toEqual([
      { label: 'mid-size', low: 0.2, typical: 0.6, high: 2.2, value: 0.6, decimals: 1 },
      { label: 'small', low: 0.05, typical: 0.1, high: 0.4, value: 0.1, decimals: 2 },
    ]);
    expect(printed(energy)).toMatch(/^mid-size 0\.60? Wh · small 0\.10 Wh$/);
  });

  it('puts the lead first, then the others in the order fable, large, medium, small, unknown', () => {
    const energy = byId(assumptionViews(facts({ lead: 'medium', used: ['unknown', 'small', 'medium', 'large', 'fable'] })), 'energy');
    expect(energy.parts?.map((part) => part.label)).toEqual(['mid-size', 'Fable', 'large', 'small', 'unknown']);
  });

  it('repeats the slider’s own numbers in the first part', () => {
    const energy = byId(assumptionViews(facts({ lead: 'large', used: ['large', 'small'], pins: { energy: 0.8 } })), 'energy');
    expect(energy.parts?.[0]).toEqual({ label: 'large', low: energy.low, typical: energy.typical, high: energy.high, value: energy.value, decimals: energy.decimals });
  });

  it('moves every part with the one thumb: the same track position in each size’s own row', () => {
    const energy = byId(assumptionViews(facts({ lead: 'large', used: ['large', 'small', 'fable'], pins: { energy: 0.8 } })), 'energy');
    expect(energy.pinned).toBe(true);
    expect(energy.value).toBe(valueAt(TABLE.energy.large, 0.8));
    for (const part of energy.parts ?? []) expect(positionOf([part.low, part.typical, part.high], part.value)).toBeCloseTo(0.8, 12);
    expect(energy.parts?.map((part) => part.label)).toEqual(['large', 'Fable', 'small']);
  });

  it('rests every part on its typical value while the slider is not set', () => {
    const energy = byId(assumptionViews(facts({ lead: 'fable', used: ['fable', 'unknown'] })), 'energy');
    expect(energy.pinned).toBe(false);
    for (const part of energy.parts ?? []) expect(part.value).toBe(part.typical);
  });

  it('keeps the thumb where it is when another size takes the lead', () => {
    const before = byId(assumptionViews(facts({ lead: 'large', used: ['large'], pins: { energy: 0.25 } })), 'energy');
    const after = byId(assumptionViews(facts({ lead: 'small', used: ['small'], pins: { energy: 0.25 } })), 'energy');
    expect(positionOf(TABLE.energy.large, before.value)).toBeCloseTo(0.25, 12);
    expect(positionOf(TABLE.energy.small, after.value)).toBeCloseTo(0.25, 12);
    expect(after.value).not.toBe(before.value);
  });
});

describe('set sliders and notes', () => {
  it('reads a set slider at its track position, and its typical value at the middle', () => {
    const views = assumptionViews(facts({ pins: { cacheRead: 0.5, pue: 1, hardware: 0, freshInput: 0.75 } }));
    expect(byId(views, 'cacheRead')).toMatchObject({ value: 0.015, pinned: true });
    expect(byId(views, 'pue')).toMatchObject({ value: 1.17, pinned: true });
    expect(byId(views, 'hardware')).toMatchObject({ value: 1.1, pinned: true });
    expect(byId(views, 'freshInput').value).toBe(valueAt(TABLE.freshInput, 0.75));
    expect(byId(views, 'grid')).toMatchObject({ value: 350, pinned: false });
  });

  it('never leaves low to high, whatever the position', () => {
    for (const position of [-1, 0, 0.001, 0.3, 0.5, 0.999, 1, 7]) {
      for (const view of assumptionViews(facts({ source: 'chatgpt', pins: { 'hidden:misses': position, energy: position } }))) {
        expect(view.value).toBeGreaterThanOrEqual(view.low);
        expect(view.value).toBeLessThanOrEqual(view.high);
      }
    }
  });

  it('ignores a set slider the tool does not have', () => {
    const views = assumptionViews(facts({ source: 'chatgpt', pins: { cacheWrite: 0.9 } }));
    expect(views.some((view) => view.id === 'cacheWrite')).toBe(false);
    expect(views.every((view) => !view.pinned)).toBe(true);
  });

  it('says so when a slider changes nothing for this data', () => {
    const views = assumptionViews(facts({ inert: ['cacheWrite'] }));
    expect(byId(views, 'cacheWrite').note).toBe('This changes nothing for your data.');
    expect(byId(views, 'cacheRead').note).toBeNull();
  });

  it('says "switched off" for a hidden-work slider whose switch is off, also when the estimator lists it as changing nothing', () => {
    const views = assumptionViews(facts({ source: 'chatgpt', off: ['search', 'files'], inert: ['hidden:search', 'hidden:files', 'hidden:thinking'] }));
    expect(byId(views, 'hidden:search').note).toBe('This is switched off in your result.');
    expect(byId(views, 'hidden:files').note).toBe('This is switched off in your result.');
    expect(byId(views, 'hidden:thinking').note).toBe('This changes nothing for your data.');
    expect(byId(views, 'hidden:misses').note).toBeNull();
    expect(views).toHaveLength(12);
  });

  it('leaves out a hidden-work slider whose piece has nothing to count', () => {
    const views = assumptionViews(facts({ source: 'chatgpt', absent: ['thinking', 'files'], off: ['thinking'] }));
    expect(views.map((view) => view.id)).toEqual([
      'energy',
      'freshInput',
      'cacheRead',
      'pue',
      'grid',
      'hardware',
      'hidden:prompt',
      'hidden:personal',
      'hidden:search',
      'hidden:misses',
    ]);
  });

  it('marks what the estimator itself calls inert', () => {
    const result = estimate({ rows: [{ model: 'claude-haiku-4-5', sizeClass: 'small', output: 5000, freshInput: 100 }], table: MODEL_TABLE }, { tips: false });
    const noted = assumptionViews(facts({ lead: 'small', used: ['small'], inert: result.inert })).filter((view) => view.note !== null);
    expect(noted.map((view) => view.id)).toEqual(['cacheWrite', 'cacheRead']);
  });
});

describe('words', () => {
  it('uses none of the banned words', () => {
    const strings = [
      ...ALL_ROWS.flatMap((row) => [row.group, row.label, row.unit, row.explanation, row.source]),
      ...Object.values(ENERGY_ROWS).map((row) => row.partLabel),
      ...Object.values(CITATIONS),
      NOTE_SWITCHED_OFF,
      NOTE_NO_EFFECT,
    ];
    expect(strings.length).toBeGreaterThan(100);
    for (const text of strings) expect(text).not.toMatch(BANNED);
  });
});
