import { describe, expect, it } from 'vitest';
import type { ConversationSink } from '../types';
import { runJob, type WorkerLike } from './job';
import { LIMITS } from './limits';
import type { WorkerReply } from './protocol';
import { progressShare, type ReadProgress } from './report';
import { serve, type WorkerScope } from './serve';
import { conversations, countingSink, file, json, USER, zip } from './test-kit';

type Counted = { ids: string[] };
type Options = { now: number };

/**
 * A stand-in for a Worker: the real worker code (`serve`) on one side, the page's code on the other,
 * and every message copied on its way across, as between real threads.
 */
function fakeWorker(createSink: (options: Options) => ConversationSink<Counted>): WorkerLike & { terminated: boolean; posted: unknown[] } {
  const toPage = new EventTarget();
  const toWorker = new EventTarget();
  const worker = {
    terminated: false,
    posted: [] as unknown[],
    postMessage(message: unknown) {
      queueMicrotask(() => toWorker.dispatchEvent(new MessageEvent('message', { data: message })));
    },
    terminate() {
      worker.terminated = true;
    },
    addEventListener(type: string, listener: (event: Event) => void) {
      toPage.addEventListener(type, listener);
    },
  };
  const scope: WorkerScope = {
    postMessage(message) {
      const copy: unknown = structuredClone(message);
      worker.posted.push(copy);
      // A worker that was ended is gone: nothing it would still say arrives.
      if (!worker.terminated) toPage.dispatchEvent(new MessageEvent('message', { data: copy }));
    },
    addEventListener(type, listener) {
      toWorker.addEventListener(type, (event) => {
        if (event instanceof MessageEvent) listener(event);
      });
    },
  };
  serve(scope, createSink);
  return worker;
}

const exportZip = async (count: number, padding = 0): Promise<File> =>
  file('export.zip', await zip([{ name: 'conversations.json', data: json(conversations(0, count, padding)) }, { name: 'user.json', data: json(USER) }]));

describe('the worker and the page together', () => {
  it('reads the files, passes the options through and answers once', async () => {
    const seenOptions: Options[] = [];
    const worker = fakeWorker((options) => {
      seenOptions.push(options);
      return countingSink();
    });
    const progress: ReadProgress[] = [];
    const job = runJob<Options, Counted>(() => worker, [await exportZip(12)], (p) => progress.push(p), { now: 1_790_000_000 });
    const outcome = await job.result;

    expect(seenOptions).toEqual([{ now: 1_790_000_000 }]);
    expect(outcome.ok && outcome.reading.ids).toHaveLength(12);
    expect(outcome.ok && outcome.report.totals).toMatchObject({ archives: 1, conversationFiles: 1, handed: 12, userFiles: 1 });
    expect(worker.terminated).toBe(true);
    expect(progress.at(-1)?.conversations).toBe(12);
    expect(worker.posted.filter((m) => (m as WorkerReply<Counted>).type !== 'progress')).toHaveLength(1);
  });

  it('answers with a code when the read gives no result', async () => {
    const files = Array.from({ length: LIMITS.maxDroppedFiles + 1 }, (_, n) => file(`part-${String(n).padStart(3, '0')}.zip`, json([])));
    const worker = fakeWorker(() => countingSink());
    expect(await runJob<Options, Counted>(() => worker, files, () => {}, { now: 0 }).result).toEqual({ ok: false, code: 'too-many-files' });
    expect(worker.terminated).toBe(true);

    const broken = fakeWorker(() => {
      throw new Error('the counting side could not start');
    });
    expect(await runJob<Options, Counted>(() => broken, [], () => {}, { now: 0 }).result).toEqual({ ok: false, code: 'internal' });
  });

  it('sends only a code when the counting side fails, never the error text', async () => {
    const worker = fakeWorker(() =>
      countingSink(() => {
        throw new Error('words from a private chat');
      }),
    );
    const outcome = await runJob<Options, Counted>(() => worker, [await exportZip(3)], () => {}, { now: 0 }).result;
    expect(outcome).toEqual({ ok: false, code: 'internal' });
    expect(JSON.stringify(worker.posted)).not.toContain('private');
  });

  it('stops at once when cancelled in the middle, and stays quiet afterwards', async () => {
    const worker = fakeWorker(() => countingSink());
    const progress: ReadProgress[] = [];
    const big = await exportZip(3000, 100);
    let job: ReturnType<typeof runJob<Options, Counted>> | null = null;
    job = runJob<Options, Counted>(
      () => worker,
      [big],
      (p) => {
        progress.push(p);
        job?.cancel();
      },
      { now: 0 },
    );
    // The first progress message comes with the first chunk, long before the end.
    expect(await job.result).toEqual({ ok: false, code: 'cancelled' });
    expect(worker.terminated).toBe(true);
    const heard = progress.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(progress).toHaveLength(heard);
    job.cancel();
    expect(await job.result).toEqual({ ok: false, code: 'cancelled' });
  });

  it('reports a worker that cannot start, that stops with an error, or that says something else', async () => {
    const none = runJob<Options, Counted>(
      () => {
        throw new Error('workers are not allowed here');
      },
      [],
      () => {},
      { now: 0 },
    );
    expect(await none.result).toEqual({ ok: false, code: 'worker-failed' });
    none.cancel();

    for (const event of [new Event('error'), new Event('messageerror'), new MessageEvent('message', { data: { type: 'surprise' } })]) {
      const target = new EventTarget();
      let terminated = false;
      const silent: WorkerLike = {
        postMessage() {},
        terminate() {
          terminated = true;
        },
        addEventListener: (type, listener) => target.addEventListener(type, listener),
      };
      const job = runJob<Options, Counted>(() => silent, [], () => {}, { now: 0 });
      target.dispatchEvent(event);
      expect(await job.result).toEqual({ ok: false, code: 'worker-failed' });
      expect(terminated).toBe(true);
    }
  });
});

