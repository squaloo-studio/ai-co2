// Two ready-made what-ifs for tips.
//
// A tip's `change` takes a usage and returns a new one. It never edits what it is given: the estimator
// hands it a frozen copy, so an edit throws. It keeps every piece of hidden work, in the same order.
// It may change a piece's rows or switch a piece off.

import { fail, isList, isPlain, onlyKeys } from './guard';
import { TOKEN_TYPES, isTokenType } from './table';
import type { MoveShareSpec, Row, ScaleTokensSpec, TokenType, TokenUsage } from './types';

interface Where {
  models: readonly string[] | undefined;
  sizeClass: string | undefined;
  includes: string | undefined;
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

const isNames = (x: unknown): x is readonly string[] => isList(x) && x.every((name) => typeof name === 'string');

/** Checks which rows a what-if is meant for. */
function readWhere(where: unknown, name: string): Where | null {
  if (where === undefined) return null;
  if (!isPlain(where)) return fail(`${name}: "where" must be an object such as { models: ["claude-opus-5-5"] }`);
  onlyKeys(where, ['models', 'sizeClass', 'modelIncludes'], `${name}: "where"`);
  const { models, sizeClass, modelIncludes } = where;
  if (models !== undefined && !isNames(models)) return fail(`${name}: "where.models" must be a list of model names`);
  if (sizeClass !== undefined && typeof sizeClass !== 'string') return fail(`${name}: "where.sizeClass" must be a size class`);
  if (modelIncludes !== undefined && typeof modelIncludes !== 'string') return fail(`${name}: "where.modelIncludes" must be text`);
  return {
    models,
    sizeClass,
    // Capitals are ignored on both sides: "Opus" finds "claude-opus-5-5".
    includes: modelIncludes === undefined ? undefined : modelIncludes.toLowerCase(),
  };
}

function rowMatches(row: Row, where: Where | null): boolean {
  if (!where) return true;
  if (where.models !== undefined && !where.models.includes(row.model)) return false;
  if (where.sizeClass !== undefined && row.sizeClass !== where.sizeClass) return false;
  if (where.includes !== undefined && !String(row.model).toLowerCase().includes(where.includes)) return false;
  return true;
}

/**
 * What-if: a share of the matching rows' tokens is handled by a model of another size class instead.
 * Rows that are already in that class stay as they are.
 */
export function moveShare(spec: MoveShareSpec): (usage: TokenUsage) => TokenUsage {
  const given: unknown = spec;
  if (!isPlain(given)) return fail('moveShare needs { where, toClass, share }');
  onlyKeys(given, ['where', 'toClass', 'share', 'toModel', 'hidden'], 'moveShare');
  const { toClass, share, toModel, hidden } = given;
  if (typeof toClass !== 'string' || toClass === '') return fail('moveShare needs "toClass": the size class the tokens move to');
  if (!(typeof share === 'number' && share >= 0 && share <= 1)) return fail('moveShare needs "share": a number from 0 to 1');
  if (toModel !== undefined && (typeof toModel !== 'string' || toModel === '')) return fail('moveShare: "toModel" must be a name');
  if (hidden !== undefined && typeof hidden !== 'boolean') return fail('moveShare: "hidden" must be true or false');
  const where = readWhere(given.where, 'moveShare');

  const moveRows = (list: readonly Row[]): Row[] => {
    const rows: Row[] = [];
    for (const row of list) {
      if (!rowMatches(row, where) || row.sizeClass === toClass) {
        rows.push(row);
        continue;
      }
      const kept: Writable<Row> = { ...row };
      const moved: Writable<Row> = { ...row, sizeClass: toClass, model: toModel || `${row.model} (moved to ${toClass})` };
      for (const type of TOKEN_TYPES) {
        const count = row[type] || 0;
        const part = count * share;
        moved[type] = part;
        kept[type] = count - part;
      }
      rows.push(kept, moved);
    }
    return rows;
  };
  return (usage) => ({
    rows: moveRows(usage.rows),
    hidden: hidden === true ? usage.hidden.map((item) => ({ ...item, rows: moveRows(item.rows) })) : usage.hidden,
  });
}

const isTokenTypes = (x: unknown): x is readonly TokenType[] => isList(x) && x.length > 0 && x.every(isTokenType);

/** What-if: the matching rows keep only `factor` of the named token types. */
export function scaleTokens(spec: ScaleTokensSpec): (usage: TokenUsage) => TokenUsage {
  const given: unknown = spec;
  if (!isPlain(given)) return fail('scaleTokens needs { types, factor }');
  onlyKeys(given, ['where', 'types', 'factor', 'hiddenId'], 'scaleTokens');
  const { factor, hiddenId } = given;
  if (!isTokenTypes(given.types)) return fail(`scaleTokens needs "types": one or more of ${TOKEN_TYPES.join(', ')}`);
  const types = [...given.types];
  if (!(typeof factor === 'number' && Number.isFinite(factor) && factor >= 0)) return fail('scaleTokens needs "factor": a number, 0 or more');
  if (hiddenId !== undefined && typeof hiddenId !== 'string') return fail('scaleTokens: "hiddenId" must be the id of a piece of hidden work');
  const where = readWhere(given.where, 'scaleTokens');

  const scaleRows = (rows: readonly Row[]): Row[] => rows.map((row) => {
    if (!rowMatches(row, where)) return row;
    const next: Writable<Row> = { ...row };
    for (const type of types) next[type] = (row[type] || 0) * factor;
    return next;
  });
  return (usage) => {
    if (hiddenId === undefined) return { rows: scaleRows(usage.rows), hidden: usage.hidden };
    if (!usage.hidden.some((item) => item.id === hiddenId)) return fail(`scaleTokens: there is no hidden work called "${hiddenId}"`);
    const hidden = usage.hidden.map((item) => (item.id === hiddenId ? { ...item, rows: scaleRows(item.rows) } : item));
    return { rows: usage.rows, hidden };
  };
}
