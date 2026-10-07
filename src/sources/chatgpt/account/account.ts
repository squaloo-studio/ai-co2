// The counting half of the ChatGPT reader. It takes the conversations of an export one at a time,
// keeps a few numbers of each, and puts them together into a Reading at the end.
//
// This file loads the tokenizer, so it belongs in the worker. The page imports reading.ts.

import type { ConversationSink } from '../types';
import {
  DAY_FIELDS, LIMITS, MODEL_FIELDS, UNDATED,
  conversationHead, countConversation, dayOf, emptyDay, modelOf,
  type ConversationCount, type CountTokens, type DayCount, type Limits,
} from './count';
import { dayIndexIn, dayName, NO_MODEL_NAME, type Calendar, type Day, type ModelDay, type Reading, type WarningCode } from './reading';
import { normaliseTime } from './rules';
import { countO200k } from './tokens';

export interface AccountOptions {
  /**
   * The time of reading, as Unix seconds: `Date.now() / 1000`. Left out, it is the worker's clock.
   * A message dated more than a day later is not believed.
   */
  now?: number;
  /**
   * The calendar the days of the Reading follow. The page passes 'local', so that "the last 30 days"
   * end today on the person's own calendar. Left out, it is 'utc'.
   */
  calendar?: Calendar;
  /** The tokenizer. Left out, it is o200k_base. Tests pass a simple one so that numbers can be checked by hand. */
  countTokens?: CountTokens;
  /** Tests count small conversations against small limits. The page never sets this. */
  limits?: Partial<Limits>;
}

/** Keeps the later of two copies of a conversation. With equal or missing times the first one stays. */
const isLater = (a: number | null, b: number | null): boolean => (a ?? -Infinity) > (b ?? -Infinity);

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * The options arrive in a message from the page, so nothing about them is taken for granted: a value
 * of the wrong kind counts as left out.
 */
function readOptions(options: AccountOptions | undefined): { count: CountTokens; now: number; calendar: Calendar; limits: Limits } {
  const given: AccountOptions = isRecord(options) ? options : {};
  const limits: Limits = { ...LIMITS };
  if (isRecord(given.limits)) {
    for (const key of Object.keys(LIMITS) as Array<keyof Limits>) {
      const value: unknown = given.limits[key];
      if (typeof value === 'number' && value >= 1) limits[key] = value;
    }
  }
  return {
    count: typeof given.countTokens === 'function' ? given.countTokens : countO200k,
    // The same rule as for the times in the export, so a `now` in milliseconds is read as what it means.
    now: normaliseTime(given.now) ?? Date.now() / 1000,
    calendar: given.calendar === 'local' ? 'local' : 'utc',
    limits,
  };
}

