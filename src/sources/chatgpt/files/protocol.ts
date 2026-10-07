// The messages between the page and the worker that reads the export. The page sends one request;
// the worker answers with progress a few times a second and then with exactly one last message.
// One worker serves one read: to cancel, the page ends the worker.

import type { ExportReport, ReadFailure, ReadProgress } from './report';

/** Page to worker. `options` is what the counting side needs to know; the reader passes it through unread. */
export interface ReadRequest<Options> {
  type: 'read';
  files: File[];
  options: Options;
}

/** Worker to page. */
export type WorkerReply<Reading> =
  | { type: 'progress'; progress: ReadProgress }
  /** The last message of a read that went through. Broken files are in the report, not a failure. */
  | { type: 'done'; reading: Reading; report: ExportReport }
  /** The last message of a read that gave no result. */
  | { type: 'failed'; code: ReadFailure };

/** What the page gets in the end. */
export type ReadOutcome<Reading> =
  | { ok: true; reading: Reading; report: ExportReport }
  | { ok: false; code: ReadFailure };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Checks the request's own fields. `options` belongs to the counting side, which checks it itself. */
export function isReadRequest<Options>(data: unknown): data is ReadRequest<Options> {
  if (!isObject(data) || data.type !== 'read' || !Array.isArray(data.files)) return false;
  return data.files.every((file: unknown) => file instanceof Blob && 'name' in file && typeof file.name === 'string');
}

const FAILURES: ReadonlySet<unknown> = new Set<ReadFailure>(['cancelled', 'too-many-files', 'internal', 'worker-failed']);

/** Checks the kind of a reply. The worker is the page's own code, so its payload is taken as typed. */
export function isWorkerReply<Reading>(data: unknown): data is WorkerReply<Reading> {
  if (!isObject(data)) return false;
  if (data.type === 'progress') return isObject(data.progress);
  if (data.type === 'done') return isObject(data.report) && 'reading' in data;
  return data.type === 'failed' && FAILURES.has(data.code);
}
