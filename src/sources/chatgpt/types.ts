// The seam inside the ChatGPT reader. One side opens the dropped files and streams out one parsed
// conversation at a time (files/). The other side counts what is in each conversation (account/).
// Neither knows how the other works, so each can be tested alone.

/** Takes the conversations of an export one at a time and keeps only counts, never text. */
export interface ConversationSink<Reading> {
  /**
   * One element of a conversations file, exactly as it was parsed. It is untrusted: it can be any
   * JSON value, so every field is checked before use. Returns false when the element was skipped.
   */
  add(conversation: unknown): boolean;
  /** user.json from the export, when it was found. It can arrive before, between or after conversations. */
  setUser(user: unknown): void;
  /** How many conversations were counted so far, for the progress line. */
  counted(): number;
  /** Called once, after the last file. */
  finish(): Reading;
}
