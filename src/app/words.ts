// Every sentence the store words itself, in one place, so the wording can be read and tested here.
// The sentences about sliders, switches, tips and money live with their data in src/model.
//
// A function here takes what it needs as plain values and prints numbers and dates through
// src/format.ts. Names that come from a pasted text or a dropped file are put in as they are: the
// page draws every sentence as a text node.

import type { SourceId } from '../contracts/usage';
import type { MassUnit } from '../contracts/view';
import { longDate, mass, percent, plainNumber, printsSame, shortDate, tokenCount } from '../format';
import { ASSUMPTION_ROWS, ENERGY_ROWS, MARKET_GRID } from '../model/assumptions';
import type { EnergyClass } from '../model/assumptions';
import { CEILING, FILE_LIMITS, WARM_SECONDS } from '../sources/chatgpt';
import type { ExportProblem } from './usage';

export const SOURCE_NAMES: Readonly<Record<SourceId, string>> = { 'claude-code': 'Claude Code', chatgpt: 'ChatGPT' };

/** "1 model", "3 models", "1,284 conversations". */
const counted = (n: number, one: string, several: string): string => `${plainNumber(n)} ${n === 1 ? one : several}`;

// ---------- models the page cannot place ----------

/** The size after a name, where two rows share the name and differ in size. */
export const SIZE_WORDS: Readonly<Record<EnergyClass, string>> = {
  small: 'small',
  medium: 'mid-size',
  large: 'large',
  fable: 'Fable',
  unknown: 'unknown size',
};

export function nameWithSize(display: string, size: EnergyClass): string {
  return `${display} (counted as ${SIZE_WORDS[size]})`;
}

export const MOSTLY_UNKNOWN = "More than half of your tokens come from models we don't know. Treat this range as a rough guide.";

/** Below this share of all counted tokens a model the page cannot place moves no printed number, so no sentence says it does. */
export const WIDER_FROM_SHARE = 0.01;

const widerNote = (share: number): string => (share >= WIDER_FROM_SHARE ? ' That makes your range wider.' : '');

/** `share` is the row's part of all counted tokens, from 0 to 1. */
export function unknownModelNote(name: string, share: number): string {
  return `We don't know the model “${name}”. It makes up ${percent(share)} of your tokens. We counted it with our widest range, from a small model to a large one.${widerNote(share)}`;
}

/** Claude Code: the steps for which the logs name no model. The script prints them under the name "unknown". */
export function unnamedStepsNote(share: number): string {
  return `Some steps in your logs name no model. They make up ${percent(share)} of your tokens. We counted them with our widest range, from a small model to a large one.${widerNote(share)}`;
}

/** Why a name such as "gpt-5-6" was counted as a large or a small model: where the plan switch stands, and who set it. */
export const PLAN_REASONS = {
  'export-plus': 'your export says this account has ChatGPT Plus',
  'export-free': 'your export says this account does not have ChatGPT Plus',
  'assumed-paid': 'your files did not say, and we assumed Plus or Pro',
  'chose-paid': 'you chose Plus or Pro',
  'chose-free': 'you chose Free or Go',
} as const;
export type PlanReason = keyof typeof PLAN_REASONS;

export function planModelNote(display: string, size: 'large' | 'small', reason: PlanReason): string {
  return `Your export says “${display}” but not which ${display} model answered. We counted it as a ${size} model, because ${PLAN_REASONS[reason]}. Change the plan switch in your result if that is wrong.`;
}

export function hiddenTierNote(source: SourceId, display: string): string {
  return source === 'claude-code'
    ? `Your logs say “${display}” but not which ${display} model answered. We counted it with our widest range, from a small model to a large one.`
    : `Your export says “${display}” but not which model answered. We counted these answers with our widest range, from a small model to a large one.`;
}

/** `runs` is a count of requests: in older exports one answer can be several. */
export function noModelNote(runs: number): string {
  return runs === 1
    ? "Your export names no model for 1 of ChatGPT's runs. We counted it with our widest range."
    : `Your export names no model for ${plainNumber(runs)} of ChatGPT's runs. We counted them with our widest range.`;
}

// ---------- Claude Code: the pasted answer ----------

export const ANSWER_CONFIRMATION = 'The numbers add up and look plausible.';
/** The same line when a remark below it says that the numbers are unusual. */
export const ANSWER_CONFIRMATION_UNUSUAL = 'The numbers add up.';

