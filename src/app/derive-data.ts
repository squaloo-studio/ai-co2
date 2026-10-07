// Chapter "Your data": what was read from the chosen tool, and every remark about it.

import type { DataView, ModelRow, SourceStatus } from '../contracts/view';
import type { EnergyClass } from '../model/assumptions';
import type { RowShare } from '../model/estimate';
import { progressShare } from '../sources/chatgpt';
import type { ExportReport, ReadProgress, Reading } from '../sources/chatgpt';
import { NO_USAGE_OTHER_CAUSES, PROMPT, SHORT_DATA_USUAL_CAUSE } from '../sources/claude-code';
import type { AnswerOk } from '../sources/claude-code';
import type { Calc } from './calc';
import { daysBetween } from './days';
import { isPaid } from './state';
import type { State } from './state';
import { countOf, dayOf, fileName } from './usage';
import type { Counted, CountedModel, ExportProblem } from './usage';
import {
  ANSWER_CONFIRMATION,
  ANSWER_CONFIRMATION_UNUSUAL,
  EXPORT_CONFIRMATION,
  IMAGES_NOTE,
  MOSTLY_UNKNOWN,
  NO_SEARCH_NOTE,
  NO_THINKING_NOTE,
  VOICE_NOTE,
  answerHeadline,
  cutOffNote,
  duplicatesNote,
  exportHeadline,
  hiddenTierNote,
  ignoredNote,
  nameWithSize,
  noModelNote,
  oldExportNote,
  planModelNote,
  problemWords,
  readingText,
  rescuedNote,
  shortDataNote,
  skippedNote,
  staleNote,
  unknownModelNote,
  unnamedStepsNote,
} from './words';
import type { PlanReason } from './words';

const WAITING: SourceStatus = { state: 'waiting' };

/** The newest message is older than this many days: the export misses recent use, and a note says so. */
const OLD_EXPORT_DAYS = 7;
/** At most this many files are named as cut off. A hostile ZIP can hold thousands. */
const MOST_CUT_OFF_NOTES = 3;

// ---------- the model table ----------

/** The raw names that the page shows as one row: the same friendly name and the same size. */
interface Group {
  readonly display: string;
  readonly sizeClass: EnergyClass;
  /** What the page prints: the friendly name, with the size after it when another row has the same name. */
  readonly name: string;
  readonly first: CountedModel;
  readonly tokens: number;
  readonly requests: number;
  readonly share: number;
}

/** The rows of the model table, biggest share first. Without shares: in the order of the source's rows. */
function groupsOf(counted: Counted, shares: readonly RowShare[] | null): Group[] {
  // Model names are kept in Maps, never as keys of a plain object: "constructor" is a valid name.
  const shareOf = new Map<string, number>();
  for (const entry of shares ?? []) shareOf.set(entry.model, (shareOf.get(entry.model) ?? 0) + countOf(entry.share));

  const groups: Array<{ display: string; sizeClass: EnergyClass; first: CountedModel; tokens: number; requests: number; share: number }> = [];
  for (const model of counted.models) {
    const share = shareOf.get(model.row) ?? 0;
    const group = groups.find((entry) => entry.display === model.display && entry.sizeClass === model.sizeClass);
    if (group === undefined) {
      groups.push({ display: model.display, sizeClass: model.sizeClass, first: model, tokens: model.tokens, requests: model.requests, share });
    } else {
      group.tokens += model.tokens;
      group.requests += model.requests;
      group.share += share;
    }
  }
  // A stable sort: rows with the same share keep the order of the source.
  if (shares !== null) groups.sort((a, b) => b.share - a.share || b.tokens - a.tokens);
  const sameName = (display: string): boolean => groups.filter((entry) => entry.display === display).length > 1;
  return groups.map((group) => ({ ...group, name: sameName(group.display) ? nameWithSize(group.display, group.sizeClass) : group.display }));
}

/** One row per display name and size, biggest share first. `shares` is the estimate's shares by model. */
export function modelRows(counted: Counted, shares: readonly RowShare[]): ModelRow[] {
  return groupsOf(counted, shares).map(({ name, tokens, share }) => ({ name, tokens, share }));
}

/** Why a name such as "gpt-5-6" was counted as it was: where the plan switch stands, and who set it. */
function planReason(state: State): PlanReason {
  const paid = isPaid(state);
  if (state.flipped.includes('plan-paid')) return paid ? 'chose-paid' : 'chose-free';
  if (!paid) return 'export-free';
  return state.export.phase === 'done' && state.export.reading.plusUser === true ? 'export-plus' : 'assumed-paid';
}

