import { describe, expect, it } from 'vitest';
import type { ConversationSink } from '../types';
import { LIMITS } from './limits';
import { readExport } from './read-export';
import { ReadExportError, type ReadProgress } from './report';
import { conversations, countingSink, file, json, USER, utf8, watchedFile, zip, zipPieces, type ZipEntry } from './test-kit';

const ids = (from: number, count: number): string[] => conversations(from, count).map((c) => c.id);
const codes = (report: { notices: Array<{ code: string }> }): string[] => report.notices.map((n) => n.code);

/** An export as the Settings route sends it: conversations among other files, the attachments after them. */
function exportEntries(pieces: Array<[name: string, from: number, count: number]>): ZipEntry[] {
  return [
    { name: 'chat.html', data: utf8('<html>not read</html>') },
    ...pieces.map(([name, from, count]) => ({ name, data: json(conversations(from, count)) })),
    { name: 'file_0000000000000000.dat', data: utf8('an attachment that is never opened'), store: true },
    { name: 'user.json', data: json(USER) },
    { name: 'export_manifest.json', data: json({ version: 1 }) },
  ];
}

describe('ordinary exports', () => {
  it('reads a plain ZIP and finds user.json', async () => {
    const sink = countingSink();
    const bytes = await zip(exportEntries([['conversations.json', 0, 7]]));
    const report = await readExport([file('export.zip', bytes)], sink);

    expect(sink.ids).toEqual(ids(0, 7));
    expect(sink.users).toEqual([USER]);
    expect(report.notices).toEqual([]);
    expect(report.files).toEqual([
      { path: ['export.zip', 'conversations.json'], bytes: json(conversations(0, 7)).byteLength, handed: 7, skipped: 0, problem: null },
    ]);
    expect(report.totals).toEqual({
      archives: 1,
      conversationFiles: 1,
      filesWithProblems: 0,
      bytes: json(conversations(0, 7)).byteLength,
      handed: 7,
      skipped: 0,
      userFiles: 1,
    });
  });

  it('reads only the conversation files, not the attachments around them', async () => {
    const pieces = await zipPieces([
      { name: 'conversations.json', data: json(conversations(0, 3)) },
      { name: 'file_big.dat', zeros: 40 * 2 ** 20 },
      { name: 'user.json', data: json(USER) },
    ]);
    const watched = watchedFile('export.zip', pieces);
    const sink = countingSink();
    await readExport([watched.file], sink);
    expect(sink.ids).toEqual(ids(0, 3));
    expect(watched.bytesAsked()).toBeLessThan(200_000);
  });

  it('reads conversations split over several files in a folder, in name order', async () => {
    const sink = countingSink();
    const bytes = await zip([
      { name: 'export/conversations-002.json', data: json(conversations(200, 15)) },
      { name: 'export/chat.html', data: utf8('x') },
      { name: 'export/conversations-000.json', data: json(conversations(0, 100)) },
      { name: 'export/conversations-001.json', data: json(conversations(100, 100)) },
      { name: 'export/user.json', data: json(USER) },
    ]);
    const progress: ReadProgress[] = [];
    const report = await readExport([file('export.zip', bytes)], sink, { onProgress: (p) => progress.push(p), progressEveryMs: 0 });

    expect(sink.ids).toEqual(ids(0, 215));
    expect(sink.users).toEqual([USER]);
    expect(report.files.map((f) => f.path[1])).toEqual([
      'export/conversations-000.json',
      'export/conversations-001.json',
      'export/conversations-002.json',
    ]);
    const last = progress.at(-1);
    expect(last?.conversations).toBe(215);
    expect(last?.conversationsAbout).toBe(200);
    expect(last?.bytesTotal).toBe(report.totals.bytes);
    expect(last?.bytesRead).toBe(report.totals.bytes);
    expect(last?.scan).toBeNull();
  });

  it('reads loose JSON files and says which files it ignored', async () => {
    const sink = countingSink();
    const report = await readExport(
      [
        file('conversations-000.json', json(conversations(0, 4))),
        file('holiday.jpg', utf8('not a picture')),
        file('conversations-001.json', json(conversations(4, 2))),
        file('user.json', json(USER)),
        file('._conversations.json', utf8('Mac resource fork')),
        file('chat.html', utf8('<html>')),
      ],
      sink,
    );
    expect(sink.ids).toEqual(ids(0, 6));
    expect(sink.users).toEqual([USER]);
    expect(report.notices).toEqual([
      { code: 'ignored', path: ['holiday.jpg'] },
      { code: 'ignored', path: ['._conversations.json'] },
      { code: 'ignored', path: ['chat.html'] },
    ]);
    expect(report.totals.archives).toBe(0);
    expect(report.totals.conversationFiles).toBe(2);
  });

  it('accepts a byte-order mark, white space around the list and an empty list', async () => {
    const sink = countingSink();
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const report = await readExport(
      [
        file('conversations-000.json', bom, utf8('\n  '), json(conversations(0, 2)), utf8('\n')),
        file('conversations-001.json', utf8('[]')),
      ],
      sink,
    );
    expect(sink.ids).toEqual(ids(0, 2));
    expect(report.files.map((f) => f.problem)).toEqual([null, null]);
  });

  it('hands over the same conversations twice when two files hold them, and leaves the choice to the counting side', async () => {
    const sink = countingSink();
    const first = await zip(exportEntries([['conversations.json', 0, 5]]));
    const second = await zip(exportEntries([['conversations.json', 0, 5]]));
    const report = await readExport([file('export.zip', first), file('export (1).zip', second)], sink);
    expect(sink.seen).toBe(10);
    expect(sink.ids).toEqual([...ids(0, 5), ...ids(0, 5)]);
    expect(sink.users).toHaveLength(2);
    expect(report.totals).toMatchObject({ archives: 2, conversationFiles: 2, handed: 10, skipped: 0 });
  });

  it('reads a ZIP64 archive', async () => {
    const sink = countingSink();
    const bytes = await zip(exportEntries([['conversations-000.json', 0, 100], ['conversations-001.json', 100, 9]]), { zip64: true });
    const report = await readExport([file('export.zip', bytes)], sink);
    expect(sink.ids).toEqual(ids(0, 109));
    expect(report.notices).toEqual([]);
  });

  it('reads conversation files that lie behind the 4 GiB mark, without reading what lies before', async () => {
    const pieces = await zipPieces([
      { name: 'file_huge.dat', zeros: 4_617_089_843 },
      { name: 'conversations-000.json', data: json(conversations(0, 100)) },
      { name: 'conversations-001.json', data: json(conversations(100, 3)) },
      { name: 'user.json', data: json(USER) },
    ]);
    const watched = watchedFile('export.zip', pieces);
    expect(watched.file.size).toBeGreaterThan(2 ** 32);
    const sink = countingSink();
    const report = await readExport([watched.file], sink);
    expect(sink.ids).toEqual(ids(0, 103));
    expect(sink.users).toEqual([USER]);
    expect(report.notices).toEqual([]);
    expect(watched.bytesAsked()).toBeLessThan(500_000);
  });
});

