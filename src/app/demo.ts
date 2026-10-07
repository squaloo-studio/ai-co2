// EXAMPLE DATA ONLY. A stand-in Store, so the page can be seen and tested before the real logic exists.
// Every amount of use and every kilogram in this file is made up, and none of the maths here is the
// real method. The sentences, the assumptions with their sources and the three providers with their
// prices are the real ones, so the page can be read as it will be. The real Store replaces this file.

import type { Action, Store } from '../contracts/store';
import type { SourceId, Spread } from '../contracts/usage';
import type {
  AssumptionPart,
  AssumptionView,
  ContributeView,
  MassUnit,
  MethodView,
  ModelRow,
  ResultView,
  Rich,
  SourceStatus,
  Stage,
  SwitchView,
  TipView,
  View,
} from '../contracts/view';
import { longDate, mass, massRange, massSpan, massWithUnit, money, monthYear, printsSame, shortDate, tokenCount } from '../format';
import { nextScale, type ChartScale } from '../model/estimate';
import { carPlace } from '../model/places';
import { NO_USAGE_OTHER_CAUSES, PROMPT, readAnswer, SHORT_DATA_USUAL_CAUSE, type AnswerOk } from '../sources/claude-code';
import { classifyModel } from '../sources/models';
import { positionOf, valueAt, type Triple } from '../track';

export const SCENARIOS = ['choose', 'cc-steps', 'cc-problem', 'cc-done', 'gpt-steps', 'gpt-loading', 'gpt-problem', 'gpt-done'] as const;
export type Scenario = (typeof SCENARIOS)[number];

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Puts the page's "example data" labels on screen: a bar above the header and a tag in the result
 * card. They are built here and are not in index.html, so the published page, which never loads this
 * file, cannot hold them. Made-up figures must never pass for the visitor's own.
 */
export function showExampleLabels(page: Document = document): void {
  if (page.querySelector('[data-example]')) return;

  const bar = page.createElement('p');
  bar.className = 'example-bar';
  bar.setAttribute('data-example', '');
  const line = page.createElement('span');
  line.className = 'wrap';
  const lead = page.createElement('b');
  lead.textContent = 'Example data.';
  line.append(lead, ' Every figure on this page is made up to show how it works. None of it is your own use.');
  bar.append(line);
  page.body.insertBefore(bar, page.querySelector('header.site')?.parentElement ?? page.body.firstChild);

  const tag = page.createElement('p');
  tag.className = 'tag tag--example';
  tag.setAttribute('data-example', '');
  const icon = page.createElementNS(SVG, 'svg');
  icon.setAttribute('class', 'i i-s');
  icon.setAttribute('aria-hidden', 'true');
  const use = page.createElementNS(SVG, 'use');
  use.setAttribute('href', '#i-typical');
  icon.append(use);
  const words = page.createElement('span');
  words.textContent = 'Example figures, not yours';
  tag.append(icon, words);
  // Right under the line that names the range, on every screen. The row of the other tags moves
  // below the switches on a narrow screen, a screen away from the figures this tag is about.
  page.querySelector('[data-summary-line]')?.after(tag);
}

/** The scenario named in the address (?demo=cc-done). Anything else gives the first visit. */
export function scenarioFrom(name: string | null | undefined): Scenario {
  return SCENARIOS.find(s => s === name) ?? 'choose';
}

// ---------- made-up numbers ----------

/** The example's own "today". A fixed day, so the example answer below never turns old or lies in the future. */
const TODAY = '2026-10-07';
const BASE: Record<SourceId, Spread> = {
  'claude-code': { p5: 3.7, mid: 9.8, p95: 34 },
  chatgpt: { p5: 0.6, mid: 1.8, p95: 6.5 },
};
const HISTORY: Spread = { p5: 16, mid: 42, p95: 130 };
const KG_PER_KM = 0.16;
const PERIOD = { from: '2026-09-08', to: TODAY };
const CONVERSATIONS = 1284;
const EXPORT_BYTES = 96_300_000;
/** The grid's middle value against the market-based 70 g/kWh. */
const MARKET = 70 / 350;

const MODEL_LINES = [
  ['claude-opus-5-5', 2184390, 21662104, 548310227, 4106552],
  ['claude-sonnet-5-5', 911204, 8904117, 172556093, 1380961],
  ['claude-haiku-4-5', 1002387, 1240008, 18771460, 402113],
] as const;

/** An answer in the format the counting script prints: a header with the window and the days that had data, one line per model, and the total. */
export const SAMPLE_ANSWER = [
  `ai-co2 v1 | ${PERIOD.from} to ${PERIOD.to} | data ${PERIOD.from} to ${PERIOD.to}`,
  ...MODEL_LINES.map(([model, fresh, write, read, out]) => `${model} | in ${fresh} | cache_write ${write} | cache_read ${read} | out ${out}`),
  `total | ${MODEL_LINES.reduce((sum, [, ...counts]) => sum + counts.reduce((a, b) => a + b, 0), 0)}`,
].join('\n');

const PROSE_ANSWER =
  'Here’s your Claude Code usage for the last 30 days:\n\n- Opus 5.5: about 576 million tokens, mostly cache reads\n- Sonnet 5.5: about 184 million tokens\n- Haiku 4.5: about 21 million tokens';

// ---------- the real sentences ----------

const NOT_EXPORT_FILES = 'None of these files is a ChatGPT export. Drop the ZIP file you downloaded from OpenAI, or the conversations.json files from inside it.';
const TOO_MANY_FILES = 'That is more than 20 files. Drop the export ZIP on its own, or only the conversations files from inside it.';
const NOT_AN_EXPORT = "This ZIP isn't a ChatGPT export: it has no conversations file. Download the export from OpenAI's message again, and drop that file.";

const FORMULA = 'CO₂ = tokens × weight × energy per token × overhead × grid × hardware';
const SLIDER_NOTE = 'Move a slider to set that assumption yourself: until you reset it, the page uses your value in every run instead of varying it between low and high.';
const SWITCHED_OFF = 'This is switched off in your result.';