/**
 * The sentences about models the page cannot place. `warning` goes before every other note. `rest`
 * goes after them, in the order of the model table (with `shares`), or of the source's rows (without).
 */
export function modelNotes(counted: Counted, state: State, shares?: readonly RowShare[]): { readonly warning: string | null; readonly rest: readonly string[] } {
  const groups = groupsOf(counted, shares ?? null);
  const all = groups.reduce((sum, group) => sum + group.tokens, 0);
  const unknown = groups.reduce((sum, group) => sum + (group.sizeClass === 'unknown' ? group.tokens : 0), 0);
  const chatgpt = counted.source === 'chatgpt';

  const rest: string[] = [];
  let unnamedSaid = false;
  for (const group of groups) {
    const { reason, byPlan } = group.first;
    if (chatgpt && (reason === 'auto' || reason === 'empty')) {
      // One sentence for every answer that names no model, where the first such row stands.
      const runs = groups.reduce((sum, entry) => sum + (entry.first.reason === 'auto' || entry.first.reason === 'empty' ? entry.requests : 0), 0);
      if (!unnamedSaid && runs > 0) rest.push(noModelNote(runs));
      unnamedSaid = true;
    } else if (!(group.tokens > 0)) {
      // A row without tokens changes nothing, so there is nothing to say about it.
    } else if (chatgpt && byPlan && (group.sizeClass === 'large' || group.sizeClass === 'small')) {
      rest.push(planModelNote(group.display, group.sizeClass, planReason(state)));
    } else if (reason === 'tier-hidden') {
      rest.push(hiddenTierNote(counted.source, group.display));
    } else if (reason === 'empty') {
      // Claude Code: the script's row for steps that name no model. "We don't know the model “unknown”" would name a model that is none.
      rest.push(unnamedStepsNote(all > 0 ? group.tokens / all : 0));
    } else if (reason !== null) {
      rest.push(unknownModelNote(group.display, all > 0 ? group.tokens / all : 0));
    }
  }
  return { warning: unknown > all / 2 ? MOSTLY_UNKNOWN : null, rest };
}

// ---------- Claude Code ----------

/** The remarks that say the numbers of an answer are unusual. Beside one of them the page does not call the numbers plausible. */
const UNUSUAL = ['high-output', 'high-total', 'output-without-input'];

/** The remarks on an accepted answer, in a fixed order. The two that hold dates are worded here, with the page's own dates. */
export function answerNotes(answer: AnswerOk, counted: Counted): string[] {
  const notes: string[] = [];
  const has = (code: string): boolean => answer.notes.some((note) => note.code === code);
  if (has('short-data')) {
    notes.push(shortDataNote(counted.covered.first, counted.window.to, counted.covered.days), SHORT_DATA_USUAL_CAUSE);
  }
  if (has('stale')) notes.push(staleNote(counted.window.to));
  for (const code of UNUSUAL) {
    for (const note of answer.notes) {
      if (note.code === code && typeof note.message === 'string' && note.message !== '') notes.push(note.message);
    }
  }
  return notes;
}

function answerStatus(state: State, counted: Counted | null, calc: Calc | null): SourceStatus {
  const reading = state.answer.reading;
  if (state.source !== 'claude-code' || reading.state === 'empty') return WAITING;
  if (reading.state === 'problem') {
    // Nothing found is not damage: the script ran. The other reasons it finds nothing follow.
    return { state: 'problem', message: reading.code === 'no-usage' ? `${reading.message} ${NO_USAGE_OTHER_CAUSES}` : reading.message };
  }
  if (counted === null || calc === null) return WAITING;
  const shares = calc.shown.shares.models;
  const models = modelRows(counted, shares);
  const { warning, rest } = modelNotes(counted, state, shares);
  const unusual = reading.notes.some((note) => UNUSUAL.includes(note.code) && typeof note.message === 'string' && note.message !== '');
  return {
    state: 'ok',
    headline: answerHeadline(models.length, counted.models.reduce((sum, model) => sum + model.tokens, 0), counted.window.from, counted.window.to),
    confirmation: unusual ? ANSWER_CONFIRMATION_UNUSUAL : ANSWER_CONFIRMATION,
    models,
    notes: [...(warning === null ? [] : [warning]), ...answerNotes(reading, counted), ...rest],
  };
}

