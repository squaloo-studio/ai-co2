// The small range bar: a band for the likely range and a pin at the middle estimate.
// It sits in the pinned pill and beside each tip.

import type { Spread } from '../contracts/usage';
import { el } from './dom';
import { createGhost, flush, type Scope } from './motion';

export interface Band {
  /** `ghost` is where the range was (or the range without the applied tips, when `held`). */
  update(range: Spread, scaleMax: number, ghost: Spread | null, held: boolean, slide: boolean): void;
}

export function createBand(host: HTMLElement, scope: Scope): Band {
  host.classList.add('band');
  const area = el('div', 'band-area');
  const track = el('div', 'band-track');
  const ghostBar = el('span', 'band-ghost');
  const fill = el('span', 'band-fill');
  const pin = el('span', 'band-pin');
  track.append(ghostBar, fill, pin);
  area.append(track);
  host.replaceChildren(area);

  const percent = (value: number, scaleMax: number) => (Math.max(0, Math.min(scaleMax, value)) / scaleMax) * 100;
  const put = (node: HTMLElement, range: Spread, scaleMax: number) => {
    const left = percent(range.p5, scaleMax);
    node.style.left = `${left.toFixed(3)}%`;
    node.style.width = `${Math.max(0, percent(range.p95, scaleMax) - left).toFixed(3)}%`;
  };
  const ghost = createGhost<{ at: Spread; scaleMax: number }>(scope, ghostBar, (node, g) => put(node, g.at, g.scaleMax));

  return {
    update(range, scaleMax, was, held, slide) {
      if (!(scaleMax > 0)) return;
      if (!slide) host.classList.add('no-anim');
      put(fill, range, scaleMax);
      pin.style.left = `${percent(range.mid, scaleMax).toFixed(3)}%`;
      if (!slide) {
        flush(host);
        host.classList.remove('no-anim');
      }
      ghost.show(was ? { at: was, scaleMax } : null, held);
    },
  };
}
