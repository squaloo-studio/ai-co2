// How the page talks to the logic: it sends actions, and it is told when the View changes.

import type { SourceId } from './usage';
import type { View } from './view';

export type Action =
  /** First visit: the person picks Claude Code or ChatGPT. */
  | { type: 'choose-source'; source: SourceId }
  /** "Switch to ChatGPT" / "Switch to Claude Code". Whatever was entered for the other tool is dropped. */
  | { type: 'switch-source' }
  /** The text in the Claude Code paste box changed. */
  | { type: 'set-answer'; text: string }
  /** ChatGPT export files were dropped or chosen. An export can come as several files. */
  | { type: 'add-files'; files: File[] }
  /** "Stop reading": the read of a ChatGPT export is given up, and the page goes back to the steps. */
  | { type: 'cancel-read' }
  /** A switch in the result card or an "Apply this tip" switch was flipped. */
  | { type: 'toggle-switch'; id: string }
  /**
   * A method slider moved: the person sets that assumption to `value` (from `valueAt` in track.ts).
   * The store turns `value` into a track position once and keeps the position.
   * `settled` is false while it is being dragged.
   */
  | { type: 'set-assumption'; id: string; value: number; settled: boolean }
  /** "Reset sliders": every assumption varies between its low and its high again. */
  | { type: 'reset-assumptions' };

export interface Store {
  getView(): View;
  /**
   * Takes one action. What the action changes directly is in the View, and every listener has been
   * called, before `dispatch` returns. Reading an export goes on afterwards: `add-files` returns with
   * the stage `loading`, and the listeners are called again for the progress and for the end of the read.
   */
  dispatch(action: Action): void;
  /** Calls `listener` after every change with the new View and the one before it. Returns a function that stops it. */
  subscribe(listener: (view: View, previous: View) => void): () => void;
}
