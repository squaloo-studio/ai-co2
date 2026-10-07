import { afterEach, describe, expect, it, vi } from 'vitest';
import { COUNT_MS, createCounter, type Scope } from './motion';

/** A Scope whose frames run only when the test says so. */
function handScope(): { scope: Scope; runFrame: () => boolean } {
  let next: (() => void) | null = null;
  const scope: Scope = {
    listen: () => {},
    timer: () => () => {},
    frame: run => {
      next = run;
      return () => {
        if (next === run) next = null;
      };
    },
    add: () => {},
    dispose: () => {},
  };
  return {
    scope,
    runFrame: () => {
      const run = next;
      next = null;
      run?.();
      return run !== null;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createCounter', () => {
  it('ends a count on the target itself, not on a sum that lands beside it', () => {
    // 41.6 + (7.15 - 41.6) is 7.149999999999999, which prints "7.1" where 7.15 prints "7.2".
    expect(41.6 + (7.15 - 41.6)).not.toBe(7.15);

    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { scope, runFrame } = handScope();
    const painted: number[] = [];
    const counter = createCounter(scope, values => painted.push(values.get('mid') ?? NaN));

    counter.set(new Map([['mid', 41.6]]), true);
    counter.set(new Map([['mid', 7.15]]), false);
    now = COUNT_MS / 2;
    expect(runFrame()).toBe(true);
    const halfway = painted.at(-1) ?? NaN;
    expect(halfway).toBeGreaterThan(7.15);
    expect(halfway).toBeLessThan(41.6);

    // The counter can say what it shows: on its way, and arrived.
    expect(counter.shown('mid')).toBe(halfway);
    expect(counter.shown('other')).toBeUndefined();

    now = COUNT_MS;
    expect(runFrame()).toBe(true);
    expect(painted.at(-1)).toBe(7.15);
    expect(counter.shown('mid')).toBe(7.15);
    expect(runFrame()).toBe(false);

    // The next count starts from the exact value as well.
    counter.set(new Map([['mid', 13]]), false);
    expect(painted.at(-1)).toBe(7.15);
    now = COUNT_MS * 2;
    runFrame();
    expect(painted.at(-1)).toBe(13);
  });
});
