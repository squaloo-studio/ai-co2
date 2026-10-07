// Every limit the reader holds against a hostile or broken file, in one place. The page writes no
// files and sends nothing anywhere, so the worst a bad file can do is freeze or crash the tab.
// The values are judgement calls: each sits far above the largest real export seen.

const KiB = 2 ** 10;
const MiB = 2 ** 20;
const GiB = 2 ** 30;

export interface Limits {
  /**
   * ZIP files dropped in one go. Other dropped files do not count: an export that was unzipped is
   * hundreds of files, and its loose conversations files fall under `maxConversationFiles`.
   */
  maxDroppedFiles: number;
  /** Entries listed in one ZIP. */
  maxEntriesPerZip: number;
  /** Conversation files in one ZIP, and loose ones in one drop. */
  maxConversationFiles: number;
  /** Bytes that come out of one conversations file. Counted as they arrive, never taken from the ZIP's own figures. */
  maxInflatedBytesPerFile: number;
  /** The same, over all files together. */
  maxInflatedBytesTotal: number;
  /** The ratio rule only applies once a file has passed this many bytes. */
  ratioFloorBytes: number;
  /** Bytes out per byte in. Real exports shrink about 5 to 1. */
  maxRatio: number;
  /** Bytes fed to the parser since the last finished conversation. */
  maxBytesPerConversation: number;
  /**
   * Names and values in one conversation. Bytes alone do not hold memory down: a conversation made of
   * nothing but "{}" takes about twenty times its size. A real conversation at the byte limit above
   * would have about 5 million.
   */
  maxPartsPerConversation: number;
  /**
   * Brackets open inside one another, the list itself included. Every level costs memory before a
   * single value is finished, so a few megabytes of "[" would otherwise fill it. Real exports go 13 deep.
   */
  maxNesting: number;
  /** Export ZIPs inside one container ZIP. */
  maxNestedZips: number;
  /**
   * The table of contents of one ZIP. It is read in one piece, so a ZIP that is nearly all table
   * would otherwise be held in memory whole. 100,000 entries with ordinary names take about 15 MiB.
   */
  maxTableBytes: number;
  /** user.json is parsed in one piece, so it has to be small. */
  maxUserFileBytes: number;
  /** Rows kept in the report. Beyond these, only the totals grow. */
  maxReportedFiles: number;
  maxNotices: number;
  /**
   * Remarks kept about dropped files that are nothing the reader looks for. They have a cap of their
   * own, far above the 4,000 files of the largest real export, so that the page can say how many
   * there were and so that they never push another remark out of the report.
   */
  maxIgnoredNotices: number;
  /** Characters kept of each file name in the report. */
  maxNameLength: number;
  /**
   * Bytes of a ZIP handed on in one go when it is read from its first byte. Small, because Deflate
   * can unpack one such piece to about a thousand times its size before the reader can stop it.
   */
  inflateSliceBytes: number;
}

export const LIMITS: Readonly<Limits> = Object.freeze({
  maxDroppedFiles: 20,
  maxEntriesPerZip: 100_000,
  maxConversationFiles: 2_000,
  maxInflatedBytesPerFile: 2 * GiB,
  maxInflatedBytesTotal: 8 * GiB,
  ratioFloorBytes: 50 * MiB,
  maxRatio: 200,
  maxBytesPerConversation: 128 * MiB,
  maxPartsPerConversation: 8_000_000,
  maxNesting: 256,
  maxNestedZips: 50,
  maxTableBytes: 64 * MiB,
  maxUserFileBytes: MiB,
  maxReportedFiles: 200,
  maxNotices: 200,
  maxIgnoredNotices: 20_000,
  maxNameLength: 200,
  inflateSliceBytes: 16 * KiB,
});
