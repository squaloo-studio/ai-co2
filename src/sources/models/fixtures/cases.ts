// The 280 checked names from model-cases.json, read once for every test.

import type { ClassifyOptions } from '../types';
import rawCases from './model-cases.json';

export interface Case {
  name: string;
  class: string;
  displayName: string;
  thinking: boolean;
  /** The cases give a reason for unknown names only. */
  reason: string | undefined;
  /** The cases file says `paidPlan`: true is Plus or Pro, false is Free or Go, anything else is not a plan. */
  options: ClassifyOptions | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readCase(value: unknown): Case {
  if (!isRecord(value)) throw new Error('a case is not an object');
  const { name, displayName, thinking, reason, context } = value;
  const cls = value['class'];
  if (typeof name !== 'string' || typeof cls !== 'string' || typeof displayName !== 'string') {
    throw new Error(`a case lacks a field: ${JSON.stringify(value)}`);
  }
  if (typeof thinking !== 'boolean') throw new Error(`no thinking in ${name}`);
  if (reason !== undefined && typeof reason !== 'string') throw new Error(`bad reason in ${name}`);
  let options: ClassifyOptions | undefined;
  if (isRecord(context)) {
    const paid = context['paidPlan'];
    options = paid === true ? { plan: 'plus-or-pro' } : paid === false ? { plan: 'free-or-go' } : hostile({ plan: paid });
  }
  return { name, class: cls, displayName, thinking, reason, options };
}

/** Passes a value the types forbid, the way a careless caller could. */
export function hostile(value: unknown): ClassifyOptions {
  return value as ClassifyOptions;
}

export const cases: Case[] = (rawCases as unknown[]).map(readCase);
