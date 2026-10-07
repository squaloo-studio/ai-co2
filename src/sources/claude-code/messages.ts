// Every sentence the Claude Code source can say to the person, in one place, so the wording can be
// reviewed here. "{detail}" stands for a date, a number of days or a short quote that answer.ts
// has made safe.

/** The placeholder of the paste box. Shown while the box is empty. */
export const EMPTY = 'Paste the answer from Claude Code here.';

/** Why an answer was refused, and what to do next. */
export const PROBLEMS = {
  'too-long': 'That is much longer than an answer from Claude Code. Paste only the block that starts with “ai-co2 v1”.',
  'pasted-prompt': "That is the prompt, not the answer. Paste it into Claude Code first, then paste Claude's answer here.",
  'no-header':
    "This doesn't look like the answer. It should start with a line that begins “ai-co2 v1”. Copy the whole block from Claude Code and paste it again.",
  version: 'This answer was made by a different version of the prompt. Copy the prompt from this page again and run it once more.',
  'bad-header': 'The first line of the answer is damaged. Copy the whole block from Claude Code again.',
  'two-answers': 'There is more than one answer in here, and they differ. Paste just one.',
  truncated: 'The end of the answer is missing. The last line should start with “total”. Copy the whole block again.',
  'bad-line': "One line of the answer can't be read: “{detail}”. Copy the whole block from Claude Code again, without changing it.",
  'bad-number': 'One of the numbers is too large to be a token count. Copy the whole block from Claude Code again.',
  'total-mismatch':
    "The numbers don't add up to the total in the last line, so something was lost or changed on the way. Copy the whole block from Claude Code again.",
  'bad-date': 'A date in the first line is not a real date. Copy the whole block from Claude Code again.',
  'bad-window': 'This answer covers {detail}. The page needs exactly 30. Copy the prompt from this page again and run it once more.',
  future: 'This answer ends on {detail}, which is in the future. Check the date on your computer, then run the prompt again.',
  'bad-data-range': "The dates in the first line don't fit together. Copy the whole block from Claude Code again.",
  inconsistent: 'The first line and the model lines disagree about whether any use was found. Copy the whole block from Claude Code again.',
  'too-many-models': 'There are more model lines than an answer can have. Copy the whole block from Claude Code again.',
  'duplicate-model': 'The model “{detail}” appears twice. Copy the whole block from Claude Code again.',
  'no-usage':
    'Claude Code found no use in the last 30 days on this computer. If you use Claude Code on another computer, run the prompt there.',
} as const;

export type ProblemCode = keyof typeof PROBLEMS;

/**
 * Shown after the "no-usage" sentence. That outcome is not damage: the script ran and found nothing.
 * These are the other reasons it finds nothing.
 */
export const NO_USAGE_OTHER_CAUSES =
  'Other causes: Claude Code keeps its files in another folder (CLAUDE_CONFIG_DIR), your setup hides that setting from the commands Claude runs, or saving conversations is switched off.';

/** Remarks on an answer the page accepts. */
export const NOTES = {
  'short-data': 'Your logs only have entries from {detail}. The result covers those days, not a full 30.',
  stale: "This answer ends on {detail}. Run the prompt again if you want today's numbers.",
  'high-output': 'That is an unusually large amount of output for 30 days. The page will use it as it is.',
  'high-total': 'That is an unusually large number of tokens for 30 days. The page will use it as it is.',
  'output-without-input':
    'The model “{detail}” shows output but no input, which the logs of some gateways cause. The page will use it as it is.',
} as const;

export type NoteCode = keyof typeof NOTES;

/** The day the fact below was read in Claude Code's documentation, as the page prints dates. Change it when the fact is checked again. */
export const RETENTION_CHECKED = '7 Oct 2026';

/** Shown after the "short-data" remark: the usual reason logs start late. A fact about the product, so it carries its date. */
export const SHORT_DATA_USUAL_CAUSE = `Claude Code deletes logs after 30 days by default, or sooner if cleanupPeriodDays is set lower (checked on ${RETENTION_CHECKED}).`;

/** "1 day", "31 days". */
export const dayCount = (days: number): string => `${days} ${days === 1 ? 'day' : 'days'}`;

/** Stands in for the day count when a window's length is nothing a person would call a number of days. */
export const WRONG_DAY_COUNT = 'the wrong number of days';

/** "2026-09-26 to 2026-10-07 (12 days)", the detail of the short-data remark. */
export function daySpan(first: string, last: string, days: number): string {
  return `${first} to ${last} (${dayCount(days)})`;
}

// A function as the replacement, so a "$" in the detail is never read as a pattern.
const fill = (template: string, detail: string): string => template.replace('{detail}', () => detail);

export function problemSentence(code: ProblemCode, detail = ''): string {
  return fill(PROBLEMS[code], detail);
}

export function noteSentence(code: NoteCode, detail = ''): string {
  return fill(NOTES[code], detail);
}
