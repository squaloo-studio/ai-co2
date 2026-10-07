// The fixed values and small rules of the ChatGPT count. Every value here is an assumption that has
// no slider, so the page lists them in its method section. No tokenizer is loaded from this file.

/** A reply this soon after the previous request of the same conversation re-reads it from the cache. */
export const WARM_SECONDS = 30 * 60;

/** Thinking time for a thinking answer with no recorded time, when its conversation has no timed answer. */
export const DEFAULT_THINK_SECONDS = 15;

/**
 * The two ceilings on re-read text. 'paid' is Go, Plus and Pro. 'free' is the free plan.
 * This is not the split that decides the size of GPT-5.6, where Go sits with Free.
 */
export type Plan = 'free' | 'paid';

/** Most earlier conversation, in tokens, that one request re-reads: the plan's window minus 20,000. */
export const CEILING: Readonly<Record<Plan, Readonly<{ instant: number; thinking: number }>>> = {
  paid: { instant: 34_000, thinking: 236_000 },
  free: { instant: 7_000, thinking: 7_000 },
};

/** Size of the hidden system prompt relative to today's, for requests before each date. */
const PROMPT_PERIODS: ReadonlyArray<readonly [untilSeconds: number, weight: number]> = [
  [Date.UTC(2024, 4, 1) / 1000, 0.04],
  [Date.UTC(2025, 7, 1) / 1000, 0.12],
  [Date.UTC(2026, 2, 1) / 1000, 0.65],
  [Date.UTC(2026, 7, 1) / 1000, 0.8],
];
/** The same for a "mini" or "nano" model that is not a thinking model, whatever the date. */
const PROMPT_MINI = 0.06;

/** ChatGPT opened on 30 Nov 2022. An earlier time is a broken value, not a date. */
export const EARLIEST_TIME = Date.UTC(2022, 10, 1) / 1000;

/** No single thinking time counts for more than this. The longest recorded one in real exports is 183 s. */
export const MAX_THINK_SECONDS = 2 * 60 * 60;

/** An image wider or taller than this has no believable size and counts as an image of unknown size. */
const MAX_IMAGE_SIDE = 1_000_000;

/**
 * The model thinks, going by its name alone: the name holds "thinking", ends in "-t-mini" or "-pro",
 * starts with "o" and a digit, is "research", or holds "deep-research". This one rule decides the
 * ceiling, the assumed thinking time and the weight of the hidden instructions. It is a rule of its
 * own: the model classifier answers a different question (which size class) and is not asked here.
 */
export function isThinkingSlug(slug: string): boolean {
  return /thinking|-t-mini$|-pro$|^o\d|^research$|deep-research/.test(slug);
}

// Answers with sources hold invisible markers from Unicode's private-use range: U+E200, a word,
// U+E202, an argument, U+E201. They are not text the person saw.
const MARKER_OPEN = '\ue200';
const MARKER_CLOSE = '\ue201';
const MARKER_CHARACTERS = /[\ue200-\ue20f]/;

/**
 * A text without its citation markers: everything from U+E200 to the next U+E201 goes, then any
 * character left in U+E200 to U+E20F. This counts answers with sources 1 to 2% low, which the
 * method accepts. One pass over the text, whatever it holds.
 */
export function withoutMarkers(text: string): string {
  if (!MARKER_CHARACTERS.test(text)) return text;
  let kept = '';
  let from = 0;
  for (;;) {
    const open = text.indexOf(MARKER_OPEN, from);
    // With no closing character after this opening one there is none after any later one either.
    const close = open < 0 ? -1 : text.indexOf(MARKER_CLOSE, open + 1);
    if (close < 0) break;
    kept += text.slice(from, open);
    from = close + 1;
  }
  return (kept + text.slice(from)).replace(/[\ue200-\ue20f]/g, '');
}

/** How much of today's system prompt a request read. `time` is Unix seconds, or null when unknown. */
export function promptWeight(slug: string, time: number | null): number {
  if (/mini|nano/.test(slug) && !isThinkingSlug(slug)) return PROMPT_MINI;
  if (time === null) return 1;
  for (const [until, weight] of PROMPT_PERIODS) if (time < until) return weight;
  return 1;
}

/**
 * Unix seconds, or null when the value is not a usable time. One real export has a time in
 * milliseconds, so anything above 10^11 is divided by 1000 first.
 */
export function normaliseTime(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const seconds = value > 1e11 ? value / 1000 : value;
  return seconds >= EARLIEST_TIME && seconds <= 1e11 ? seconds : null;
}

/** true when a time was given in milliseconds. */
export function isMilliseconds(value: unknown): boolean {
  return typeof value === 'number' && value > 1e11 && normaliseTime(value) !== null;
}

// The wording is interface text ("Thought for 1m 12s", "Worked for 24s", "Thought for a few seconds").
// Only the time is read, and only from the start: a recap is one short line.
const RECAP_READ_CHARS = 200;

/**
 * Seconds of thinking on one recap message, or null when no time can be read.
 * `duration` is `metadata.finished_duration_sec`, `text` is `content.content`.
 */
export function recapSeconds(duration: unknown, text: unknown): number | null {
  if (typeof duration === 'number' && duration >= 0 && Number.isFinite(duration)) return duration;
  if (typeof text !== 'string') return null;
  const t = text.slice(0, RECAP_READ_CHARS);
  const h = /(\d+)\s*h(?:ours?|rs?)?\b/.exec(t);
  const m = /(\d+)\s*m(?:in(?:ute)?s?)?\b/.exec(t);
  const s = /(\d+)\s*s(?:ec(?:ond)?s?)?\b/.exec(t);
  if (h || m || s) return Number(h?.[1] ?? 0) * 3600 + Number(m?.[1] ?? 0) * 60 + Number(s?.[1] ?? 0);
  if (/couple of seconds/.test(t)) return 2;
  if (/few seconds/.test(t)) return 4;
  if (/a second/.test(t)) return 1;
  if (/couple of minutes/.test(t)) return 120;
  if (/few minutes/.test(t)) return 240;
  if (/a minute/.test(t)) return 60;
  return null;
}

/** Tokens of an image of unknown size: a 1024 × 1024 image. */
export const IMAGE_TOKENS_UNKNOWN = 1229;

/** true when width and height can be used for the image rule. */
export function isImageSize(width: unknown, height: unknown): boolean {
  const ok = (x: unknown) => typeof x === 'number' && x > 0 && x <= MAX_IMAGE_SIDE;
  return ok(width) && ok(height);
}

/**
 * Tokens of an image the person sent, by OpenAI's published rule at "high" detail: patches of 32 px,
 * at most 2,500 of them, times 1.2. Never more than 3,000. ChatGPT's own setting is not published.
 */
export function imageTokens(width: unknown, height: unknown): number {
  if (typeof width !== 'number' || typeof height !== 'number' || !isImageSize(width, height)) return IMAGE_TOKENS_UNKNOWN;
  const budget = 2500;
  let patches = Math.ceil(width / 32) * Math.ceil(height / 32);
  if (patches > budget) {
    const f = Math.sqrt((1024 * budget) / (width * height));
    const w = (width * f) / 32;
    const h = (height * f) / 32;
    const g = f * Math.min(Math.floor(w) / w, Math.floor(h) / h);
    patches = Math.min(budget, Math.ceil(Math.floor(width * g) / 32) * Math.ceil(Math.floor(height * g) / 32));
  }
  return Math.ceil(patches * 1.2);
}