const COUNTED_SHARED = ['Data-centre overhead and the electricity grid.', 'Making the hardware, about 10–13% on top.'];
const COUNTED: Record<SourceId, string[]> = {
  'claude-code': [
    'Every token Claude Code logged on this computer in the 30 days, by model and type: fresh input, cache writes, cache reads and output. Thinking is part of output.',
    'Advisor calls, compaction steps and attempts that a model declined, where the logs show them.',
    ...COUNTED_SHARED,
  ],
  chatgpt: [
    'Counted from your export: what you wrote, what ChatGPT answered, and every time it read the conversation again. Edited questions and regenerated answers count too.',
    'Estimated on top: thinking, hidden instructions, memory, web pages and files. You can switch each group off.',
    'One more estimate has no switch: how often ChatGPT cannot reuse an earlier reading of the conversation. Its slider is below.',
    ...COUNTED_SHARED,
  ],
};
const LEFT_OUT_SHARED = [
  'Water. Published figures differ by more than ten times, so any number would mislead.',
  'Training the models, and the research runs before training.',
  'Your own device, and the networks between it and the data centre.',
  'Idle spare machines and data storage.',
  'Power-line losses, and making the fuel for power plants, at the low and middle grid values.',
];
const LEFT_OUT: Record<SourceId, string[]> = {
  'claude-code': [...LEFT_OUT_SHARED, 'Claude Code use on other computers, in cloud sessions and over SSH.', 'Requests Claude Code makes in the background, where it does not log them.'],
  chatgpt: [
    ...LEFT_OUT_SHARED,
    'Generated images, deep research and agent runs, and the audio of voice chats.',
    'Temporary and deleted chats. They are not in the export.',
    'The instructions and files of custom GPTs and projects.',
    'Thinking in answers from instant models, which show no thinking time.',
    'About 1 web search in 10. Current exports do not show them.',
  ],
};
const FIXED_ASSUMPTIONS = [
  'The whole-history line uses today’s energy and grid values for use from years ago. The hidden instructions are counted smaller for earlier years.',
  'We assume ChatGPT reuses its earlier reading when you reply within 30 minutes. OpenAI documents this for its developer service, not for ChatGPT.',
  'We assume ChatGPT keeps at most about 34,000 tokens of earlier conversation for instant models and 236,000 for thinking models on a paid plan, and 7,000 on the free plan. OpenAI publishes the total window, not this share.',
  "We count each image you sent with OpenAI's published rule for developers at its 'high' setting. ChatGPT's own setting is not published; a large photo may have cost up to five times more.",
  'We count the hidden instructions as text ChatGPT can reuse, even on the first message of a chat. If it reads them afresh each time, this part is about three times larger.',
];

/** How the "matters most" sentence names each slider. */
const NAMES: Record<string, string> = {
  energy: 'energy per token',
  cacheRead: 'the weight of a cache read',
  cacheWrite: 'the weight of a cache write',
  freshInput: 'the weight of fresh input',
  grid: 'the grid',
  pue: 'data-centre overhead',
  hardware: 'the hardware factor',
  'hidden:thinking': 'how much ChatGPT writes while thinking',
  'hidden:prompt': 'the length of ChatGPT’s hidden instructions',
  'hidden:personal': 'the length of ChatGPT’s memory',
  'hidden:search': 'how much web text ChatGPT reads',
  'hidden:files': 'the length of your uploaded files',
  'hidden:misses': 'how often ChatGPT cannot reuse an earlier reading',
};

// ---------- the assumptions ----------

interface Row {
  label: string;
  decimals: number;
  values: Triple;
  explanation: string;
  source: string;
  sourceUrl: string | null;
  soft: boolean;
}

interface DemoSlider extends Row {
  id: string;
  group: string;
  unit: string;
  /** MADE UP: what the example result is multiplied by with the assumption at its low and at its high value. */
  effect: [number, number];
  /** The hidden-work switch this slider belongs to. Switched off, the slider changes nothing. */
  piece?: string;
}

const CHECKED = '2026-10-07';
const ECOLOGITS = 'https://ecologits.ai/latest/methodology/llm_inference/';

/** The energy slider stands for one row per model size. The lead size's row is the one it shows. */
const ENERGY: Record<'small' | 'mid-size' | 'large', Row> = {
  small: {
    label: 'Energy to write 1,000 tokens, small models', decimals: 2, values: [0.05, 0.1, 0.4],
    explanation: 'How much electricity a small model uses to write 1,000 tokens. No company publishes this, so the range comes from an open-source estimate based on the model’s guessed size.',
    source: 'EcoLogits 0.11.1 (an estimate; 0.11.2 is the newest release)', sourceUrl: ECOLOGITS, soft: false,
  },
  'mid-size': {
    label: 'Energy to write 1,000 tokens, mid-size models', decimals: 1, values: [0.2, 0.6, 2.2],
    explanation: 'How much electricity a mid-size model uses to write 1,000 tokens. Published estimates differ by about ten times, and the range shows that.',
    source: 'Epoch AI (2025) for the middle, which already includes some data-centre overhead; EcoLogits 0.11.1 for the high end; the low end has thin support',
    sourceUrl: 'https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use', soft: false,
  },
  large: {
    label: 'Energy to write 1,000 tokens, large models', decimals: 1, values: [0.5, 1.0, 5.4],
    explanation: 'How much electricity a large model uses to write 1,000 tokens. The low end and middle follow a 2026 study of well-run servers, the high end a cautious open-source estimate.',
    source: 'Oviedo et al., Joule (2026) for the low end and middle, which already include data-centre overhead; EcoLogits 0.11.1 for the high end',
    sourceUrl: 'https://arxiv.org/abs/2509.20241', soft: false,
  },
};
type Size = keyof typeof ENERGY;
/** The lead size first. With a result, the example person has used all of a tool's sizes. */
const SIZES: Record<SourceId, Size[]> = { 'claude-code': ['large', 'mid-size', 'small'], chatgpt: ['mid-size', 'small'] };

const INPUT = 'Input and cache';
const PLANT = 'Data centre, grid and hardware';
const HIDDEN_GROUP = 'Hidden work in ChatGPT';

