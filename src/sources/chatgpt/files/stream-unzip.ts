// Reads a ZIP from its first byte to its last, without its table of contents. Needed in two cases:
// an export ZIP that sits compressed inside a container ZIP, and a download that was cut off, where
// the table of contents at the end is missing. In a real export the conversation files come first,
// so a cut-off download often still holds all of them.
//
// fflate does this work and is loaded only here, so most people never download it.

import type {
  AsyncFlateStreamHandler,
  FlateError,
  Inflate,
  UnzipDecoder,
  UnzipDecoderConstructor,
  UnzipFile,
} from 'fflate';
import { FileStopped, openFeed, type Feed } from './feed';
import { CONVERSATION_FILE, USER_FILE } from './names';
import type { FilePath } from './report';
import { Refused, type Run } from './run';
import { collectUser } from './user';

export interface StreamedArchive {
  /** Takes the ZIP's next bytes. Throws when the archive must not be read any further. */
  write(chunk: Uint8Array): void;
  /** The bytes ran out. */
  close(): void;
  /**
   * Call once when the bytes have run out or stopped. `error` is what stopped them, or null.
   * `rescue` is true when the ZIP is read this way because its table of contents is unusable: its
   * end is then expected to be broken, and only the outcome is put on record.
   */
  finish(error: unknown, rescue: boolean): void;
}

const EMPTY = new Uint8Array(0);
const STORED = 0;
const DEFLATE = 8;

