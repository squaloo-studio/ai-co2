// ChatGPT's hidden work: the six pieces an export does not show, and the switches of the result card.
// Each piece is an amount (an assumption with its own slider) times a base that the reader counts.

import type { SwitchView } from '../contracts/view';
import type { Triple } from '../track';
import { ASSUMPTION_ROWS } from './assumptions';
import type { HiddenId } from './assumptions';
import type { HiddenWork, Row, TokenType } from './estimate';

export type { HiddenId };
export type SwitchId = 'thinking' | 'instructions-memory' | 'search-files' | 'plan-paid';

/** The three switches that cover pieces. The fourth, the plan, covers none. */
type PieceSwitchId = Exclude<SwitchId, 'plan-paid'>;

export interface HiddenPiece {
  readonly id: HiddenId;
  /** Its place in the estimator's pattern. Fixed per piece, so a list in another order gives the same numbers. */
  readonly slot: 0 | 1 | 2 | 3 | 4 | 5;
  /** The key of this piece in the reader's `Totals.hidden`. */
  readonly readerKey: 'thinking' | 'systemPrompt' | 'memory' | 'search' | 'files' | 'cacheMisses';
  /** Low, typical, high: the row of its slider. */
  readonly amount: Triple;
  /** The token types its base is counted as. Two for memory: a cache read on a quick reply, fresh input after a break. */
  readonly countedAs: readonly TokenType[];
  /** The switch that covers it. null for `misses`: always on. */
  readonly switchId: PieceSwitchId | null;
}

/** The six pieces in slot order. */
export const HIDDEN_PIECES: readonly HiddenPiece[] = Object.freeze(
  (
    [
      { id: 'thinking', slot: 0, readerKey: 'thinking', countedAs: ['output'], switchId: 'thinking' },
      { id: 'prompt', slot: 1, readerKey: 'systemPrompt', countedAs: ['cacheRead'], switchId: 'instructions-memory' },
      { id: 'personal', slot: 2, readerKey: 'memory', countedAs: ['cacheRead', 'freshInput'], switchId: 'instructions-memory' },
      { id: 'search', slot: 3, readerKey: 'search', countedAs: ['freshInput'], switchId: 'search-files' },
      { id: 'files', slot: 4, readerKey: 'files', countedAs: ['freshInput'], switchId: 'search-files' },
      { id: 'misses', slot: 5, readerKey: 'cacheMisses', countedAs: ['freshInput'], switchId: null },
    ] as const
  ).map((piece) => Object.freeze({ ...piece, amount: ASSUMPTION_ROWS[`hidden:${piece.id}`].triple })),
);

/** The units of each piece, by model and token type. */
export type Bases = Readonly<Record<HiddenId, readonly Row[]>>;

const NO_ROWS: readonly Row[] = Object.freeze([]);

export const NO_BASES: Bases = Object.freeze({
  thinking: NO_ROWS,
  prompt: NO_ROWS,
  personal: NO_ROWS,
  search: NO_ROWS,
  files: NO_ROWS,
  misses: NO_ROWS,
});

/** The same shape as `Totals.evidence` of the ChatGPT reader. */
export interface SwitchEvidence {
  readonly thinking: 'recorded' | 'model-name' | 'none';
  readonly memoryInUse: boolean;
  readonly searchOrFiles: boolean;
}

/** One switch as the export sets it. */
export interface SwitchDefault {
  readonly id: SwitchId;
  readonly label: string;
  /** false: nothing to count, so the switch is left out, and the store adds a note that says why. */
  readonly shown: boolean;
  readonly on: boolean;
  readonly note: string;
  readonly noteIcon: 'typical' | 'export';
}

export const SWITCH_GROUP: { readonly title: string; readonly note: string } = Object.freeze({
  title: 'Hidden work in ChatGPT',
  note: "Exports don't show it, so it's estimated on top. Flip one to see what it adds. The last switch is your plan: it sets which size of GPT-5.6 is counted, and how much earlier conversation counts as read again.",
});

export const SWITCH_LABELS: Readonly<Record<SwitchId, string>> = Object.freeze({
  thinking: 'Thinking',
  'instructions-memory': 'Hidden instructions and memory',
  'search-files': 'Search results and file contents',
  'plan-paid': 'Plus or Pro plan',
});