const SLIDERS: DemoSlider[] = [
  { id: 'energy', group: 'Energy', unit: ' Wh', effect: [0.55, 3.2], ...ENERGY.large },
  {
    id: 'freshInput', group: INPUT, unit: '', effect: [0.95, 1.08],
    label: 'Reading a new token, compared with writing one', decimals: 2, values: [0.03, 0.15, 0.35],
    explanation: 'Reading a token takes far less energy than writing one. Studies put it between 3% and 35%, and it may be more in very long conversations.',
    source: 'Delavande et al. (2026), Caravaca et al. (2025), Epoch AI (2025). Epoch’s own numbers give 0.66 for a 100,000-token input',
    sourceUrl: 'https://arxiv.org/abs/2511.05597', soft: false,
  },
  {
    id: 'cacheWrite', group: INPUT, unit: '', effect: [0.96, 1.1],
    label: 'Storing a token for re-use, compared with writing one', decimals: 2, values: [0.03, 0.15, 0.45],
    explanation: 'Storing text for re-use is assumed to cost about the same as reading it fresh. No published study has measured this.',
    source: 'Our assumption: equal to fresh input, with a top end taken from a price ratio, not from a measurement',
    sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing', soft: true,
  },
  {
    id: 'cacheRead', group: INPUT, unit: '', effect: [0.47, 3.0],
    label: 'Re-reading a stored token, compared with writing one', decimals: 2, values: [0.001, 0.015, 0.1],
    explanation: 'Re-reading stored text is much cheaper than reading it fresh, but only one small study has measured how much. Among the numbers that apply to everyone, this is the least certain: its high value is 100 times its low value.',
    source: 'The low end and middle follow price ratios. The one measurement (Irminsul, 2026, short texts) implies 0.004 and 0.02 to 0.06',
    sourceUrl: 'https://arxiv.org/abs/2605.05696', soft: true,
  },
  {
    id: 'pue', group: PLANT, unit: '', effect: [0.96, 1.03],
    label: 'Data-centre overhead', decimals: 2, values: [1.09, 1.14, 1.17],
    explanation: 'Data centres use extra electricity for cooling and power supply: 9% extra at Google, 14% at Amazon and 17% at Microsoft, by their own 2025 reports.',
    source: 'Google, Amazon and Microsoft, 2025 figures for their whole fleets', sourceUrl: 'https://datacenters.google/efficiency/', soft: false,
  },
  {
    id: 'grid', group: PLANT, unit: ' g/kWh', effect: [0.77, 1.31],
    label: 'CO₂ per unit of electricity', decimals: 0, values: [270, 350, 460],
    explanation: 'How much CO2 comes with each unit of electricity. The low end is the Virginia and Carolinas grid, the middle is the US average, and the high end is the world average.',
    source: 'US EPA eGRID2023 for the low end and middle (power plants only); Ember 2026 for the high end (whole life cycle)',
    sourceUrl: 'https://www.epa.gov/egrid/summary-data', soft: false,
  },
  {
    id: 'hardware', group: PLANT, unit: '', effect: [0.99, 1.01],
    label: 'Making the hardware, as a factor on top', decimals: 3, values: [1.1, 1.115, 1.13],
    explanation: 'Making the chips and servers adds roughly a tenth on top, by Google’s studies of its own AI hardware.',
    source: 'Schneider et al. (2025) and Elsworth et al. (2025), both about Google’s own hardware. The middle value is our choice',
    sourceUrl: 'https://arxiv.org/abs/2502.01671', soft: true,
  },
  {
    id: 'hidden:thinking', group: HIDDEN_GROUP, unit: ' tokens', effect: [0.8, 1.5], piece: 'thinking',
    label: 'Thinking tokens per second of thinking', decimals: 0, values: [20, 60, 150],
    explanation: 'Your export records how long ChatGPT thought before each answer, but not how much it wrote while thinking; we assume 60 tokens for each second, and it could be 20 to 150.',
    source: 'Output speeds measured by Artificial Analysis. The step from seconds to tokens is our assumption',
    sourceUrl: 'https://artificialanalysis.ai/models/gpt-5', soft: true,
  },
  {
    id: 'hidden:prompt', group: HIDDEN_GROUP, unit: ' tokens', effect: [0.93, 1.15], piece: 'instructions-memory',
    label: 'Hidden instructions, tokens each time ChatGPT answers', decimals: 0, values: [12000, 25000, 35000],
    explanation: 'Before every answer ChatGPT reads instructions from OpenAI that you never see; copies published by users are about 25,000 tokens long, and we allow 12,000 to 35,000.',
    source: 'Copies of ChatGPT’s instructions published by users, counted by us. They cannot be verified',
    sourceUrl: 'https://github.com/asgeirtj/system_prompts_leaks', soft: true,
  },
  {
    id: 'hidden:personal', group: HIDDEN_GROUP, unit: ' tokens', effect: [0.97, 1.1], piece: 'instructions-memory',
    label: 'Memory and custom instructions, tokens each time ChatGPT answers', decimals: 0, values: [500, 3000, 10000],
    explanation: 'If memory is on, ChatGPT also reads what it has saved about you before every answer; nobody has published how long that is, so 3,000 tokens is our estimate from a few published examples, within 500 to 10,000.',
    source: 'Added up by us from a few published examples. Not a measurement',
    sourceUrl: 'https://embracethered.com/blog/posts/2025/chatgpt-how-does-chat-history-memory-preferences-work/', soft: true,
  },
  {
    id: 'hidden:search', group: HIDDEN_GROUP, unit: ' tokens', effect: [0.95, 1.2], piece: 'search-files',
    label: 'Web text read, tokens per source', decimals: 0, values: [100, 600, 2500],
    explanation: 'Your export lists the web sources behind an answer but not the text ChatGPT read from them; we assume 600 tokens per source, and it could be 100 to 2,500.',
    source: 'One official figure: OpenAI bills 8,000 tokens per search on two small models. The rest is our estimate',
    sourceUrl: 'https://developers.openai.com/api/docs/pricing', soft: true,
  },
  {
    id: 'hidden:files', group: HIDDEN_GROUP, unit: ' tokens', effect: [0.98, 1.1], piece: 'search-files',
    label: 'Uploaded file with no size in the export, tokens per file', decimals: 0, values: [500, 5000, 40000],
    explanation: 'For some of your uploaded files the export does not say how long they are; we assume 5,000 tokens each, within 500 to 40,000.',
    source: 'Our own count of 35 files in four public exports', sourceUrl: null, soft: true,
  },
  {
    id: 'hidden:misses', group: HIDDEN_GROUP, unit: '', effect: [0.97, 1.4],
    label: 'Share of quick replies where re-use fails', decimals: 2, values: [0.02, 0.1, 1.0],
    explanation: 'When you reply within half an hour, ChatGPT can probably reuse its earlier reading of the conversation instead of reading it afresh; we assume this fails for 1 reply in 10, and it could be anywhere from 1 in 50 to every time.',
    source: 'Our assumption. OpenAI documents re-use for its developer service, not for ChatGPT',
    sourceUrl: 'https://developers.openai.com/api/docs/guides/prompt-caching', soft: true,
  },
];

