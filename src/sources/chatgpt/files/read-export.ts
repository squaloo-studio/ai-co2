// Opens the dropped files of a ChatGPT export and hands every conversation in them, one at a time,
// to the counting side. It never looks inside a conversation and never holds a whole file: at any
// moment there is one packed chunk, one unpacked chunk and the conversation being parsed.
//
// A ZIP keeps its table of contents at the end. zip.js reads that table and then jumps straight to
// the conversation files, so the attachments, which are most of an export, are never touched.

import { BlobReader, ZipReader, configure, type FileEntry } from '@zip.js/zip.js/lib/zip-core-custom.js';
import type { ConversationSink } from '../types';
import { FileStopped, openFeed, pump } from './feed';
import { CONVERSATION_FILE, USER_FILE, ZIP_FILE, isInnerExportZip } from './names';
import { ReadExportError, type ExportReport, type FilePath, type Notice } from './report';
import { Refused, startRun, type ReadOptions, type Run } from './run';
import { streamArchive } from './stream-unzip';
import { collectUser } from './user';

// This code already runs in a worker, so zip.js needs none of its own. It then unpacks with the
// browser's built-in DecompressionStream. The "custom" build of zip.js carries no worker script and
// no WebAssembly, so nothing is ever started from a blob: or data: address.
//
// zip.js hands packed bytes to the browser in pieces of `chunkSize`, and Deflate can unpack a piece to
// about a thousand times its size before this reader sees any of it and can stop. A quarter of the
// default piece keeps that below about 70 MiB.
configure({ useWebWorkers: false, useCompressionStream: true, chunkSize: 64 * 1024 });

/**
 * zip.js reads a ZIP's table of contents in one piece, however large the file says it is. This reader
 * refuses a piece above the limit. The listing then fails, and the ZIP is read from its first byte.
 */
class BoundedReader extends BlobReader {
  readonly #mostBytes: number;
  constructor(blob: Blob, mostBytes: number) {
    super(blob);
    this.#mostBytes = mostBytes;
  }
  override readUint8Array(index: number, length: number): Promise<Uint8Array> {
    if (length > this.#mostBytes) return Promise.reject(new Error('too large to read in one piece'));
    return super.readUint8Array(index, length);
  }
}

type Kind = 'archive' | 'conversations' | 'user' | 'other';

/** What a dropped file is, going by its name alone. */
function kindOf(file: File): Kind {
  const name = typeof file.name === 'string' ? file.name : '';
  if (ZIP_FILE.test(name)) return 'archive';
  if (CONVERSATION_FILE.test(name)) return 'conversations';
  return USER_FILE.test(name) ? 'user' : 'other';
}

const byName = (a: FileEntry, b: FileEntry): number => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0);

interface Listing {
  conversations: FileEntry[];
  user: FileEntry | null;
  inner: FileEntry[];
  /** true when the ZIP holds nothing this reader looks for. */
  nothing: boolean;
}

/**
 * Reads the dropped files and feeds `sink`: every element of every conversations file, and user.json
 * when one is found. Resolves with the report of what was read, ignored or cut off. A broken file
 * never rejects: it is in the report. Rejects with a ReadExportError only when the whole read ends
 * early: cancelled, too many ZIP files, or a fault in the page's own code.
 *
 * Only ZIP files are counted against `maxDroppedFiles`. Loose conversations files may be as many as
 * one ZIP may hold, and every other dropped file is passed over with the remark "ignored".
 *
 * `sink.finish()` is left to the caller.
 */