describe('the worker alone', () => {
  /** The worker's side only: what it is sent, and what it posts back. */
  function scopeFor(createSink: (options: Options) => ConversationSink<Counted>): { send(message: unknown): void; posted: unknown[] } {
    const inbox = new EventTarget();
    const posted: unknown[] = [];
    serve<Options, Counted>(
      {
        postMessage: (message) => void posted.push(message),
        addEventListener: (type, listener) => inbox.addEventListener(type, (event) => event instanceof MessageEvent && listener(event)),
      },
      createSink,
    );
    return { send: (message) => void inbox.dispatchEvent(new MessageEvent('message', { data: message })), posted };
  }
  const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

  it('answers a first message that is no request, so the page is never left waiting', async () => {
    for (const nonsense of [undefined, null, 'read', { type: 'read' }, { type: 'read', files: [{ name: 'conversations.json' }], options: {} }]) {
      let sinks = 0;
      const worker = scopeFor(() => {
        sinks++;
        return countingSink();
      });
      worker.send(nonsense);
      await settled();
      expect(worker.posted).toEqual([{ type: 'failed', code: 'internal' }]);
      expect(sinks).toBe(0);
    }
  });

  it('serves one read: whatever is sent after the first message gets no answer', async () => {
    let sinks = 0;
    const worker = scopeFor(() => {
      sinks++;
      return countingSink();
    });
    const request = { type: 'read', files: [file('conversations.json', json(conversations(0, 2)))], options: { now: 0 } };
    worker.send(request);
    worker.send(request);
    worker.send('nonsense');
    await settled();
    expect(sinks).toBe(1);
    expect(worker.posted.filter((m) => (m as WorkerReply<Counted>).type !== 'progress')).toEqual([
      expect.objectContaining({ type: 'done', reading: { ids: ['conv-00000', 'conv-00001'] } }),
    ]);
  });
});

describe('a request that cannot be sent', () => {
  it('ends the job as a fault of the page, and ends the worker', async () => {
    let terminated = false;
    const worker: WorkerLike = {
      postMessage() {
        // What a browser throws when the options hold something that cannot be copied, such as a function.
        throw new DOMException('could not be cloned', 'DataCloneError');
      },
      terminate() {
        terminated = true;
      },
      addEventListener() {},
    };
    const job = runJob<Options, Counted>(() => worker, [], () => {}, { now: 0 });
    expect(await job.result).toEqual({ ok: false, code: 'internal' });
    expect(terminated).toBe(true);
  });
});

describe('progressShare', () => {
  const progress = (bytesRead: number, bytesTotal: number | null): ReadProgress => ({ bytesRead, bytesTotal, conversations: 0, conversationsAbout: null, scan: null });
  it('stays between 0 and 0.99 whatever the files claim', () => {
    expect(progressShare(progress(0, null))).toBe(0);
    expect(progressShare(progress(50, null))).toBe(0);
    expect(progressShare(progress(50, 200))).toBe(0.25);
    expect(progressShare(progress(200, 200))).toBe(0.99);
    expect(progressShare(progress(900, 200))).toBe(0.99);
    expect(progressShare(progress(5, 0))).toBe(0);
    expect(progressShare(progress(Number.NaN, 10))).toBe(0);
  });
});
