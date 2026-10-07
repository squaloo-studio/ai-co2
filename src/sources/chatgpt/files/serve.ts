// What the worker does, apart from where its counting side comes from: wait for the one request,
// read the files, post progress and one last message. Kept apart from worker.ts so that it can be
// tested without a worker.

import type { ConversationSink } from '../types';
import { isReadRequest, type WorkerReply } from './protocol';
import { readExport } from './read-export';
import { ReadExportError } from './report';

/** The two members of a worker's global scope that are used here. */
export interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

export function serve<Options, Reading>(scope: WorkerScope, createSink: (options: Options) => ConversationSink<Reading>): void {
  let busy = false;
  const post = (reply: WorkerReply<Reading>): void => scope.postMessage(reply);

  scope.addEventListener('message', (event) => {
    // One worker, one read. A later message gets no answer: the answer to the first is the last word.
    if (busy) return;
    busy = true;
    const request: unknown = event.data;
    // The page waits for one last message, so a first message that is no request gets one too.
    if (!isReadRequest<Options>(request)) return post({ type: 'failed', code: 'internal' });
    void (async () => {
      try {
        const sink = createSink(request.options);
        const report = await readExport(request.files, sink, { onProgress: (progress) => post({ type: 'progress', progress }) });
        post({ type: 'done', reading: sink.finish(), report });
      } catch (error) {
        // Only a code crosses over: an error's text could carry words from the person's files.
        post({ type: 'failed', code: error instanceof ReadExportError ? error.code : 'internal' });
      }
    })();
  });
}
