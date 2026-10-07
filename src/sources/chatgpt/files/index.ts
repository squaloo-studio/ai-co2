// What the file-reading half of the ChatGPT reader gives to the outside: start a read, follow its
// progress, get the counts and a report of what was read, ignored or cut off. The page takes these
// from ../index.ts, together with what the counting half gives.
//
// Only types and small helpers are exported here on purpose. The code that opens ZIPs and parses
// JSON is loaded by the worker alone, so the page itself stays small.

export { startReading, type AccountOptions, type AccountReading } from './client';
export type { ReadingJob } from './job';
export type { ReadOutcome } from './protocol';
export { progressShare } from './report';
export type {
  ExportReport,
  FilePath,
  FileProblem,
  Notice,
  NoticeCode,
  ReadFailure,
  ReadFile,
  ReadProgress,
} from './report';
export { LIMITS, type Limits } from './limits';
