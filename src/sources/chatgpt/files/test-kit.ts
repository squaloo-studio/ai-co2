// Builds the files the tests read: made-up conversations, and ZIP archives written byte by byte so
// that a test can also make the broken and hostile ones no ordinary ZIP tool will write.

import type { ConversationSink } from '../types';

// ---------- made-up conversations ----------

export interface MadeUpConversation {
  id: string;
  conversation_id: string;
  title: string;
  create_time: number;
  update_time: number;
  current_node: string;
  mapping: Record<string, unknown>;
}

/** A small conversation in the shape of an export. Every word in it is invented. */
export function conversation(n: number, padding = 0): MadeUpConversation {
  const id = `conv-${String(n).padStart(5, '0')}`;
  const time = 1_790_000_000 + n * 60;
  const message = (role: string, text: string, at: number): unknown => ({
    id: `${id}-${role}`,
    author: { name: null, role },
    create_time: at,
    content: { content_type: 'text', parts: [text] },
    metadata: role === 'assistant' ? { model_slug: 'gpt-test-1' } : {},
  });
  return {
    id,
    conversation_id: id,
    title: `Made-up chat ${n}`,
    create_time: time,
    update_time: time + 30,
    current_node: `${id}-assistant`,
    mapping: {
      [`${id}-root`]: { id: `${id}-root`, parent: null, message: null },
      [`${id}-user`]: { id: `${id}-user`, parent: `${id}-root`, message: message('user', `Question ${n}? ${'pad '.repeat(padding)}`, time) },
      [`${id}-assistant`]: { id: `${id}-assistant`, parent: `${id}-user`, message: message('assistant', `Answer ${n}.`, time + 5) },
    },
  };
}

export function conversations(from: number, count: number, padding = 0): MadeUpConversation[] {
  return Array.from({ length: count }, (_, i) => conversation(from + i, padding));
}

const encoder = new TextEncoder();
export const utf8 = (text: string): Uint8Array<ArrayBuffer> => encoder.encode(text);
/** Indented with two spaces and without a final line break, like a real export. */
export const json = (value: unknown): Uint8Array<ArrayBuffer> => utf8(JSON.stringify(value, null, 2));

export function file(name: string, ...parts: Array<Uint8Array<ArrayBuffer>>): File {
  return new File(parts, name);
}

export const USER = { id: 'user-made-up', email: 'someone@example.invalid', chatgpt_plus_user: true };

// ---------- a sink that only counts ----------

export interface CountingSink extends ConversationSink<{ ids: string[] }> {
  /** The id of every conversation that was accepted, in the order it arrived. */
  ids: string[];
  /** Everything that was handed over, accepted or not. */
  seen: number;
  users: unknown[];
}

export function countingSink(onAdd?: (seen: number) => void): CountingSink {
  const sink: CountingSink = {
    ids: [],
    seen: 0,
    users: [],
    add(value) {
      sink.seen++;
      onAdd?.(sink.seen);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
      if (!Object.hasOwn(value, 'mapping') || !Object.hasOwn(value, 'id')) return false;
      const { id } = value as { id: unknown };
      if (typeof id !== 'string') return false;
      sink.ids.push(id);
      return true;
    },
    setUser(user) {
      sink.users.push(user);
    },
    counted: () => sink.ids.length,
    finish: () => ({ ids: sink.ids }),
  };
  return sink;
}

// ---------- ZIP archives ----------

export interface ZipEntry {
  name: string;
  data?: Uint8Array<ArrayBuffer>;
  /** Stored without packing. Default: packed with Deflate. */
  store?: boolean;
  /** Sets the "encrypted" flag. The bytes are not really encrypted: a reader must not get that far. */
  encrypted?: boolean;
  /** Sizes and checksum after the data instead of before it, as a streaming ZIP writer does. */
  descriptor?: boolean;
  /** The unpacked size the ZIP claims, when it should lie. */
  claimedSize?: number;
  /** A wrong checksum. */
  badChecksum?: boolean;
  /** The packing method written into the headers, when it should be one no reader knows. */
  method?: number;
  /** Instead of `data`: this many zero bytes, stored, and never held in memory. */
  zeros?: number;
}

/** A piece of a file: real bytes, or a run of zero bytes that exists only as a number. */
export type Piece = Uint8Array<ArrayBuffer> | { zeros: number };