/** The sliders a tool shows, in order. ChatGPT has no cache writes, and only ChatGPT has hidden work. */
function slidersFor(source: SourceId | null): DemoSlider[] {
  return SLIDERS.filter(s => (source === 'chatgpt' ? s.id !== 'cacheWrite' : !s.id.startsWith('hidden:'))).map(s =>
    s.id === 'energy' ? { ...s, ...ENERGY[source === 'chatgpt' ? 'mid-size' : 'large'] } : s,
  );
}

// ---------- the switches and the tips ----------

/** Hidden work in ChatGPT, and the plan. MADE UP: switching one off scales the range by `factor`. */
const SWITCHES = [
  { id: 'thinking', label: 'Thinking', note: 'Set from your export', noteIcon: 'export', factor: 0.82 },
  { id: 'instructions-memory', label: 'Hidden instructions and memory', note: 'Typical setting', noteIcon: 'typical', factor: 0.93 },
  { id: 'search-files', label: 'Search results and file contents', note: 'Set from your export', noteIcon: 'export', factor: 0.9 },
  { id: 'plan-paid', label: 'Plus or Pro plan', note: 'Set from your export', noteIcon: 'export', factor: 0.75 },
] as const;

interface DemoTip {
  id: string;
  /** MADE UP: what the range is multiplied by with this tip alone. */
  factor: number;
  title: string;
  lead: string;
  label: string;
  afterLabel: string;
  how: Rich;
}

const shareWords = (share: number): string | null => {
  const pct = Math.round((share * 100) / 5) * 5;
  if (pct < 10) return null;
  return pct >= 95 ? 'Almost all' : `About ${pct}%`;
};

function claudeCodeTips(answer: AnswerOk, models: readonly ModelRow[]): DemoTip[] {
  const tips: DemoTip[] = [];
  const opus = models.filter(row => row.name.startsWith('Opus'));
  const [first] = opus;
  if (first) {
    const name = opus.length === 1 ? first.name : 'Opus models';
    const share = shareWords(opus.reduce((sum, row) => sum + row.share, 0));
    tips.push({
      id: 'cc-opus-to-sonnet',
      factor: 0.84,
      title: share ? `${share} of your estimate comes from ${name}` : `Part of your estimate comes from ${name}`,
      lead: `Moving half of your ${opus.length === 1 ? first.name : 'Opus'} work to Sonnet`,
      label: 'Sonnet for half of your Opus work',
      afterLabel: 'Sonnet',
      how: [
        'Type ', { code: '/model sonnet' }, ' for routine work and ', { code: '/model opus' },
        ' for a hard problem. Each choice also becomes your default for new sessions. Switch at the start of a task: after a switch, Claude reads the whole conversation again without its cache.',
      ],
    });
  }
  const reads = answer.usage.models.reduce((sum, row) => sum + row.cacheRead, 0);
  if (reads > 0) {
    const pct = Math.round((reads / answer.total) * 100);
    tips.push({
      id: 'cc-clear',
      factor: 0.8,
      title: `${pct >= 99 ? 'Almost all' : pct >= 50 ? `${pct}%` : tokenCount(reads)} of your tokens are earlier text being read again`,
      lead: 'A third less re-reading',
      label: 'A third less re-reading',
      afterLabel: 'Less re-reading',
      how: [
        'Type ', { code: '/clear' },
        ' when you switch to an unrelated task. Claude Code then starts a new conversation, so there is less to read again at every step. To stay on the same task with a shorter history, type ',
        { code: '/compact' }, ' at a natural break in your work.',
      ],
    });
  }
  return tips;
}

const CHATGPT_TIPS: DemoTip[] = [
  {
    id: 'gpt-less-thinking',
    factor: 0.93,
    title: 'ChatGPT thought for about 25 minutes before its answers',
    lead: 'Half as much thinking',
    label: 'Half as much thinking',
    afterLabel: 'Less thinking',
    how: [
      'For everyday questions, pick ', { strong: 'Instant' }, '. On paid plans, the ', { strong: 'Thinking' },
      ' slider sets how much ChatGPT thinks. On Free and Go, use ', { strong: 'Think' }, ' only for harder questions.',
    ],
  },
  {
    id: 'gpt-shorter-answers',
    factor: 0.95,
    title: `ChatGPT wrote ${tokenCount(1_240_000)} tokens for you`,
    lead: 'Answers a quarter shorter',
    label: 'Answers a quarter shorter',
    afterLabel: 'Shorter answers',
    how: [
      'In ', { strong: 'Settings' }, ', select ', { strong: 'Personalization' }, ' (in the phone app: ', { strong: 'Customize ChatGPT' }, '). In the ',
      { strong: 'Custom Instructions' }, ' field, add a line such as “Keep answers short unless I ask for detail.”',
    ],
  },
];

/** A saving in words: "roughly 0.8–6.9 kg a month". null when it prints as nothing. */
function savingWords(saving: Spread, unit: MassUnit): string | null {
  const high = mass(Math.max(0, saving.p95), unit);
  if (high === '0') return null;
  const period = ' a month';
  if (!(saving.p5 > 0) || massWithUnit(saving.p5).startsWith('0 ')) return `between nothing and roughly ${high} ${unit}${period}`;
  const low = mass(saving.p5, unit);
  if (low === '0') return `roughly ${massSpan(saving.p5, saving.p95)}${period}`;
  if (low === high) return `about ${high} ${unit}${period}`;
  return `roughly ${low}–${high} ${unit}${period}`;
}

// ---------- the three options ----------

const PRICES = { climeworksPerTonne: 500, forTomorrowPerTonne: 114, forTomorrowMin: 5, effektivMin: 10, checked: '2026-10-07' };
const FOR_TOMORROW_MIN_KG = 10 * Math.floor((PRICES.forTomorrowMin * 100) / PRICES.forTomorrowPerTonne);