describe('the container ZIP of the privacy portal', () => {
  const inner = (): Promise<Uint8Array<ArrayBuffer>> =>
    zip(exportEntries([['conversations-000.json', 0, 100], ['conversations-001.json', 100, 20]]));
  const container = async (store: boolean, extra: ZipEntry[] = []): Promise<Uint8Array<ArrayBuffer>> =>
    zip([
      { name: 'report.html', data: utf8('<html>') },
      { name: 'User Online Activity/Conversations__abc-chatgpt-0001.zip', data: await inner(), store },
      { name: 'User Online Activity/Files__abc-files-0001.zip', data: await zip([{ name: 'conversations.json', data: json(conversations(900, 1)) }]), store },
      ...extra,
    ]);

  it('reads an export ZIP that is stored inside it, in place', async () => {
    const pieces = [await container(true)];
    const watched = watchedFile('OpenAI-export.zip', pieces);
    const sink = countingSink();
    const report = await readExport([watched.file], sink);
    expect(sink.ids).toEqual(ids(0, 120));
    expect(sink.users).toEqual([USER]);
    expect(report.notices).toEqual([]);
    expect(report.totals.archives).toBe(2);
    expect(report.files[0]?.path).toEqual([
      'OpenAI-export.zip',
      'User Online Activity/Conversations__abc-chatgpt-0001.zip',
      'conversations-000.json',
    ]);
  });

  it('reads an export ZIP that is packed inside it, as a stream', async () => {
    const sink = countingSink();
    const progress: ReadProgress[] = [];
    const report = await readExport([file('OpenAI-export.zip', await container(false))], sink, {
      onProgress: (p) => progress.push(p),
      progressEveryMs: 0,
    });
    expect([...sink.ids].sort()).toEqual(ids(0, 120));
    expect(sink.users).toEqual([USER]);
    expect(report.notices).toEqual([]);
    expect(report.totals).toMatchObject({ archives: 2, conversationFiles: 2, filesWithProblems: 0, handed: 120 });
    expect(progress.some((p) => p.scan !== null && p.scan.read > 0)).toBe(true);
    expect(progress.at(-1)?.scan).toBeNull();
  });

  it('reads the parts of a large export, each a whole ZIP', async () => {
    const sink = countingSink();
    const bytes = await zip([
      { name: 'Conversations__abc-chatgpt-0001-part-0002.zip', data: await zip([{ name: 'file_1.dat', data: utf8('attachment') }]), store: true },
      { name: 'Conversations__abc-chatgpt-0001-part-0001.zip', data: await inner(), store: true },
    ]);
    const report = await readExport([file('OpenAI-export.zip', bytes)], sink);
    expect(sink.ids).toEqual(ids(0, 120));
    expect(report.notices).toEqual([]);
    expect(report.totals.archives).toBe(3);
  });

  it('reads a packed inner ZIP that was written with the sizes after the data', async () => {
    const sink = countingSink();
    const streamed = await zip([
      { name: 'conversations.json', data: json(conversations(0, 30)), descriptor: true },
      { name: 'file_1.dat', data: utf8('attachment '.repeat(500)), descriptor: true },
      { name: 'user.json', data: json(USER), descriptor: true },
    ]);
    const report = await readExport([file('c.zip', await zip([{ name: 'x-chatgpt-0001.zip', data: streamed }]))], sink);
    expect(sink.ids).toEqual(ids(0, 30));
    expect(sink.users).toEqual([USER]);
    expect(report.notices).toEqual([]);
  });

  for (const store of [true, false]) {
    it(`does not open a ZIP inside a ZIP inside a ZIP (${store ? 'stored' : 'packed'})`, async () => {
      const deepest = await zip([{ name: 'conversations.json', data: json(conversations(500, 3)) }]);
      const middle = await zip([
        { name: 'conversations.json', data: json(conversations(0, 2)) },
        { name: 'deeper-chatgpt-0001.zip', data: deepest, store },
      ]);
      const sink = countingSink();
      const report = await readExport([file('outer.zip', await zip([{ name: 'a-chatgpt-0001.zip', data: middle, store }]))], sink);
      expect(sink.ids).toEqual(ids(0, 2));
      expect(report.totals.archives).toBe(2);
    });
  }

  it('reads at most a set number of inner ZIPs', async () => {
    const small = await zip([{ name: 'conversations.json', data: json(conversations(0, 1)) }]);
    const sink = countingSink();
    const report = await readExport(
      [file('c.zip', await zip([1, 2, 3].map((n) => ({ name: `x-chatgpt-000${n}.zip`, data: small, store: true }))))],
      sink,
      { limits: { maxNestedZips: 2 } },
    );
    expect(sink.seen).toBe(0);
    expect(report.notices).toEqual([{ code: 'too-many-inner-archives', path: ['c.zip'], limit: 2, found: 3 }]);
  });
});

