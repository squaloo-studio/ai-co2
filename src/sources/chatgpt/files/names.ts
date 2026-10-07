// Which names the reader acts on. Names are only ever matched, never used as paths: nothing is
// written anywhere, so "../" and absolute names can do no harm.

/**
 * conversations.json or conversations-000.json, at the top level or inside folders.
 * "._conversations.json" (what a Mac adds when a folder is zipped again) does not match.
 */
export const CONVERSATION_FILE = /^(?:.*\/)?conversations(?:-\d{3,})?\.json$/;

/** user.json, which says what kind of account the export is from. */
export const USER_FILE = /^(?:.*\/)?user\.json$/;

export const ZIP_FILE = /\.zip$/i;

/**
 * An ordinary export stored inside the container ZIP that the privacy portal sends: the last part of
 * its name holds "-chatgpt-" and a number, and it ends in ".zip".
 *
 * Checked in two plain steps on purpose. Written as one pattern, the check takes seconds on a long
 * made-up name, and a ZIP can list a hundred thousand names.
 */
export function isInnerExportZip(name: string): boolean {
  const last = name.slice(name.lastIndexOf('/') + 1);
  return ZIP_FILE.test(last) && /-chatgpt-\d/i.test(last);
}