const cleanKg = (kg: number) => Math.round(kg * 1000) / 1000;
/** Climeworks counts in whole kilograms. The order is rounded up, so nobody funds less than the estimate. */
function climeworksCost(kg: number): number | null {
  if (!(kg > 0)) return null;
  return (Math.max(1, Math.ceil(cleanKg(kg))) * PRICES.climeworksPerTonne) / 1000;
}
/** ForTomorrow's form counts in steps of 10 kg and in whole euros, and never takes less than its minimum. */
function forTomorrowCost(kg: number): number | null {
  if (!(kg > 0)) return null;
  const steps = Math.max(1, Math.ceil(cleanKg(kg) / 10));
  const euros = Math.max(PRICES.forTomorrowMin, Math.ceil((steps * PRICES.forTomorrowPerTonne) / 100));
  return euros > 999999 ? Infinity : euros;
}

const PER_KG: Record<MassUnit, number> = { kg: 1, g: 1000, mg: 1_000_000 };
/** The kilograms the reader sees: the printed number, read back in the shown unit. */
const printedKg = (kg: number, unit: MassUnit) => Number(mass(kg, unit).replace(/,/g, '')) / PER_KG[unit];

function costs(rule: (kg: number) => number | null, range: Spread, unit: MassUnit): [number, number, number] | null {
  const priced = (kg: number) => rule(printedKg(kg, unit)) ?? rule(kg);
  const [low, mid, high] = [priced(range.p5), priced(range.mid), priced(range.p95)];
  return low === null || mid === null || high === null ? null : [low, mid, high];
}

const NO_PRICE = 'See their site for the price.';

function climeworksWords(range: Spread, unit: MassUnit): string {
  const tax = 'Plus tax where it applies.';
  if (printedKg(range.p95, unit) < 1) {
    return `$${money(PRICES.climeworksPerTonne / 1000)} for 1 kg. Climeworks counts in whole kilograms, and your range is below 1 kg. ${tax}`;
  }
  const c = costs(climeworksCost, range, unit);
  if (!c) return NO_PRICE;
  if (c[0] === c[2]) return `About $${money(c[0])}. ${tax}`;
  return `$${money(c[0])}–${money(c[2])}. At the middle estimate: $${money(c[1])}. ${tax}`;
}

function forTomorrowWords(range: Spread, unit: MassUnit): string {
  const c = costs(forTomorrowCost, range, unit);
  if (!c) return NO_PRICE;
  const min = PRICES.forTomorrowMin;
  if (c.some(cost => !Number.isFinite(cost))) return 'More than their form accepts.';
  if (c.every(cost => cost === min)) return `€${money(min)}. That is their minimum. On their form it covers up to ${FOR_TOMORROW_MIN_KG} kg.`;
  if (c[0] === c[2]) return `About €${money(c[0])}.`;
  const both = `€${money(c[0])}–${money(c[2])}. At the middle estimate: €${money(c[1])}.`;
  return c[0] === min ? `${both} €${money(min)} is their minimum.` : both;
}

function contributeFor(range: Spread, unit: MassUnit, single: boolean): ContributeView {
  const checked = longDate(PRICES.checked);
  const size = single || printsSame(range.p5, range.p95, unit) ? `about ${mass(range.mid, unit)} ${unit}` : massRange(range, unit);
  return {
    costSentence: `Each option shows below what it would cost for ${size} of CO₂, the size of your estimate. They do different things, so the three costs cannot be compared.`,
    options: [
      {
        id: 'climeworks', kind: 'Lasting removal', name: 'Climeworks',
        price: `${PRICES.climeworksPerTonne} US dollars per tonne of CO₂, which is ${PRICES.climeworksPerTonne / 10} cents per kilogram. Tax may be added at checkout. Price on ${checked}.`,
        minimum: 'Climeworks states none. It counts in whole kilograms.',
        whatYouGet:
          'You pay now, and Climeworks delivers later: it says within 7 years after the year you buy. Paying today does not take CO₂ out of the air today. This is its “Technology focus” portfolio, which Climeworks describes as 100% technology-based. You get an order confirmation and an invoice, and after delivery a delivery note and a certificate. This is a purchase, not a donation.',
        forYourRange: climeworksWords(range, unit),
        url: 'https://climeworks.com/actnow',
      },
      {
        id: 'fortomorrow', kind: 'EU avoidance', name: 'ForTomorrow',
        price: `${PRICES.forTomorrowPerTonne} euros per tonne for EU emission rights only, which is about ${Math.round(PRICES.forTomorrowPerTonne / 10)} cents per kilogram. Price on ${checked}.`,
        minimum: `${PRICES.forTomorrowMin} euros. Whole euros only.`,
        whatYouGet:
          'ForTomorrow, a non-profit company in Berlin, buys EU emission allowances and keeps them in its own account, so no company can use them. It says it will cancel them later. This does not take CO₂ out of the air. Your payment is a donation, and you get a certificate straight away. Their form can also include tree planting: choose “EU emission rights” if you want allowances only.',
        forYourRange: forTomorrowWords(range, unit),
        url: 'https://www.fortomorrow.eu/en/donate-for-climate-protection/?mix=0',
      },
      {
        id: 'effektiv-spenden', kind: 'Donation fund', name: 'Effektiv Spenden',
        price: `No price per tonne. You choose the amount. Checked on ${checked}.`,
        minimum: `${PRICES.effektivMin} euros, or ${PRICES.effektivMin} francs in the Swiss form. Whole amounts only.`,
        whatYouGet:
          'A donation to its climate fund, which passes your money to organisations that work on climate policy and clean technology. The fund does not promise an amount of CO₂. You get a donation receipt, not a certificate. Tax-deductible in Germany, Austria, Switzerland and Czechia, through the form for your country.',
        forYourRange: `You choose. The smallest donation is ${PRICES.effektivMin} euros.`,
        url: 'https://effektiv-spenden.org/en/spenden-fonds-klima-schutzen/',
      },
    ],
    footnote: [
      { strong: `Prices and minimums were checked on ${checked} and can change.` },
      " These are three examples, one of each kind. ai-co2 gets nothing from them.",
    ],
  };
}

// ---------- what was read ----------

