// One conversation of a ChatGPT export, turned into counts. The rule: every run of assistant messages
// is one request, which read its new messages and the previous answer fresh and everything above
// them again. The comments below state each step where it is taken.
//
// The conversation is untrusted. Every field is checked before use, every walk over the tree is a
// single pass in which a child looks only at its parent, so no shape of tree can make it slow, and
// no text is kept: a message's text is counted and dropped.

import type { Day, ModelDay, WarningCode } from './reading';
import { NO_MODEL_NAME } from './reading';
import {
  CEILING, DEFAULT_THINK_SECONDS, MAX_THINK_SECONDS, WARM_SECONDS,
  imageTokens, isImageSize, isMilliseconds, isThinkingSlug, normaliseTime, promptWeight, recapSeconds, withoutMarkers,
} from './rules';

/** The tokenizer's counting function. The option keeps it from throwing on strings like "<|endoftext|>". */
export type CountTokens = (text: string, options: { disallowedSpecial: Set<string> }) => number;

/** Judgement calls. Each sits far above anything a real export holds. */
export interface Limits {
  /** Messages in one conversation. A larger conversation is skipped. Real ones have a few thousand at most. */
  maxNodes: number;
  /**
   * Characters of one message that are tokenized. The rest is estimated from that start. Two million
   * characters are about 500,000 tokens, more than the largest window any plan has.
   */
  maxMessageChars: number;
  /**
   * Characters that may go by without a certain break between two words before the text is cut and
   * counted in parts (see countBounded). A cut can add a token. Ordinary text in a script with
   * spaces is never cut. Chinese, Japanese and Thai are, about every 512 characters.
   */
  maxRunChars: number;
  /** Attachments counted on one message, and images counted on one message. */
  maxAttachments: number;
  /** Web sources counted on one message. Real answers list 11 to 19 at the median. */
  maxSources: number;
  /** The largest token count believed for one file. The largest real one is 41,000. */
  maxFileTokens: number;
  /** Different model names in one reading. Rarer names beyond these are counted under the empty name. */
  maxModels: number;
}

export const LIMITS: Readonly<Limits> = Object.freeze({
  maxNodes: 200_000,
  maxMessageChars: 2_000_000,
  maxRunChars: 512,
  maxAttachments: 100,
  maxSources: 1_000,
  maxFileTokens: 2_000_000,
  maxModels: 50,
});

export type ModelNumbers = Omit<ModelDay, 'model'>;

const ZERO: Readonly<ModelNumbers> = {
  requests: 0, coldRequests: 0, output: 0, newInput: 0,
  rereadWarmFree: 0, rereadWarmPaid: 0, rereadColdFree: 0, rereadColdPaid: 0, cutFree: 0, cutPaid: 0,
  thinkingSeconds: 0, thinkingSecondsAssumed: 0, thinkingRecorded: 0, thinkingAssumed: 0,
  promptReadings: 0, sources: 0, searchRequests: 0, filesWithoutCount: 0, filesWithCount: 0, images: 0,
};
export const MODEL_FIELDS = Object.keys(ZERO) as ReadonlyArray<keyof ModelNumbers>;

export type DayNumbers = Omit<Day, 'day' | 'models'>;

export interface DayCount extends DayNumbers {
  models: Map<string, ModelNumbers>;
}

const NO_DAY: Readonly<DayNumbers> = { messages: 0, prompts: 0, answers: 0, recaps: 0, transcripts: 0, memoryMessages: 0 };
export const DAY_FIELDS = Object.keys(NO_DAY) as ReadonlyArray<keyof DayNumbers>;

/** The day key of everything that has no usable time. */
export const UNDATED = -1;

/** What is kept of one conversation until the end, so that a later copy of it can replace it. */
export interface ConversationCount {
  id: string | null;
  updateTime: number | null;
  /** Keyed by day number in the Reading's calendar, or UNDATED. */
  days: Map<number, DayCount>;
  firstRequest: number | null;
  lastRequest: number | null;
  lastMessage: number | null;
  memorySeen: boolean;
  customInstructions: boolean;
  warnings: Map<WarningCode, number>;
}

export function emptyDay(): DayCount {
  return { ...NO_DAY, models: new Map() };
}

export function dayOf(days: Map<number, DayCount>, key: number): DayCount {
  let day = days.get(key);
  if (!day) days.set(key, (day = emptyDay()));
  return day;
}

export function modelOf(day: DayCount, model: string): ModelNumbers {
  let numbers = day.models.get(model);
  if (!numbers) day.models.set(model, (numbers = { ...ZERO }));
  return numbers;
}

