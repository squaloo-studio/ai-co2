// The assumption table as the page shows it: one row per slider, with its label, its sentence and its
// source. The numbers themselves belong to the estimator. This file reads them from there and adds words.

import type { SourceId } from '../contracts/usage';
import type { AssumptionPart, AssumptionView } from '../contracts/view';
import { longDate } from '../format';
import { valueAt } from '../track';
import type { Triple } from '../track';
import { TABLE } from './estimate';
import type { AssumptionTable } from './estimate';

/** The four sizes of the classifier plus the row for a name nobody can place. The keys of MODEL_TABLE.energy. */
export type EnergyClass = 'small' | 'medium' | 'large' | 'fable' | 'unknown';
export type HiddenId = 'thinking' | 'prompt' | 'personal' | 'search' | 'files' | 'misses';
export type SliderId = 'energy' | 'freshInput' | 'cacheWrite' | 'cacheRead' | 'pue' | 'grid' | 'hardware' | `hidden:${HiddenId}`;

/** One row of the assumption table. */
export interface AssumptionRow {
  /** The heading the slider sits under. */
  readonly group: string;
  readonly label: string;
  /** Printed after the value. Empty for a plain ratio. */
  readonly unit: string;
  /** The fewest decimals to print. */
  readonly decimals: number;
  /** Low, typical, high. */
  readonly triple: Triple;
  readonly explanation: string;
  readonly source: string;
  readonly sourceUrl: string | null;
  /** The day the source was opened, as YYYY-MM-DD. */
  readonly checked: string;
  /** true when the evidence is thin. */
  readonly soft: boolean;
}