/** MADE UP: how much a token of each size weighs in the example's model shares. */
const SIZE_WEIGHT: Record<string, number> = { small: 0.1, medium: 0.6, large: 1, fable: 1, unknown: 0.6 };

interface Pasted {
  status: SourceStatus;
  answer: AnswerOk | null;
}

/** The real reader's verdict on the pasted text, as the page's status. The shares are the example's own. */
function readPasted(text: string): Pasted {
  const reading = readAnswer(text, TODAY);
  if (reading.state === 'empty') return { status: { state: 'waiting' }, answer: null };
  if (reading.state === 'problem') {
    return { status: { state: 'problem', message: reading.code === 'no-usage' ? `${reading.message} ${NO_USAGE_OTHER_CAUSES}` : reading.message }, answer: null };
  }
  const rows: Array<{ name: string; tokens: number; weight: number }> = [];
  for (const row of reading.usage.models) {
    const model = classifyModel(row.model);
    if (model.class === 'skip') continue;
    const weight = (row.output + (row.freshInput + row.cacheWrite) * 0.15 + row.cacheRead * 0.015) * (SIZE_WEIGHT[model.class] ?? 0.6);
    rows.push({ name: model.displayName, tokens: row.freshInput + row.cacheWrite + row.cacheRead + row.output, weight });
  }
  rows.sort((a, b) => b.weight - a.weight);
  const all = rows.reduce((sum, row) => sum + row.weight, 0) || 1;
  const { from, to } = reading.usage;
  // The reader's own remarks say when the numbers are unusual. The page then does not call them plausible.
  const unusual = reading.notes.some(note => note.code === 'high-output' || note.code === 'high-total' || note.code === 'output-without-input');
  return {
    answer: reading,
    status: {
      state: 'ok',
      headline: `${rows.length} ${rows.length === 1 ? 'model' : 'models'} · ${tokenCount(reading.total)} tokens · ${shortDate(from)} – ${shortDate(to)}`,
      confirmation: unusual ? '' : 'The numbers add up and look plausible.',
      models: rows.map(row => ({ name: row.name, tokens: row.tokens, share: row.weight / all })),
      notes: reading.notes.flatMap(note => (note.code === 'short-data' ? [note.message, SHORT_DATA_USUAL_CAUSE] : [note.message])),
    },
  };
}

const CHATGPT_OK: SourceStatus = {
  state: 'ok',
  headline: `${CONVERSATIONS.toLocaleString('en')} conversations · 612 answers in the last 30 days · newest message ${shortDate(TODAY)}`,
  confirmation: 'Your export was read in this tab.',
  models: [
    { name: 'GPT-5.5 Thinking', tokens: 2_840_000, share: 0.71 },
    { name: 'GPT-5.5', tokens: 1_960_000, share: 0.26 },
    { name: 'GPT-5.5 mini', tokens: 410_000, share: 0.03 },
  ],
  notes: [],
};

function reading(conversations: number): SourceStatus {
  return {
    state: 'reading',
    done: Math.round((EXPORT_BYTES * conversations) / CONVERSATIONS),
    total: EXPORT_BYTES,
    text: `Reading your export in this tab: ${conversations.toLocaleString('en')} conversations so far. Large exports can take a minute.`,
  };
}

// ---------- the pretend maths ----------

const times = (v: Spread, f: number): Spread => ({ p5: v.p5 * f, mid: v.mid * f, p95: v.p95 * f });

/** The standard normal's inverse, for spreading 100 dots between the range's ends. */
function invNorm(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239] as const;
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572] as const;
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783] as const;
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416] as const;
  const tail = (q: number) =>
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

function quantiles(v: Spread): number[] {
  return Array.from({ length: 100 }, (_, i) => {
    const z = invNorm((i + 0.5) / 100);
    const reach = z < 0 ? v.mid / v.p5 : v.p95 / v.mid;
    return v.mid * Math.exp((z * Math.log(reach)) / 1.6449);
  });
}

// ---------- the store ----------

interface DemoState {
  stage: Stage;
  source: SourceId | null;
  answer: string;
  pasted: Pasted;
  chatgpt: SourceStatus;
  /** Switches that are on, and tips that are applied. */
  on: Set<string>;
  /** Switches the person has flipped away from where they started. */
  flipped: Set<string>;
  /** The sliders the person has set: the thumb's place on the track, from 0 to 1, by id. */
  set: Map<string, number>;
  /** true while a slider is dragged: the scale and the unit then only go up. */
  dragging: boolean;
}

const WAITING: Pasted = { status: { state: 'waiting' }, answer: null };
const ALL_SWITCHES = () => new Set<string>(SWITCHES.map(s => s.id));

function startState(scenario: Scenario): DemoState {
  const state: DemoState = {
    stage: 'choose', source: null, answer: '', pasted: WAITING, chatgpt: { state: 'waiting' },
    on: ALL_SWITCHES(), flipped: new Set(), set: new Map(), dragging: false,
  };
  if (scenario === 'choose') return state;
  const [tool, step] = scenario.split('-');
  state.source = tool === 'cc' ? 'claude-code' : 'chatgpt';
  state.stage = step === 'done' ? 'done' : step === 'problem' ? 'problem' : step === 'loading' ? 'loading' : 'steps';
  if (state.source === 'claude-code') {
    state.answer = step === 'done' ? SAMPLE_ANSWER : step === 'problem' ? PROSE_ANSWER : '';
    state.pasted = readPasted(state.answer);
  } else if (step === 'done') state.chatgpt = CHATGPT_OK;
  else if (step === 'problem') state.chatgpt = { state: 'problem', message: NOT_AN_EXPORT };
  else if (step === 'loading') state.chatgpt = reading(412);
  return state;
}

