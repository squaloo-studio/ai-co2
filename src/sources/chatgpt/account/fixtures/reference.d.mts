// Types for reference.mjs, which is plain JavaScript.

export interface ReferenceRow {
  freshInput: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}
export type ReferenceRows = Record<string, ReferenceRow>;

export interface ReferenceTotals {
  rows: ReferenceRows;
  thinking: ReferenceRows;
  prompt: ReferenceRows;
  personal: ReferenceRows;
  search: ReferenceRows;
  files: ReferenceRows;
  misses: ReferenceRows;
  counts: {
    requests: number;
    cold: number;
    thinkingTimed: number;
    thinkingImputed: number;
    recapsNotPlaced: number;
    searchAnswers: number;
    sources: number;
    filesExact: number;
    filesEstimated: number;
    images: number;
    truncated: number;
    customInstructionsInExport: number;
    memorySeen: number;
    afterWindowEnd: number;
  };
}

export interface ReferenceOptions {
  countTokens: (text: string, options: { disallowedSpecial: Set<string> }) => number;
  /** `chatgpt_plus_user`. false gives the free ceiling. */
  plus?: boolean | null;
  /** End of the 30 days, as Unix seconds. Left out, it is the newest update time. */
  exportTime?: number | null;
}

export function readExport(
  conversations: readonly unknown[],
  options: ReferenceOptions,
): { window: ReferenceTotals; all: ReferenceTotals; exportTime: number };
export function recapSeconds(message: { content?: { content?: unknown }; metadata?: Record<string, unknown> }): number | null;
export function imageTokens(width: unknown, height: unknown, budget?: number): number;
export function isThinkingSlug(slug: unknown): boolean;
export function promptWeight(slug: unknown, time: number): number;