/** Shown in place of a result when the page itself fails on an answer it has accepted. Never a fault of the answer. */
export const ANSWER_FAULT = 'The page could not work out a result from this answer. The fault is in the page, not in your answer.';

export function answerHeadline(models: number, tokens: number, from: string, to: string): string {
  return `${counted(models, 'model', 'models')} · ${tokenCount(tokens)} tokens · ${shortDate(from)} – ${shortDate(to)}`;
}

/**
 * The first use lies late in the window. `first` is the first day with data, `to` the window's last
 * day, `days` the days between them, both counted. The page knows the first day with use and nothing
 * about the days before it, so the sentence says no more than that.
 */
export function shortDataNote(first: string, to: string, days: number): string {
  const covers = days === 1
    ? `The result covers one day (${shortDate(to)}), not a full 30.`
    : `The result covers ${plainNumber(days)} days (${shortDate(first)} – ${shortDate(to)}), not a full 30.`;
  return `The first use found in these 30 days was on ${shortDate(first)}. ${covers} If you used Claude Code on this computer earlier in these 30 days, those logs are no longer here.`;
}

/** The answer is more than a week old. The year is printed, because an answer can be years old. */
export function staleNote(to: string): string {
  return `This answer ends on ${longDate(to)}. Run the prompt again if you want today's numbers.`;
}

// ---------- ChatGPT: the export ----------

export const EXPORT_CONFIRMATION = 'Your export was read in this tab.';

export function readingText(conversations: number): string {
  return `Reading your export in this tab: ${counted(conversations, 'conversation', 'conversations')} so far. Large exports can take a minute.`;
}

/** `newest` is the day of the newest message, or null when no message has a date. */
export function exportHeadline(conversations: number, answers: number, newest: string | null): string {
  const head = `${counted(conversations, 'conversation', 'conversations')} · ${counted(answers, 'answer', 'answers')} in the last 30 days`;
  return newest === null ? head : `${head} · newest message ${shortDate(newest)}`;
}

/** Why an export gives no result, and what to do next. */
export function problemWords(problem: ExportProblem): string {
  switch (problem.code) {
    case 'E1':
      return 'None of these files is a ChatGPT export. Drop the ZIP file you downloaded from OpenAI, or the conversations.json files from inside it.';
    case 'E2':
      // Only ZIP files count against this limit: an export that was unzipped may be dropped as hundreds of files.
      return `That is more than ${plainNumber(FILE_LIMITS.maxDroppedFiles)} ZIP files. Drop the export ZIP on its own, or only the conversations files from inside it.`;
    case 'E3':
      return "This ZIP isn't a ChatGPT export: it has no conversations file. Download the export from OpenAI's message again, and drop that file.";
    case 'E4':
      return "This ZIP can't be opened, and no conversations could be read from it. The download may be cut off. Download it again, or unzip it on your computer and drop the conversations files.";
    case 'E5':
      return `“${problem.name}” is not a conversations file from a ChatGPT export. Drop the export ZIP as you downloaded it.`;
    case 'E6':
      return 'This file is larger or more tightly packed than any real export, so the page stopped reading it. If it is a real export, unzip it on your computer and drop only the conversations files.';
    case 'E7':
      return 'This export holds no conversations.';
    case 'E8':
      return problem.newest === null
        ? 'This export has no ChatGPT answers in the last 30 days. Ask ChatGPT for a new export, then drop it here.'
        : `This export has no ChatGPT answers in the last 30 days. Its newest message is from ${longDate(problem.newest)}. Ask ChatGPT for a new export, then drop it here.`;
    case 'E9':
      return 'The page could not finish reading this export. Close other tabs and try again, or unzip it on your computer and drop only the conversations files.';
    case 'E10':
      return 'The page could not start reading this export. Check your connection, reload the page, then drop the export again.';
    case 'E11':
      return `The file “${problem.name}” is damaged, and no conversations could be read from it. Download the export again, or unzip it on your computer and drop the conversations files.`;
  }
}

export function oldExportNote(newest: string): string {
  return `The newest message in this export is from ${longDate(newest)}. The 30 days are counted back from today, so newer use is missing. Ask ChatGPT for a new export if you want today's numbers.`;
}