function buildView(state: DemoState, previous: ChartScale | null): { view: View; scale: ChartScale | null } {
  const source = state.source;
  const sliders = slidersFor(source);
  const done = state.stage === 'done' && source !== null;
  /** A slider whose piece of hidden work is switched off changes nothing. */
  const inert = (s: DemoSlider) => done && s.piece !== undefined && !state.on.has(s.piece);

  // A slider that is not set adds to the spread. One that is set moves the whole range and adds nothing.
  let shift = 1;
  let upLeft = 0;
  let upAll = 0;
  let downLeft = 0;
  let downAll = 0;
  let lowest = 1;
  let highest = 1;
  for (const s of sliders) {
    const up = Math.log(s.effect[1]) ** 2;
    const down = Math.log(s.effect[0]) ** 2;
    upAll += up;
    downAll += down;
    if (inert(s)) continue;
    const position = state.set.get(s.id);
    if (position === undefined) {
      upLeft += up;
      downLeft += down;
      lowest *= s.effect[0];
      highest *= s.effect[1];
      continue;
    }
    const factor = valueAt([s.effect[0], 1, s.effect[1]], position);
    shift *= factor;
    lowest *= factor;
    highest *= factor;
  }
  const switched = source === 'chatgpt' ? SWITCHES.reduce((f, h) => (state.on.has(h.id) ? f : f * h.factor), 1) : 1;
  const narrow = (base: Spread): Spread => {
    const mid = base.mid * shift * switched;
    return {
      p5: mid * Math.exp(-Math.log(base.mid / base.p5) * Math.sqrt(downLeft / downAll)),
      mid,
      p95: mid * Math.exp(Math.log(base.p95 / base.mid) * Math.sqrt(upLeft / upAll)),
    };
  };

  const assumptions: AssumptionView[] = sliders.map(s => {
    const position = state.set.get(s.id);
    const at = position ?? 0.5;
    // With a result the energy slider prints every size the person used, the lead size first.
    const parts: AssumptionPart[] | undefined =
      s.id === 'energy' && done && source
        ? SIZES[source].map(size => {
            const row = ENERGY[size];
            return { label: size, low: row.values[0], typical: row.values[1], high: row.values[2], value: valueAt(row.values, at), decimals: row.decimals };
          })
        : undefined;
    return {
      id: s.id, group: s.group, label: s.label, unit: s.unit, decimals: s.decimals,
      low: s.values[0], typical: s.values[1], high: s.values[2],
      value: valueAt(s.values, at), pinned: position !== undefined,
      ...(parts ? { parts } : {}),
      explanation: s.explanation, note: inert(s) ? SWITCHED_OFF : null,
      source: s.source, sourceUrl: s.sourceUrl, checked: CHECKED, soft: s.soft,
    };
  });

  const now = done && source ? narrow(BASE[source]) : null;
  const method: MethodView = {
    formula: FORMULA,
    counted: source ? COUNTED[source] : ['Your tokens, by model and by type.', ...COUNTED_SHARED],
    leftOut: source ? LEFT_OUT[source] : LEFT_OUT_SHARED,
    notes: [],
    assumptions,
    sliderNote: SLIDER_NOTE,
    extreme: null,
    extremeLabel: 'Every low or every high assumption combined',
    unit: 'kg',
  };
  const view: View = {
    stage: state.stage,
    source,
    data: { claudeCode: { prompt: PROMPT, answer: state.answer, status: state.pasted.status }, chatgpt: { status: state.chatgpt } },
    result: null,
    tips: [],
    noTipsNote: null,
    contribute: null,
    method,
  };
  if (!done || !source || !now) return { view, scale: null };

  const sourceName = source === 'claude-code' ? 'Claude Code' : 'ChatGPT';
  const single = upLeft === 0 && downLeft === 0;
  const answer = state.pasted.answer;
  const models = state.pasted.status.state === 'ok' ? state.pasted.status.models : [];
  const built = source === 'chatgpt' ? CHATGPT_TIPS : answer ? claudeCodeTips(answer, models) : [];
  // With thinking switched off, half as much thinking saves nothing.
  const factorOf = (tip: DemoTip) => (tip.id === 'gpt-less-thinking' && !state.on.has('thinking') ? 1 : tip.factor);
  const applied = built.filter(tip => state.on.has(tip.id));
  const range = times(now, applied.reduce((f, tip) => f * factorOf(tip), 1));
  const scale = nextScale(previous, range, applied.length ? now : null, state.dragging);
  const unit = scale.unit;

  const NOTHING = 'With your current settings this change saves nothing.';
  // A tip that saves nothing is only shown while it is on, so it can be switched off again.
  const shown = built
    .map(tip => ({ tip, saving: savingWords(times(now, 1 - factorOf(tip)), unit) }))
    .filter(({ tip, saving }) => saving !== null || state.on.has(tip.id))
    .sort((a, b) => factorOf(a.tip) - factorOf(b.tip));
  view.tips = shown.map(({ tip, saving }): TipView => ({
    id: tip.id,
    title: tip.title,
    body: saving === null ? [NOTHING] : [`${tip.lead} would save `, { mark: saving }, '.'],
    how: tip.how,
    applied: state.on.has(tip.id),
    now,
    after: times(now, factorOf(tip)),
    afterLabel: tip.afterLabel,
  }));
  if (!view.tips.length) view.noTipsNote = `None of the changes we know how to work out applies to your ${sourceName} numbers.`;

  const set = sliders.filter(s => state.set.has(s.id) && !inert(s));
  const days = `${shortDate(PERIOD.from)} – ${shortDate(PERIOD.to)}`;
  const flippedNote = (s: (typeof SWITCHES)[number]): Pick<SwitchView, 'note' | 'noteIcon'> =>
    state.flipped.has(s.id) ? { note: 'Changed by you.', noteIcon: null } : { note: s.note, noteIcon: s.noteIcon };

  const result: ResultView = {
    sourceName,
    period: PERIOD,
    summary: single
      ? `CO₂e from ${sourceName} in the last 30 days (${days}), with every assumption that changes your result set by you`
      : `Likely CO₂e from ${sourceName} in the last 30 days (${days})`,
    unit,
    range,
    single,
    quantiles: quantiles(range),
    scaleMax: scale.scaleMax,
    car: times(range, 1 / KG_PER_KM),
    carPlace: carPlace(times(range, 1 / KG_PER_KM)),
    history: source === 'chatgpt' ? { range: narrow(HISTORY), since: monthYear(Date.UTC(2023, 2, 15) / 1000) } : null,
    baseline: applied.length ? now : null,
    appliedLabel: applied.length === 0 ? null : applied.length === 1 ? `With: ${applied[0]?.label ?? ''}` : `With ${applied.length} tips applied`,
    setLabel: set.length ? `With ${set.length} ${set.length === 1 ? 'assumption' : 'assumptions'} set by you` : null,
    switches:
      source === 'chatgpt'
        ? {
            title: 'Hidden work in ChatGPT',
            note: "Exports don't show it, so it's estimated on top. Flip one to see what it adds. The last switch is your plan: it sets how much earlier conversation counts as read again.",
            items: SWITCHES.map(s => ({ id: s.id, label: s.label, ...flippedNote(s), on: state.on.has(s.id) })),
          }
        : {
            title: 'Try a change',
            note: 'Flip one to see what it changes. The details are under “Ways to cut”.',
            items: shown.map(({ tip, saving }) => ({
              id: tip.id, label: tip.label, note: saving === null ? 'Saves nothing with your current settings' : `Saves ${saving}`, noteIcon: null, on: state.on.has(tip.id),
            })),
          },
  };
  view.result = result;
  view.contribute = contributeFor(range, unit, single);

  // What matters most: the slider that still varies and moves the middle estimate furthest.
  const free = sliders.filter(s => !state.set.has(s.id) && !inert(s));
  const widest = free.reduce<DemoSlider | null>((best, s) => (!best || s.effect[1] / s.effect[0] > best.effect[1] / best.effect[0] ? s : best), null);
  const market = times(range, MARKET);
  method.unit = unit;
  method.extreme = single ? null : { low: (range.mid / shift) * lowest, high: (range.mid / shift) * highest };
  method.extremeLabel = `${set.length ? 'Every assumption you have not set, at its low or at its high' : 'Every low or every high assumption combined'}${applied.length ? ', with your tip applied' : ''}`;
  method.notes = [
    ...(widest && !single
      ? [
          `${set.length ? 'Of the assumptions you have not set, what matters most is' : 'What matters most for your result is'} ${NAMES[widest.id] ?? widest.label}. Set its slider to low and then to high: your middle estimate goes from ${mass(range.mid * widest.effect[0], unit)} to ${mass(range.mid * widest.effect[1], unit)} ${unit}.`,
          '“Matters most” is worked out like this: one assumption goes from its low to its high value while the others stay where they are. The assumption that moves your footprint by the most kilograms is named.',
        ]
      : []),
    'The least certain number in the table is the weight of a cache read: its high value is 100 times its low value.',
    `Counted with the clean power that Google and Microsoft buy, about 70 g per kWh, your range would be ${massRange(market, unit)}, middle estimate ${mass(market.mid, unit)} ${unit}. The power their data centres draw is no cleaner than the local grid's, so this is shown only for comparison.`,
    'A model’s share is worked out with every assumption at its typical value, or at your value where you have set one.',
    ...(source === 'chatgpt' ? FIXED_ASSUMPTIONS : []),
  ];
  return { view, scale };
}

