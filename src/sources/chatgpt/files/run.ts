// The state of one read: the counters, the report as it grows, and the two ways a read ends early
// (the person cancels, or the page's own code fails). Everything else only stops one file.

import type { ConversationSink } from '../types';
import { LIMITS, type Limits } from './limits';
import {
  ReadExportError,
  type ExportReport,
  type FilePath,
  type Notice,
  type ReadFile,
  type ReadProgress,
} from './report';

export interface ReadOptions {
  /** Aborting it stops the read: readExport then rejects with a ReadExportError "cancelled". */
  signal?: AbortSignal;
  /** Called while reading, at most every `progressEveryMs`, and once more at the end. */
  onProgress?: (progress: ReadProgress) => void;
  /** Default 200: a few times a second. */
  progressEveryMs?: number;
  /** Tests read small files against small limits. The page never sets this. */
  limits?: Partial<Limits>;
}

/**
 * Control characters, line and paragraph breaks, marks that cannot be seen or that change the
 * direction of the text, and halves of a character that was cut in two. A file name with these could
 * make a sentence on the page read differently from what it says.
 */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu;

/** A stop that concerns the whole ZIP, not one file in it. */
export class Refused extends Error {
  readonly notice: Notice;
  constructor(notice: Notice) {
    super(notice.code);
    this.notice = notice;
  }
}

export interface Run {
  readonly limits: Readonly<Limits>;
  readonly signal: AbortSignal | undefined;
  readonly report: ExportReport;
  /** Bytes of conversation JSON over all files, for the total limit. */
  inflated: number;
  bytesTotal: number;
  /** Pieces listed so far, per ZIP, for the rough conversation total. */
  conversationsAbout: number | null;
  scan: { read: number; total: number } | null;

  /** Hands one list element to the counting side. Returns what it returns. */
  add(value: unknown): boolean;
  setUser(value: unknown): void;
  /** Throws when the read was cancelled or the page's own code has failed. */
  checkpoint(): void;
  /** For a catch block: throws when the read must end, returns when only this file is affected. */
  onlyThisFile(error: unknown): void;
  progress(force?: boolean): void;
  path(parent: FilePath, name: string): FilePath;
  notice(notice: Notice): void;
  fileDone(file: ReadFile): void;
  /** `pieces` conversation files were listed in one ZIP. */
  listed(pieces: number, declaredBytes: number): void;
}

export function startRun<Reading>(sink: ConversationSink<Reading>, options: ReadOptions): Run {
  const limits: Readonly<Limits> = { ...LIMITS, ...options.limits };
  const every = options.progressEveryMs ?? 200;
  const report: ExportReport = {
    files: [],
    filesNotListed: 0,
    notices: [],
    noticesNotListed: 0,
    totals: { archives: 0, conversationFiles: 0, filesWithProblems: 0, bytes: 0, handed: 0, skipped: 0, userFiles: 0 },
  };
  let fault: ReadExportError | null = null;
  let lastProgress = Number.NEGATIVE_INFINITY;
  let ignoredListed = 0;

  // A fault on the counting side must not pass as a broken file: it would give a silently wrong total.
  const guard = <T>(work: () => T): T => {
    try {
      return work();
    } catch (error) {
      fault ??= new ReadExportError('internal', { cause: error });
      throw fault;
    }
  };

  const run: Run = {
    limits,
    signal: options.signal,
    report,
    inflated: 0,
    bytesTotal: 0,
    conversationsAbout: null,
    scan: null,

    add: (value) => guard(() => sink.add(value)) === true,
    setUser(value) {
      guard(() => sink.setUser(value));
      report.totals.userFiles++;
    },
    checkpoint() {
      if (fault !== null) throw fault;
      if (options.signal?.aborted === true) throw new ReadExportError('cancelled');
    },
    onlyThisFile(error) {
      run.checkpoint();
      if (error instanceof ReadExportError) throw error;
    },
    progress(force = false) {
      const { onProgress } = options;
      if (onProgress === undefined) return;
      const now = performance.now();
      if (!force && now - lastProgress < every) return;
      lastProgress = now;
      const conversations = guard(() => sink.counted());
      // Guarded like the counting side: a fault in the caller's own code is not a broken file either.
      guard(() =>
        onProgress({
          bytesRead: report.totals.bytes,
          bytesTotal: run.bytesTotal > 0 ? run.bytesTotal : null,
          conversations: Number.isFinite(conversations) ? conversations : 0,
          conversationsAbout: run.conversationsAbout,
          scan: run.scan === null ? null : { ...run.scan },
        }),
      );
    },
    path(parent, name) {
      const long = name.length > limits.maxNameLength;
      const shown = (long ? name.slice(0, limits.maxNameLength) : name).replace(UNSEEN, '\ufffd');
      return [...parent, long ? `${shown}…` : shown];
    },
    notice(notice) {
      // "ignored" is said once per dropped file that is nothing the reader looks for. Their number is
      // the person's own doing, not the file's, and the page shows it, so they are capped apart.
      const mine = notice.code === 'ignored';
      const room = mine ? ignoredListed < limits.maxIgnoredNotices : report.notices.length - ignoredListed < limits.maxNotices;
      if (!room) report.noticesNotListed++;
      else {
        report.notices.push(notice);
        if (mine) ignoredListed++;
      }
    },
    fileDone(file) {
      report.totals.conversationFiles++;
      if (file.problem !== null) report.totals.filesWithProblems++;
      if (report.files.length < limits.maxReportedFiles) report.files.push(file);
      else report.filesNotListed++;
    },
    listed(pieces, declaredBytes) {
      // The declared sizes come from the file and can be anything. They only feed the progress bar.
      if (Number.isFinite(declaredBytes) && declaredBytes > 0) run.bytesTotal += declaredBytes;
      if (pieces > 1) run.conversationsAbout = (run.conversationsAbout ?? 0) + (pieces - 1) * 100;
    },
  };
  return run;
}