// ---------- ChatGPT ----------

/** The exact message for an export that gives no result. */
export function problemMessage(problem: ExportProblem): string {
  return problemWords(problem);
}

/** The status while an export is read. `done` and `total` are bytes, and the bar stops just short of full. */
export function readingStatus(progress: ReadProgress | null): SourceStatus {
  if (progress === null) return { state: 'reading', done: 0, total: null, text: readingText(0) };
  const total = typeof progress.bytesTotal === 'number' && progress.bytesTotal > 0 && Number.isFinite(progress.bytesTotal) ? progress.bytesTotal : null;
  const done = total === null ? countOf(progress.bytesRead) : countOf(progressShare(progress)) * total;
  return { state: 'reading', done, total, text: readingText(Math.floor(countOf(progress.conversations))) };
}

/** The remarks on an export that was read, in a fixed order, each only when it applies. */
export function exportNotes(reading: Reading, report: ExportReport, counted: Counted, today: string): string[] {
  const notes: string[] = [];
  const warned = (...codes: string[]): number =>
    reading.warnings.reduce((sum, warning) => sum + (codes.includes(warning.code) ? Math.floor(countOf(warning.count)) : 0), 0);

  const newest = dayOf(reading, reading.lastMessage);
  if (newest !== null && daysBetween(newest, today) > OLD_EXPORT_DAYS) notes.push(oldExportNote(newest));

  const rescued = report.notices.filter((notice) => notice.code === 'rescued');
  if (rescued.length > 0) {
    notes.push(rescuedNote(rescued.reduce((sum, notice) => sum + (notice.code === 'rescued' ? Math.floor(countOf(notice.conversations)) : 0), 0)));
  }

  const cutOff: string[] = [];
  for (const file of report.files) {
    const broken = file.problem === 'cut-off' || file.problem === 'not-json' || file.problem === 'damaged';
    if (broken && file.handed > 0) cutOff.push(fileName(file.path));
  }
  for (const notice of report.notices) {
    if (notice.code === 'ends-early') cutOff.push(fileName(notice.path));
  }
  for (const name of cutOff.slice(0, MOST_CUT_OFF_NOTES)) notes.push(cutOffNote(name));

  const duplicates = warned('duplicate-conversation');
  if (duplicates > 0) notes.push(duplicatesNote(duplicates));
  const skipped = warned('not-a-conversation', 'conversation-too-large', 'conversation-failed');
  if (skipped > 0) notes.push(skippedNote(skipped));
  const ignored = report.notices.filter((notice) => notice.code === 'ignored' || notice.code === 'encrypted').length;
  if (ignored > 0) notes.push(ignoredNote(ignored));

  // A switch that is left out has nothing to count, and the notes say why it is missing.
  const sums = counted.totals;
  if (sums !== null) {
    if (sums.evidence.thinking === 'none') notes.push(NO_THINKING_NOTE);
    if (!sums.evidence.searchOrFiles) notes.push(NO_SEARCH_NOTE);
    if (sums.transcripts > 0) notes.push(VOICE_NOTE);
    if (sums.images > 0) notes.push(IMAGES_NOTE);
  }
  return notes;
}

function exportStatus(state: State, counted: Counted | null, calc: Calc | null): SourceStatus {
  const held = state.export;
  if (state.source !== 'chatgpt' || held.phase === 'waiting') return WAITING;
  if (held.phase === 'reading') return readingStatus(held.progress);
  if (held.phase === 'problem') return { state: 'problem', message: problemMessage(held.problem) };
  if (counted === null || calc === null) return WAITING;
  const shares = calc.shown.shares.models;
  const { warning, rest } = modelNotes(counted, state, shares);
  return {
    state: 'ok',
    headline: exportHeadline(
      Math.floor(countOf(held.reading.conversations)),
      Math.floor(countOf(counted.totals?.answers)),
      dayOf(held.reading, held.reading.lastMessage),
    ),
    confirmation: EXPORT_CONFIRMATION,
    models: modelRows(counted, shares),
    notes: [...(warning === null ? [] : [warning]), ...exportNotes(held.reading, held.report, counted, state.today), ...rest],
  };
}

export function dataView(state: State, counted: Counted | null, calc: Calc | null): DataView {
  return {
    claudeCode: { prompt: PROMPT, answer: state.answer.text, status: answerStatus(state, counted, calc) },
    chatgpt: { status: exportStatus(state, counted, calc) },
  };
}