export function rescuedNote(conversations: number): string {
  return `This ZIP is damaged at its end, so the page read it from the start and found ${counted(conversations, 'conversation', 'conversations')}. Some may be missing. Download the export again for a complete count.`;
}

export function cutOffNote(name: string): string {
  return `The file “${name}” stops in the middle. The conversations before the break were read. Your result may be missing use.`;
}

export function duplicatesNote(conversations: number): string {
  return conversations === 1
    ? '1 conversation was in more than one file. The newer copy was used.'
    : `${plainNumber(conversations)} conversations were in more than one file. The newer copy was used.`;
}

export function skippedNote(entries: number): string {
  return entries === 1
    ? '1 entry in the conversations files could not be read and was skipped.'
    : `${plainNumber(entries)} entries in the conversations files could not be read and were skipped.`;
}

export function ignoredNote(files: number): string {
  return files === 1
    ? '1 file was not a conversations file and was ignored.'
    : `${plainNumber(files)} files were not conversations files and were ignored.`;
}

export const NO_THINKING_NOTE = 'No thinking was found in your export for the last 30 days.';
export const NO_SEARCH_NOTE = 'No web searches and no files without a size were found in your export for the last 30 days.';
export const VOICE_NOTE = 'Voice chats are counted by their transcript only, so they are counted low.';
export const IMAGES_NOTE =
  "Images you sent are counted with OpenAI's published rule for developers. ChatGPT's own setting is not published; a large photo may have cost up to five times more.";

// ---------- the result ----------

/** Which end of the 30 days an export leaves open: it starts late, it ends early, or both. */
export type ExportGap = 'start' | 'end' | 'both';

/**
 * The line under the big range.
 *   last-30   the window ends today or yesterday, and at least 28 of its days are covered
 *   older-30  the same for an older Claude Code answer
 *   days      2 to 27 days are covered: `first` to `last`
 *   one-day   one day is covered: `last`
 * With one outcome the word "Likely" goes, and the sentence says why there is no range.
 * With `tipsApplied` tips that change the result, the range above the line is a what-if, and the line says so.
 *
 * Fewer days are named by what the page knows: the first day with use in the logs, and the oldest
 * and the newest message of the export. It does not know what the logs or the export "cover".
 * `gap` is read for ChatGPT only.
 */
export function summaryWords(
  source: SourceId,
  form: 'last-30' | 'older-30' | 'days' | 'one-day',
  first: string,
  last: string,
  days: number,
  single: boolean,
  gap: ExportGap = 'end',
  tipsApplied = 0,
): string {
  const tool = SOURCE_NAMES[source];
  const bounds = source === 'claude-code' ? 'from your first use'
    : gap === 'start' ? 'from your oldest message'
    : gap === 'both' ? 'from your oldest to your newest message'
    : 'up to your newest message';
  const period =
    form === 'last-30' ? `in the last 30 days (${shortDate(first)} – ${shortDate(last)})`
    : form === 'older-30' ? `in the 30 days from ${shortDate(first)} to ${shortDate(last)}`
    : form === 'days' ? `in the ${plainNumber(days)} days ${bounds} (${shortDate(first)} – ${shortDate(last)})`
    : `on the one day with ${source === 'claude-code' ? 'use' : 'messages'} (${shortDate(last)})`;
  const applied = tipsApplied > 0 ? `your ${tipsApplied === 1 ? 'tip' : 'tips'} applied` : null;
  if (single) return `CO₂e from ${tool} ${period}, with ${applied === null ? '' : `${applied} and `}every assumption that changes your result set by you`;
  return `Likely CO₂e from ${tool} ${period}${applied === null ? '' : `, with ${applied}`}`;
}

/**
 * The tag for the applied tips that change the result, by their switch labels. A tip that is on and
 * saves nothing with the current settings is not among them: the tag would name a change that changes nothing.
 */
export function appliedLabel(labels: readonly string[]): string | null {
  const [only] = labels;
  if (only === undefined) return null;
  return labels.length === 1 ? `With: ${only}` : `With ${plainNumber(labels.length)} tips applied`;
}

/** null when no slider that can change the result is set. */
export function setLabel(sliders: number): string | null {
  if (!(sliders > 0)) return null;
  return sliders === 1 ? 'With 1 assumption set by you' : `With ${plainNumber(sliders)} assumptions set by you`;
}

