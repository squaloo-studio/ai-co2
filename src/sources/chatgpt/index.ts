// The ChatGPT reader, as the rest of the page sees it. One read goes like this:
//
//   const job = startReading(files, (progress) => draw(progressShare(progress)));
//   const outcome = await job.result;                     // never rejects
//   if (outcome.ok) {
//     const { reading, report } = outcome;
//     const last30 = totals(reading, { from, to }, plan);  // the 30 days that end today, as day names
//     const history = totals(reading, 'all', plan);
//   }
//
// The store makes the window from today's date and takes the plan from its own switch, which
// starts from `reading.plusUser`. Before the next read (other files were dropped, or the person
// switched to the other tool), call job.cancel() and take no notice of what that job still answers.
//
// A request stamped after the window's last day is not in the window, and one stamped more than a
// day after the read's `now` is on no day at all. Both stay in the whole history.
//
// Importing this file adds a few kilobytes to the page. The code that opens ZIPs, parses JSON and
// counts tokens is in the worker's own file, which the browser fetches when the first read starts.
// For that to stay true, the page imports from here and never from ./account/account,
// ./account/count, ./account/tokens or ./files/read-export.

import type { Reading } from './account/reading';
import type { ReadingJob as Job, ReadOutcome as Outcome } from './files';

// ---------- reading ----------

/**
 * Starts reading the dropped files in a worker of its own. `onProgress` is called a few times a
 * second. The days of the reading are the person's own calendar days, and "now" is the moment of
 * the call, unless the options say otherwise.
 */
export { startReading } from './files';

/**
 * What a read can be told: `now` (Unix seconds) and `calendar` ('local' or 'utc'). Tests set them.
 * It crosses to the worker by copying, so it cannot hold a function.
 */
export type { AccountOptions as ReadingOptions } from './files';

/**
 * A running read. `result` never rejects: it resolves with the outcome. `cancel()` ends the worker
 * at once and frees what it held, and `result` then resolves as "cancelled".
 *
 * If the browser ends the worker without a word (out of memory), `result` never resolves. Keep a
 * way to cancel within reach while a read is running.
 */
export type ReadingJob = Job<Reading>;

/**
 * How a read ended. `ok: true` comes with the reading and the file report, also when files were
 * broken: those are in the report. `ok: false` comes with a code, and "cancelled" is not an error.
 */
export type ReadOutcome = Outcome<Reading>;

/** Why a read gave no result: cancelled, too-many-files, internal or worker-failed. */
export type { ReadFailure } from './files';

// ---------- progress ----------

/**
 * Bytes and conversations read so far. `bytesTotal` is null until a size is known, and `scan` is
 * set while a ZIP without a usable table of contents is read from its first byte.
 */
export type { ReadProgress } from './files';

/** The share to draw on the progress bar, from 0 to 0.99. */
export { progressShare } from './files';

// ---------- the file report ----------

/**
 * Which files were read, ignored or cut off, as codes with numbers and file names. The names come
 * from the person's files: show them as text only.
 */
export type { ExportReport, FilePath, FileProblem, Notice, NoticeCode, ReadFile } from './files';

/** The reader's limits. `maxDroppedFiles` is the number of ZIP files that may be dropped at once. */
export { LIMITS as FILE_LIMITS } from './files';

// ---------- the reading ----------

/**
 * The export, counted: numbers per calendar day and per model, and nothing else. `warnings` are
 * codes with counts. Model names are text from the file: show them as text, hand them to the model
 * classifier as they are, and never use one as the key of a plain object.
 */
export type { Calendar, Day, ModelDay, Reading, Warning, WarningCode } from './account/reading';

/**
 * From a reading to the numbers the maths takes. `totals(reading, window, plan)` gives the token
 * rows and the six hidden-work bases of one window, or of the whole export with 'all'. A change of
 * window or plan is another call to totals(), never another read.
 */
export { totals } from './account/reading';

/** For tests: the window of 30 days that ends on a given moment, and the plan user.json points to. The store makes both itself. */
export { planFromExport, windowOf } from './account/reading';

/** For tests: the six pieces of hidden work in the reader's order, and the name of "no model named". The store has its own list of the pieces. */
export { NO_MODEL_NAME, PIECES } from './account/reading';

/** What totals() takes and gives. */
export type { PieceId, Plan, SwitchEvidence, TokenRow, Totals, Window } from './account/reading';

/**
 * The assumptions of the count that have no slider, for the method section: a reply within
 * WARM_SECONDS re-reads the conversation from the cache, and CEILING is the most earlier
 * conversation one request re-reads on each plan.
 */
export { CEILING, WARM_SECONDS } from './account/rules';

/** For tests: the seconds assumed for a thinking answer with no recorded time in a conversation that has none. No sentence on the page names it yet. */
export { DEFAULT_THINK_SECONDS } from './account/rules';