/** @param total the ZIP's size in bytes, for the progress line. */
export async function streamArchive(run: Run, path: FilePath, total: number): Promise<StreamedArchive> {
  const { Unzip, UnzipPassThrough, Inflate: InflateStream } = await import('fflate');
  run.checkpoint();
  const { limits } = run;

  // fflate builds a file's decoder inside start(). These two carry word between the code that starts
  // a file and the decoder built for it: whether the file is to be unpacked, and which decoder it got.
  let unpack = false;
  let latest: WantedInflate | null = null;
  const newest = (): WantedInflate | null => latest;

  /**
   * fflate's own inflater unpacks every file, attachments included, and cannot be stopped. This one
   * unpacks only the files the reader asks for, in small slices, and drops the rest of a file as soon
   * as the reader has given up on it. A decompression bomb then costs one slice, not gigabytes.
   */
  class WantedInflate implements UnzipDecoder {
    static compression = DEFLATE;
    ondata: AsyncFlateStreamHandler = () => {};
    private inflate: Inflate | null;
    constructor() {
      this.inflate = unpack ? new InflateStream((data, final) => this.ondata(null, data, final)) : null;
      latest = this;
    }
    push(chunk: Uint8Array, final: boolean): void {
      for (let at = 0; at < chunk.length && this.inflate !== null; at += limits.inflateSliceBytes) {
        this.slice(chunk.subarray(at, at + limits.inflateSliceBytes), false);
      }
      if (final) this.slice(EMPTY, true);
    }
    stop(): void {
      this.inflate = null;
    }
    private slice(bytes: Uint8Array, final: boolean): void {
      if (this.inflate === null) {
        if (final) this.ondata(null, EMPTY, true);
        return;
      }
      try {
        this.inflate.push(bytes, final);
      } catch (error) {
        this.inflate = null;
        this.ondata(asFlateError(error), EMPTY, final);
      }
    }
  }

  /**
   * A stand-in for a packing method this reader cannot unpack. fflate can only start a file whose
   * method has a decoder: without one it stops the whole archive at the first such file. A
   * conversations file packed that way is reported as damaged.
   */
  class Dropped implements UnzipDecoder {
    ondata: AsyncFlateStreamHandler = () => {};
    private readonly missed = unpack;
    private told = false;
    push(_chunk: Uint8Array, final: boolean): void {
      if (this.missed && !this.told) {
        this.told = true;
        this.ondata(asFlateError(null), EMPTY, final);
      } else if (final) this.ondata(null, EMPTY, true);
    }
  }
  const droppedFor = (method: number): UnzipDecoderConstructor =>
    class extends Dropped {
      static compression = method;
    };

  let entries = 0;
  let conversationFiles = 0;
  let userSeen = false;
  const names = new Set<string>();
  const openFeeds = new Set<Feed>();
  // What a handler wants thrown. fflate calls the handlers from inside its own code, where an
  // exception would be taken for broken data, so it is kept here until fflate has returned.
  let pending: unknown = null;

  /**
   * Starts a file the reader wants. `take` gets what comes out of it and returns false once it wants
   * no more. The rest of the file is then dropped without being unpacked.
   */
  const startWanted = (file: UnzipFile, take: (error: FlateError | null, chunk: Uint8Array, final: boolean) => boolean): void => {
    let decoder: WantedInflate | null = null;
    let taking = true;
    file.ondata = (error, chunk, final) => {
      if (!taking) return;
      try {
        taking = take(error, chunk, final);
      } catch (thrown) {
        pending ??= thrown;
        taking = false;
      }
      if (!taking) decoder?.stop();
    };
    unpack = true;
    latest = null;
    try {
      file.start();
    } finally {
      unpack = false;
    }
    // start() builds the inflater, and may already have fed it the bytes that were waiting.
    decoder = newest();
    if (!taking) decoder?.stop();
  };

  const readConversations = (file: UnzipFile, filePath: FilePath): void => {
    const feed = openFeed(run, filePath, typeof file.size === 'number' ? file.size : 0);
    openFeeds.add(feed);
    if (typeof file.originalSize === 'number') run.listed(0, file.originalSize);
    startWanted(file, (error, chunk, final) => {
      try {
        if (error !== null) feed.fail('damaged');
        else {
          if (chunk.length > 0) feed.push(chunk);
          if (final) feed.end();
        }
      } catch (thrown) {
        // A stopped file is already on record. Anything else ends the whole read.
        if (!(thrown instanceof FileStopped)) throw thrown;
      }
      if (!feed.open) openFeeds.delete(feed);
      return feed.open;
    });
  };

  const readUser = (file: UnzipFile, filePath: FilePath): void => {
    const user = collectUser(run, filePath);
    startWanted(file, (error, chunk, final) => {
      if (error !== null) user.fail();
      else {
        user.push(chunk);
        if (final) user.end();
      }
      return user.open;
    });
  };

  const unzip = new Unzip();
  unzip.register(UnzipPassThrough);
  unzip.register(WantedInflate);
  const withDecoder = new Set<number>([STORED, DEFLATE]);
  unzip.onfile = (file) => {
    if (++entries > limits.maxEntriesPerZip) {
      throw new Refused({ code: 'too-many-entries', path, limit: limits.maxEntriesPerZip });
    }
    // The method is a number from the file and can be anything, so the stand-in is made when it is met.
    if (!withDecoder.has(file.compression)) {
      withDecoder.add(file.compression);
      unzip.register(droppedFor(file.compression));
    }
    if (CONVERSATION_FILE.test(file.name)) {
      const filePath = run.path(path, file.name);
      if (names.has(file.name)) run.notice({ code: 'same-name', path: filePath });
      else {
        names.add(file.name);
        if (++conversationFiles > limits.maxConversationFiles) {
          throw new Refused({ code: 'too-many-conversation-files', path, limit: limits.maxConversationFiles });
        }
        return readConversations(file, filePath);
      }
    } else if (USER_FILE.test(file.name) && !userSeen) {
      userSeen = true;
      return readUser(file, run.path(path, file.name));
    }
    // fflate keeps every byte of a file that is never started. Started with a handler that does
    // nothing, the bytes pass and are dropped, still packed.
    file.ondata = () => {};
    file.start();
  };

  let failure: unknown = null;
  const push = (chunk: Uint8Array, final: boolean): void => {
    try {
      run.checkpoint();
      // fflate works through a piece by calling itself once or twice for every file that starts in
      // it. A large piece full of small files overflows the call stack, so the pieces are kept small.
      for (let at = 0; at < chunk.length; at += limits.inflateSliceBytes) {
        unzip.push(chunk.subarray(at, at + limits.inflateSliceBytes), false);
        if (pending !== null) throw pending;
      }
      if (final) {
        unzip.push(EMPTY, true);
        if (pending !== null) throw pending;
      }
    } catch (error) {
      failure ??= error;
      throw error;
    }
  };

  const { totals } = run.report;
  // Files are read one after another, so what the counting side took from this ZIP is the growth of the totals.
  const takenBefore = totals.handed - totals.skipped;
  totals.archives++;
  run.scan = { read: 0, total };
  return {
    write(chunk) {
      if (run.scan !== null) run.scan.read += chunk.byteLength;
      push(chunk, false);
      run.progress();
    },
    close() {
      push(EMPTY, true);
    },
    finish(error, rescue) {
      run.scan = null;
      const cause = failure ?? error;
      if (cause !== null && cause !== undefined) run.onlyThisFile(cause);
      // A file that never reached its end: the archive stopped inside it.
      for (const feed of openFeeds) feed.fail('cut-off');
      openFeeds.clear();
      if (cause instanceof Refused) run.notice(cause.notice);
      else if (rescue) {
        const conversations = totals.handed - totals.skipped - takenBefore;
        run.notice(conversationFiles > 0 ? { code: 'rescued', path, files: conversationFiles, conversations } : { code: 'unreadable', path });
      } else if (cause !== null && cause !== undefined) run.notice({ code: 'ends-early', path });
    },
  };
}

function asFlateError(error: unknown): FlateError {
  const flate: FlateError = Object.assign(new Error(error instanceof Error ? error.message : 'broken data'), { code: 0 });
  return flate;
}
