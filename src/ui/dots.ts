// The result drawn as 100 dots: each one possible outcome, stacked in columns over the scale.

import type { Spread } from '../contracts/usage';
import { el } from './dom';
import { createGhost, flush, type Scope } from './motion';

export interface DotsGeometry {
  /** Width of the scale in pixels, from 0 to `scaleMax`. */
  width: number;
  /** Top of the scale, in the same unit as the values. */
  scaleMax: number;
  /** Distance from one dot to the next, across and up. */
  step: number;
  /** Width of the strip past the end of the scale. */
  gutter: number;
  /** How many dots fit on top of each other. */
  rows: number;
}

export interface DotsLayout {
  /** Centre of each dot, in pixels from the start of the scale. */
  x: number[];
  /** Bottom of each dot, in pixels above the axis. */
  y: number[];
  /** How many dots lie past the end of the scale. */
  beyond: number;
  /** The tallest stack, in dots. */
  tallest: number;
}

/**
 * Where each dot goes. A value falls into the column nearest to it and sits on the dots already there.
 * A column that is full hands the dot to the nearest column with room, so a very narrow range becomes a
 * wider pile instead of a tower. Values past the end of the scale stack in the gutter.
 * The same values and geometry always give the same layout.
 */
export function layoutDots(values: readonly number[], g: DotsGeometry): DotsLayout {
  const rows = Math.max(1, Math.floor(g.rows));
  const last = Math.max(0, Math.round(g.width / g.step));
  const perColumn = (g.step * g.scaleMax) / g.width;
  const filled = new Map<number, number>();
  const count = (c: number) => filled.get(c) ?? 0;
  const layout: DotsLayout = { x: [], y: [], beyond: 0, tallest: 0 };

  const columnWithRoom = (wanted: number): number => {
    if (count(wanted) < rows) return wanted;
    for (let d = 1; d <= last; d++) {
      if (wanted + d <= last && count(wanted + d) < rows) return wanted + d;
      if (wanted - d >= 0 && count(wanted - d) < rows) return wanted - d;
    }
    return wanted;
  };

  for (const raw of values) {
    const value = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    if (value > g.scaleMax) {
      // More dots past the scale than fit in the gutter share its top place.
      const row = Math.min(layout.beyond, rows - 1);
      layout.x.push(g.width + g.gutter / 2);
      layout.y.push(row * g.step);
      layout.beyond += 1;
      layout.tallest = Math.max(layout.tallest, row + 1);
      continue;
    }
    const column = columnWithRoom(Math.min(last, Math.round(value / perColumn)));
    const row = Math.min(count(column), rows - 1);
    filled.set(column, count(column) + 1);
    layout.x.push(column * g.step);
    layout.y.push(row * g.step);
    layout.tallest = Math.max(layout.tallest, row + 1);
  }
  return layout;
}

/** Dot size, spacing and gutter for a chart this wide. Narrow charts get smaller dots. */
export function dotSizes(outerWidth: number): { dot: number; step: number; gutter: number } {
  const dot = outerWidth < 480 ? 8 : outerWidth < 760 ? 10 : 12;
  return { dot, step: dot + (outerWidth < 480 ? 2 : 3), gutter: dot + 14 };
}

/** No column of dots is taller than this. A dot that does not fit goes to the nearest column with room. */
export const MAX_STACK = 12;

/**
 * How many dots may stack. It depends on the width alone, so the chart keeps its height while the
 * range moves: a narrow chart has fewer columns and gets taller ones, up to the cap.
 */
export function rowsFor(width: number, step: number): number {
  const columns = Math.max(1, Math.round(width / step));
  return Math.max(8, Math.min(MAX_STACK, Math.round(3 + 570 / columns)));
}

/** How many of the values lie past the end of the scale, and the highest of them. They are the dots in the gutter. */
export function beyondScale(values: readonly number[], scaleMax: number): { count: number; highest: number } {
  let count = 0;
  let highest = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || !(value > scaleMax)) continue;
    count += 1;
    highest = Math.max(highest, value);
  }
  return { count, highest };
}