// ---------- reading untrusted values ----------

type Rec = Record<string, unknown>;
const NOTHING: Rec = Object.freeze({});

const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Own fields only, so a field named like something on Object.prototype reads as missing. */
const get = (o: Rec, key: string): unknown => (Object.hasOwn(o, key) ? o[key] : undefined);
const rec = (o: Rec, key: string): Rec => {
  const x = get(o, key);
  return isRec(x) ? x : NOTHING;
};
const list = (o: Rec, key: string): readonly unknown[] => {
  const x = get(o, key);
  return Array.isArray(x) ? x : [];
};
const str = (o: Rec, key: string): string | null => {
  const x = get(o, key);
  return typeof x === 'string' ? x : null;
};

const MAX_ID_LENGTH = 200;

/** The id and update time of a conversation, or null when the value is not a conversation. */
export function conversationHead(value: unknown): { id: string | null; updateTime: number | null } | null {
  if (!isRec(value) || !isRec(get(value, 'mapping'))) return null;
  const usable = (id: string | null) => (id !== null && id !== '' && id.length <= MAX_ID_LENGTH ? id : null);
  return {
    // Real exports carry the same id under both names.
    id: usable(str(value, 'conversation_id')) ?? usable(str(value, 'id')),
    updateTime: normaliseTime(get(value, 'update_time')),
  };
}

// ---------- tokens of a text ----------

const NO_SPECIAL_TOKENS: Set<string> = new Set();

// The tokenizer first cuts a text into pieces: a word, up to three digits, a run of signs with the
// line breaks and slashes after it, a run of white space. Then it works on each piece, and that work
// grows with the square of the piece's length. Ordinary text has short pieces. A pasted gene
// sequence, a page of Chinese, or a file built to stall the page has not.
//
// So a text is handed over in parts. It is cut wherever more than `maxRun` characters went by
// without a place where a new piece certainly begins. Only these places are certain: next to an
// ASCII digit, between an ASCII letter and an ASCII sign or any white space, and between white space
// and a character outside ASCII. A character outside ASCII can be a letter, a mark on a letter or a
// sign, so it ends no run of letters and no run of signs. A sign and white space end nothing between
// them either, because of the line breaks a run of signs takes along. That leaves a piece at most
// twice `maxRun` long, and a little.
const DIGIT = 0;
const LETTER = 1;
const SIGN = 2;
const SPACE = 3;
const BEYOND_ASCII = 4;

function kindOf(c: number): number {
  if (c < 128) {
    if (c === 32 || (c >= 9 && c <= 13)) return SPACE;
    if (c >= 48 && c <= 57) return DIGIT;
    const lower = c | 32;
    return lower >= 97 && lower <= 122 ? LETTER : SIGN;
  }
  // Exactly the white space a regular expression's \s knows. One more here would hide a run of signs.
  if (c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff) return SPACE;
  return BEYOND_ASCII;
}

/** NEW_PIECE[5 * before + after] is 1 when a new piece certainly begins between two characters of these kinds. */
const NEW_PIECE = new Uint8Array(25);
for (let kind = 0; kind < 5; kind++) NEW_PIECE[5 * DIGIT + kind] = NEW_PIECE[5 * kind + DIGIT] = 1;
for (const [a, b] of [[LETTER, SIGN], [LETTER, SPACE], [BEYOND_ASCII, SPACE]] as const) NEW_PIECE[5 * a + b] = NEW_PIECE[5 * b + a] = 1;

function countBounded(text: string, count: CountTokens, maxRun: number): number {
  let cuts: number[] | null = null;
  let kind = DIGIT;
  let run = 0;
  let previous = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const k = kindOf(c);
    if (NEW_PIECE[5 * kind + k]) {
      run = 1;
    } else if (++run > maxRun && !(c >= 0xdc00 && c <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff)) {
      // Never between the two halves of one character.
      (cuts ??= []).push(i);
      run = 1;
    }
    kind = k;
    previous = c;
  }
  if (!cuts) return count(text, { disallowedSpecial: NO_SPECIAL_TOKENS });
  let total = 0;
  let start = 0;
  for (const cut of cuts) {
    total += count(text.slice(start, cut), { disallowedSpecial: NO_SPECIAL_TOKENS });
    start = cut;
  }
  return total + count(text.slice(start), { disallowedSpecial: NO_SPECIAL_TOKENS });
}

type Warn = (code: WarningCode, count?: number) => void;

