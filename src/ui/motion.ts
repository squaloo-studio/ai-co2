// Timing, and everything that has to be undone when the page is taken down.

/** How long a number counts across to its new value. */
export const COUNT_MS = 700;
/** How long the dashed ghost of the old range stays. Longer with reduced motion, where nothing slides. */
export const GHOST_MS = 1400;
export const GHOST_STILL_MS = 2600;
/** How long the ghost takes to fade once its time is up. The styles hold the same number. */
export const GHOST_FADE_MS = 600;

/** From the moment a ghost appears until nothing of it is left. */
export function ghostGoneMs(): number {
  return (reducedMotion() ? GHOST_STILL_MS : GHOST_MS) + GHOST_FADE_MS;
}
/** How long the change chip stays. */
export const CHIP_MS = 2600;
/** How long the pill's outline stays lit after a change. */
export const FLASH_MS = 1100;

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Undo = () => void;

/** Collects every listener, timer, frame and observer a part of the page adds, so one call removes them all. */
export interface Scope {
  listen<E extends Event = Event>(target: EventTarget, type: string, handler: (event: E) => void, options?: AddEventListenerOptions): void;
  /** Returns a function that cancels the timer. */
  timer(run: () => void, ms: number): Undo;
  /** Returns a function that cancels the frame. */
  frame(run: () => void): Undo;
  add(undo: Undo): void;
  dispose(): void;
}

export function createScope(): Scope {
  const undos = new Set<Undo>();
  const once = (start: (done: () => void) => Undo): Undo => {
    const stop = start(() => undos.delete(cancel));
    const cancel = () => {
      stop();
      undos.delete(cancel);
    };
    undos.add(cancel);
    return cancel;
  };
  return {
    listen(target, type, handler, options) {
      const listener = handler as EventListener;
      target.addEventListener(type, listener, options);
      undos.add(() => target.removeEventListener(type, listener, options));
    },
    timer: (run, ms) =>
      once(done => {
        const id = setTimeout(() => {
          done();
          run();
        }, ms);
        return () => clearTimeout(id);
      }),
    frame: run =>
      once(done => {
        const id = requestAnimationFrame(() => {
          done();
          run();
        });
        return () => cancelAnimationFrame(id);
      }),
    add(undo) {
      undos.add(undo);
    },
    dispose() {
      for (const undo of Array.from(undos)) undo();
      undos.clear();
    },
  };
}

/** Forces the browser to take in the styles set so far, so the next change starts a fresh transition. */
export function flush(node: HTMLElement): void {
  void node.offsetWidth;
}

export interface Counter {
  /**
   * Counts every number across to its target. `instant` jumps there.
   * `measure` runs while the numbers show their final values, before the count starts: whatever sizes
   * itself by their width gets the width they end up with.
   */
  set(targets: ReadonlyMap<string, number>, instant: boolean, measure?: () => void): void;
  /** The value one number shows on screen right now, on its way or arrived. undefined before it was ever set. */
  shown(key: string): number | undefined;
}

/**
 * Counts a set of named numbers up or down together. A second change while they are still moving
 * starts from where each number is on screen at that moment.
 */
export function createCounter(scope: Scope, paint: (values: ReadonlyMap<string, number>) => void): Counter {
  let shown = new Map<string, number>();
  let from = new Map<string, number>();
  let to: ReadonlyMap<string, number> = new Map();
  let started = 0;
  let cancel: Undo | null = null;

  const step = () => {
    const t = Math.min(1, (performance.now() - started) / COUNT_MS);
    const eased = 1 - Math.pow(2, -10 * t);
    // The last frame takes the targets as they are: start + (target - start) can land a hair beside
    // the target and print one digit off from the change chip and the spoken text.
    shown = new Map(to);
    if (t < 1) {
      for (const [key, target] of to) {
        const start = from.get(key);
        if (start !== undefined && Number.isFinite(start)) shown.set(key, start + (target - start) * eased);
      }
    }
    paint(shown);
    cancel = t < 1 ? scope.frame(step) : null;
  };

  return {
    set(targets, instant, measure) {
      cancel?.();
      cancel = null;
      from = shown;
      to = new Map(targets);
      const still = instant || reducedMotion();
      if (still || measure) paint(to);
      measure?.();
      if (still) {
        shown = new Map(to);
        return;
      }
      started = performance.now();
      step();
    },
    shown: key => shown.get(key),
  };
}

export interface Ghost<T> {
  /** Shows the ghost at `at`. It fades after a moment unless `held`. null takes it away. */
  show(at: T | null, held: boolean): void;
}

/** The dashed mark of where something was. */
export function createGhost<T>(scope: Scope, node: HTMLElement, place: (node: HTMLElement, at: T) => void): Ghost<T> {
  let cancel: Undo | null = null;
  return {
    show(at, held) {
      cancel?.();
      cancel = null;
      if (at === null) {
        node.classList.remove('is-on');
        return;
      }
      // It appears where the range was, without sliding there from its last place.
      node.classList.add('no-move');
      place(node, at);
      flush(node);
      node.classList.remove('no-move');
      node.classList.add('is-on');
      if (!held) cancel = scope.timer(() => node.classList.remove('is-on'), reducedMotion() ? GHOST_STILL_MS : GHOST_MS);
    },
  };
}

export interface Chip {
  /** Shows the chip with this text for a moment. null takes it away at once. */
  show(text: string | null): void;
}

/** The lime change chip. A change that prints no difference clears a chip that is still up from the one before. */
export function createChip(scope: Scope, node: HTMLElement): Chip {
  let cancel: Undo | null = null;
  return {
    show(text) {
      cancel?.();
      cancel = null;
      node.classList.remove('is-on');
      if (text === null) return;
      node.textContent = text;
      flush(node);
      node.classList.add('is-on');
      cancel = scope.timer(() => node.classList.remove('is-on'), CHIP_MS);
    },
  };
}