const pieceSize = (piece: Piece): number => (piece instanceof Uint8Array ? piece.byteLength : piece.zeros);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const packed = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(packed).arrayBuffer());
}

function record(size: number, fill: (view: DataView, bytes: Uint8Array) => void): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer), bytes);
  return bytes;
}

const MAX32 = 0xffffffff;

/**
 * Writes a ZIP. With `zip64`, every size and offset goes into the 64-bit fields, as in an archive
 * above 4 GiB. Returned in pieces so that such an archive can be made without holding it.
 */
export async function zipPieces(entries: ZipEntry[], options: { zip64?: boolean } = {}): Promise<Piece[]> {
  const zip64 = options.zip64 === true;
  const pieces: Piece[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const put = (piece: Piece): void => {
    pieces.push(piece);
    offset += pieceSize(piece);
  };

  for (const entry of entries) {
    const name = utf8(entry.name);
    const raw = entry.data ?? new Uint8Array(0);
    const stored = entry.store === true || entry.zeros !== undefined;
    const body: Piece = entry.zeros !== undefined ? { zeros: entry.zeros } : stored ? raw : await deflate(raw);
    const method = entry.method ?? (stored ? 0 : 8);
    const packedSize = pieceSize(body);
    const size = entry.claimedSize ?? (entry.zeros ?? raw.byteLength);
    const crc = entry.zeros !== undefined ? 0 : (crc32(raw) ^ (entry.badChecksum === true ? 1 : 0)) >>> 0;
    const flags = 0x0800 | (entry.encrypted === true ? 1 : 0) | (entry.descriptor === true ? 8 : 0);
    const big = zip64 || packedSize > MAX32 || size > MAX32 || offset > MAX32;
    const start = offset;
    const inHeader = entry.descriptor !== true;

    const localExtra = big
      ? record(20, (v) => {
          v.setUint16(0, 1, true);
          v.setUint16(2, 16, true);
          v.setBigUint64(4, BigInt(inHeader ? size : 0), true);
          v.setBigUint64(12, BigInt(inHeader ? packedSize : 0), true);
        })
      : new Uint8Array(0);
    put(
      record(30 + name.byteLength + localExtra.byteLength, (v, bytes) => {
        v.setUint32(0, 0x04034b50, true);
        v.setUint16(4, big ? 45 : 20, true);
        v.setUint16(6, flags, true);
        v.setUint16(8, method, true);
        v.setUint32(14, inHeader ? crc : 0, true);
        v.setUint32(18, big ? MAX32 : inHeader ? packedSize : 0, true);
        v.setUint32(22, big ? MAX32 : inHeader ? size : 0, true);
        v.setUint16(26, name.byteLength, true);
        v.setUint16(28, localExtra.byteLength, true);
        bytes.set(name, 30);
        bytes.set(localExtra, 30 + name.byteLength);
      }),
    );
    put(body);
    if (entry.descriptor === true) {
      put(
        record(big ? 24 : 16, (v) => {
          v.setUint32(0, 0x08074b50, true);
          v.setUint32(4, crc, true);
          if (big) {
            v.setBigUint64(8, BigInt(packedSize), true);
            v.setBigUint64(16, BigInt(size), true);
          } else {
            v.setUint32(8, packedSize, true);
            v.setUint32(12, size, true);
          }
        }),
      );
    }

    const centralExtra = big
      ? record(28, (v) => {
          v.setUint16(0, 1, true);
          v.setUint16(2, 24, true);
          v.setBigUint64(4, BigInt(size), true);
          v.setBigUint64(12, BigInt(packedSize), true);
          v.setBigUint64(20, BigInt(start), true);
        })
      : new Uint8Array(0);
    central.push(
      record(46 + name.byteLength + centralExtra.byteLength, (v, bytes) => {
        v.setUint32(0, 0x02014b50, true);
        v.setUint16(4, big ? 45 : 20, true);
        v.setUint16(6, big ? 45 : 20, true);
        v.setUint16(8, flags, true);
        v.setUint16(10, method, true);
        v.setUint32(16, crc, true);
        v.setUint32(20, big ? MAX32 : packedSize, true);
        v.setUint32(24, big ? MAX32 : size, true);
        v.setUint16(28, name.byteLength, true);
        v.setUint16(30, centralExtra.byteLength, true);
        v.setUint32(42, big ? MAX32 : start, true);
        bytes.set(name, 46);
        bytes.set(centralExtra, 46 + name.byteLength);
      }),
    );
  }

  const directoryStart = offset;
  for (const header of central) put(header);
  const directorySize = offset - directoryStart;
  const big = zip64 || directoryStart > MAX32 || entries.length > 0xffff;
  if (big) {
    const recordStart = offset;
    put(
      record(56, (v) => {
        v.setUint32(0, 0x06064b50, true);
        v.setBigUint64(4, 44n, true);
        v.setUint16(12, 45, true);
        v.setUint16(14, 45, true);
        v.setBigUint64(24, BigInt(entries.length), true);
        v.setBigUint64(32, BigInt(entries.length), true);
        v.setBigUint64(40, BigInt(directorySize), true);
        v.setBigUint64(48, BigInt(directoryStart), true);
      }),
    );
    put(
      record(20, (v) => {
        v.setUint32(0, 0x07064b50, true);
        v.setBigUint64(8, BigInt(recordStart), true);
        v.setUint32(16, 1, true);
      }),
    );
  }
  put(
    record(22, (v) => {
      v.setUint32(0, 0x06054b50, true);
      v.setUint16(8, big ? 0xffff : entries.length, true);
      v.setUint16(10, big ? 0xffff : entries.length, true);
      v.setUint32(12, big ? MAX32 : directorySize, true);
      v.setUint32(16, big ? MAX32 : directoryStart, true);
    }),
  );
  return pieces;
}

/** A ZIP as bytes. */
export async function zip(entries: ZipEntry[], options: { zip64?: boolean } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const pieces = await zipPieces(entries, options);
  const bytes = new Uint8Array(pieces.reduce((sum, piece) => sum + pieceSize(piece), 0));
  let at = 0;
  for (const piece of pieces) {
    if (piece instanceof Uint8Array) bytes.set(piece, at);
    at += pieceSize(piece);
  }
  return bytes;
}

// ---------- files that are watched, or larger than memory ----------

export interface Watched {
  file: File;
  /** Bytes the reader has asked for so far, by any route. */
  bytesAsked(): number;
  /** Streams that were opened and neither read to their end nor cancelled. */
  openStreams(): number;
}

/**
 * Something that acts like a File, made of pieces. It counts what is read from it, and a run of
 * zeros in it costs no memory, so it can stand for a file above 4 GiB. (Node 22's own way to open a
 * file as a Blob reports a wrong size above 4 GiB.)
 */
export function watchedFile(name: string, pieces: Piece[], chunkSize = 64 * 1024): Watched {
  let asked = 0;
  let open = 0;
  const total = pieces.reduce((sum, piece) => sum + pieceSize(piece), 0);

  const read = (from: number, to: number): Uint8Array<ArrayBuffer> => {
    const out = new Uint8Array(to - from);
    let at = 0;
    for (const piece of pieces) {
      const end = at + pieceSize(piece);
      if (end > from && at < to && piece instanceof Uint8Array) {
        const a = Math.max(from, at);
        const b = Math.min(to, end);
        out.set(piece.subarray(a - at, b - at), a - from);
      }
      at = end;
    }
    asked += out.byteLength;
    return out;
  };

  const part = (from: number, to: number): object => ({
    size: to - from,
    type: '',
    name,
    slice(start = 0, end = to - from) {
      const a = Math.min(Math.max(start, 0), to - from);
      const b = Math.min(Math.max(end, a), to - from);
      return part(from + a, from + b);
    },
    arrayBuffer: () => Promise.resolve(read(from, to).buffer),
    stream() {
      let at = from;
      let done = false;
      open++;
      const close = (): void => {
        if (!done) open--;
        done = true;
      };
      return new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (at >= to) {
              close();
              return controller.close();
            }
            const next = Math.min(to, at + chunkSize);
            controller.enqueue(read(at, next));
            at = next;
          },
          cancel: close,
        },
        { highWaterMark: 0 },
      );
    },
  });

  // The reader only uses the few members above, so this stand-in is passed off as a File.
  return { file: part(0, total) as unknown as File, bytesAsked: () => asked, openStreams: () => open };
}
