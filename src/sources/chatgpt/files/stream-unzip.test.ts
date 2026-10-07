// How much a ZIP read from its first byte really unpacks. The report cannot show that: a file the
// reader has given up on is closed, whatever goes on behind it. So fflate's inflater is wrapped here
// and every byte that comes out of it is counted.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlateStreamHandler } from 'fflate';
import { readExport } from './read-export';
import { conversations, countingSink, file, json, USER, utf8, zip } from './test-kit';

const unpacked = vi.hoisted(() => ({ bytes: 0 }));

vi.mock('fflate', async (importOriginal) => {
  const real = await importOriginal<typeof import('fflate')>();
  class Inflate extends real.Inflate {
    constructor(handler: FlateStreamHandler) {
      super((data, final) => {
        unpacked.bytes += data.length;
        handler(data, final);
      });
    }
  }
  return { ...real, Inflate };
});

const MiB = 2 ** 20;
const ids = (from: number, count: number): string[] => conversations(from, count).map((c) => c.id);

/** 24 MiB of white space behind one character: it packs to about 24 KiB. */
const bomb = (first: string): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(24 * MiB).fill(0x20);
  bytes[0] = first.charCodeAt(0);
  return bytes;
};

/** The inner export ZIP is packed inside the container, so it is read as a stream. */
const container = async (inner: Uint8Array<ArrayBuffer>): Promise<File> => file('c.zip', await zip([{ name: 'x-chatgpt-0001.zip', data: inner }]));
const slices = { inflateSliceBytes: 1024 };

describe('what a ZIP read from its first byte unpacks', () => {
  beforeEach(() => {
    unpacked.bytes = 0;
  });

  it('only the conversation files and user.json, never an attachment', async () => {
    const data = json(conversations(0, 30));
    const inner = await zip([
      { name: 'chat.html', data: new Uint8Array(3 * MiB).fill(0x41) },
      { name: 'conversations.json', data },
      { name: 'file_1.dat', data: new Uint8Array(5 * MiB).fill(0x42) },
      { name: 'user.json', data: json(USER) },
    ]);
    const sink = countingSink();
    await readExport([await container(inner)], sink);
    expect(sink.ids).toEqual(ids(0, 30));
    expect(sink.users).toEqual([USER]);
    expect(unpacked.bytes).toBe(data.byteLength + json(USER).byteLength);
  });

  it('stops unpacking a conversations file as soon as a limit has stopped it', async () => {
    const inner = await zip([
      { name: 'conversations-000.json', data: bomb('[') },
      { name: 'conversations-001.json', data: json(conversations(0, 2)) },
    ]);
    const sink = countingSink();
    const report = await readExport([await container(inner)], sink, { limits: { ...slices, ratioFloorBytes: 256 * 1024, maxRatio: 50 } });
    expect(report.files.map((f) => f.problem)).toEqual(['ratio-too-high', null]);
    expect(sink.ids).toEqual(ids(0, 2));
    expect(unpacked.bytes).toBeLessThan(4 * MiB);
  });

  it('stops unpacking a file that is not a list at its first piece', async () => {
    const inner = await zip([{ name: 'conversations.json', data: bomb('{') }]);
    const report = await readExport([await container(inner)], countingSink(), { limits: slices });
    expect(report.files.map((f) => f.problem)).toEqual(['not-an-array']);
    expect(unpacked.bytes).toBeLessThan(2 * MiB);
  });

  it('stops unpacking a user.json that is too large', async () => {
    const inner = await zip([
      { name: 'user.json', data: bomb('{') },
      { name: 'conversations.json', data: json(conversations(0, 2)) },
    ]);
    const sink = countingSink();
    const report = await readExport([await container(inner)], sink, { limits: { ...slices, maxUserFileBytes: 64 * 1024 } });
    expect(report.notices).toEqual([{ code: 'user-unreadable', path: ['c.zip', 'x-chatgpt-0001.zip', 'user.json'] }]);
    expect(sink.ids).toEqual(ids(0, 2));
    expect(sink.users).toEqual([]);
    expect(unpacked.bytes).toBeLessThan(4 * MiB);
  });

  it('unpacks nothing more of a file once the read is cancelled', async () => {
    const data = json(conversations(0, 3000, 100));
    const inner = await zip([{ name: 'conversations.json', data }]);
    const controller = new AbortController();
    const sink = countingSink((seen) => {
      if (seen === 10) controller.abort();
    });
    await expect(readExport([await container(inner)], sink, { signal: controller.signal, limits: slices })).rejects.toMatchObject({ code: 'cancelled' });
    expect(unpacked.bytes).toBeLessThan(data.byteLength / 4);
    const after = unpacked.bytes;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(unpacked.bytes).toBe(after);
  });

  it('does not unpack the same name a second time', async () => {
    const data = json(conversations(0, 5));
    const inner = await zip([
      { name: 'conversations.json', data },
      { name: 'conversations.json', data: utf8(`[${' '.repeat(MiB)}]`) },
    ]);
    const report = await readExport([await container(inner)], countingSink());
    expect(report.notices).toEqual([{ code: 'same-name', path: ['c.zip', 'x-chatgpt-0001.zip', 'conversations.json'] }]);
    expect(unpacked.bytes).toBe(data.byteLength);
  });
});