export async function readExport<Reading>(
  files: readonly File[],
  sink: ConversationSink<Reading>,
  options: ReadOptions = {},
): Promise<ExportReport> {
  const run = startRun(sink, options);
  const { limits } = run;
  // Sorted by kind before anything is refused. An export that was unzipped is dropped as hundreds of
  // files, most of them attachments, and its conversations come in as many pieces as a ZIP holds.
  const kinds = files.map(kindOf);
  const count = (kind: Kind): number => kinds.filter((k) => k === kind).length;
  if (count('archive') > limits.maxDroppedFiles) throw new ReadExportError('too-many-files');
  // As inside a ZIP: more pieces than any export has, and none of them is read.
  const tooManyPieces = count('conversations') > limits.maxConversationFiles;
  let refused = false;
  try {
    run.checkpoint();
    for (const [at, file] of files.entries()) {
      const path = run.path([], typeof file.name === 'string' && file.name !== '' ? file.name : 'file');
      const kind = kinds[at];
      if (kind === 'archive') await readArchive(run, file, path, 0);
      else if (kind === 'conversations' && !tooManyPieces) await readLooseConversations(run, file, path);
      else if (kind === 'conversations' && !refused) {
        refused = true;
        run.notice({ code: 'too-many-conversation-files', path, limit: limits.maxConversationFiles });
      } else if (kind === 'user') await readLooseUser(run, file, path);
      else if (kind === 'other') run.notice({ code: 'ignored', path });
      run.checkpoint();
    }
    run.progress(true);
    return run.report;
  } catch (error) {
    // Whatever was thrown while a cancelled read winds down, the answer is "cancelled".
    run.checkpoint();
    throw error instanceof ReadExportError ? error : new ReadExportError('internal', { cause: error });
  }
}

async function readLooseConversations(run: Run, file: Blob, path: FilePath): Promise<void> {
  run.listed(1, file.size);
  const feed = openFeed(run, path, 0);
  try {
    await pump(run, file.stream(), feed.push);
    feed.end();
  } catch (error) {
    run.onlyThisFile(error);
    feed.fail('damaged');
  }
}

async function readLooseUser(run: Run, file: Blob, path: FilePath): Promise<void> {
  const user = collectUser(run, path);
  try {
    // Sliced first, so that a huge file with this name is never read in full.
    const head = file.slice(0, run.limits.maxUserFileBytes + 1);
    user.push(new Uint8Array(await head.arrayBuffer()));
    user.end();
  } catch (error) {
    run.onlyThisFile(error);
    user.fail();
  }
}

/** @param depth 0 for a dropped ZIP, 1 for an export ZIP inside a container. Nothing deeper is opened. */
async function readArchive(run: Run, blob: Blob, path: FilePath, depth: 0 | 1): Promise<void> {
  // Names are only matched against patterns and nothing is written, so odd names are let through.
  const reader = new ZipReader(new BoundedReader(blob, run.limits.maxTableBytes), { filenameValidation: 'tolerant' });
  let listing: Listing;
  try {
    listing = await list(run, reader, path, depth);
  } catch (error) {
    run.onlyThisFile(error);
    if (error instanceof Refused) return run.notice(error.notice);
    // No usable table of contents: a cut-off download, or an archive written wrongly.
    return readFromTheStart(run, blob, path);
  } finally {
    await reader.close().catch(() => {});
  }
  run.report.totals.archives++;

  if (listing.user !== null) await readUserEntry(run, listing.user, run.path(path, listing.user.filename));
  for (const entry of listing.conversations) {
    await readConversationsEntry(run, entry, run.path(path, entry.filename));
  }
  if (depth === 0 && listing.nothing) run.notice({ code: 'no-conversations', path });
  for (const entry of listing.inner) await readInnerArchive(run, blob, entry, run.path(path, entry.filename));
}

