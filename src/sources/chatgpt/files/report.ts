// What the reader tells the page afterwards: which files were read, ignored or cut off. Everything is
// a code with numbers and names, so the sentences are written in one place, on the page's side.

/**
 * Where a file was found: the dropped file's name first, then the names inside it, e.g.
 * ["OpenAI-export.zip", "User Online Activity/Conversations__x-chatgpt-0001.zip", "conversations-000.json"].
 * Every name comes from the person's files and is untrusted text: show it as text, never as HTML.
 * Long names are cut short, and characters that cannot be seen or that turn the text around them
 * (line breaks, control and direction marks) are replaced, so a name cannot change what a sentence says.
 */
export type FilePath = string[];

/**
 * Why a conversations file was not read to its end. What was read before the problem still counts.
 *
 * empty                   nothing in it
 * not-an-array            it does not start with "[", so it is not a list of conversations
 * not-json                broken JSON in the middle
 * cut-off                 it stops in the middle: an unfinished download
 * damaged                 the bytes could not be had: the ZIP could not unpack them, their checksum or
 *                         the size the ZIP gives for them is wrong, or the browser could not read the
 *                         file (for example, it was moved or changed after it was dropped)
 * file-too-large          more bytes than one file may hold
 * total-too-large         all files together passed the limit
 * ratio-too-high          it unpacks to far more than a real export does
 * conversation-too-large  one conversation is larger than any real one: it never ends, it has too
 *                         many parts, or its brackets are nested too deep
 *
 * A file with bytes that are not valid text is not a problem: such bytes are read as the replacement
 * character, as a browser shows them.
 */
export type FileProblem =
  | 'empty'
  | 'not-an-array'
  | 'not-json'
  | 'cut-off'
  | 'damaged'
  | 'file-too-large'
  | 'total-too-large'
  | 'ratio-too-high'
  | 'conversation-too-large';

/** One conversations file that was opened. */
export interface ReadFile {
  path: FilePath;
  /** Bytes of JSON read from it, unpacked. */
  bytes: number;
  /** Elements of its list that were handed over for counting. */
  handed: number;
  /**
   * How many of those the counting side did not take: it returned false for them. That covers what
   * is not a conversation, and whatever else that side passes over, such as a second copy. Its own
   * report says which.
   */
  skipped: number;
  problem: FileProblem | null;
}

/**
 * ignored                      a dropped file that is neither a ZIP nor a conversations file
 * no-conversations             a dropped ZIP that was read and holds no conversations file. Normal for
 *                              the later parts of an export in several ZIPs: they hold only attachments
 * unreadable                   a ZIP that could not be read at all
 * rescued                      a ZIP without a usable table of contents (often a cut-off download) that
 *                              was read from its first byte instead. `files` conversation files were
 *                              found, and the counting side took `conversations` elements from them. A
 *                              file among them that the cut went through has the problem "cut-off"
 * ends-early                   a ZIP read from its first byte that stops in the middle or is damaged
 * too-many-entries             more entries than a ZIP may hold. The ZIP was not read. Only when it
 *                              was read from its first byte, what came before the limit was read
 * too-many-conversation-files  the same for conversation files. Also said once, with the name of the
 *                              first of them, when more loose conversations files were dropped
 *                              than one ZIP may hold; none of the loose ones was read
 * too-many-inner-archives      a container with too many export ZIPs inside; none of them was read
 * encrypted                    an entry protected with a password; it was skipped
 * same-name                    a second entry with a name that was already read; it was skipped
 * user-unreadable              a user.json that is too large or is not JSON
 */
export type Notice =
  | { code: 'ignored'; path: FilePath }
  | { code: 'no-conversations'; path: FilePath }
  | { code: 'unreadable'; path: FilePath }
  | { code: 'rescued'; path: FilePath; files: number; conversations: number }
  | { code: 'ends-early'; path: FilePath }
  | { code: 'too-many-entries'; path: FilePath; limit: number }
  | { code: 'too-many-conversation-files'; path: FilePath; limit: number }
  | { code: 'too-many-inner-archives'; path: FilePath; limit: number; found: number }
  | { code: 'encrypted'; path: FilePath }
  | { code: 'same-name'; path: FilePath }
  | { code: 'user-unreadable'; path: FilePath };

export type NoticeCode = Notice['code'];

export interface ExportReport {
  /** The conversation files that were opened, in reading order. A hostile ZIP can hold thousands, so the list is capped. */
  files: ReadFile[];
  /** Files beyond the cap. They are still in `totals`. */
  filesNotListed: number;
  notices: Notice[];
  noticesNotListed: number;
  totals: {
    /** ZIPs opened, inner ones included. */
    archives: number;
    /** Conversation files opened. */
    conversationFiles: number;
    /** Of those, files that were not read to their end. */
    filesWithProblems: number;
    /** Bytes of conversation JSON read, unpacked. */
    bytes: number;
    /** List elements handed over for counting. */
    handed: number;
    /** Of those, elements the counting side did not take. */
    skipped: number;
    /** user.json files handed over. */
    userFiles: number;
  };
}

export interface ReadProgress {
  /** Bytes of conversation JSON read so far, unpacked. */
  bytesRead: number;
  /**
   * What the files say they hold, for the progress bar only. It is not checked and it can grow while
   * reading (an export ZIP inside a container is listed when its turn comes). null while unknown.
   */
  bytesTotal: number | null;
  /** Conversations counted so far. */
  conversations: number;
  /** A rough total, to be shown as "about": every piece but the last holds 100. null for an export in one piece. */
  conversationsAbout: number | null;
  /** Set while a ZIP is read from its first byte to its last: bytes of that ZIP passed so far. */
  scan: { read: number; total: number } | null;
}

/** The share to draw on the progress bar: 0 to 0.99. The last step belongs to the finished result. */
export function progressShare(progress: ReadProgress): number {
  const { bytesRead, bytesTotal } = progress;
  if (bytesTotal === null || !(bytesTotal > 0) || !(bytesRead > 0)) return 0;
  return Math.min(0.99, bytesRead / bytesTotal);
}

/** Why a whole read gave no result. */
export type ReadFailure =
  /** The person switched away or dropped other files. */
  | 'cancelled'
  /** More ZIP files were dropped than the reader takes at once. Other files are not counted. */
  | 'too-many-files'
  /** A fault in the page's own code, not in the files. */
  | 'internal'
  /** The background worker could not be started, or it stopped without an answer (for example out of memory). */
  | 'worker-failed';

export class ReadExportError extends Error {
  readonly code: ReadFailure;
  constructor(code: ReadFailure, options?: ErrorOptions) {
    super(`reading the export failed: ${code}`, options);
    this.name = 'ReadExportError';
    this.code = code;
  }
}
