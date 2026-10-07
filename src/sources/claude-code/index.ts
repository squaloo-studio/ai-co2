// The Claude Code source: the prompt the person copies, and the reader for the answer they paste back.
//
//   PROMPT                      the whole text for the copy box
//   SCRIPT, NODE_SCRIPT         for tests: the two counting scripts as text. The page uses neither
//   readAnswer(text, today)     what the pasted text is: nothing yet, a problem, or the counts
//
// Everything readAnswer hands on is safe to show as text: numbers, dates, model names made of
// A–Z a–z 0–9 . _ : / @ - and sentences from messages.ts. A model name can still read like a web
// address, so the page shows it as plain text and never as a link.

export { PROMPT, SCRIPT, NODE_SCRIPT } from './prompt';
export { readAnswer, LIMITS } from './answer';
export type { AnswerReading, AnswerOk, AnswerProblem, AnswerNote } from './answer';
export { EMPTY, NO_USAGE_OTHER_CAUSES, SHORT_DATA_USUAL_CAUSE } from './messages';
export type { ProblemCode, NoteCode } from './messages';
