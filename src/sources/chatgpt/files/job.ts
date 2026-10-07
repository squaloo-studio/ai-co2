// One read, seen from the page: start a worker, pass on its progress, and settle once, whatever
// happens. Kept apart from client.ts so that it can be tested with a stand-in for the worker.

import { isWorkerReply, type ReadOutcome, type ReadRequest } from './protocol';
import type { ReadProgress } from './report';

/** The members of a Worker that are used here. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: 'message' | 'messageerror' | 'error', listener: (event: Event) => void): void;
}

export interface ReadingJob<Reading> {
  /** Never rejects. A read that gave no result resolves with `ok: false` and a code. */
  result: Promise<ReadOutcome<Reading>>;
  /** Stops the worker at once and frees what it held. `result` then resolves as "cancelled". */
  cancel(): void;
}

export function runJob<Options, Reading>(
  spawn: () => WorkerLike,
  files: File[],
  onProgress: (progress: ReadProgress) => void,
  options: Options,
): ReadingJob<Reading> {
  let settle: (outcome: ReadOutcome<Reading>) => void = () => {};
  const result = new Promise<ReadOutcome<Reading>>((resolve) => {
    settle = resolve;
  });
  let worker: WorkerLike | null = null;
  const finish = (outcome: ReadOutcome<Reading>): void => {
    if (worker === null) return;
    // Ending the worker is what frees the memory: the files it opened and the counts it kept.
    worker.terminate();
    worker = null;
    settle(outcome);
  };

  try {
    worker = spawn();
  } catch {
    // No worker at all: a very old browser, or the page's own rules forbid it.
    settle({ ok: false, code: 'worker-failed' });
    return { result, cancel: () => {} };
  }

  try {
    worker.addEventListener('message', (event) => {
      if (worker === null) return;
      const reply: unknown = 'data' in event ? event.data : undefined;
      if (!isWorkerReply<Reading>(reply)) return finish({ ok: false, code: 'worker-failed' });
      if (reply.type === 'progress') onProgress(reply.progress);
      else if (reply.type === 'done') finish({ ok: true, reading: reply.reading, report: reply.report });
      else finish({ ok: false, code: reply.code });
    });
    const failed = (event: Event): void => {
      event.preventDefault();
      finish({ ok: false, code: 'worker-failed' });
    };
    worker.addEventListener('error', failed);
    worker.addEventListener('messageerror', failed);
    const request: ReadRequest<Options> = { type: 'read', files, options };
    worker.postMessage(request);
  } catch {
    // The request could not be sent: something in it cannot be copied to a worker. The worker is fine.
    finish({ ok: false, code: 'internal' });
  }

  return { result, cancel: () => finish({ ok: false, code: 'cancelled' }) };
}
