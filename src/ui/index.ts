// The page. It draws the View a Store hands it and sends the person's actions back. It never calculates.

import type { Action, Store } from '../contracts/store';
import type { ResultView, View } from '../contracts/view';
import { distance, distanceUnitFor, mass, printsSame } from '../format';
import { describe, NO_TRACE, traceBetween, type Motion, type Trace } from './change';
import { createContribute } from './contribute';
import { createData } from './data';
import { all, need, setText } from './dom';
import { createMethod } from './method';
import { COUNT_MS, createCounter, createScope, ghostGoneMs, reducedMotion } from './motion';
import { createPill } from './pill';
import { createResult } from './result';
import { createTips } from './tips';

/** A changed estimate is spoken once things have been still this long, so a held arrow key is not read out step by step. */
export const ANNOUNCE_MS = 1000;

/**
 * Starts the page in the document, which holds the markup of index.html.
 * Returns a function that removes every listener, observer and timer the page added.
 */
export function mountPage(store: Store): () => void {
  const root = document;
  const scope = createScope();
  const send = (action: Action) => store.dispatch(action);
  const live = need(root, '[data-live]');
  let current = store.getView();

  let stopSaying: (() => void) | null = null;
  function say(text: string, wait = 0, then?: () => void): void {
    stopSaying?.();
    stopSaying = null;
    if (wait <= 0) {
      setText(live, text);
      then?.();
    } else {
      stopSaying = scope.timer(() => {
        stopSaying = null;
        setText(live, text);
        then?.();
      }, wait);
    }
  }
  // What a listener knows of the result: the sentence last spoken, or the one that stood on the page
  // when it loaded. null while there is no result. A change is announced whenever it leaves the page
  // saying something else than this, however it got there.
  let heardResult: string | null = current.result ? describe(current.result) : null;

  const data = createData(root, scope, send, say);
  const result = createResult(root, scope, send);
  const tips = createTips(root, scope, send);
  const contribute = createContribute(root);
  const pill = createPill(root, scope, result.panel);
  const method = createMethod(root, scope, { reset: () => send({ type: 'reset-assumptions' }), slide });

  // Every number that counts across carries a data-num key. The key's first letter says how it is printed:
  // m a mass in the result's unit, d the car distance.
  let cells: Array<[Element, string]> = [];
  let units: Element[] = [];
  let shape: string | null = null;
  const print = (key: string, value: number): string => {
    const shown = current.result;
    if (!shown) return '';
    return key.startsWith('d:') ? distance(value, distanceUnitFor(shown.car)) : mass(value, shown.unit);
  };
  const counter = createCounter(scope, values => {
    for (const [node, key] of cells) {
      const value = values.get(key);
      if (value !== undefined) setText(node, print(key, value));
    }
  });

  // The top of the scale the charts are drawn on. It follows the View, with one exception: when the
  // scale steps down after a settled change, the dots move first on the scale they were on, and the
  // scale follows once the ghost of the old range has faded. Otherwise the ghost would be drawn on a
  // scale it never stood on.
  let drawnScale: number | null = null;
  let stopRescale: (() => void) | null = null;
  function scaleFor(next: ResultView, motion: Motion, trace: Trace): number {
    stopRescale?.();
    stopRescale = null;
    const wanted = next.scaleMax;
    // A scale with no length draws nothing, and is nothing to step down to.
    if (!(wanted > 0)) return wanted;
    if (drawnScale !== null && wanted < drawnScale) {
      // Under a dragged slider the scale never steps down. A step that was still waiting waits for the release.
      if (motion === 'fast') return drawnScale;
      // A held ghost (a tip is applied) does not fade, so there is nothing to wait for.
      if (motion === 'full' && trace.was && !next.baseline) {
        stopRescale = scope.timer(() => {
          stopRescale = null;
          drawnScale = wanted;
          result.rescale(current, wanted);
          tips.rescale(current, wanted);
          pill.rescale(current, wanted);
        }, ghostGoneMs());
        return drawnScale;
      }
    }
    drawnScale = wanted;
    return wanted;
  }

  function render(view: View, motion: Motion, trace: Trace): void {
    current = view;
    data.update(view);
    result.update(view);
    tips.update(view);
    contribute.update(view);
    method.update(view);
    pill.update(view);

    // While a slider is dragged the same rows stay on the page, so the hooks found before still hold.
    const rows = view.tips.map(tip => tip.id).join('|');
    if (motion !== 'fast' || rows !== shape) {
      shape = rows;
      cells = all(root, '[data-num]').map(node => [node, node.getAttribute('data-num') ?? '']);
      units = all(root, '[data-unit]');
    }
    if (view.result) for (const node of units) setText(node, view.result.unit);

    const targets = new Map<string, number>();
    result.targets(view, targets);
    tips.targets(view, targets);
    // The charts measure their labels, so they are drawn while the numbers show their final values.
    if (!view.result) {
      stopRescale?.();
      stopRescale = null;
      drawnScale = null;
    }
    const scaleMax = view.result ? scaleFor(view.result, motion, trace) : 0;
    counter.set(targets, motion !== 'full', () => {
      result.draw(view, motion, trace, scaleMax);
      tips.draw(view, motion, scaleMax);
      pill.draw(view, motion, trace, scaleMax);
    });
  }

  // The result the page showed when it was last at rest. A change that comes while the numbers are still
  // counting, or while a slider is dragged, leaves its trace from there, so the chip and the ghost cover
  // the move the reader saw from start to end.
  // `counting` marks a hold that only lasts while the middle estimate is still on its way: once the
  // number it was heading for is printed, the reader has seen it, and the next change starts from it.
  let origin: { result: ResultView | null; counting: boolean } | null = null;
  let stopHold: (() => void) | null = null;
  function hold(from: ResultView | null, ms: number | null, counting = false): void {
    stopHold?.();
    stopHold = null;
    origin = { result: from, counting };
    if (ms !== null) {
      stopHold = scope.timer(() => {
        stopHold = null;
        origin = null;
      }, ms);
    }
  }
  function atRest(): void {
    stopHold?.();
    stopHold = null;
    origin = null;
  }
  /** true once the printed middle estimate shows the number the last change was heading for. */
  function arrived(): boolean {
    const target = current.result;
    const shown = counter.shown('m:mid');
    return !target || shown === undefined || printsSame(shown, target.range.mid, target.unit);
  }
  /** The result the next change is measured from: the one the reader last saw standing on the page. */
  function seen(): ResultView | null {
    if (origin && !(origin.counting && arrived())) return origin.result;
    return current.result;
  }
  /** What the read data is, apart from anything a slider, a switch or a tip can change. */
  function dataOf(view: View): string {
    if (view.source !== 'claude-code') return view.source ?? '';
    const status = view.data.claudeCode.status;
    return status.state === 'ok' ? JSON.stringify([status.headline, status.models.map(model => [model.name, model.tokens])]) : '';
  }

  // While a slider is dragged the page follows without a trace, at most once a frame.
  let drag: { id: string } | null = null;
  let queued: View | null = null;
  let stopFrame: (() => void) | null = null;
  let heard = false;

  /** A change that has come to rest: everything moves once, leaves its trace and is announced once. */
  function settle(view: View): void {
    stopFrame?.();
    stopFrame = null;
    queued = null;
    root.body.classList.remove('is-dragging');
    const from = seen();
    const to = view.result;
    // Another answer or export is a new result, not a change of the one before: nothing slides or
    // counts across from numbers that came from other data, and there is no chip between the two.
    const sameResult = !!from && !!to && from.sourceName === to.sourceName && dataOf(current) === dataOf(view);
    // With reduced motion nothing counts: the number is at rest as soon as it is drawn.
    if (sameResult && !reducedMotion()) hold(from, COUNT_MS, true);
    else atRest();
    // The result went away: the line that announced it is emptied, so the same numbers are announced
    // again when they come back. Done before the draw, which may have something of its own to say.
    if (from && !to) {
      say('');
      heardResult = null;
    }
    render(view, sameResult ? 'full' : 'none', sameResult ? traceBetween(from, to) : NO_TRACE);
    if (!to) return;
    const sentence = describe(to);
    if (!from || !sameResult) {
      say(`Your result is in. ${sentence}`);
      heardResult = sentence;
    } else if (sentence !== heardResult) {
      say(`Estimate updated. ${sentence}`, ANNOUNCE_MS, () => {
        heardResult = sentence;
      });
    } else {
      // Back at what the listener already knows: there is nothing to report.
      stopSaying?.();
      stopSaying = null;
    }
  }

  function slide(id: string, value: number, settled: boolean): void {
    if (!settled) {
      if (!drag) hold(seen(), null);
      drag = { id };
      send({ type: 'set-assumption', id, value, settled: false });
      return;
    }
    drag = null;
    heard = false;
    send({ type: 'set-assumption', id, value, settled: true });
    if (heard) return;
    // A store with nothing new to say stays silent, and one that answers later has not spoken yet.
    // The move settles on what is known now, and an answer that is still to come adds to the same trace.
    const from = seen();
    settle(store.getView());
    if (from && current.result) hold(from, COUNT_MS);
  }

  const unsubscribe = store.subscribe(view => {
    heard = true;
    // A slider that left the page can no longer be let go: its drag ends here.
    if (drag && view.method.assumptions.some(a => a.id === drag?.id)) {
      root.body.classList.add('is-dragging');
      queued = view;
      stopFrame ??= scope.frame(() => {
        stopFrame = null;
        const next = queued;
        queued = null;
        if (next) render(next, 'fast', NO_TRACE);
      });
      return;
    }
    drag = null;
    settle(view);
  });

  render(current, 'none', NO_TRACE);

  return () => {
    unsubscribe();
    scope.dispose();
    root.body.classList.remove('is-dragging');
  };
}