/** Tokens of text pieces joined by line breaks. The joined text lives only inside this call. */
function tokensOf(pieces: readonly string[], count: CountTokens, limits: Limits, warn: Warn): number {
  let length = pieces.length - 1;
  for (const piece of pieces) length += piece.length;
  if (length <= 0) return 0;
  let text: string;
  if (length <= limits.maxMessageChars) {
    text = pieces.join('\n');
  } else {
    warn('message-too-long');
    text = '';
    for (let i = 0; i < pieces.length && text.length < limits.maxMessageChars; i++) {
      text += (i === 0 ? '' : '\n') + (pieces[i] ?? '').slice(0, limits.maxMessageChars - text.length);
    }
    text = text.slice(0, limits.maxMessageChars);
  }
  let tokens: number;
  try {
    tokens = countBounded(text, count, limits.maxRunChars);
    if (!Number.isFinite(tokens) || tokens < 0) throw new RangeError('not a count');
  } catch {
    warn('message-not-tokenized');
    tokens = Math.ceil(text.length / 4);
  }
  return text.length < length ? Math.round((tokens * length) / text.length) : tokens;
}

// ---------- one message ----------

const USER = 1;
const ASSISTANT = 2;
const TOOL = 3;
const SYSTEM = 4;
const OTHER = 5;
const ROLES: ReadonlyMap<string, number> = new Map([['user', USER], ['assistant', ASSISTANT], ['tool', TOOL], ['system', SYSTEM]]);

const TEXT_FIELD: ReadonlyMap<string, string> = new Map([
  ['code', 'text'], ['execution_output', 'text'], ['tether_quote', 'text'], ['system_error', 'text'], ['tether_browsing_display', 'result'],
]);
const NO_TEXT_TYPES: ReadonlySet<string> = new Set(['thoughts', 'reasoning_recap', 'model_editable_context', 'app_pairing_content']);
const HIDDEN_TYPES: ReadonlySet<string> = new Set(['user_editable_context', 'model_editable_context', 'app_pairing_content']);
const FILE_TEXT_TOOLS: ReadonlySet<string> = new Set(['file_search', 'myfiles_browser']);

// A model name goes into the reading and from there onto the page, so only short plain names pass.
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function modelName(value: unknown, warn: Warn): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && MODEL_NAME.test(value)) return value;
  warn('model-name-ignored');
  return null;
}

/**
 * The text pieces of a message that count, by content type, with the citation markers taken out.
 * Unknown types have none.
 */
function textPieces(content: Rec, type: string | null, warn: Warn): string[] {
  const out: string[] = [];
  for (const piece of rawPieces(content, type, warn)) out.push(withoutMarkers(piece));
  return out;
}

function rawPieces(content: Rec, type: string | null, warn: Warn): string[] {
  const out: string[] = [];
  if (type === 'text' || type === 'multimodal_text') {
    for (const part of list(content, 'parts')) {
      if (typeof part === 'string') out.push(part);
      else if (isRec(part) && get(part, 'content_type') === 'audio_transcription') out.push(str(part, 'text') ?? '');
    }
  } else if (type === 'user_editable_context') {
    out.push(str(content, 'user_profile') ?? '', str(content, 'user_instructions') ?? '');
  } else {
    const field = type === null ? undefined : TEXT_FIELD.get(type);
    if (field !== undefined) out.push(str(content, field) ?? '');
    else if (type === null || !NO_TEXT_TYPES.has(type)) warn('unknown-content-type');
  }
  return out;
}

interface Request {
  /** Filled in once every node was seen: see "The model of each request" below. */
  model: string;
  /** The first output node of the run. */
  start: number;
  /** The latest output node of the run that has a `model_slug`, and the same for `resolved_model_slug`. -1 for none. */
  named: number;
  resolved: number;
  /** The nearest earlier request on the same path, as a place in the list of requests. -1 for none. */
  previous: number;
  /**
   * Unix seconds: the time of the first output node, else of its nearest ancestor that has one, else
   * of the conversation. null when none of them has a time.
   */
  time: number | null;
  /** The earlier prompt that the previous request already read. Read again by this one. */
  prefix: number;
  previousAnswer: number;
  fresh: number;
  output: number;
  thinkingSeconds: number;
  timed: boolean;
  files: number;
  filesWithCount: number;
  images: number;
  oldBrowser: boolean;
  sources: number;
  toolCall: boolean;
  turn: number;
}

/**
 * Counts one element of a conversations file. `now` is Unix seconds: a time more than a day later
 * is not believed. `toDayIndex` gives the day number of a time in the Reading's calendar.
 */