export function createAccount(options?: AccountOptions): ConversationSink<Reading> {
  const { count, now, calendar, limits } = readOptions(options);
  const toDayIndex = (seconds: number): number => dayIndexIn(calendar, seconds);

  // Two exports dropped together repeat conversations. Keeping one small count per id lets the
  // later copy replace the earlier one.
  const byId = new Map<string, ConversationCount>();
  const withoutId: ConversationCount[] = [];
  const warnings = new Map<WarningCode, number>();
  const warn = (code: WarningCode, by = 1): void => {
    warnings.set(code, (warnings.get(code) ?? 0) + by);
  };
  let plusUser: boolean | null = null;

  return {
    add(conversation) {
      const head = conversationHead(conversation);
      if (head === null) {
        warn('not-a-conversation');
        return false;
      }
      const known = head.id === null ? undefined : byId.get(head.id);
      if (known) {
        warn('duplicate-conversation');
        if (!isLater(head.updateTime, known.updateTime)) return false;
      }
      let counted: ReturnType<typeof countConversation>;
      try {
        counted = countConversation(conversation, count, now, limits, toDayIndex);
      } catch {
        // Nothing known throws. This keeps one conversation that breaks the code from ending the whole reading.
        warn('conversation-failed');
        return false;
      }
      if (typeof counted === 'string') {
        warn(counted);
        return false;
      }
      if (counted.id === null) withoutId.push(counted);
      else byId.set(counted.id, counted);
      return true;
    },

    setUser(user) {
      const first: unknown = Array.isArray(user) ? user[0] : user;
      if (!isRecord(first) || !Object.hasOwn(first, 'chatgpt_plus_user')) return;
      const flag = first['chatgpt_plus_user'];
      if (typeof flag === 'boolean') plusUser = flag;
    },

    counted: () => byId.size + withoutId.length,

    finish() {
      const all = [...byId.values(), ...withoutId];
      const total = new Map(warnings);
      const days = new Map<number, DayCount>();
      const conversationDays: number[][] = [];
      let firstRequest: number | null = null;
      let lastRequest: number | null = null;
      let lastMessage: number | null = null;
      let memorySeen = false;
      let conversationsWithCustomInstructions = 0;
      const requestsOf = new Map<string, number>();

      for (const c of all) {
        for (const [code, by] of c.warnings) total.set(code, (total.get(code) ?? 0) + by);
        const active: number[] = [];
        for (const [key, from] of c.days) {
          const into = dayOf(days, key);
          for (const field of DAY_FIELDS) into[field] += from[field];
          if (key !== UNDATED && from.messages > 0) active.push(key);
          for (const [model, numbers] of from.models) {
            const sum = modelOf(into, model);
            for (const field of MODEL_FIELDS) sum[field] += numbers[field];
            requestsOf.set(model, (requestsOf.get(model) ?? 0) + numbers.requests);
          }
        }
        conversationDays.push(active.sort((a, b) => a - b));
        if (c.firstRequest !== null && (firstRequest === null || c.firstRequest < firstRequest)) firstRequest = c.firstRequest;
        if (c.lastRequest !== null && (lastRequest === null || c.lastRequest > lastRequest)) lastRequest = c.lastRequest;
        if (c.lastMessage !== null && (lastMessage === null || c.lastMessage > lastMessage)) lastMessage = c.lastMessage;
        if (c.memorySeen) memorySeen = true;
        if (c.customInstructions) conversationsWithCustomInstructions++;
      }
      if (withoutId.length > 0) total.set('conversation-without-id', withoutId.length);

      // A file can name any number of models. The page shows a row for each, so the rare ones are put together.
      let kept: Set<string> | null = null;
      if (requestsOf.size > limits.maxModels) {
        const names = [...requestsOf.keys()].filter((name) => name !== NO_MODEL_NAME);
        names.sort((a, b) => (requestsOf.get(b) ?? 0) - (requestsOf.get(a) ?? 0) || (a < b ? -1 : 1));
        kept = new Set(names.slice(0, limits.maxModels - 1));
        total.set('model-name-over-limit', names.length - kept.size);
      }

      const toDay = (key: number, from: DayCount): Day => {
        const { models: perModel, ...numbers } = from;
        const models = new Map<string, ModelDay>();
        for (const [name, counts] of perModel) {
          const model = kept === null || kept.has(name) ? name : NO_MODEL_NAME;
          const sum = models.get(model);
          if (!sum) models.set(model, { model, ...counts });
          else for (const field of MODEL_FIELDS) sum[field] += counts[field];
        }
        return {
          day: key === UNDATED ? '' : dayName(key),
          ...numbers,
          models: [...models.values()].sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0)),
        };
      };

      return {
        calendar,
        conversations: all.length,
        conversationDays,
        days: [...days.keys()].filter((key) => key !== UNDATED).sort((a, b) => a - b).map((key) => toDay(key, days.get(key) ?? emptyDay())),
        undated: toDay(UNDATED, days.get(UNDATED) ?? emptyDay()),
        firstRequest,
        lastRequest,
        lastMessage,
        plusUser,
        memorySeen,
        conversationsWithCustomInstructions,
        warnings: [...total].filter(([, by]) => by > 0).map(([code, by]) => ({ code, count: by })).sort((a, b) => (a.code < b.code ? -1 : 1)),
      };
    },
  };
}