/** How fast the pretend reading counts up: this many conversations every tick. */
const READ_STEP = 46;
const READ_TICK_MS = 60;

export function createDemoStore(scenario: Scenario = 'choose'): Store {
  let state = startState(scenario);
  let scale: ChartScale | null = null;
  let view: View;
  ({ view, scale } = buildView(state, scale));
  let reader: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<(view: View, previous: View) => void>();

  const commit = () => {
    const previous = view;
    ({ view, scale } = buildView(state, scale));
    for (const listener of Array.from(listeners)) listener(view, previous);
  };
  const stopReading = () => {
    if (reader !== null) clearInterval(reader);
    reader = null;
  };
  const pick = (source: SourceId) => {
    stopReading();
    state = { ...startState('choose'), source, stage: 'steps', set: state.set };
  };

  function dispatch(action: Action): void {
    // Only a slider that is still held counts as a drag. Anything else ends it.
    if (action.type !== 'set-assumption') state = { ...state, dragging: false };
    switch (action.type) {
      case 'choose-source':
        pick(action.source);
        break;
      case 'switch-source':
        if (state.source) pick(state.source === 'claude-code' ? 'chatgpt' : 'claude-code');
        break;
      case 'set-answer': {
        // The paste box belongs to Claude Code. Text that arrives after a switch to ChatGPT is dropped.
        if (state.source !== 'claude-code') return;
        const pasted = readPasted(action.text);
        const got = pasted.status.state;
        state = { ...state, answer: action.text, pasted, stage: got === 'ok' ? 'done' : got === 'problem' ? 'problem' : 'steps' };
        break;
      }
      case 'add-files': {
        if (state.source !== 'chatgpt') return;
        stopReading();
        // The example reads nothing. A file that could be an export is "read" with a count that runs up.
        const refused = action.files.length > 20 ? TOO_MANY_FILES : action.files.some(file => /\.(zip|json)$/i.test(file.name)) ? null : NOT_EXPORT_FILES;
        if (refused) {
          state = { ...state, stage: 'problem', chatgpt: { state: 'problem', message: refused } };
          break;
        }
        let read = 0;
        state = { ...state, stage: 'loading', chatgpt: reading(read) };
        reader = setInterval(() => {
          read = Math.min(CONVERSATIONS, read + READ_STEP);
          if (read < CONVERSATIONS) state = { ...state, chatgpt: reading(read) };
          else {
            stopReading();
            state = { ...state, stage: 'done', chatgpt: CHATGPT_OK };
          }
          commit();
        }, READ_TICK_MS);
        break;
      }
      case 'cancel-read':
        // Giving up a read is not a problem: the steps are simply back.
        if (state.stage !== 'loading') return;
        stopReading();
        state = { ...state, stage: 'steps', chatgpt: { state: 'waiting' } };
        break;
      case 'toggle-switch': {
        const on = new Set(state.on);
        if (!on.delete(action.id)) on.add(action.id);
        const flipped = new Set(state.flipped);
        if (SWITCHES.some(s => s.id === action.id) && !flipped.delete(action.id)) flipped.add(action.id);
        state = { ...state, on, flipped };
        break;
      }
      case 'set-assumption': {
        const slider = slidersFor(state.source).find(s => s.id === action.id);
        if (!slider || !Number.isFinite(action.value)) return;
        // The value becomes a place on the track once, with the row the slider shows. The place is what is kept.
        const set = new Map(state.set);
        set.set(action.id, positionOf(slider.values, action.value));
        state = { ...state, set, dragging: !action.settled };
        break;
      }
      case 'reset-assumptions':
        state = { ...state, set: new Map(), dragging: false };
        break;
    }
    commit();
  }

  return {
    getView: () => view,
    dispatch,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