// ---------- how it's calculated ----------

export const FORMULA = 'CO₂ = tokens × weight × energy per token × overhead × grid × hardware';

export const SLIDER_NOTE =
  'Move a slider to set that assumption yourself: until you reset it, the page uses your value in every run instead of varying it between low and high.';

/** The words before the extreme range: its name, then in brackets what it is made of. The page puts a colon and the two ends after it. */
export function extremeLabel(anySliderSet: boolean, tipsApplied: number): string {
  const made = anySliderSet ? 'every assumption you have not set, at its low or at its high' : 'every low or every high assumption combined';
  const tips = tipsApplied > 0 ? `, with your ${tipsApplied === 1 ? 'tip' : 'tips'} applied` : '';
  return `Extreme range (${made}${tips})`;
}

/**
 * `label` is the label of the slider that matters most, as it stands on the slider: the sentence
 * tells the person to move it, so it names it by the words they can find. `low` and `high` are the
 * middle estimate with that one slider at its low and at its high, in kg.
 */
export function mattersMostNote(label: string, low: number, high: number, unit: MassUnit, anySliderSet: boolean): string {
  const opening = anySliderSet ? `Of the assumptions you have not set, what matters most is “${label}”.` : `What matters most for your result is “${label}”.`;
  return `${opening} Set its slider to low and then to high: your middle estimate goes from ${mass(low, unit)} to ${mass(high, unit)} ${unit}.`;
}

export const MATTERS_MOST_HOW =
  '“Matters most” is worked out like this: one assumption goes from its low to its high value while the others stay where they are. The assumption that moves your footprint by the most kilograms is named.';

/** null when the two values print the same: then there is nothing to tell apart. */
export function allTypicalNote(allTypical: number, middle: number, runsAbove: number, unit: MassUnit, anySliderSet: boolean): string | null {
  if (printsSame(allTypical, middle, unit)) return null;
  const opening = anySliderSet ? 'With every assumption you have not set at its typical value' : 'With every assumption at its typical value';
  return `${opening}, the formula gives ${mass(allTypical, unit)} ${unit}. The middle estimate is ${middle > allTypical ? 'higher' : 'lower'}, ${mass(middle, unit)} ${unit}: ${plainNumber(runsAbove)} of the 10,000 results lie above that all-typical value.`;
}

/** How many times its low value a row's high value is. */
const timesLow = (triple: readonly [number, number, number]): string => plainNumber(triple[2] / triple[0]);

const LEAST_CERTAIN_ROW = ASSUMPTION_ROWS.cacheRead;
const LEAST_CERTAIN_FACT = `“${LEAST_CERTAIN_ROW.label}”: its high value is ${timesLow(LEAST_CERTAIN_ROW.triple)} times its low value.`;

/** The notes stand above the sliders, so "below" is where the person finds them. */
export const LEAST_CERTAIN = `The least certain number in the list of assumptions below is ${LEAST_CERTAIN_FACT}`;
export const LEAST_CERTAIN_WITH_UNKNOWN =
  `Among the numbers that apply to everyone, the least certain is ${LEAST_CERTAIN_FACT} The energy of the models we don't know is as uncertain: its high value is ${timesLow(ENERGY_ROWS.unknown.triple)} times its low value.`;

const MARKET_ENDING = "The power their data centres draw is no cleaner than the local grid's, so this is shown only for comparison.";

/**
 * The result counted with the clean power the companies buy. `single`: there is one outcome and no
 * range. Only the grid value changes: the kilograms for making the hardware stay as they are, so the
 * line is not the shown result times 70/350, and the sentence says why.
 */
export function marketNote(low: number, middle: number, high: number, unit: MassUnit, single: boolean): string {
  const opening = `Counted with the clean power that Google and Microsoft buy, about ${plainNumber(MARKET_GRID)} g per kWh, and with making the hardware counted as before,`;
  return single || printsSame(low, high, unit)
    ? `${opening} your result would be about ${mass(middle, unit)} ${unit}. ${MARKET_ENDING}`
    : `${opening} your range would be ${mass(low, unit)}–${mass(high, unit)} ${unit}, middle estimate ${mass(middle, unit)} ${unit}. ${MARKET_ENDING}`;
}