async function list(run: Run, reader: ZipReader<Blob>, path: FilePath, depth: 0 | 1): Promise<Listing> {
  const { limits } = run;
  const names = new Set<string>();
  const conversations: FileEntry[] = [];
  const inner: FileEntry[] = [];
  // Kept back until the whole table is read. A listing that fails halfway is followed by a refusal
  // or by a second reading from the first byte, and must leave no remarks of its own behind.
  const notices: Notice[] = [];
  let user: FileEntry | null = null;
  let entries = 0;
  for await (const entry of reader.getEntriesGenerator()) {
    run.checkpoint();
    if (++entries > limits.maxEntriesPerZip) {
      throw new Refused({ code: 'too-many-entries', path, limit: limits.maxEntriesPerZip });
    }
    if (entry.directory) continue;
    const name = entry.filename;
    const isConversations = CONVERSATION_FILE.test(name);
    const isInner = depth === 0 && !isConversations && isInnerExportZip(name);
    if (isConversations || isInner) {
      const entryPath = run.path(path, name);
      if (entry.encrypted) notices.push({ code: 'encrypted', path: entryPath });
      else if (names.has(name)) notices.push({ code: 'same-name', path: entryPath });
      else {
        names.add(name);
        (isConversations ? conversations : inner).push(entry);
      }
    } else if (user === null && !entry.encrypted && USER_FILE.test(name)) user = entry;
  }
  if (conversations.length > limits.maxConversationFiles) {
    throw new Refused({ code: 'too-many-conversation-files', path, limit: limits.maxConversationFiles });
  }
  for (const notice of notices) run.notice(notice);
  const nothing = conversations.length === 0 && inner.length === 0;
  if (inner.length > limits.maxNestedZips) {
    run.notice({ code: 'too-many-inner-archives', path, limit: limits.maxNestedZips, found: inner.length });
    inner.length = 0;
  }
  conversations.sort(byName);
  inner.sort(byName);
  let declared = 0;
  for (const entry of conversations) declared += entry.uncompressedSize;
  run.listed(conversations.length, declared);
  return { conversations, user, inner, nothing };
}

// A cancelled read is stopped by the writer: `write` throws at the next chunk, and zip.js then lets go
// of the file. Handing zip.js the signal itself ends its work no sooner, and it leaves the stream it
// was reading from open.

async function readConversationsEntry(run: Run, entry: FileEntry, path: FilePath): Promise<void> {
  const feed = openFeed(run, path, entry.compressedSize);
  try {
    await entry.getData(new WritableStream<Uint8Array>({ write: feed.push }), { checkCrc32: true });
    feed.end();
  } catch (error) {
    run.onlyThisFile(error);
    feed.fail('damaged');
  }
}

async function readUserEntry(run: Run, entry: FileEntry, path: FilePath): Promise<void> {
  const user = collectUser(run, path);
  const { maxUserFileBytes } = run.limits;
  let size = 0;
  try {
    await entry.getData(
      new WritableStream<Uint8Array>({
        write(chunk) {
          size += chunk.byteLength;
          // Stops the unpacking as well, where collecting alone would let a bomb run to its end.
          if (size > maxUserFileBytes) throw new FileStopped('file-too-large');
          user.push(chunk);
        },
      }),
    );
    user.end();
  } catch (error) {
    run.onlyThisFile(error);
    user.fail();
  }
}

/** An export ZIP inside the privacy portal's container. */
async function readInnerArchive(run: Run, outer: Blob, entry: FileEntry, path: FilePath): Promise<void> {
  if (entry.compressionMethod === 0) {
    // Stored without packing, the inner ZIP is a plain stretch of bytes of the outer file. It can be
    // read in place, with jumps, like a dropped ZIP.
    const slice = await storedBytes(outer, entry).catch(() => null);
    run.checkpoint();
    if (slice !== null) return readArchive(run, slice, path, 1);
  }
  // Packed: it passes through in chunks and is never held as a whole.
  const archive = await streamArchive(run, path, entry.uncompressedSize);
  let failure: unknown = null;
  try {
    await entry.getData(new WritableStream<Uint8Array>({ write: archive.write, close: archive.close }));
  } catch (error) {
    failure = error ?? new Error('stopped');
  }
  archive.finish(failure, false);
}

/** The bytes of an entry that is stored without packing, as a slice of the file around it. */
async function storedBytes(outer: Blob, entry: FileEntry): Promise<Blob | null> {
  const header = new DataView(await outer.slice(entry.offset, entry.offset + 30).arrayBuffer());
  if (header.byteLength < 30 || header.getUint32(0, true) !== 0x04034b50) return null;
  const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const end = start + entry.compressedSize;
  if (!Number.isSafeInteger(end) || end > outer.size) return null;
  return outer.slice(start, end);
}

/** The fallback for a ZIP whose table of contents cannot be used. */
async function readFromTheStart(run: Run, blob: Blob, path: FilePath): Promise<void> {
  const archive = await streamArchive(run, path, blob.size);
  let failure: unknown = null;
  try {
    await pump(run, blob.stream(), archive.write);
    archive.close();
  } catch (error) {
    failure = error ?? new Error('stopped');
  }
  archive.finish(failure, true);
}