/** The six ticks of a scale. An empty label draws the tick alone. */
export function drawAxis(axis: Element, labels: readonly string[]): void {
  const ticks = Array.from(axis.children);
  if (ticks.length !== labels.length) {
    axis.replaceChildren(
      ...labels.map(() => {
        const tick = el('span', 'tick');
        tick.append(el('i'), el('em'));
        return tick;
      }),
    );
  }
  Array.from(axis.children).forEach((tick, i) => {
    const label = tick.lastElementChild;
    if (label && label.textContent !== labels[i]) label.textContent = labels[i] ?? '';
  });
}

export interface DotsInput {
  /** 100 values, ascending. */
  values: readonly number[];
  range: Spread;
  scaleMax: number;
  /** true when there is one outcome: every dot is filled and there is no bracket. */
  single: boolean;
  /** Labels for the six ticks. */
  ticks: readonly string[];
}

export interface DotsChart {
  /**
   * Draws `input`. `ghost` is where the range was (or the range without the applied tips, when `held`).
   * With `slide` false the dots are placed at once.
   */
  update(input: DotsInput, ghost: Spread | null, held: boolean, slide: boolean): void;
  /** The parts the result panel fills in: the label beside the middle line and the label under the bracket. */
  midLabel: HTMLElement;
  bracketLabel: HTMLElement;
}

const LABEL_ROOM = 26;
const COUNT = 100;