/** An energy row also has the word the page prints before its value: "Fable", "large", "mid-size", "small", "unknown". */
export interface EnergyRow extends AssumptionRow {
  readonly partLabel: string;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

const CHECKED = '2026-10-07';

const ENERGY_GROUP = 'Energy';
const INPUT_GROUP = 'Input and cache';
const SITE_GROUP = 'Data centre, grid and hardware';
const HIDDEN_GROUP = 'Hidden work in ChatGPT';

const PRICING_PAGE = 'https://platform.claude.com/docs/en/about-claude/pricing';

// A name nobody can place could be anything from a small model to a large one. So its row is built
// from the three rows it spans, and follows them if they change.
const UNKNOWN_ENERGY: Triple = [TABLE.energy.small[0], TABLE.energy.medium[1], TABLE.energy.large[2]];

const ENERGY: Readonly<Record<EnergyClass, Triple>> = {
  small: TABLE.energy.small,
  medium: TABLE.energy.medium,
  large: TABLE.energy.large,
  fable: TABLE.energy.fable,
  unknown: UNKNOWN_ENERGY,
};

/** The table every call to estimate gets: the estimator's own, with the row for unknown models added. */
export const MODEL_TABLE: AssumptionTable = deepFreeze({ ...TABLE, energy: { ...ENERGY } });

/** g per kWh for the market-based line. The full call passes `{ marketGrid: MARKET_GRID }`. */
export const MARKET_GRID = 70 as const;

export const ENERGY_ROWS: Readonly<Record<EnergyClass, EnergyRow>> = deepFreeze({
  small: {
    group: ENERGY_GROUP,
    label: 'Energy to write 1,000 tokens, small models',
    partLabel: 'small',
    unit: ' Wh',
    decimals: 2,
    triple: ENERGY.small,
    explanation:
      "How much electricity a small model uses to write 1,000 tokens. No company publishes this, so the range comes from an open-source estimate based on the model's guessed size.",
    source: 'EcoLogits 0.11.1 (an estimate; 0.11.2 is the newest release)',
    sourceUrl: 'https://ecologits.ai/latest/methodology/llm_inference/',
    checked: CHECKED,
    soft: false,
  },
  medium: {
    group: ENERGY_GROUP,
    label: 'Energy to write 1,000 tokens, mid-size models',
    partLabel: 'mid-size',
    unit: ' Wh',
    decimals: 1,
    triple: ENERGY.medium,
    explanation:
      'How much electricity a mid-size model uses to write 1,000 tokens. Published estimates differ by about ten times, and the range shows that.',
    source:
      'Epoch AI (2025) for the middle, which already includes some data-centre overhead; EcoLogits 0.11.1 for the high end; the low end has thin support',
    sourceUrl: 'https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use',
    checked: CHECKED,
    soft: false,
  },
  large: {
    group: ENERGY_GROUP,
    label: 'Energy to write 1,000 tokens, large models',
    partLabel: 'large',
    unit: ' Wh',
    decimals: 1,
    triple: ENERGY.large,
    explanation:
      'How much electricity a large model uses to write 1,000 tokens. The low end and middle follow a 2026 study of well-run servers, the high end a cautious open-source estimate.',
    source:
      'Oviedo et al., Joule (2026) for the low end and middle, which already include data-centre overhead; EcoLogits 0.11.1 for the high end',
    sourceUrl: 'https://arxiv.org/abs/2509.20241',
    checked: CHECKED,
    soft: false,
  },
  fable: {
    group: ENERGY_GROUP,
    label: 'Energy to write 1,000 tokens, Fable',
    partLabel: 'Fable',
    unit: ' Wh',
    decimals: 1,
    triple: ENERGY.fable,
    explanation:
      // Twice the list price of Opus 4.5 to 5, two and a half times that of Opus 5.5, on the day the prices were read.
      `Fable is treated as a large model with a higher top end, because it costs two to two and a half times as much as Opus (list prices on ${longDate(CHECKED)}) and is thought to be about twice the size. Nobody outside Anthropic has measured it.`,
    source: "Our assumption: twice the large high end. EcoLogits 0.11.2's own formula gives up to 18 Wh",
    sourceUrl: PRICING_PAGE,
    checked: CHECKED,
    soft: true,
  },
  unknown: {
    group: ENERGY_GROUP,
    label: "Energy to write 1,000 tokens, models we don't know",
    partLabel: 'unknown',
    unit: ' Wh',
    decimals: 2,
    triple: ENERGY.unknown,
    explanation:
      'We could not tell how big this model is, so its range runs from the low end of small models to the high end of large ones.',
    source: 'Our assumption: the small low end, the mid-size middle and the large high end',
    sourceUrl: null,
    checked: CHECKED,
    soft: true,
  },
});

export const ASSUMPTION_ROWS: Readonly<Record<Exclude<SliderId, 'energy'>, AssumptionRow>> = deepFreeze({
  freshInput: {
    group: INPUT_GROUP,
    label: 'Reading a new token, compared with writing one',
    unit: '',
    decimals: 2,
    triple: TABLE.freshInput,
    explanation:
      'Reading a token takes far less energy than writing one. Studies put it between 3% and 35%, and it may be more in very long conversations.',
    source:
      "Delavande et al. (2026), Caravaca et al. (2025), Epoch AI (2025). Epoch's own numbers give 0.66 for a 100,000-token input",
    sourceUrl: 'https://arxiv.org/abs/2511.05597',
    checked: CHECKED,
    soft: false,
  },
  cacheWrite: {
    group: INPUT_GROUP,
    label: 'Storing a token for re-use, compared with writing one',
    unit: '',
    decimals: 2,
    triple: TABLE.cacheWrite,
    explanation:
      'Storing text for re-use is assumed to cost about the same as reading it fresh. No published study has measured this.',
    source: 'Our assumption: equal to fresh input, with a top end taken from a price ratio, not from a measurement',
    sourceUrl: PRICING_PAGE,
    checked: CHECKED,
    soft: true,
  },
  cacheRead: {
    group: INPUT_GROUP,
    label: 'Re-reading a stored token, compared with writing one',
    unit: '',
    decimals: 2,
    triple: TABLE.cacheRead,
    explanation:
      'Re-reading stored text is much cheaper than reading it fresh, but only one small study has measured how much. Among the numbers that apply to everyone, this is the least certain: its high value is 100 times its low value.',
    source:
      'The low end and middle follow price ratios. The one measurement (Irminsul, 2026, short texts) implies 0.004 and 0.02 to 0.06',
    sourceUrl: 'https://arxiv.org/abs/2605.05696',
    checked: CHECKED,
    soft: true,
  },
  pue: {
    group: SITE_GROUP,
    label: 'Data-centre overhead',
    unit: '',
    decimals: 2,
    triple: TABLE.pue,
    explanation:
      'Data centres use extra electricity for cooling and power supply: 9% extra at Google, 14% at Amazon and 17% at Microsoft, by their own 2025 reports.',
    source: 'Google, Amazon and Microsoft, 2025 figures for their whole fleets',
    sourceUrl: 'https://datacenters.google/efficiency/',
    checked: CHECKED,
    soft: false,
  },
  grid: {
    group: SITE_GROUP,
    label: 'CO₂ per unit of electricity',
    unit: ' g/kWh',
    decimals: 0,
    triple: TABLE.grid,
    explanation:
      'How much CO2 comes with each unit of electricity. The low end is the Virginia and Carolinas grid, the middle is the US average, and the high end is the world average.',
    source:
      'US EPA eGRID2023 for the low end and middle (power plants only); Ember 2026 for the high end (whole life cycle)',
    sourceUrl: 'https://www.epa.gov/egrid/summary-data',
    checked: CHECKED,
    soft: false,
  },
  hardware: {
    group: SITE_GROUP,
    label: 'Making the hardware, as a factor on top',
    unit: '',
    decimals: 3,
    triple: TABLE.hardware,
    explanation:
      "Making the chips and servers adds roughly a tenth on top, by Google's studies of its own AI hardware.",
    source:
      "Schneider et al. (2025) and Elsworth et al. (2025), both about Google's own hardware. The middle value is our choice",
    sourceUrl: 'https://arxiv.org/abs/2502.01671',
    checked: CHECKED,
    soft: true,
  },
  'hidden:thinking': {
    group: HIDDEN_GROUP,
    label: 'Thinking tokens per second of thinking',
    unit: ' tokens',
    decimals: 0,
    triple: [20, 60, 150],
    explanation:
      'Your export records how long ChatGPT thought before each answer, but not how much it wrote while thinking; we assume 60 tokens for each second, and it could be 20 to 150.',
    source: 'Output speeds measured by Artificial Analysis. The step from seconds to tokens is our assumption',
    sourceUrl: 'https://artificialanalysis.ai/models/gpt-5',
    checked: CHECKED,
    soft: true,
  },
  'hidden:prompt': {
    group: HIDDEN_GROUP,
    label: 'Hidden instructions, tokens each time ChatGPT answers',
    unit: ' tokens',
    decimals: 0,
    triple: [12000, 25000, 35000],
    explanation:
      'Before every answer ChatGPT reads instructions from OpenAI that you never see; copies published by users are about 25,000 tokens long, and we allow 12,000 to 35,000.',
    source: "Copies of ChatGPT's instructions published by users, counted by us. They cannot be verified",
    sourceUrl: 'https://github.com/asgeirtj/system_prompts_leaks',
    checked: CHECKED,
    soft: true,
  },
  'hidden:personal': {
    group: HIDDEN_GROUP,
    label: 'Memory and custom instructions, tokens each time ChatGPT answers',
    unit: ' tokens',
    decimals: 0,
    triple: [500, 3000, 10000],
    explanation:
      'If memory is on, ChatGPT also reads what it has saved about you before every answer; nobody has published how long that is, so 3,000 tokens is our estimate from a few published examples, within 500 to 10,000.',
    source: 'Added up by us from a few published examples. Not a measurement',
    sourceUrl: 'https://embracethered.com/blog/posts/2025/chatgpt-how-does-chat-history-memory-preferences-work/',
    checked: CHECKED,
    soft: true,
  },
  'hidden:search': {
    group: HIDDEN_GROUP,
    label: 'Web text read, tokens per source',
    unit: ' tokens',
    decimals: 0,
    triple: [100, 600, 2500],
    explanation:
      'Your export lists the web sources behind an answer but not the text ChatGPT read from them; we assume 600 tokens per source, and it could be 100 to 2,500.',
    source: 'One official figure: OpenAI bills 8,000 tokens per search on two small models. The rest is our estimate',
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
    checked: CHECKED,
    soft: true,
  },
  'hidden:files': {
    group: HIDDEN_GROUP,
    label: 'Uploaded file with no size in the export, tokens per file',
    unit: ' tokens',
    decimals: 0,
    triple: [500, 5000, 40000],
    explanation:
      'For some of your uploaded files the export does not say how long they are; we assume 5,000 tokens each, within 500 to 40,000.',
    source: 'Our own count of 35 files in four public exports',
    sourceUrl: null,
    checked: CHECKED,
    soft: true,
  },
  'hidden:misses': {
    group: HIDDEN_GROUP,
    label: 'Share of quick replies where re-use fails',
    unit: '',
    decimals: 2,
    triple: [0.02, 0.1, 1.0],
    explanation:
      'When you reply within half an hour, ChatGPT can probably reuse its earlier reading of the conversation instead of reading it afresh; we assume this fails for 1 reply in 10, and it could be anywhere from 1 in 50 to every time.',
    source: 'Our assumption. OpenAI documents re-use for its developer service, not for ChatGPT',
    sourceUrl: 'https://developers.openai.com/api/docs/guides/prompt-caching',
    checked: CHECKED,
    soft: true,
  },
});

/** The order for a tie and for the parts: fable, large, medium, small, unknown. */
export const ENERGY_ORDER: readonly EnergyClass[] = Object.freeze(['fable', 'large', 'medium', 'small', 'unknown'] as const);

const SHARED_SLIDERS = ['freshInput', 'cacheRead', 'pue', 'grid', 'hardware'] as const;

/** The sliders of each tool, in the order the page shows them. ChatGPT shows no cache writes, so it has no slider for them. */
export const SLIDERS: Readonly<Record<SourceId, readonly SliderId[]>> = deepFreeze({
  'claude-code': ['energy', 'freshInput', 'cacheWrite', 'cacheRead', 'pue', 'grid', 'hardware'],
  chatgpt: [
    'energy',
    ...SHARED_SLIDERS,
    'hidden:thinking',
    'hidden:prompt',
    'hidden:personal',
    'hidden:search',
    'hidden:files',
    'hidden:misses',
  ],
});

/** The energy row shown before there is a result: large for Claude Code, mid-size for ChatGPT. */
export const DEFAULT_LEAD: Readonly<Record<SourceId, EnergyClass>> = Object.freeze({ 'claude-code': 'large', chatgpt: 'medium' });

export const NOTE_SWITCHED_OFF = 'This is switched off in your result.';
export const NOTE_NO_EFFECT = 'This changes nothing for your data.';

// The car figure has no slider, so its source line is fixed text of the page. Its two links are kept
// here, with the other sources, so one list holds every source address the site may carry.
const CAR_SOURCE_LINKS = [
  'https://www.eea.europa.eu/en/datahub/datahubitem-view/fa8b1229-3db6-495d-b18e-9c9b3267c02b',
  'https://theicct.org/publication/real-world-co2-emission-values-vehicles-europe-jun26/',
] as const;

function sourceLinks(): string[] {
  const links = new Set<string>();
  for (const row of [...Object.values(ENERGY_ROWS), ...Object.values(ASSUMPTION_ROWS)]) {
    if (row.sourceUrl !== null) links.add(row.sourceUrl);
  }
  for (const link of CAR_SOURCE_LINKS) links.add(link);
  return [...links];
}

/** Every `sourceUrl` and the two links of the car's source line, each once. */
export const SOURCE_LINKS: readonly string[] = Object.freeze(sourceLinks());

/**
 * The full citation of each row, for the project's documentation. NOT for the page: these hold web
 * addresses that the built site must not carry. Nothing the page loads may import this.
 */
export const CITATIONS: Readonly<Record<`energy:${EnergyClass}` | Exclude<SliderId, 'energy'>, string>> = {
  'energy:small':
    'Rincé, S. and Banse, A. (2025). EcoLogits: Evaluating the Environmental Impacts of Generative AI. Journal of Open Source Software 10(111), 7471. https://doi.org/10.21105/joss.07471',
  'energy:medium':
    'You, J. (7 Feb 2025). How much energy does ChatGPT use? Epoch AI, Gradient Updates. Also EcoLogits as above, and Chung, J.-W. et al. (2026). Where Do the Joules Go? arXiv:2601.22076. https://arxiv.org/abs/2601.22076',
  'energy:large':
    'Oviedo, F., Kazhamiaka, F., Choukse, E., Kim, A., Luers, A., Nakagawa, M., Bianchini, R. and Lavista Ferres, J. M. (2026). Energy use of AI inference, efficiency pathways, and test-time scaling. Joule 10(8), 102430. https://doi.org/10.1016/j.joule.2026.102430',
  'energy:fable': 'Anthropic, Pricing (list prices); EcoLogits as above.',
  'energy:unknown': '',
  freshInput:
    'Caravaca, F., Cuevas, Á. and Cuevas, R. (2025). From Prompts to Power: Measuring the Energy Footprint of LLM Inference. arXiv:2511.05597. Delavande, J., Pierrard, R. and Luccioni, S. (2026). Small Talk, Big Impact: The Energy Cost of Thanking AI. arXiv:2601.22357. https://arxiv.org/abs/2601.22357 . You, J. (2025), as above.',
  cacheWrite: 'Anthropic, Pricing (cache write at 1.25 times the input price).',
  cacheRead:
    'Ma, B., Eitzinger, J. and Köstler, H. (2026). Irminsul: MLA-Native Position-Independent Caching for Agentic LLM Serving. arXiv:2605.05696. Anthropic, Pricing (cache read at 0.1 times the input price).',
  pue: 'Google, Data center efficiency. Amazon (2026), 2025 Amazon Sustainability Report: AWS Summary, https://sustainability.aboutamazon.com/2025-aws-summary.pdf . Microsoft, Measuring energy and water efficiency for Microsoft datacenters, https://datacenters.microsoft.com/sustainability/efficiency/',
  grid: 'US EPA (2025). eGRID2023 Summary Tables, revision 2. Fulghum, N., Altieri, K., Rangelova, K. and Suarez, W. (21 Apr 2026). Global Electricity Review 2026. Ember. https://ember-energy.org/latest-insights/global-electricity-review-2026/',
  hardware:
    'Schneider, I. et al. (2025). Life-Cycle Emissions of AI Hardware: A Cradle-To-Grave Approach and Generational Trends. arXiv:2502.01671. Elsworth, C. et al. (2025). Measuring the environmental impact of delivering AI at Google Scale. arXiv:2508.15734. https://arxiv.org/abs/2508.15734',
  'hidden:thinking':
    'Artificial Analysis, model pages for the GPT-5.5, GPT-5.6 and GPT-6 families (about 40 to 160 output tokens per second).',
  'hidden:prompt': 'the folder `OpenAI` in that collection, and https://github.com/jujumilk3/leaked-system-prompts .',
  'hidden:personal': 'that write-up, and the memory block inside the published instructions above.',
  'hidden:search': 'OpenAI, API pricing, "search content tokens".',
  'hidden:files': '',
  'hidden:misses': 'OpenAI, Prompt caching guide.',
};

const ALL_SLIDERS: ReadonlySet<string> = new Set(['energy', ...Object.keys(ASSUMPTION_ROWS)]);

export function isSliderId(id: string): id is SliderId {
  return ALL_SLIDERS.has(id);
}

/** The row a slider shows. `lead` only matters for "energy". */
export function rowOf(id: SliderId, lead: EnergyClass): AssumptionRow {
  return id === 'energy' ? ENERGY_ROWS[lead] : ASSUMPTION_ROWS[id];
}

/**
 * Which size's row the energy slider shows. `kg` is the kilograms per size with every assumption at
 * typical and no slider set. A size with no entry or 0 is not used.
 *
 * While the slider is set and its size is still used, the size stays: the store keeps a track position,
 * and reading that position with another size's row would move the setting on its own. Otherwise the
 * used size with the most kg leads, a tie by ENERGY_ORDER. With nothing used, `current` stays.
 */
export function leadSize(current: EnergyClass, energyIsSet: boolean, kg: ReadonlyMap<EnergyClass, number>): EnergyClass {
  const used = (size: EnergyClass): number => {
    const amount = kg.get(size);
    return amount !== undefined && amount > 0 ? amount : 0;
  };
  if (energyIsSet && used(current) > 0) return current;
  let lead = current;
  let most = 0;
  for (const size of ENERGY_ORDER) {
    // Strictly more, so the first of a tie keeps the lead.
    if (used(size) > most) {
      lead = size;
      most = used(size);
    }
  }
  return lead;
}

/** What the method section needs to know about this person to list the sliders. */
export interface SliderFacts {
  /** null before a tool is chosen: the seven sliders of Claude Code are shown. */
  readonly source: SourceId | null;
  /** The sliders the person has set, as track positions. Ids the tool does not have are ignored. */
  readonly pins: Readonly<Partial<Record<SliderId, number>>>;
  readonly lead: EnergyClass;
  /** The sizes the person used, in any order. Empty before there is a result: no parts then. */
  readonly used: readonly EnergyClass[];
  /** `Estimate.inert`. Empty before there is a result. */
  readonly inert: readonly string[];
  /** Pieces of hidden work that are switched off. */
  readonly off: readonly HiddenId[];
  /** Pieces with nothing to count. Their sliders are left out. Empty before there is a result. */
  readonly absent: readonly HiddenId[];
}

const HIDDEN_IDS: readonly HiddenId[] = ['thinking', 'prompt', 'personal', 'search', 'files', 'misses'];

/** The piece of hidden work a slider belongs to. null for the seven sliders every tool has. */
function hiddenIdOf(id: SliderId): HiddenId | null {
  return HIDDEN_IDS.find((piece) => id === `hidden:${piece}`) ?? null;
}

/** One part per used size, the lead first. null with fewer than two used sizes: the slider then stands for one value. */
function energyParts(facts: SliderFacts, position: number | undefined): AssumptionPart[] | null {
  if (facts.used.length < 2) return null;
  const sizes = [facts.lead, ...ENERGY_ORDER.filter((size) => size !== facts.lead && facts.used.includes(size))];
  return sizes.map((size) => {
    const row = ENERGY_ROWS[size];
    const [low, typical, high] = row.triple;
    return { label: row.partLabel, low, typical, high, value: valueAt(row.triple, position ?? 0.5), decimals: row.decimals };
  });
}

/** `MethodView.assumptions`: the tool's sliders in their order, each as the page draws it. */
export function assumptionViews(facts: SliderFacts): AssumptionView[] {
  const views: AssumptionView[] = [];
  for (const id of SLIDERS[facts.source ?? 'claude-code']) {
    const piece = hiddenIdOf(id);
    if (piece !== null && facts.absent.includes(piece)) continue;

    const row = rowOf(id, facts.lead);
    const [low, typical, high] = row.triple;
    const position = Object.hasOwn(facts.pins, id) ? facts.pins[id] : undefined;

    // "Off" before "no effect": the estimator lists a switched-off piece's slider as one that changes nothing, too.
    let note: string | null = null;
    if (piece !== null && facts.off.includes(piece)) note = NOTE_SWITCHED_OFF;
    else if (facts.inert.includes(id)) note = NOTE_NO_EFFECT;

    const view: AssumptionView = {
      id,
      group: row.group,
      label: row.label,
      unit: row.unit,
      decimals: row.decimals,
      low,
      typical,
      high,
      value: position === undefined ? typical : valueAt(row.triple, position),
      pinned: position !== undefined,
      explanation: row.explanation,
      note,
      source: row.source,
      sourceUrl: row.sourceUrl,
      checked: row.checked,
      soft: row.soft,
    };
    const parts = id === 'energy' ? energyParts(facts, position) : null;
    if (parts !== null) view.parts = parts;
    views.push(view);
  }
  return views;
}
