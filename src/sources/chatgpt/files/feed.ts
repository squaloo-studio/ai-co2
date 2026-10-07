// One conversations file, fed in chunks of bytes. The JSON is parsed as it arrives and every finished
// element of the top-level list is handed over at once, so neither the file nor a second conversation
// is ever held in memory.

import { JSONParser, TokenType } from '@streamparser/json';
import type { FilePath, FileProblem, ReadFile } from './report';
import type { Run } from './run';

/** Thrown by `push` when this file must not be read any further. The problem is already on record. */
export class FileStopped extends Error {
  readonly problem: FileProblem;
  constructor(problem: FileProblem) {
    super(problem);
    this.problem = problem;
  }
}

export interface Feed {
  /** false once the file has ended or was stopped. */
  readonly open: boolean;
  /**
   * Takes the next bytes. Throws FileStopped when a limit is passed or the JSON is broken, and a
   * ReadExportError when the whole read must end. Does nothing once the file is closed.
   */
  push(chunk: Uint8Array): void;
  /** The bytes ran out: checks that the JSON is complete. */
  end(): void;
  /** The bytes stopped coming for another reason. Does nothing once the file is closed. */
  fail(problem: FileProblem): void;
}

const BOM = [0xef, 0xbb, 0xbf];
const isSpace = (byte: number): boolean => byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;

/**
 * The parser gathers a long string or number in these buffers. Without them it keeps one list entry
 * per escaped character or digit, which takes many times the memory of the text itself.
 */
const STRING_BUFFER_BYTES = 64 * 1024;
const NUMBER_BUFFER_BYTES = 64;

/**
 * @param packedSize the file's size inside the ZIP, for the ratio rule. 0 when it is not known or the
 * file is not packed.
 */
export function openFeed(run: Run, path: FilePath, packedSize: number): Feed {
  const { limits } = run;
  const file: ReadFile = { path, bytes: 0, handed: 0, skipped: 0, problem: null };
  const parser = new JSONParser({
    paths: ['$.*'],
    keepStack: false,
    stringBufferSize: STRING_BUFFER_BYTES,
    numberBufferSize: NUMBER_BUFFER_BYTES,
  });
  // The parser stops a file at the first byte that is not valid UTF-8, and exports with such bytes
  // have been reported. Decoding first puts a replacement character there, and the reading goes on.
  const decoder = new TextDecoder();
  let open = true;
  let started = false;
  let sinceLastValue = 0;
  let parts = 0;
  let nesting = 0;

  // Runs before the parser builds anything for the token, so a limit stops the growth it guards.
  parser.onToken = ({ token }) => {
    switch (token) {
      case TokenType.LEFT_BRACE:
      case TokenType.LEFT_BRACKET:
        if (++nesting > limits.maxNesting) throw new FileStopped('conversation-too-large');
        break;
      case TokenType.RIGHT_BRACE:
      case TokenType.RIGHT_BRACKET:
        nesting--;
        return;
      case TokenType.STRING:
      case TokenType.NUMBER:
      case TokenType.TRUE:
      case TokenType.FALSE:
      case TokenType.NULL:
        break;
      default:
        return;
    }
    if (++parts > limits.maxPartsPerConversation) throw new FileStopped('conversation-too-large');
  };

  parser.onValue = ({ value, stack }) => {
    if (stack.length !== 1) return;
    sinceLastValue = 0;
    parts = 0;
    file.handed++;
    run.report.totals.handed++;
    if (!run.add(value)) {
      file.skipped++;
      run.report.totals.skipped++;
    }
  };

  const close = (problem: FileProblem | null): void => {
    if (!open) return;
    open = false;
    file.problem = problem;
    run.fileDone(file);
  };

  /** Looks for the first character that is not a byte-order mark or white space. It must be "[". */
  const checkStart = (chunk: Uint8Array): void => {
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      if (byte === undefined) return;
      const position = file.bytes + i;
      if (position < BOM.length && byte === BOM[position]) continue;
      if (isSpace(byte)) continue;
      started = true;
      if (byte !== 0x5b) throw new FileStopped('not-an-array');
      return;
    }
  };

  const parse = (text: string): void => {
    try {
      parser.write(text);
    } catch (error) {
      // A limit, thrown by the token check above and passed on by the parser.
      if (error instanceof FileStopped) throw error;
      run.onlyThisFile(error);
      throw new FileStopped('not-json');
    }
  };

  return {
    get open() {
      return open;
    },
    push(chunk) {
      if (!open) return;
      try {
        run.checkpoint();
        if (!started) checkStart(chunk);
        const size = chunk.byteLength;
        file.bytes += size;
        sinceLastValue += size;
        run.inflated += size;
        run.report.totals.bytes += size;
        if (file.bytes > limits.maxInflatedBytesPerFile) throw new FileStopped('file-too-large');
        if (run.inflated > limits.maxInflatedBytesTotal) throw new FileStopped('total-too-large');
        if (packedSize > 0 && file.bytes > limits.ratioFloorBytes && file.bytes > packedSize * limits.maxRatio) {
          throw new FileStopped('ratio-too-high');
        }
        if (sinceLastValue > limits.maxBytesPerConversation) throw new FileStopped('conversation-too-large');
        parse(decoder.decode(chunk, { stream: true }));
        run.progress();
      } catch (error) {
        if (error instanceof FileStopped) close(error.problem);
        throw error;
      }
    },
    end() {
      if (!open) return;
      if (!started) return close('empty');
      try {
        // Without this call a file that stops in the middle passes as complete.
        if (!parser.isEnded) parser.end();
      } catch (error) {
        run.onlyThisFile(error);
        return close('cut-off');
      }
      close(null);
    },
    fail: close,
  };
}

/**
 * The most bytes handed on in one piece. A browser may give a file in pieces of any size, and the
 * limits and the cancel check are applied once per piece.
 */
const PIECE_BYTES = 256 * 1024;

/**
 * Reads a stream to its end, one chunk at a time. Whatever stops it, the stream is cancelled, so
 * the file behind it is let go at once.
 */
export async function pump(run: Run, source: ReadableStream<Uint8Array>, write: (chunk: Uint8Array) => void): Promise<void> {
  const reader = source.getReader();
  const stop = (): void => void reader.cancel().catch(() => {});
  run.signal?.addEventListener('abort', stop, { once: true });
  try {
    for (;;) {
      run.checkpoint();
      const { done, value } = await reader.read();
      run.checkpoint();
      if (done) return;
      for (let at = 0; at < value.byteLength; at += PIECE_BYTES) write(value.subarray(at, at + PIECE_BYTES));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    run.signal?.removeEventListener('abort', stop);
  }
}