export function createDots(host: HTMLElement, scope: Scope): DotsChart {
  host.classList.add('dp');
  const area = el('div', 'dp-area');
  const grid = el('div', 'dp-grid');
  grid.append(el('span'), el('span'), el('span'), el('span'));
  const ghostLine = el('div', 'dp-ghost');
  const mid = el('div', 'dp-mid');
  const midLabel = el('span', 'dp-mid-label');
  mid.append(midLabel);
  const dotsWrap = el('div', 'dp-dots');
  const dots = Array.from({ length: COUNT }, (_, i) => {
    const dot = el('span', 'dp-dot');
    // Each dot starts a hair after the one before, so a change reads as a wave and not as a jump.
    // The delay is set in the styles from this number, so they can drop it while a slider is dragged.
    dot.style.setProperty('--i', String(i));
    return dot;
  });
  dotsWrap.append(...dots);
  area.append(grid, ghostLine, mid, dotsWrap);

  const axis = el('div', 'axis');
  const foot = el('div', 'dp-foot');
  const bracket = el('div', 'dp-bracket');
  const bracketGhost = el('span', 'dp-bracket-ghost');
  const bracketLine = el('span', 'dp-bracket-line');
  const bracketLabel = el('span', 'dp-bracket-label');
  bracket.append(bracketGhost, bracketLine, bracketLabel);
  foot.append(bracket);
  host.append(area, axis, foot);

  let width = 0;
  let sizes = dotSizes(600);
  let rows = 8;
  let last: { input: DotsInput; ghost: Spread | null; held: boolean } | null = null;

  const percent = (value: number, scaleMax: number) => `${((Math.max(0, Math.min(scaleMax, value)) / scaleMax) * 100).toFixed(3)}%`;
  const spanOf = (range: Spread, scaleMax: number) =>
    `${(((Math.min(scaleMax, range.p95) - Math.max(0, Math.min(scaleMax, range.p5))) / scaleMax) * 100).toFixed(3)}%`;

  const midGhost = createGhost<{ at: Spread; scaleMax: number }>(scope, ghostLine, (node, g) => {
    node.style.transform = `translateX(${((Math.min(g.scaleMax, g.at.mid) / g.scaleMax) * width).toFixed(1)}px)`;
  });
  const rangeGhost = createGhost<{ at: Spread; scaleMax: number }>(scope, bracketGhost, (node, g) => {
    node.style.left = percent(g.at.p5, g.scaleMax);
    node.style.width = spanOf(g.at, g.scaleMax);
  });

  function measure(): void {
    sizes = dotSizes(host.clientWidth || 600);
    host.style.setProperty('--dot', `${sizes.dot}px`);
    host.style.setProperty('--gutter', `${sizes.gutter}px`);
    width = area.clientWidth || 600;
    rows = rowsFor(width, sizes.step);
    host.style.setProperty('--area-h', `${rows * sizes.step + LABEL_ROOM}px`);
  }

  function place(input: DotsInput): void {
    const { range, scaleMax } = input;
    drawAxis(axis, input.ticks);
    bracketLine.hidden = input.single;
    bracketLabel.hidden = input.single;
    // Both labels are measured before anything is moved, so the browser lays the page out once.
    const labelWidth = midLabel.offsetWidth;
    const half = bracketLabel.offsetWidth / 2;
    const layout = layoutDots(input.values, { width, scaleMax, step: sizes.step, gutter: sizes.gutter, rows });
    dots.forEach((dot, i) => {
      // The 5 lowest and the 5 highest lie outside the likely range and are drawn hollow.
      dot.classList.toggle('tail', !input.single && (i < 5 || i >= COUNT - 5));
      const x = (layout.x[i] ?? 0) - sizes.dot / 2;
      dot.style.transform = `translate3d(${x.toFixed(1)}px,${(-(layout.y[i] ?? 0)).toFixed(1)}px,0)`;
    });

    const midX = Math.min(width, (Math.max(0, range.mid) / scaleMax) * width);
    mid.style.transform = `translateX(${midX.toFixed(1)}px)`;
    // The label sits to the right of the line and flips to its left when it would leave the chart.
    let offset = 10;
    if (midX + offset + labelWidth > width + sizes.gutter) offset = -(10 + labelWidth);
    if (midX + offset < 0) offset = -midX;
    midLabel.style.left = `${offset}px`;

    bracketLine.style.left = percent(range.p5, scaleMax);
    bracketLine.style.width = spanOf(range, scaleMax);
    // Centred under the bracket, and kept inside the chart when the range sits at either end.
    const centre = ((Math.max(0, Math.min(scaleMax, range.p5)) + Math.min(scaleMax, range.p95)) / 2 / scaleMax) * width;
    const left = Math.max(0, Math.min(width + sizes.gutter - half * 2, centre - half));
    bracketLabel.style.left = `${left.toFixed(1)}px`;
  }

  function still(run: () => void): void {
    host.classList.add('no-anim');
    run();
    flush(host);
    host.classList.remove('no-anim');
  }

  measure();
  const watched = typeof ResizeObserver === 'function';
  if (watched) {
    const observer = new ResizeObserver(() => {
      if (!host.clientWidth || Math.abs(area.clientWidth - width) < 1) return;
      still(() => {
        measure();
        if (!last) return;
        place(last.input);
        // A held ghost has to follow the new width. A fading one is simply dropped.
        const at = last.held && last.ghost ? { at: last.ghost, scaleMax: last.input.scaleMax } : null;
        midGhost.show(at, true);
        rangeGhost.show(at, true);
      });
    });
    observer.observe(host);
    scope.add(() => observer.disconnect());
  }

  return {
    midLabel,
    bracketLabel,
    update(input, ghost, held, slide) {
      // A scale with no length has nowhere to put anything.
      if (!(input.scaleMax > 0)) return;
      // The chart was hidden until now: its width was not known when it was built. After that the
      // observer above keeps the width, so a draw does not have to ask for it.
      if (!last || !watched) still(measure);
      last = { input, ghost, held };
      if (slide) place(input);
      else still(() => place(input));
      const at = ghost ? { at: ghost, scaleMax: input.scaleMax } : null;
      midGhost.show(at, held);
      rangeGhost.show(at, held);
    },
  };
}
