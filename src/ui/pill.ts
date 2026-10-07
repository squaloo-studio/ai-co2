// The pinned pill: a small copy of the result that stays on screen once the panel has scrolled away.

import type { View } from '../contracts/view';
import { oneNumber, underOneMilligram, type Motion, type Trace } from './change';
import { need, setText, show } from './dom';
import { createBand } from './band';
import { createChip, FLASH_MS, flush, reducedMotion, type Scope } from './motion';

export interface PillPart {
  update(view: View): void;
  /** `scaleMax` is the top of the scale to draw on. It can lag behind the View's (see index.ts). */
  draw(view: View, motion: Motion, trace: Trace, scaleMax: number): void;
  rescale(view: View, scaleMax: number): void;
}

/** The panel counts as scrolled away once its lower edge is this close to the top of the window. */
const AWAY_PX = 120;

export function createPill(root: ParentNode, scope: Scope, panel: HTMLElement): PillPart {
  const pin = need(root, '[data-pill]');
  const pill = need(pin, '.pill');
  const about = need(pin, '[data-pill-about]');
  const rest = need(pin, '[data-pill-rest]');
  const mid = need(pin, '[data-pill-mid]');
  const numbers = need(pin, '[data-pill-numbers]');
  const underWords = need(pin, '[data-pill-under]');
  const applied = need(pin, '[data-pill-applied]');
  const bandHost = need(pin, '[data-pill-band]');
  const band = createBand(need(pin, '[data-pill-band]'), scope);
  const chip = createChip(scope, need(pin, '[data-pill-chip]'));
  let hasResult = false;
  let stopFlash: (() => void) | null = null;

  function sync(): void {
    const on = hasResult && panel.getBoundingClientRect().bottom < AWAY_PX;
    if (on === pin.classList.contains('is-on')) return;
    // The button inside takes the focus with it when the pill goes, so hand it to the panel first.
    if (!on && pin.contains(document.activeElement)) panel.focus({ preventScroll: true });
    pin.classList.toggle('is-on', on);
    pin.toggleAttribute('inert', !on);
  }

  let waiting: (() => void) | null = null;
  const later = () => {
    waiting?.();
    waiting = scope.frame(() => {
      waiting = null;
      sync();
    });
  };
  scope.listen(window, 'scroll', later, { passive: true });
  scope.listen(window, 'resize', later, { passive: true });

  scope.listen(need(pin, '[data-to-result]'), 'click', () => {
    panel.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    panel.focus({ preventScroll: true });
  });

  return {
    update(view) {
      const result = view.result;
      const had = hasResult;
      hasResult = !!result;
      if (result) {
        const one = oneNumber(result);
        const under = underOneMilligram(result);
        show(numbers, !under);
        show(underWords, under);
        show(bandHost, !under);
        show(about, one);
        show(rest, !one);
        show(mid, !one && !under);
        // The pill has no room for the tag that says a tip is applied. A screen reader still hears it,
        // so the what-if is not taken for the person's own numbers.
        show(applied, !!result.appliedLabel);
        setText(applied, result.appliedLabel ? ` ${result.appliedLabel}. ` : '');
      }
      // Whether the panel is in view only changes with a scroll or a resize, which are watched above.
      // Asking again on every draw would make the browser lay the page out in the middle of it.
      if (had !== hasResult) sync();
    },

    rescale(view, scaleMax) {
      const result = view.result;
      if (result) band.update(result.range, scaleMax, result.baseline, !!result.baseline, true);
    },

    draw(view, motion, trace, scaleMax) {
      const result = view.result;
      if (!result) {
        chip.show(null);
        return;
      }
      const ghost = result.baseline ?? (motion === 'full' ? trace.was : null);
      band.update(result.range, scaleMax, ghost, !!result.baseline, motion !== 'none');
      chip.show(motion === 'full' ? trace.chip : null);
      if (motion !== 'full' || (!trace.was && !trace.chip)) return;
      // The outline lights up so a change is noticed while the panel itself is out of view.
      stopFlash?.();
      pill.classList.remove('flash');
      flush(pill);
      pill.classList.add('flash');
      stopFlash = scope.timer(() => pill.classList.remove('flash'), FLASH_MS);
    },
  };
}