export const NOTE_FROM_EXPORT = 'Set from your export';
export const NOTE_TYPICAL = 'Typical setting';
export const NOTE_MEMORY_USED = 'Set from your export: memory was used';
export const NOTE_FREE_OR_GO = 'Set from your export: Free or Go';
export const NOTE_PLAN_NOT_SAID = 'Your files did not say. Switch this off if you are on Free or Go.';
export const CHANGED_BY_YOU = 'Changed by you.';

const SWITCH_ORDER: readonly SwitchId[] = Object.freeze(['thinking', 'instructions-memory', 'search-files', 'plan-paid'] as const);

export function isSwitchId(id: string): id is SwitchId {
  return (SWITCH_ORDER as readonly string[]).includes(id);
}

type Setting = Pick<SwitchDefault, 'shown' | 'on' | 'note' | 'noteIcon'>;

const fromExport = (note: string, on = true): Setting => ({ shown: true, on, note, noteIcon: 'export' });
const typical = (note: string): Setting => ({ shown: true, on: true, note, noteIcon: 'typical' });
// A switch that is left out has no note to show. Its pieces count: outside the 30 days there may be something.
const LEFT_OUT: Setting = { shown: false, on: true, note: '', noteIcon: 'typical' };

/**
 * All four, in the order thinking, instructions-memory, search-files, plan-paid. `plusUser` is the
 * export's plan flag: true, false, or null when the file that holds it was not in the drop.
 */
export function switchDefaults(evidence: SwitchEvidence, plusUser: boolean | null): SwitchDefault[] {
  const settings: Record<SwitchId, Setting> = {
    thinking: evidence.thinking === 'recorded' ? fromExport(NOTE_FROM_EXPORT) : evidence.thinking === 'model-name' ? typical(NOTE_TYPICAL) : LEFT_OUT,
    // The export can show that memory was on. It can never show that it was off.
    'instructions-memory': evidence.memoryInUse ? fromExport(NOTE_MEMORY_USED) : typical(NOTE_TYPICAL),
    'search-files': evidence.searchOrFiles ? fromExport(NOTE_FROM_EXPORT) : LEFT_OUT,
    'plan-paid': plusUser === true ? fromExport(NOTE_FROM_EXPORT) : plusUser === false ? fromExport(NOTE_FREE_OR_GO, false) : typical(NOTE_PLAN_NOT_SAID),
  };
  return SWITCH_ORDER.map((id) => ({ id, label: SWITCH_LABELS[id], ...settings[id] }));
}

/** Where a switch stands now: its default, turned round when the person has flipped it. On when it has no default. */
export function switchOn(defaults: readonly SwitchDefault[], flipped: readonly SwitchId[], id: SwitchId): boolean {
  const start = defaults.find((entry) => entry.id === id)?.on ?? true;
  return flipped.includes(id) ? !start : start;
}

/** The switches that are shown, for the result card. A flipped one says so and loses its icon. */
export function switchViews(defaults: readonly SwitchDefault[], flipped: readonly SwitchId[]): SwitchView[] {
  return defaults
    .filter((entry) => entry.shown)
    .map((entry) => {
      const changed = flipped.includes(entry.id);
      return {
        id: entry.id,
        label: entry.label,
        note: changed ? CHANGED_BY_YOU : entry.note,
        noteIcon: changed ? null : entry.noteIcon,
        on: changed ? !entry.on : entry.on,
      };
    });
}

/** Which pieces are counted. A piece follows its switch when that is shown. Otherwise it is on. */
export function piecesOn(defaults: readonly SwitchDefault[], flipped: readonly SwitchId[]): Record<HiddenId, boolean> {
  const on: Record<HiddenId, boolean> = { thinking: true, prompt: true, personal: true, search: true, files: true, misses: true };
  for (const piece of HIDDEN_PIECES) {
    const switchId = piece.switchId;
    if (switchId === null) continue;
    const shown = defaults.some((entry) => entry.id === switchId && entry.shown);
    if (shown) on[piece.id] = switchOn(defaults, flipped, switchId);
  }
  return on;
}

/** The six pieces as the estimator takes them, in slot order, always all six: one that is off keeps its place. */
export function hiddenWork(bases: Bases, on: Readonly<Record<HiddenId, boolean>>): HiddenWork[] {
  return HIDDEN_PIECES.map((piece) => ({ id: piece.id, slot: piece.slot, on: on[piece.id], amount: piece.amount, rows: bases[piece.id] }));
}
