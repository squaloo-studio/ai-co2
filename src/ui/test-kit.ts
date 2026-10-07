// Shared by the page's tests: the real index.html in a test page, a Store that hands out hand-made
// Views, and a View to start from. Not part of the built site.

import html from '../../index.html?raw';
import type { Action, Store } from '../contracts/store';
import type { Spread } from '../contracts/usage';
import type { AssumptionView, ResultView, TipView, View } from '../contracts/view';

/** Puts the body of index.html into the test document. */
export function loadPage(): void {
  const start = html.indexOf('<body>');
  const end = html.lastIndexOf('</body>');
  document.body.innerHTML = html.slice(start + '<body>'.length, end);
}

export interface FakeStore extends Store {
  /** Every action the page has sent, in order. */
  actions: Action[];
  /** Hands the page a new View, as the logic would after a change. */
  push(view: View): void;
}

export function fakeStore(first: View): FakeStore {
  let view = first;
  const listeners = new Set<(view: View, previous: View) => void>();
  const actions: Action[] = [];
  return {
    actions,
    getView: () => view,
    dispatch: action => {
      actions.push(action);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    push(next) {
      const previous = view;
      view = next;
      for (const listener of Array.from(listeners)) listener(view, previous);
    },
  };
}

export const spread = (p5: number, mid: number, p95: number): Spread => ({ p5, mid, p95 });

/** 100 values spread evenly from just under the low end to just over the high end. */
export function evenQuantiles(range: Spread): number[] {
  return Array.from({ length: 100 }, (_, i) => range.p5 * 0.9 + ((range.p95 * 1.1 - range.p5 * 0.9) * i) / 99);
}

export function makeAssumption(over: Partial<AssumptionView> = {}): AssumptionView {
  return {
    id: 'energy', group: 'Energy', label: 'Energy per 1,000 output tokens', unit: ' Wh', decimals: 1,
    low: 0.5, typical: 1, high: 5.4, value: 1, pinned: false,
    explanation: 'The electricity a model uses to write 1,000 tokens.', note: null,
    source: 'A study', sourceUrl: 'https://example.org/study', checked: '2026-09-27', soft: false,
    ...over,
  };
}

export function makeTip(over: Partial<TipView> = {}): TipView {
  return {
    id: 'tip-a', title: 'Most of your footprint is one model',
    body: ['Switching would save roughly ', { mark: '0.75–7.6 kg a month' }, '.'],
    how: ['type ', { code: '/model small' }, ' first.'],
    applied: false, now: spread(3.7, 9.8, 34), after: spread(2.9, 7.9, 27), afterLabel: 'Smaller',
    ...over,
  };
}

export function makeResult(over: Partial<ResultView> = {}): ResultView {
  const range = over.range ?? spread(3.7, 9.8, 34);
  return {
    sourceName: 'Claude Code',
    period: { from: '2026-08-30', to: '2026-09-29' },
    summary: 'Likely CO₂e from Claude Code in the last 30 days (30 Aug – 29 Sep)',
    unit: 'kg',
    range,
    single: false,
    quantiles: evenQuantiles(range),
    scaleMax: 50,
    car: spread(range.p5 / 0.16, range.mid / 0.16, range.p95 / 0.16),
    carPlace: null,
    history: null,
    baseline: null,
    appliedLabel: null,
    setLabel: null,
    switches: { title: 'Try a change', note: 'Flip one to see what it changes. The details are under “Ways to cut”.', items: [] },
    ...over,
  };
}

/** A View with a Claude Code result and nothing optional. Override what a test is about. */
export function makeView(over: Partial<View> = {}): View {
  return {
    stage: 'done',
    source: 'claude-code',
    data: {
      claudeCode: {
        prompt: 'Count my tokens.',
        answer: '',
        status: { state: 'ok', headline: '1 model · 12 million tokens · 30 Aug – 29 Sep', confirmation: 'The numbers add up and look plausible.', models: [{ name: 'Opus 5.5', tokens: 12_000_000, share: 1 }], notes: [] },
      },
      chatgpt: { status: { state: 'waiting' } },
    },
    result: makeResult(),
    tips: [],
    noTipsNote: null,
    contribute: null,
    method: {
      formula: 'CO₂ = tokens × weight × energy per token × overhead × grid × hardware',
      counted: ['Every token.'],
      leftOut: ['Water.'],
      notes: [],
      assumptions: [makeAssumption()],
      sliderNote: 'Move a slider to set that assumption yourself: until you reset it, the page uses your value in every run instead of varying it between low and high.',
      extreme: { low: 1, high: 540 },
      extremeLabel: 'Every low or every high assumption combined',
      unit: 'kg',
    },
    ...over,
  };
}

/** The text a reader gets from the first match, without the parts that are hidden. */
export const text = (selector: string): string => {
  const copy = document.querySelector(selector)?.cloneNode(true) as Element | undefined;
  if (!copy) return '';
  for (const hidden of Array.from(copy.querySelectorAll('[hidden]'))) hidden.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
};
const without = (selector: string, drop: string): string => {
  const copy = document.querySelector(selector)?.cloneNode(true) as Element | undefined;
  if (!copy) return '';
  for (const gone of Array.from(copy.querySelectorAll(`[hidden], ${drop}`))) gone.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
};
/** What the eye gets from the first match: without the hidden parts and the words kept for screen readers. */
export const seen = (selector: string): string => without(selector, '.sr');
/** What a screen reader gets from the first match: without the hidden parts and what is marked aria-hidden. */
export const spoken = (selector: string): string => without(selector, '[aria-hidden="true"]');
export const shown = (selector: string): boolean => {
  const node = document.querySelector(selector);
  return !!node && !node.closest('[hidden]');
};