describe('broken files', () => {
  it('reads a cut-off ZIP from its first byte when the conversations came before the cut', async () => {
    const whole = await zip([
      { name: 'conversations-000.json', data: json(conversations(0, 100)) },
      { name: 'conversations-001.json', data: json(conversations(100, 12)) },
      { name: 'file_1.dat', data: crypto.getRandomValues(new Uint8Array(60_000)), store: true },
      { name: 'user.json', data: json(USER) },
    ]);
    const sink = countingSink();
    const report = await readExport([file('export.zip', whole.slice(0, whole.byteLength - 30_000))], sink);
    expect(sink.ids).toEqual(ids(0, 112));
    expect(report.notices).toEqual([{ code: 'rescued', path: ['export.zip'], files: 2, conversations: 112 }]);
    expect(report.totals.filesWithProblems).toBe(0);
  });

  it('reports a ZIP that is cut inside a conversations file, and keeps what came before', async () => {
    const whole = await zip([
      { name: 'conversations-000.json', data: json(conversations(0, 100)) },
      { name: 'conversations-001.json', data: json(conversations(100, 100, 40)) },
      { name: 'file_1.dat', data: utf8('attachment') },
    ]);
    const firstSize = (await zip([{ name: 'conversations-000.json', data: json(conversations(0, 100)) }])).byteLength;
    const sink = countingSink();
    const report = await readExport([file('export.zip', whole.slice(0, firstSize + 2_000))], sink);
    expect(sink.ids.slice(0, 100)).toEqual(ids(0, 100));
    expect(sink.ids.length).toBeLessThan(200);
    expect(report.files.map((f) => f.problem)).toEqual([null, 'cut-off']);
    // The notice counts what was taken from this ZIP: the whole first file and the start of the second.
    expect(report.notices).toEqual([{ code: 'rescued', path: ['export.zip'], files: 2, conversations: sink.ids.length }]);
    expect(sink.ids.length).toBeGreaterThanOrEqual(100);
  });

  it('says so when nothing can be rescued from a ZIP', async () => {
    const sink = countingSink();
    const report = await readExport([file('export.zip', crypto.getRandomValues(new Uint8Array(5_000)))], sink);
    expect(sink.seen).toBe(0);
    expect(report.notices).toEqual([{ code: 'unreadable', path: ['export.zip'] }]);
  });

  it('reports a cut-off JSON file and keeps the conversations before the cut', async () => {
    const whole = json(conversations(0, 10));
    const sink = countingSink();
    const report = await readExport(
      [file('conversations-000.json', whole.slice(0, Math.floor(whole.byteLength * 0.55))), file('conversations-001.json', json(conversations(10, 2)))],
      sink,
    );
    expect(sink.ids).toEqual([...ids(0, 5), ...ids(10, 2)]);
    expect(report.files.map((f) => [f.handed, f.problem])).toEqual([[5, 'cut-off'], [2, null]]);
    expect(report.totals.filesWithProblems).toBe(1);
  });

  it('refuses a file that is not a list', async () => {
    const sink = countingSink();
    const report = await readExport(
      [
        file('conversations.json', json({ mapping: {}, id: 'x' })),
        file('conversations-000.json', utf8('')),
        file('conversations-001.json', utf8('   \n ')),
        file('conversations-002.json', utf8('"[just a string]"')),
        file('conversations-003.json', utf8('<html>')),
      ],
      sink,
    );
    expect(sink.seen).toBe(0);
    expect(report.files.map((f) => f.problem)).toEqual(['not-an-array', 'empty', 'empty', 'not-an-array', 'not-an-array']);
  });

  it('stops at broken JSON, keeps what came before, and goes on with the next file', async () => {
    const sink = countingSink();
    const good = JSON.stringify(conversations(0, 3));
    const report = await readExport(
      [
        file('conversations-000.json', utf8(`${good.slice(0, -1)}, {"id": "x", "mapping": {]]`)),
        file('conversations-001.json', utf8(`${good} trailing`)),
        file('conversations-002.json', json(conversations(3, 1))),
      ],
      sink,
    );
    expect(sink.ids).toEqual([...ids(0, 3), ...ids(0, 3), ...ids(3, 1)]);
    expect(report.files.map((f) => f.problem)).toEqual(['not-json', 'not-json', null]);
  });

  it('hands over junk elements and counts the ones that were not conversations', async () => {
    const sink = countingSink();
    const list = [1, 'x', null, [conversations(0, 1)], {}, { mapping: 'no id' }, ...conversations(0, 2), true, { ['__proto__']: { polluted: true }, id: 7, mapping: {} }];
    const report = await readExport([file('conversations.json', utf8(JSON.stringify(list).replace('"["__proto__"]"', '"__proto__"')))], sink);
    expect(sink.ids).toEqual(ids(0, 2));
    expect(report.files).toEqual([expect.objectContaining({ handed: 10, skipped: 8, problem: null })]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('reports an entry with a wrong checksum as damaged', async () => {
    const sink = countingSink();
    const bytes = await zip([
      { name: 'conversations-000.json', data: json(conversations(0, 2)), badChecksum: true },
      { name: 'conversations-001.json', data: json(conversations(2, 2)) },
      { name: 'conversations-002.json', data: json(conversations(4, 2)), method: 99 },
    ]);
    const report = await readExport([file('export.zip', bytes)], sink);
    expect(report.files.map((f) => f.problem)).toEqual(['damaged', null, 'damaged']);
    expect(sink.ids.slice(-2)).toEqual(ids(2, 2));
  });

  it('says so when a ZIP holds no conversations', async () => {
    const sink = countingSink();
    const report = await readExport([file('photos.zip', await zip([{ name: 'a.jpg', data: utf8('x') }]))], sink);
    expect(report.notices).toEqual([{ code: 'no-conversations', path: ['photos.zip'] }]);
  });
});

describe('hostile files', () => {
  const bomb = (): Uint8Array<ArrayBuffer> => {
    const bytes = new Uint8Array(24 * 2 ** 20).fill(0x20);
    bytes[0] = 0x5b;
    return bytes;
  };
  const small = { ratioFloorBytes: 256 * 1024, maxRatio: 50 };

  it('stops a decompression bomb early, by the bytes that really come out', async () => {
    const pieces = await zipPieces([
      { name: 'conversations-000.json', data: bomb() },
      { name: 'conversations-001.json', data: bomb(), claimedSize: 10 },
      { name: 'conversations-002.json', data: json(conversations(0, 2)) },
    ]);
    const sink = countingSink();
    const report = await readExport([watchedFile('bomb.zip', pieces).file], sink, { limits: small });
    expect(report.files[0]?.problem).toBe('ratio-too-high');
    expect(report.files[0]?.bytes).toBeLessThan(4 * 2 ** 20);
    // The same bomb with a false size in the table of contents fares no better.
    expect(report.files[1]?.problem).not.toBeNull();
    expect(report.files[1]?.bytes).toBeLessThan(4 * 2 ** 20);
    expect(sink.ids).toEqual(ids(0, 2));
  });

  it('stops a decompression bomb in a ZIP that is read as a stream', async () => {
    const inner = await zip([
      { name: 'conversations-000.json', data: bomb() },
      { name: 'conversations-001.json', data: json(conversations(0, 2)) },
    ]);
    const sink = countingSink();
    const report = await readExport([file('c.zip', await zip([{ name: 'x-chatgpt-0001.zip', data: inner }]))], sink, {
      limits: { ...small, inflateSliceBytes: 1024 },
    });
    expect(report.files[0]?.problem).toBe('ratio-too-high');
    expect(report.files[0]?.bytes).toBeLessThan(4 * 2 ** 20);
    expect(sink.ids).toEqual(ids(0, 2));
  });

  it('stops at the size limit for one file and for all files together', async () => {
    const sink = countingSink();
    const one = json(conversations(0, 50));
    const perFile = await readExport([file('conversations-000.json', one), file('conversations-001.json', json(conversations(50, 1)))], sink, {
      limits: { maxInflatedBytesPerFile: 5_000 },
    });
    expect(perFile.files.map((f) => f.problem)).toEqual(['file-too-large', null]);

    const total = await readExport(
      [file('a.zip', await zip([{ name: 'conversations-000.json', data: one }, { name: 'conversations-001.json', data: one }]))],
      countingSink(),
      { limits: { maxInflatedBytesTotal: one.byteLength + 100 } },
    );
    expect(total.files.map((f) => f.problem)).toEqual([null, 'total-too-large']);
  });

  it('stops at a conversation that never ends', async () => {
    const sink = countingSink();
    const endless = utf8(`${JSON.stringify(conversations(0, 2)).slice(0, -1)}, {"id": "endless", "mapping": {"a": "${'x'.repeat(300_000)}`);
    const report = await readExport([watchedFile('conversations.json', [endless], 4096).file], sink, {
      limits: { maxBytesPerConversation: 100_000 },
    });
    expect(sink.ids).toEqual(ids(0, 2));
    expect(report.files[0]?.problem).toBe('conversation-too-large');
    expect(report.files[0]?.bytes).toBeLessThan(250_000);
  });

  it('refuses a ZIP with too many entries, also when it is read as a stream', async () => {
    const entries: ZipEntry[] = [
      { name: 'conversations.json', data: json(conversations(0, 1)) },
      ...Array.from({ length: 12 }, (_, n) => ({ name: `file_${n}.dat`, data: utf8('x'), store: true })),
    ];
    const bytes = await zip(entries);
    const limits = { maxEntriesPerZip: 10 };

    const listed = await readExport([file('many.zip', bytes)], countingSink(), { limits });
    expect(listed.notices).toEqual([{ code: 'too-many-entries', path: ['many.zip'], limit: 10 }]);
    expect(listed.totals.handed).toBe(0);

    const streamed = await readExport([file('c.zip', await zip([{ name: 'x-chatgpt-0001.zip', data: bytes }]))], countingSink(), { limits });
    expect(streamed.notices).toEqual([{ code: 'too-many-entries', path: ['c.zip', 'x-chatgpt-0001.zip'], limit: 10 }]);

    const cut = await readExport([file('cut.zip', bytes.slice(0, bytes.byteLength - 40))], countingSink(), { limits });
    expect(cut.notices).toEqual([{ code: 'too-many-entries', path: ['cut.zip'], limit: 10 }]);
  });

  it('refuses a ZIP with too many conversation files', async () => {
    const entries = Array.from({ length: 4 }, (_, n) => ({ name: `conversations-00${n}.json`, data: json(conversations(n, 1)) }));
    const sink = countingSink();
    const report = await readExport([file('many.zip', await zip(entries))], sink, { limits: { maxConversationFiles: 3 } });
    expect(sink.seen).toBe(0);
    expect(report.notices).toEqual([{ code: 'too-many-conversation-files', path: ['many.zip'], limit: 3 }]);
  });

  it('skips encrypted entries and says so', async () => {
    const sink = countingSink();
    const bytes = await zip([
      { name: 'conversations-000.json', data: json(conversations(0, 2)), encrypted: true },
      { name: 'conversations-001.json', data: json(conversations(2, 2)) },
      { name: 'user.json', data: json(USER), encrypted: true },
      { name: 'x-chatgpt-0001.zip', data: utf8('secret'), encrypted: true, store: true },
    ]);
    const report = await readExport([file('export.zip', bytes)], sink);
    expect(sink.ids).toEqual(ids(2, 2));
    expect(sink.users).toEqual([]);
    expect(report.notices).toEqual([
      { code: 'encrypted', path: ['export.zip', 'conversations-000.json'] },
      { code: 'encrypted', path: ['export.zip', 'x-chatgpt-0001.zip'] },
    ]);
  });

  it('treats path tricks as plain names: nothing is written, nothing escapes', async () => {
    const sink = countingSink();
    const bytes = await zip([
      { name: '../../etc/conversations.json', data: json(conversations(0, 1)) },
      { name: '/abs/conversations-000.json', data: json(conversations(1, 1)) },
      { name: 'C:\\Windows\\conversations.json', data: json(conversations(2, 1)) },
      { name: '__MACOSX/._conversations.json', data: utf8('Mac resource fork') },
      { name: '<img src=x onerror=alert(1)>/conversations.json', data: json(conversations(3, 1)) },
    ]);
    const report = await readExport([file('tricks.zip', bytes)], sink);
    expect([...sink.ids].sort()).toEqual([...ids(0, 2), ...ids(3, 1)]);
    expect(report.notices).toEqual([]);
    expect(report.files.map((f) => f.path[1]).sort()).toEqual([
      '../../etc/conversations.json',
      '/abs/conversations-000.json',
      '<img src=x onerror=alert(1)>/conversations.json',
    ]);
  });

  it('reads the first of two entries with one name', async () => {
    const sink = countingSink();
    const bytes = await zip([
      { name: 'conversations.json', data: json(conversations(0, 2)) },
      { name: 'conversations.json', data: json(conversations(50, 2)) },
    ]);
    const report = await readExport([file('twice.zip', bytes)], sink);
    expect(sink.ids).toEqual(ids(0, 2));
    expect(report.notices).toEqual([{ code: 'same-name', path: ['twice.zip', 'conversations.json'] }]);
  });

  it('uses the sizes a ZIP claims for the progress bar only', async () => {
    const sink = countingSink();
    const bytes = await zip(
      [
        { name: 'conversations-000.json', data: json(conversations(0, 3)), claimedSize: 2 ** 40 },
        { name: 'conversations-001.json', data: json(conversations(3, 3)) },
      ],
      { zip64: true },
    );
    const progress: ReadProgress[] = [];
    const report = await readExport([file('liar.zip', bytes)], sink, { onProgress: (p) => progress.push(p), progressEveryMs: 0 });
    // The file with the false size fails the ZIP reader's own check. Nothing of it is counted.
    expect(report.files.map((f) => f.problem)).toEqual(['damaged', null]);
    expect(sink.ids).toEqual(ids(3, 3));
    expect(progress.at(-1)?.bytesTotal).toBeGreaterThan(2 ** 40);
    expect(progress.every((p) => p.bytesRead <= report.totals.bytes)).toBe(true);
  });

  it('does not read a huge or broken user.json', async () => {
    const sink = countingSink();
    const report = await readExport(
      [
        file('a.zip', await zip([{ name: 'user.json', data: new Uint8Array(300_000).fill(0x20) }, { name: 'conversations.json', data: json(conversations(0, 1)) }])),
        file('user.json', utf8('{"id": ')),
      ],
      sink,
      { limits: { maxUserFileBytes: 1_000 } },
    );
    expect(sink.users).toEqual([]);
    expect(sink.ids).toEqual(ids(0, 1));
    expect(report.notices).toEqual([
      { code: 'user-unreadable', path: ['a.zip', 'user.json'] },
      { code: 'user-unreadable', path: ['user.json'] },
    ]);
  });

  it('takes at most a set number of dropped ZIP files, and counts no other file against it', async () => {
    const one = await zip([{ name: 'conversations.json', data: json(conversations(0, 1)) }]);
    const zips = (n: number) => Array.from({ length: n }, (_, i) => file(`part-${i}.zip`, one));
    await expect(readExport(zips(4), countingSink(), { limits: { maxDroppedFiles: 3 } })).rejects.toMatchObject({ code: 'too-many-files' });
    // A capital ending is a ZIP too.
    await expect(readExport([...zips(3), file('MORE.ZIP', one)], countingSink(), { limits: { maxDroppedFiles: 3 } })).rejects.toMatchObject({ code: 'too-many-files' });

    // Three ZIPs with seven other files around them are three ZIPs.
    const sink = countingSink();
    const others = Array.from({ length: 7 }, (_, i) => file(`photo-${i}.jpg`, utf8('x')));
    const report = await readExport([...others, ...zips(3)], sink, { limits: { maxDroppedFiles: 3 } });
    expect(sink.seen).toBe(3);
    expect(report.totals.archives).toBe(3);
    expect(report.notices.map((notice) => notice.code)).toEqual(Array.from({ length: 7 }, () => 'ignored'));
  });

  it('reads an export that was unzipped: 24 conversations files with the other files of the export around them', async () => {
    // What OpenAI's ZIP holds, dropped file by file: more than twenty files in all, and more than
    // twenty pieces of conversations. Nothing in the limits is changed for this test.
    const pieces = Array.from({ length: 24 }, (_, n) => file(`conversations-${String(n).padStart(3, '0')}.json`, json(conversations(n * 2, 2))));
    const rest = [
      file('chat.html', utf8('<html>')), file('user.json', json(USER)), file('user_settings.json', utf8('{}')), file('export_manifest.json', utf8('{}')),
      ...Array.from({ length: 40 }, (_, n) => file(`file-${n}-photo.png`, utf8('not a picture'))),
    ];
    const sink = countingSink();
    const report = await readExport([...rest, ...pieces], sink);
    expect(sink.ids).toEqual(ids(0, 48));
    expect(sink.users).toEqual([USER]);
    expect(report.totals).toMatchObject({ archives: 0, conversationFiles: 24, filesWithProblems: 0, handed: 48, userFiles: 1 });
    expect(report.notices).toHaveLength(43);
    expect(report.notices.every((notice) => notice.code === 'ignored')).toBe(true);
    expect(report.noticesNotListed).toBe(0);
  });

  it('refuses loose conversations files beyond what one ZIP may hold, once, and reads none of them', async () => {
    const pieces = Array.from({ length: 4 }, (_, n) => file(`conversations-00${n}.json`, json(conversations(n, 1))));
    const sink = countingSink();
    const report = await readExport([file('notes.txt', utf8('x')), ...pieces, file('user.json', json(USER))], sink, { limits: { maxConversationFiles: 3 } });
    expect(sink.seen).toBe(0);
    expect(sink.users).toEqual([USER]);
    expect(report.totals.conversationFiles).toBe(0);
    expect(report.notices).toEqual([
      { code: 'ignored', path: ['notes.txt'] },
      { code: 'too-many-conversation-files', path: ['conversations-000.json'], limit: 3 },
    ]);

    // At the limit they are read.
    const atLimit = countingSink();
    const fine = await readExport(pieces.slice(0, 3), atLimit, { limits: { maxConversationFiles: 3 } });
    expect(atLimit.seen).toBe(3);
    expect(fine.notices).toEqual([]);
  });

  it('counts every ignored dropped file, and they never push another remark out of the report', async () => {
    const hidden = await zip([{ name: 'conversations.json', data: utf8('x'), encrypted: true }]);
    const others = Array.from({ length: 9 }, (_, i) => file(`photo-${i}.jpg`, utf8('x')));
    const report = await readExport([...others, file('locked.zip', hidden)], countingSink(), { limits: { maxNotices: 2, maxIgnoredNotices: 6 } });
    expect(report.notices.filter((notice) => notice.code === 'ignored')).toHaveLength(6);
    expect(report.notices.filter((notice) => notice.code !== 'ignored')).toEqual([
      { code: 'encrypted', path: ['locked.zip', 'conversations.json'] },
      { code: 'no-conversations', path: ['locked.zip'] },
    ]);
    expect(report.noticesNotListed).toBe(3);
  });

  it('keeps the report short however many files and remarks there are, and cuts long names', async () => {
    const entries: ZipEntry[] = [
      ...Array.from({ length: 6 }, (_, n) => ({ name: `conversations-00${n}.json`, data: json(conversations(n, 1)) })),
      ...Array.from({ length: 6 }, (_, n) => ({ name: `${n}/conversations.json`, data: utf8('x'), encrypted: true })),
      { name: `${'long'.repeat(100)}/conversations.json`, data: json([]) },
    ];
    const report = await readExport([file('many.zip', await zip(entries))], countingSink(), {
      limits: { maxReportedFiles: 4, maxNotices: 2, maxNameLength: 20 },
    });
    expect(report.files).toHaveLength(4);
    expect(report.filesNotListed).toBe(3);
    expect(report.notices).toHaveLength(2);
    expect(report.noticesNotListed).toBe(4);
    expect(report.totals.conversationFiles).toBe(7);
    expect(report.totals.handed).toBe(6);
  });
});

describe('cancelling', () => {
  const big = (): Promise<Uint8Array<ArrayBuffer>[]> =>
    Promise.all(Array.from({ length: 8 }, (_, n) => json(conversations(n * 100, 100, 200))).map((data, n) => zip([{ name: `conversations-00${n}.json`, data }]).then(() => data)));

  async function cancelMidway(make: (parts: Uint8Array<ArrayBuffer>[]) => Promise<ReturnType<typeof watchedFile>[]>): Promise<void> {
    const watched = await make(await big());
    const controller = new AbortController();
    const sink = countingSink((seen) => {
      if (seen === 150) controller.abort();
    });
    const reading = readExport(watched.map((w) => w.file), sink, { signal: controller.signal });
    await expect(reading).rejects.toBeInstanceOf(ReadExportError);
    await expect(reading).rejects.toMatchObject({ code: 'cancelled' });

    const seen = sink.seen;
    const asked = watched.map((w) => w.bytesAsked());
    expect(seen).toBeLessThan(260);
    await new Promise((resolve) => setTimeout(resolve, 60));
    // Nothing goes on behind the back of the rejected promise, and no stream is left open.
    expect(sink.seen).toBe(seen);
    expect(watched.map((w) => w.bytesAsked())).toEqual(asked);
    expect(watched.map((w) => w.openStreams())).toEqual(watched.map(() => 0));
  }

  it('stops in the middle of loose files', () =>
    cancelMidway(async (parts) => parts.map((data, n) => watchedFile(`conversations-00${n}.json`, [data], 4096))));

  it('stops in the middle of a ZIP', () =>
    cancelMidway(async (parts) => [
      watchedFile('export.zip', await zipPieces(parts.map((data, n) => ({ name: `conversations-00${n}.json`, data }))), 4096),
    ]));

  it('stops in the middle of a ZIP that is read as a stream', () =>
    cancelMidway(async (parts) => {
      const inner = await zip(parts.map((data, n) => ({ name: `conversations-00${n}.json`, data })));
      return [watchedFile('c.zip', await zipPieces([{ name: 'x-chatgpt-0001.zip', data: inner }]), 4096)];
    }));

  it('stops in the middle of a cut-off ZIP', () =>
    cancelMidway(async (parts) => {
      const whole = await zip(parts.map((data, n) => ({ name: `conversations-00${n}.json`, data })));
      return [watchedFile('cut.zip', [whole.slice(0, whole.byteLength - 50)], 4096)];
    }));

  it('does not start when it is cancelled before', async () => {
    const sink = countingSink();
    await expect(readExport([file('conversations.json', json(conversations(0, 1)))], sink, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(sink.seen).toBe(0);
  });
});

describe('faults on the counting side', () => {
  it('end the read instead of passing as a broken file', async () => {
    const sink = countingSink((seen) => {
      if (seen === 3) throw new Error('a bug in the counting');
    });
    await expect(readExport([file('conversations.json', json(conversations(0, 5)))], sink)).rejects.toMatchObject({ code: 'internal' });
    const zipped = file('a.zip', await zip([{ name: 'x-chatgpt-0001.zip', data: await zip([{ name: 'conversations.json', data: json(conversations(0, 5)) }]) }]));
    const again = countingSink((seen) => {
      if (seen === 3) throw new Error('a bug in the counting');
    });
    await expect(readExport([zipped], again)).rejects.toMatchObject({ code: 'internal' });
    expect(again.seen).toBe(3);
  });
});

/** A sink that keeps every element it is handed, to look at what the parser made of the bytes. */
function keepingSink(): ConversationSink<unknown[]> & { values: unknown[] } {
  const values: unknown[] = [];
  return { values, add: (value) => values.push(value) > 0, setUser() {}, counted: () => values.length, finish: () => values };
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let at = 0; at <= haystack.length - needle.length; at++) {
    for (let i = 0; i < needle.length; i++) if (haystack[at + i] !== needle[i]) continue outer;
    return at;
  }
  return -1;
}

function insertBytes(bytes: Uint8Array<ArrayBuffer>, at: number, extra: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array([...bytes.subarray(0, at), ...extra, ...bytes.subarray(at)]);
}

describe('text that is not clean', () => {
  const brokenBytes: Array<[what: string, bytes: number[]]> = [
    ['half of an emoji, written as its own three bytes', [0xed, 0xa0, 0xbd]],
    ['a byte that continues nothing', [0x80]],
    ['a character from an older encoding', [0xe9]],
    ['the first two bytes of a three-byte character', [0xe2, 0x82]],
  ];

  for (const [what, bad] of brokenBytes) {
    it(`reads on past bytes that are not valid text: ${what}`, async () => {
      const clean = json(conversations(0, 6));
      const broken = insertBytes(clean, indexOfBytes(clean, utf8('Question 1?')), bad);
      const sink = countingSink();
      const report = await readExport(
        [file('a.zip', await zip([{ name: 'conversations-000.json', data: broken }])), file('conversations-001.json', broken)],
        sink,
      );
      // Before the bytes, at them and after them: nothing is lost.
      expect(sink.ids).toEqual([...ids(0, 6), ...ids(0, 6)]);
      expect(report.files.map((f) => f.problem)).toEqual([null, null]);
      expect(report.files.map((f) => f.bytes)).toEqual([broken.byteLength, broken.byteLength]);
    });
  }

  it('puts a replacement character where such a byte was, and changes nothing else', async () => {
    const clean = json([{ id: 'a', mapping: {}, title: 'before after' }]);
    const sink = keepingSink();
    await readExport([file('conversations.json', insertBytes(clean, indexOfBytes(clean, utf8('after')), [0xff]))], sink);
    expect(sink.values).toEqual([{ id: 'a', mapping: {}, title: 'before \ufffdafter' }]);
  });

  it('keeps a character whole when a chunk ends in the middle of it', async () => {
    const title = 'Zürich → 東京 😀 '.repeat(40);
    const sink = keepingSink();
    const report = await readExport([watchedFile('conversations.json', [json([{ id: 'a', mapping: {}, title }])], 7).file], sink);
    expect(sink.values).toEqual([{ id: 'a', mapping: {}, title }]);
    expect(report.files[0]?.problem).toBeNull();
  });

  it('still refuses such a byte where the JSON itself is broken by it', async () => {
    const clean = json(conversations(0, 3));
    const sink = countingSink();
    const report = await readExport([file('conversations.json', insertBytes(clean, indexOfBytes(clean, utf8('"title"')), [0x80]))], sink);
    expect(report.files[0]?.problem).toBe('not-json');
  });

  it('reports a file that ends inside a character as cut off', async () => {
    const whole = json([{ id: 'a', mapping: {}, title: '東京' }]);
    const report = await readExport([file('conversations.json', whole.slice(0, indexOfBytes(whole, utf8('京')) + 1))], countingSink());
    expect(report.files[0]?.problem).toBe('cut-off');
  });
});

describe('a conversation unlike any real one', () => {
  it('stops at brackets nested deeper than any export, before they cost memory', async () => {
    const sink = countingSink();
    // 4 MiB of "[" took about 1 GB before this limit, and 16 MiB ended the program.
    const deep = new Uint8Array(4 * 2 ** 20).fill(0x5b);
    const report = await readExport([watchedFile('conversations-000.json', [deep], 4096).file, file('conversations-001.json', json(conversations(0, 2)))], sink);
    expect(report.files.map((f) => f.problem)).toEqual(['conversation-too-large', null]);
    expect(report.files[0]?.bytes).toBeLessThanOrEqual(4096);
    expect(sink.ids).toEqual(ids(0, 2));
  });

  it('stops at nested objects as well, also inside a ZIP', async () => {
    const deep = utf8(`[${'{"a":'.repeat(100_000)}`);
    const report = await readExport([file('a.zip', await zip([{ name: 'conversations.json', data: deep }]))], countingSink());
    expect(report.files.map((f) => f.problem)).toEqual(['conversation-too-large']);
  });

  it('takes nesting up to the limit and not one level more', async () => {
    const nested = (levels: number): Uint8Array<ArrayBuffer> => utf8(`[${'['.repeat(levels)}${']'.repeat(levels)}]`);
    const sink = countingSink();
    const report = await readExport(
      [file('conversations-000.json', nested(LIMITS.maxNesting - 1)), file('conversations-001.json', nested(LIMITS.maxNesting))],
      sink,
    );
    expect(report.files.map((f) => [f.handed, f.problem])).toEqual([[1, null], [0, 'conversation-too-large']]);
  });

  it('stops at a conversation with more parts than the limit, and counts the parts of each conversation alone', async () => {
    const many = { id: 'wide', mapping: Object.fromEntries(Array.from({ length: 400 }, (_, n) => [`node-${n}`, {}])) };
    const sink = countingSink();
    const report = await readExport(
      [
        // 40 ordinary conversations hold far more parts together than the limit, and each far fewer.
        file('conversations-000.json', json(conversations(0, 40))),
        file('conversations-001.json', json([...conversations(40, 2), many, ...conversations(42, 2)])),
        file('conversations-002.json', json(conversations(44, 1))),
      ],
      sink,
      { limits: { maxPartsPerConversation: 500 } },
    );
    expect(report.files.map((f) => [f.handed, f.problem])).toEqual([[40, null], [2, 'conversation-too-large'], [1, null]]);
    expect(sink.ids).toEqual([...ids(0, 42), ...ids(44, 1)]);
  });

  it('does not take a large chunk of small conversations for one large conversation', async () => {
    const data = json(conversations(0, 2000));
    expect(data.byteLength).toBeGreaterThan(2 ** 20);
    const sink = countingSink();
    // The stand-in hands the whole file over in one piece, as a browser may.
    const report = await readExport([watchedFile('conversations.json', [data], 64 * 2 ** 20).file], sink, {
      limits: { maxBytesPerConversation: 512 * 1024 },
    });
    expect(report.files.map((f) => [f.handed, f.problem])).toEqual([[2000, null]]);
  });
});

describe('ZIPs that are read from the first byte', () => {
  it('reads past thousands of small files that arrive in one piece', async () => {
    const whole = await zip([
      ...Array.from({ length: 9000 }, (_, n) => ({ name: `f/${n}`, data: utf8('x'), store: true })),
      { name: 'conversations.json', data: json(conversations(0, 4)) },
    ]);
    const sink = countingSink();
    // Without its last bytes the ZIP has no table of contents. The stand-in hands it over in pieces of 1 MiB.
    const report = await readExport([watchedFile('cut.zip', [whole.slice(0, whole.byteLength - 40)], 2 ** 20).file], sink);
    expect(sink.ids).toEqual(ids(0, 4));
    expect(report.notices).toEqual([{ code: 'rescued', path: ['cut.zip'], files: 1, conversations: 4 }]);
  });

  it('goes on after a file packed in a way it has never heard of', async () => {
    const inner = await zip([
      { name: 'file_1.dat', data: utf8('packed some other way'), method: 77 },
      { name: 'conversations-000.json', data: json(conversations(0, 2)), method: 77 },
      { name: 'file_2.dat', data: utf8('and another'), method: 4321 },
      { name: 'conversations-001.json', data: json(conversations(2, 3)) },
    ]);
    const sink = countingSink();
    const report = await readExport([file('c.zip', await zip([{ name: 'x-chatgpt-0001.zip', data: inner }]))], sink);
    expect(sink.ids).toEqual(ids(2, 3));
    expect(report.files.map((f) => f.problem)).toEqual(['damaged', null]);
    expect(report.notices).toEqual([]);
  });
});

describe('the table of contents', () => {
  it('is not read in one piece when it is larger than any real one: the ZIP is read from its first byte', async () => {
    const entries: ZipEntry[] = [
      { name: 'conversations.json', data: json(conversations(0, 3)) },
      ...Array.from({ length: 60 }, (_, n) => ({ name: `${'long-name-'.repeat(20)}${n}.dat`, data: utf8('x'), store: true })),
    ];
    const bytes = await zip(entries);
    const limits = { maxTableBytes: 4096 };

    const refused = watchedFile('table.zip', [bytes]);
    const sink = countingSink();
    const report = await readExport([refused.file], sink, { limits });
    expect(sink.ids).toEqual(ids(0, 3));
    expect(report.notices).toEqual([{ code: 'rescued', path: ['table.zip'], files: 1, conversations: 3 }]);

    // The same ZIP under the real limit is listed as usual.
    const listed = await readExport([file('table.zip', bytes)], countingSink());
    expect(listed.notices).toEqual([]);
    expect(listed.totals.handed).toBe(3);
  });

  it('leaves no remarks behind when it breaks off halfway and the ZIP is read again from its first byte', async () => {
    const bytes = await zip([
      { name: 'conversations.json', data: json(conversations(0, 2)) },
      { name: 'conversations.json', data: json(conversations(50, 2)) },
    ]);
    // The end record now claims a third entry, so the listing fails after the two real ones.
    const end = new DataView(bytes.buffer, bytes.byteLength - 22);
    end.setUint16(8, 3, true);
    end.setUint16(10, 3, true);
    const sink = countingSink();
    const report = await readExport([file('twice.zip', bytes)], sink);
    expect(sink.ids).toEqual(ids(0, 2));
    expect(report.notices).toEqual([
      { code: 'same-name', path: ['twice.zip', 'conversations.json'] },
      { code: 'rescued', path: ['twice.zip'], files: 1, conversations: 2 },
    ]);
  });
});

describe('progress', () => {
  it('comes in small steps while a packed file is read, so one step never unpacks much at once', async () => {
    const data = json(conversations(0, 400, 600));
    expect(data.byteLength).toBeGreaterThan(2 ** 20);
    const progress: ReadProgress[] = [];
    await readExport([file('a.zip', await zip([{ name: 'conversations.json', data }]))], countingSink(), {
      onProgress: (p) => progress.push(p),
      progressEveryMs: 0,
    });
    const steps = progress.map((p, n) => p.bytesRead - (progress[n - 1]?.bytesRead ?? 0));
    expect(Math.max(...steps)).toBeLessThanOrEqual(64 * 1024);
    expect(progress.at(-1)?.bytesRead).toBe(data.byteLength);
  });

  it('ends the read when the callback itself fails, instead of blaming a file', async () => {
    const sink = countingSink();
    const reading = readExport([file('conversations-000.json', json(conversations(0, 3))), file('conversations-001.json', json(conversations(3, 3)))], sink, {
      onProgress: () => {
        throw new Error('a bug on the page');
      },
      progressEveryMs: 0,
    });
    await expect(reading).rejects.toMatchObject({ code: 'internal' });
    expect(sink.seen).toBeLessThanOrEqual(3);
  });
});

describe('a cancel that comes between two chunks', () => {
  // Made-up text that barely packs, so that a packed file is many chunks long, as in a real export.
  const noise = (): string => Array.from(crypto.getRandomValues(new Uint8Array(40_000)), (byte) => byte.toString(16)).join('');
  const parts = (): Uint8Array<ArrayBuffer>[] =>
    Array.from({ length: 3 }, (_, n) => json(Array.from({ length: 20 }, (_, i) => ({ id: `noisy-${n}-${i}`, mapping: {}, title: noise() }))));
  const routes: Array<[route: string, make: () => Promise<ReturnType<typeof watchedFile>>]> = [
    ['a ZIP', async () => watchedFile('export.zip', await zipPieces(parts().map((data, n) => ({ name: `conversations-00${n}.json`, data }))))],
    [
      'a ZIP that is read as a stream',
      async () => {
        const inner = await zip(parts().map((data, n) => ({ name: `conversations-00${n}.json`, data })));
        return watchedFile('c.zip', await zipPieces([{ name: 'x-chatgpt-0001.zip', data: inner }]));
      },
    ],
  ];

  for (const [route, make] of routes) {
    it(`stops ${route} and lets go of the file`, async () => {
      const watched = await make();
      const controller = new AbortController();
      const sink = countingSink();
      let armed = false;
      const reading = readExport([watched.file], sink, {
        signal: controller.signal,
        progressEveryMs: 0,
        onProgress: () => {
          // Not from inside the reader's own work, as the tests above do, but as a page would: later.
          if (!armed) setTimeout(() => controller.abort(), 0);
          armed = true;
        },
      });
      await expect(reading).rejects.toMatchObject({ code: 'cancelled' });
      expect(sink.seen).toBeLessThan(60);

      const seen = sink.seen;
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(sink.seen).toBe(seen);
      expect(watched.openStreams()).toBe(0);
      const asked = watched.bytesAsked();
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(watched.bytesAsked()).toBe(asked);
    });
  }
});

describe('file names in the report', () => {
  it('cannot break a sentence apart or turn it around', async () => {
    // A folder name with a line break in it is not taken for a conversations file at all, so this one has none.
    const tricky = 'conversations\u202e\u2066gpj.exe Second line\u0000\u200b\ud83d/conversations.json';
    const report = await readExport(
      [
        file('line\nbreak\u202e.txt', utf8('x')),
        file('a.zip', await zip([{ name: tricky, data: json(conversations(0, 1)) }])),
        file('c.zip', await zip([{ name: 'x-chatgpt-0001.zip', data: await zip([{ name: tricky, data: json(conversations(1, 1)) }]) }])),
      ],
      countingSink(),
    );
    const names = [...report.notices.flatMap((n) => n.path), ...report.files.flatMap((f) => f.path)];
    expect(names).toHaveLength(6);
    for (const name of names) expect(name).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u);
    expect(report.notices).toEqual([{ code: 'ignored', path: ['line\ufffdbreak\ufffd.txt'] }]);
    expect(report.files.map((f) => f.path.at(-1))).toEqual(Array.from({ length: 2 }, () => 'conversations\ufffd\ufffdgpj.exe Second line\ufffd\ufffd\ufffd/conversations.json'));
    expect(report.totals.handed).toBe(2);
  });

  it('keeps letters of every script, and cuts a long name without leaving half a character', async () => {
    const report = await readExport(
      [file('Unterhaltungen – 会話 – беседы.zip', await zip([{ name: `${'😀'.repeat(30)}/conversations.json`, data: json([]) }]))],
      countingSink(),
      { limits: { maxNameLength: 21 } },
    );
    expect(report.files[0]?.path).toEqual(['Unterhaltungen – 会話 –…', `${'😀'.repeat(10)}\ufffd…`]);
  });
});
