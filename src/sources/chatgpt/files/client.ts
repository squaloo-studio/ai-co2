// What the page's main thread calls to read a ChatGPT export. The reading itself happens in a Web
// Worker, so the page stays usable while a large export is read.
//
// Only types are taken from the counting side here. Its code, and the tokenizer with it, is loaded
// by the worker alone.

import type { AccountOptions as CountingOptions } from '../account/account';
import type { Reading } from '../account/reading';
import { runJob, type ReadingJob } from './job';
import type { ReadProgress } from './report';

/** The members of T that can be sent to a worker. A function cannot, so those are left out. */
type Sendable<T> = { [K in keyof T as NonNullable<T[K]> extends (...args: never[]) => unknown ? never : K]: T[K] };

/** What the counting side needs to know before it starts. */
export type AccountOptions = Sendable<CountingOptions>;
/** What the counting side hands back: counts only, never text. */
export type AccountReading = Reading;

/**
 * Starts reading the dropped files. `onProgress` is called a few times a second.
 * One call is one read with a worker of its own: to read other files, cancel this one and call again.
 *
 * Left out, `now` is the moment of this call and `calendar` is 'local': the days of the reading are
 * then the person's own calendar days, which is what "the last 30 days" means on the page.
 */
export function startReading(
  files: File[],
  onProgress: (progress: ReadProgress) => void,
  options: AccountOptions = {},
): ReadingJob<AccountReading> {
  // Written in exactly this form so that Vite finds the worker and builds it as its own file.
  // The worker is then loaded from the page's own address, never from a blob: or data: address.
  const spawn = (): Worker => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  // The counting side's own defaults are UTC days, which only its tests want. Sent from here, the
  // page cannot forget them and end up with a window that is cut at midnight in Greenwich.
  const sent: AccountOptions = { ...options, now: options.now ?? Date.now() / 1000, calendar: options.calendar ?? 'local' };
  return runJob<AccountOptions, AccountReading>(spawn, files, onProgress, sent);
}