export const SHARE_NOTE = "A model's share is worked out with every assumption at its typical value, or at your value where you have set one.";
export const HISTORY_NOTE =
  "The whole-history line uses today's energy and grid values for use from years ago. The hidden instructions are counted smaller for earlier years.";

/**
 * Shown when Fable is one of the sizes behind the energy slider and not the one whose row the slider
 * shows: the slider's own sentence for Fable, then its range. words.test.ts ties the two numbers to the table.
 */
export const FABLE_NOTE = `${ENERGY_ROWS.fable.explanation} Its energy runs from 0.5 to 10.8 Wh per 1,000 tokens.`;
/** The same for models the page cannot place. */
export const UNKNOWN_SIZE_NOTE =
  'We could not tell how big some of your models are, so their energy runs from the low end of small models to the high end of large ones: 0.05 to 5.4 Wh per 1,000 tokens.';

/** ChatGPT: four assumptions of the count that have no slider. words.test.ts holds the first two word for word. */
export const FIXED_ASSUMPTIONS: readonly string[] = [
  `We assume ChatGPT reuses its earlier reading when you reply within ${plainNumber(WARM_SECONDS / 60)} minutes. OpenAI documents this for its developer service, not for ChatGPT.`,
  // The plan switch of the result decides which ceiling is used, so the sentence names the plans as the switch does.
  `We assume ChatGPT keeps at most about ${plainNumber(CEILING.paid.instant)} tokens of earlier conversation for instant models and ${plainNumber(CEILING.paid.thinking)} for thinking models on Plus or Pro, and ${plainNumber(CEILING.free.instant)} on Free or Go. OpenAI publishes the total window, not this share.`,
  "We count each image you sent with OpenAI's published rule for developers at its 'high' setting. ChatGPT's own setting is not published; a large photo may have cost up to five times more.",
  // Read afresh the weight is ten times that of a re-read. How much larger the part gets depends on how
  // many of the person's messages start a chat, so the sentence gives no figure.
  'We count the hidden instructions as text ChatGPT can reuse, even on the first message of a chat. If it reads them afresh at the start of every chat, this part is several times larger.',
];

const OVERHEAD_AND_GRID = 'Data-centre overhead and the electricity grid.';
const HARDWARE = 'Making the hardware, about 10–13% on top.';

/** What is counted, before a tool is chosen. */
export const COUNTED_SHARED: readonly string[] = ['Your tokens, by model and by type.', OVERHEAD_AND_GRID, HARDWARE];

export const COUNTED: Readonly<Record<SourceId, readonly string[]>> = {
  'claude-code': [
    'Every token Claude Code logged on this computer in the 30 days, by model and type: fresh input, cache writes, cache reads and output. Thinking is part of output.',
    'Advisor calls, compaction steps and attempts that a model declined, where the logs show them.',
    OVERHEAD_AND_GRID,
    HARDWARE,
  ],
  chatgpt: [
    'Counted from your export: what you wrote, what ChatGPT answered, and every time it read the conversation again. Edited questions and regenerated answers count too.',
    'Estimated on top: thinking, hidden instructions, memory, web pages and files. You can switch each group off.',
    'One more estimate has no switch: how often ChatGPT cannot reuse an earlier reading of the conversation. Its slider is below.',
    OVERHEAD_AND_GRID,
    HARDWARE,
  ],
};

/** What is left out for both tools. */
export const LEFT_OUT_SHARED: readonly string[] = [
  'Water. Published figures differ by more than ten times, so any number would mislead.',
  'Training the models, and the research runs before training.',
  'Your own device, and the networks between it and the data centre.',
  'Idle spare machines and data storage.',
  'Power-line losses, and making the fuel for power plants, at the low and middle grid values.',
];

export const LEFT_OUT: Readonly<Record<SourceId, readonly string[]>> = {
  'claude-code': [
    ...LEFT_OUT_SHARED,
    'Claude Code use on other computers, in cloud sessions and over SSH.',
    'Requests Claude Code makes in the background, where it does not log them.',
  ],
  chatgpt: [
    ...LEFT_OUT_SHARED,
    'Generated images, deep research and agent runs, and the audio of voice chats.',
    'Temporary and deleted chats. They are not in the export.',
    'The instructions and files of custom GPTs and projects.',
    'Thinking in answers from instant models, which show no thinking time.',
    'About 1 web search in 10. Current exports do not show them.',
  ],
};