export function countConversation(
  value: unknown,
  count: CountTokens,
  now: number,
  limits: Limits,
  toDayIndex: (seconds: number) => number,
): ConversationCount | 'not-a-conversation' | 'conversation-too-large' {
  const head = conversationHead(value);
  if (!isRec(value) || head === null) return 'not-a-conversation';
  const mapping = rec(value, 'mapping');
  const keys = Object.keys(mapping);
  if (keys.length > limits.maxNodes) return 'conversation-too-large';

  const warnings = new Map<WarningCode, number>();
  const warn: Warn = (code, by = 1) => {
    if (by > 0) warnings.set(code, (warnings.get(code) ?? 0) + by);
  };

  // Only `parent` builds the tree. `children` is missing or empty in current exports, and
  // `metadata.parent_id` often names a message that is not in the file.
  const index = new Map<string, number>();
  const nodes: Rec[] = [];
  for (const key of keys) {
    const node = mapping[key];
    if (isRec(node)) {
      index.set(key, nodes.length);
      nodes.push(node);
    }
  }
  const n = nodes.length;

  const parent = new Int32Array(n).fill(-1);
  const role = new Uint8Array(n);
  const hasMessage = new Uint8Array(n);
  const tokens = new Float64Array(n);
  const ownTime = new Float64Array(n).fill(NaN);
  const isOutput = new Uint8Array(n);
  const isRecap = new Uint8Array(n);
  const recapTime = new Float64Array(n).fill(NaN);
  const isCustom = new Uint8Array(n);
  const isPrompt = new Uint8Array(n);
  const toolCall = new Uint8Array(n);
  const oldBrowser = new Uint8Array(n);
  const sources = new Int32Array(n);
  const images = new Int32Array(n);
  const fileTokens = new Float64Array(n);
  const filesWithCount = new Int32Array(n);
  const filesWithoutCount = new Int32Array(n);
  const named: Array<string | null> = new Array<string | null>(n).fill(null);
  const resolved: Array<string | null> = new Array<string | null>(n).fill(null);
  const hasTranscript = new Uint8Array(n);
  const showsMemory = new Uint8Array(n);
  let fileTextExported = false;
  let memorySeen = false;
  let recaps = 0;

  for (let i = 0; i < n; i++) {
    const node = nodes[i] ?? NOTHING;
    const p = str(node, 'parent');
    const parentIndex = p === null ? undefined : index.get(p);
    if (parentIndex !== undefined) parent[i] = parentIndex;

    const message = get(node, 'message');
    if (!isRec(message)) continue;
    hasMessage[i] = 1;
    const author = rec(message, 'author');
    const roleName = str(author, 'role');
    const r = roleName === null ? OTHER : (ROLES.get(roleName) ?? OTHER);
    role[i] = r;
    const toolName = str(author, 'name');
    const content = rec(message, 'content');
    const type = str(content, 'content_type');
    const metadata = rec(message, 'metadata');

    const rawTime = get(message, 'create_time');
    const time = normaliseTime(rawTime);
    if (time !== null) ownTime[i] = time;
    if (time === null && rawTime !== null && rawTime !== undefined) warn('unusable-time');
    else if (isMilliseconds(rawTime)) warn('time-in-milliseconds');

    const pieces = textPieces(content, type, warn);
    let t = tokensOf(pieces, count, limits, warn);
    if (type === 'text' || type === 'multimodal_text') {
      for (const part of list(content, 'parts')) {
        if (isRec(part) && get(part, 'content_type') === 'audio_transcription') hasTranscript[i] = 1;
      }
    }

    if (r === USER) {
      const imageIds = new Set<string>();
      let seen = 0;
      for (const part of list(content, 'parts')) {
        if (!isRec(part) || get(part, 'content_type') !== 'image_asset_pointer') continue;
        if (++seen > limits.maxAttachments) continue;
        const width = get(part, 'width');
        const height = get(part, 'height');
        if (!isImageSize(width, height)) warn('image-size-unknown');
        t += imageTokens(width, height);
        images[i] = (images[i] ?? 0) + 1;
        const pointer = str(part, 'asset_pointer');
        if (pointer !== null) imageIds.add(pointer.includes('//') ? pointer.slice(pointer.lastIndexOf('//') + 2) : pointer);
      }
      warn('attachment-over-limit', seen - limits.maxAttachments);

      seen = 0;
      for (const attachment of list(metadata, 'attachments')) {
        if (!isRec(attachment)) continue;
        const mime = get(attachment, 'mime_type') ?? get(attachment, 'mimeType');
        const id = get(attachment, 'id');
        // An image is counted by its size in pixels, above.
        if ((typeof mime === 'string' && mime.startsWith('image/')) || (typeof id === 'string' && imageIds.has(id))) continue;
        if (++seen > limits.maxAttachments) continue;
        const size = get(attachment, 'file_token_size') ?? get(attachment, 'fileSizeTokens');
        if (typeof size === 'number' && size >= 0 && size <= limits.maxFileTokens) {
          fileTokens[i] = (fileTokens[i] ?? 0) + Math.round(size);
          filesWithCount[i] = (filesWithCount[i] ?? 0) + 1;
        } else {
          if (size !== undefined && size !== null) warn('attachment-size-ignored');
          filesWithoutCount[i] = (filesWithoutCount[i] ?? 0) + 1;
        }
      }
      warn('attachment-over-limit', seen - limits.maxAttachments);
      const hidden = type !== null && HIDDEN_TYPES.has(type);
      if (!hidden && get(metadata, 'is_visually_hidden_from_conversation') !== true) isPrompt[i] = 1;
    }
    tokens[i] = t;

    if (type === 'user_editable_context' && t > 0) isCustom[i] = 1;
    if (r === TOOL) {
      if (toolName === 'browser' && t > 0) oldBrowser[i] = 1;
      if (toolName === 'bio') showsMemory[i] = 1;
      if (toolName !== null && FILE_TEXT_TOOLS.has(toolName) && pieces.some((piece) => /\S/.test(piece))) fileTextExported = true;
    }
    if (type === 'model_editable_context' || Object.hasOwn(metadata, 'conversation_context_citation_metadata')) showsMemory[i] = 1;
    if (showsMemory[i]) memorySeen = true;

    if (type === 'reasoning_recap') {
      isRecap[i] = 1;
      recaps++;
      const seconds = recapSeconds(get(metadata, 'finished_duration_sec'), get(content, 'content'));
      if (seconds === null) warn('thinking-time-unreadable');
      else if (seconds > MAX_THINK_SECONDS) warn('thinking-time-capped');
      if (seconds !== null) recapTime[i] = Math.min(seconds, MAX_THINK_SECONDS);
    }
    if (r === ASSISTANT) {
      // Messages addressed to a tool are output too: the search query, the code to run.
      if (type !== 'thoughts' && type !== 'reasoning_recap' && t > 0) isOutput[i] = 1;
      const recipient = str(message, 'recipient');
      if (recipient !== null && recipient !== '' && recipient !== 'all') toolCall[i] = 1;
      // Read from assistant messages only: some user, system and tool messages carry a name too.
      named[i] = modelName(get(metadata, 'model_slug'), warn);
      resolved[i] = modelName(get(metadata, 'resolved_model_slug'), warn);
      let listed = 0;
      for (const group of list(metadata, 'search_result_groups')) if (isRec(group)) listed += list(group, 'entries').length;
      warn('source-over-limit', listed - limits.maxSources);
      sources[i] = Math.min(listed, limits.maxSources);
    }
  }

  // When the export holds the text of uploaded files as tool messages, the files are counted there.
  for (let i = 0; i < n; i++) {
    if (fileTextExported) {
      filesWithCount[i] = 0;
      filesWithoutCount[i] = 0;
    } else {
      tokens[i] = (tokens[i] ?? 0) + (fileTokens[i] ?? 0);
    }
  }

  // The children of each node, in the order of the file.
  const firstKid = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const p = parent[i] ?? -1;
    if (p >= 0) firstKid[p + 1] = (firstKid[p + 1] ?? 0) + 1;
  }
  for (let i = 0; i < n; i++) firstKid[i + 1] = (firstKid[i + 1] ?? 0) + (firstKid[i] ?? 0);
  const kids = new Int32Array(n);
  const filled = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const p = parent[i] ?? -1;
    if (p < 0) continue;
    kids[(firstKid[p] ?? 0) + (filled[p] ?? 0)] = i;
    filled[p] = (filled[p] ?? 0) + 1;
  }

  // Every node below a root, parents before children. A node in a loop of parent links hangs below
  // no root and is never reached. The order is the reference's, because requests at the same second
  // are told apart by it.
  const order = new Int32Array(n);
  const stack = new Int32Array(n);
  let reached = 0;
  let top = 0;
  for (let i = 0; i < n; i++) if ((parent[i] ?? -1) < 0) stack[top++] = i;
  while (top > 0) {
    const i = stack[--top] ?? 0;
    order[reached++] = i;
    for (let k = firstKid[i] ?? 0, end = firstKid[i + 1] ?? 0; k < end; k++) stack[top++] = kids[k] ?? 0;
  }
  warn('unreachable-message', n - reached);

  // A message with no time has its nearest ancestor's, and with none above it the conversation's
  // `create_time`. Never `update_time` first: that would move a request with no time to the end of
  // its conversation, into another month and next to requests it did not follow.
  const timeFallback = normaliseTime(get(value, 'create_time')) ?? head.updateTime ?? NaN;

  // Per node, from its parent:
  // above       tokens of the node and all its ancestors
  // turn        the nearest message of the person at or above the node
  // start       the first output node of the run of assistant output the node is in
  // gap…        what lies between the node and the nearest output node above it, the node included
  // outAbove    that output node (the node itself when it is one)
  // time        the node's own time, else its nearest ancestor's, else the conversation's
  // answer      the first node of the answer the node is in: everything between two messages of the person
  // And per answer, under its first node: the latest assistant node that has a `model_slug`, and the
  // latest that has a `resolved_model_slug`.
  const above = new Float64Array(n);
  const turn = new Int32Array(n).fill(-1);
  const start = new Int32Array(n).fill(-1);
  const gapTokens = new Float64Array(n);
  const gapFiles = new Int32Array(n);
  const gapFilesWithCount = new Int32Array(n);
  const gapImages = new Int32Array(n);
  const gapOldBrowser = new Uint8Array(n);
  const outAbove = new Int32Array(n).fill(-1);
  const time = new Float64Array(n);
  const answer = new Int32Array(n);
  const answerNamed = new Int32Array(n).fill(-1);
  const answerResolved = new Int32Array(n).fill(-1);
  let customInstructions = false;
  // "Latest" goes by time. Nodes are visited parents first, so of two with the same time the one
  // seen later wins, and `candidate` is always that one.
  const stamp = (i: number): number => (Number.isNaN(time[i] ?? NaN) ? -Infinity : (time[i] ?? -Infinity));
  const later = (candidate: number, kept: number): boolean => kept < 0 || stamp(candidate) >= stamp(kept);

  for (let at = 0; at < reached; at++) {
    const i = order[at] ?? 0;
    const p = parent[i] ?? -1;
    const own = tokens[i] ?? 0;
    const r = role[i] ?? 0;
    above[i] = (p >= 0 ? (above[p] ?? 0) : 0) + own;
    turn[i] = r === USER ? i : p >= 0 ? (turn[p] ?? -1) : -1;
    if (r === ASSISTANT) {
      const run = p >= 0 && role[p] === ASSISTANT ? (start[p] ?? -1) : -1;
      start[i] = run >= 0 ? run : isOutput[i] ? i : -1;
    }
    if (isOutput[i]) {
      outAbove[i] = i;
    } else {
      gapTokens[i] = own + (p >= 0 ? (gapTokens[p] ?? 0) : 0);
      gapFiles[i] = (filesWithoutCount[i] ?? 0) + (p >= 0 ? (gapFiles[p] ?? 0) : 0);
      gapFilesWithCount[i] = (filesWithCount[i] ?? 0) + (p >= 0 ? (gapFilesWithCount[p] ?? 0) : 0);
      gapImages[i] = (images[i] ?? 0) + (p >= 0 ? (gapImages[p] ?? 0) : 0);
      gapOldBrowser[i] = oldBrowser[i] || (p >= 0 && gapOldBrowser[p]) ? 1 : 0;
      outAbove[i] = p >= 0 ? (outAbove[p] ?? -1) : -1;
    }
    const mine = ownTime[i] ?? NaN;
    time[i] = !Number.isNaN(mine) ? mine : p >= 0 ? (time[p] ?? NaN) : timeFallback;
    const first = p < 0 || role[p] === USER || !hasMessage[p] ? i : (answer[p] ?? i);
    answer[i] = first;
    if (r === ASSISTANT) {
      if (named[i] !== null && later(i, answerNamed[first] ?? -1)) answerNamed[first] = i;
      if (resolved[i] !== null && later(i, answerResolved[first] ?? -1)) answerResolved[first] = i;
    }
    if (isCustom[i]) customInstructions = true;
  }

  // Requests: one per run of output nodes. Every node is visited, so abandoned branches and
  // regenerated answers count, and each request looks only at its own ancestors.
  const requests: Request[] = [];
  const requestOf = new Int32Array(n).fill(-1);
  for (let at = 0; at < reached; at++) {
    const i = order[at] ?? 0;
    if (!isOutput[i]) continue;
    const first = start[i] ?? i;
    if (first !== i) {
      // A later node of a run, on whichever branch it sits.
      const request = requests[requestOf[first] ?? -1];
      if (request) {
        request.output += tokens[i] ?? 0;
        request.sources = Math.max(request.sources, sources[i] ?? 0);
        if (!toolCall[i]) request.toolCall = false;
        if (named[i] !== null && later(i, request.named)) request.named = i;
        if (resolved[i] !== null && later(i, request.resolved)) request.resolved = i;
      }
      continue;
    }
    const p = parent[i] ?? -1;
    const before = p >= 0 ? (outAbove[p] ?? -1) : -1;
    let prefix = 0;
    let previousAnswer = 0;
    if (before >= 0) {
      const runStart = start[before] ?? before;
      const q = parent[runStart] ?? -1;
      prefix = q >= 0 ? (above[q] ?? 0) : 0;
      previousAnswer = (above[before] ?? 0) - prefix;
    }
    const when = time[i] ?? NaN;
    requestOf[i] = requests.length;
    requests.push({
      model: NO_MODEL_NAME,
      start: i,
      named: named[i] !== null ? i : -1,
      resolved: resolved[i] !== null ? i : -1,
      previous: before >= 0 ? (requestOf[start[before] ?? before] ?? -1) : -1,
      time: Number.isNaN(when) ? null : when,
      prefix,
      previousAnswer,
      fresh: p >= 0 ? (gapTokens[p] ?? 0) : 0,
      output: tokens[i] ?? 0,
      thinkingSeconds: 0,
      timed: false,
      files: p >= 0 ? (gapFiles[p] ?? 0) : 0,
      filesWithCount: p >= 0 ? (gapFilesWithCount[p] ?? 0) : 0,
      images: p >= 0 ? (gapImages[p] ?? 0) : 0,
      oldBrowser: p >= 0 && gapOldBrowser[p] === 1,
      sources: sources[i] ?? 0,
      toolCall: toolCall[i] === 1,
      turn: turn[i] ?? -1,
    });
  }

  // The model of each request, the first of these that exists: the `model_slug` of the run's latest
  // output node that has one; that of the latest other assistant node of the same answer (in
  // current exports often only the thinking line carries the name); `resolved_model_slug` on those
  // nodes, in the same order; the model of the nearest earlier request on the same path; the
  // conversation's `default_model_slug`. That last one is the setting of the model picker, so
  // "auto" is no model. A request is listed after every request above it, so one pass is enough.
  const picked = modelName(get(value, 'default_model_slug'), warn);
  const defaultModel = picked === null || picked === 'auto' ? NO_MODEL_NAME : picked;
  const nameAt = (names: ReadonlyArray<string | null>, i: number): string | null => (i >= 0 ? (names[i] ?? null) : null);
  for (const request of requests) {
    const first = answer[request.start] ?? request.start;
    request.model =
      nameAt(named, request.named) ?? nameAt(named, answerNamed[first] ?? -1)
      ?? nameAt(resolved, request.resolved) ?? nameAt(resolved, answerResolved[first] ?? -1)
      ?? requests[request.previous]?.model ?? defaultModel;
  }

  const days = new Map<number, DayCount>();
  const place = (seconds: number | null): number =>
    seconds === null || Number.isNaN(seconds) || seconds > now + 86_400 ? UNDATED : toDayIndex(seconds);

  // Thinking times. A recap belongs to the request that comes next below it. When none follows,
  // it belongs to the run it sits in.
  // The turn sets are indexed by turn + 1, so "no turn" has a place too.
  const turnTimed = new Uint8Array(n + 1);
  const turnUntimed = new Uint8Array(n + 1);
  if (recaps > 0) {
    const firstOutputKid = new Int32Array(n).fill(-1);
    const firstAssistantKid = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const p = parent[i] ?? -1;
      if (p < 0 || role[i] !== ASSISTANT) continue;
      if ((firstAssistantKid[p] ?? -1) < 0) firstAssistantKid[p] = i;
      if (isOutput[i] && (firstOutputKid[p] ?? -1) < 0) firstOutputKid[p] = i;
    }
    // The run that comes next below each node, children before parents.
    const next = new Int32Array(n).fill(-1);
    for (let at = reached - 1; at >= 0; at--) {
      const i = order[at] ?? 0;
      const outputKid = firstOutputKid[i] ?? -1;
      const assistantKid = firstAssistantKid[i] ?? -1;
      next[i] = outputKid >= 0 ? (start[outputKid] ?? -1) : assistantKid >= 0 ? (next[assistantKid] ?? -1) : -1;
    }
    for (let at = 0; at < reached; at++) {
      const i = order[at] ?? 0;
      if (!isRecap[i]) continue;
      dayOf(days, place(time[i] ?? NaN)).recaps++;
      const seconds = recapTime[i] ?? NaN;
      const turnSlot = (turn[i] ?? -1) + 1;
      if (Number.isNaN(seconds)) {
        turnUntimed[turnSlot] = 1;
        continue;
      }
      const target = (next[i] ?? -1) >= 0 ? (next[i] ?? -1) : (start[i] ?? -1);
      const request = target >= 0 ? requests[requestOf[target] ?? -1] : undefined;
      if (request) {
        request.thinkingSeconds += seconds;
        request.timed = true;
        turnTimed[turnSlot] = 1;
      } else {
        warn('thinking-time-unplaced');
      }
    }
  }

  // Messages, prompts and answers, each on the day of its own time.
  const answerCounted = new Uint8Array(n);
  let lastMessage: number | null = null;
  for (let at = 0; at < reached; at++) {
    const i = order[at] ?? 0;
    if (!hasMessage[i]) continue;
    const key = place(time[i] ?? NaN);
    const day = dayOf(days, key);
    day.messages++;
    if (isPrompt[i]) day.prompts++;
    if (hasTranscript[i]) day.transcripts++;
    if (showsMemory[i]) day.memoryMessages++;
    if (key !== UNDATED && (lastMessage === null || (time[i] ?? 0) > lastMessage)) lastMessage = time[i] ?? null;
    if (role[i] !== ASSISTANT) continue;
    const first = answer[i] ?? i;
    if (answerCounted[first]) continue;
    answerCounted[first] = 1;
    dayOf(days, place(time[first] ?? NaN)).answers++;
  }

  // Warm or cold goes by the previous request of the conversation in time, on any branch.
  const sortTime = (r: Request) => r.time ?? Infinity;
  const sorted = [...requests].sort((a, b) => (sortTime(a) < sortTime(b) ? -1 : sortTime(a) > sortTime(b) ? 1 : 0));
  const timedSeconds = sorted.filter((r) => r.timed).map((r) => r.thinkingSeconds).sort((a, b) => a - b);
  // The median: with an even number of timed requests, the mean of the two in the middle.
  const middle = timedSeconds.length >> 1;
  const medianSeconds = timedSeconds.length === 0
    ? DEFAULT_THINK_SECONDS
    : timedSeconds.length % 2 === 1 ? (timedSeconds[middle] ?? 0) : ((timedSeconds[middle - 1] ?? 0) + (timedSeconds[middle] ?? 0)) / 2;

  let firstRequest: number | null = null;
  let lastRequest: number | null = null;
  let previous: Request | undefined;
  for (const r of sorted) {
    const warm = previous !== undefined && (r.time === null ? previous.time === null : previous.time !== null && r.time - previous.time <= WARM_SECONDS);
    previous = r;
    const key = place(r.time);
    if (key === UNDATED) warn(r.time === null ? 'request-without-time' : 'request-in-future');
    else if (r.time !== null) {
      if (firstRequest === null || r.time < firstRequest) firstRequest = r.time;
      if (lastRequest === null || r.time > lastRequest) lastRequest = r.time;
    }
    const m = modelOf(dayOf(days, key), r.model);
    const kind = isThinkingSlug(r.model) ? 'thinking' : 'instant';
    const free = Math.min(r.prefix, CEILING.free[kind]);
    const paid = Math.min(r.prefix, CEILING.paid[kind]);
    m.requests++;
    m.output += r.output;
    m.newInput += r.fresh + r.previousAnswer;
    if (warm) {
      m.rereadWarmFree += free;
      m.rereadWarmPaid += paid;
    } else {
      m.coldRequests++;
      m.rereadColdFree += free;
      m.rereadColdPaid += paid;
    }
    if (r.prefix > CEILING.free[kind]) m.cutFree++;
    if (r.prefix > CEILING.paid[kind]) m.cutPaid++;

    if (r.timed) {
      m.thinkingSeconds += r.thinkingSeconds;
      m.thinkingRecorded++;
    } else if (!r.toolCall && !turnTimed[r.turn + 1] && (isThinkingSlug(r.model) || turnUntimed[r.turn + 1])) {
      // It thought, and the export does not say for how long.
      m.thinkingSecondsAssumed += medianSeconds;
      m.thinkingAssumed++;
    }
    m.promptReadings += promptWeight(r.model, r.time);
    // The old browser tool's results are in the export and counted as text already.
    if (r.sources > 0 && !r.oldBrowser) {
      m.sources += r.sources;
      m.searchRequests++;
    }
    m.filesWithoutCount += r.files;
    m.filesWithCount += r.filesWithCount;
    m.images += r.images;
  }

  return {
    id: head.id,
    updateTime: head.updateTime,
    days,
    firstRequest,
    lastRequest,
    lastMessage,
    memorySeen,
    customInstructions,
    warnings,
  };
}
