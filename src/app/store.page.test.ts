// @vitest-environment happy-dom
// The real page on the real store: what a person does on the page arrives as numbers and sentences
// on the page. The page and the store each have their own tests. This one checks that they fit.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '../contracts/store';
import { mountPage } from '../ui';
import { loadPage, shown, text } from '../ui/test-kit';
import { createStore } from './store';
import { ANSWER_A, exampleReading, outside, progress, report } from './test-kit';
import type { Outside } from './test-kit';

let unmount: (() => void) | null = null;
let errors: ReturnType<typeof vi.spyOn>;

function open(world: Outside): Store {
  loadPage();
  const store = createStore(world.env);
  unmount = mountPage(store);
  return store;
}
/** Lets the page's own timers run: the pause after typing, the counting numbers, the spoken line. */
const settle = (): void => {
  vi.advanceTimersByTime(4000);
};
const click = (selector: string): void => {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`nothing matches ${selector}`);
  node.click();
};
const type = (value: string): void => {
  const box = document.querySelector<HTMLTextAreaElement>('[data-answer]');
  if (!box) throw new Error('no paste box');
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
};
const slide = (id: string, position: number, events: readonly string[] = ['input', 'change']): void => {
  const input = document.querySelector<HTMLInputElement>(`[data-key="s:${id}"] input`);
  if (!input) throw new Error(`no slider ${id}`);
  input.value = String(Math.round(position * Number(input.max)));
  for (const event of events) input.dispatchEvent(new Event(event, { bubbles: true }));
};
const drop = (names: readonly string[]): void => {
  const zone = document.querySelector<HTMLElement>('[data-drop]');
  if (!zone) throw new Error('no drop zone');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: names.map((name) => new File(['x'], name)), types: ['Files'] } });
  zone.dispatchEvent(event);
};
const neverOnThePage = /\bNaN\b|undefined|\[object|\boffset|\bneutral|compensat|saves? up to|\bowe/i;

beforeEach(() => {
  vi.useFakeTimers();
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  unmount?.();
  unmount = null;
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
  vi.useRealTimers();
});

describe('the page on the real store', () => {
  it('starts with the choice, the method and no result', () => {
    open(outside());
    settle();
    expect(shown('[data-result-top]')).toBe(false);
    expect(shown('#how')).toBe(true);
    expect(document.querySelectorAll('.sl input')).toHaveLength(7);
    expect(text('main')).toContain('Energy to write 1,000 tokens, large models');
    expect(text('main')).not.toMatch(neverOnThePage);
  });

  it('Claude Code: a pasted answer becomes a result, tips and costs', () => {
    const store = open(outside());
    click('[data-choose-source="claude-code"]');
    type(ANSWER_A);
    // The page waits for the typing to pause before it sends the text on.
    expect(store.getView().stage).toBe('steps');
    settle();
    expect(store.getView().stage).toBe('done');

    const page = text('main');
    for (const sentence of [
      '3 models · 781 million tokens · 8 Sep – 7 Oct',
      'The numbers add up and look plausible.',
      'Opus 5.5',
      'Likely CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct)',
      'Middle estimate: 9.8 kg',
      'Try a change',
      'About 85% of your estimate comes from Opus 5.5',
      // The page puts a spoken form of the saving after the printed one, so the full stop comes after both.
      'Moving half of your Opus 5.5 work to Sonnet would save roughly 0.75–7.6 kg a month',
      ' for 3.7–34 kg of CO₂, the size of your estimate.',
      '$2–17. At the middle estimate: $5. Plus tax where it applies.',
      'What matters most for your result is “Energy to write 1,000 tokens, large models”.',
    ]) expect(page).toContain(sentence);
    expect(text('[data-range]')).toContain('3.7–34');
    expect(Array.from(document.querySelectorAll('.dp .tick em'), (em) => em.textContent)).toEqual(['0', '10', '20', '30', '40', '50 kg']);
    expect(page).not.toMatch(neverOnThePage);
  });

  it('Claude Code: a tip, a slider and the reset reach the store and come back as words', () => {
    const store = open(outside());
    click('[data-choose-source="claude-code"]');
    type(ANSWER_A);
    settle();

    click('[data-switches-list] [data-switch="cc-opus-to-sonnet"]');
    settle();
    expect(store.getView().result?.appliedLabel).toBe('With: Sonnet for half of your Opus work');
    expect(text('main')).toContain('With: Sonnet for half of your Opus work');

    slide('grid', 1);
    settle();
    expect(store.getView().method.assumptions.find((entry) => entry.id === 'grid')).toMatchObject({ pinned: true, value: 460 });
    expect(text('main')).toContain('With 1 assumption set by you');
    expect(text('main')).toContain('Extreme range (every assumption you have not set, at its low or at its high, with your tip applied)');

    click('[data-reset]');
    click('.tip [data-switch="cc-opus-to-sonnet"]');
    settle();
    expect(store.getView().result).toMatchObject({ appliedLabel: null, setLabel: null });
    expect(text('main')).toContain('Middle estimate: 9.8 kg');
    expect(text('main')).not.toMatch(neverOnThePage);
  });

  it('Claude Code: a slider that is held gets its full call when the pointer rests, and again when it is let go', () => {
    const world = outside();
    const store = open(world);
    click('[data-choose-source="claude-code"]');
    type(ANSWER_A);
    settle();
    const tips = store.getView().tips;
    slide('grid', 1, ['input']);
    expect(store.getView().tips[0]).toBe(tips[0]);
    expect(world.timer()?.ms).toBe(100);
    world.timer()?.run();
    expect(store.getView().tips[0]).not.toBe(tips[0]);
    slide('grid', 1, ['change']);
    settle();
    expect(world.timer()).toBeUndefined();
    expect(text('main')).toContain('With 1 assumption set by you');
  });

  it('Claude Code: an answer that cannot be read is said so, and an emptied box goes back to waiting', () => {
    const store = open(outside());
    click('[data-choose-source="claude-code"]');
    type('Here is your usage for the month.');
    settle();
    expect(store.getView().stage).toBe('problem');
    expect(text('main')).toContain("This doesn't look like the answer. It should start with a line that begins “ai-co2 v1”.");
    expect(shown('[data-result-top]')).toBe(false);
    type('');
    settle();
    expect(store.getView().stage).toBe('steps');
  });

  it('ChatGPT: dropped files are read, the read can be stopped, and an export becomes a result', async () => {
    const world = outside();
    const store = open(world);
    click('[data-choose-source="chatgpt"]');
    expect(document.querySelectorAll('.sl input')).toHaveLength(12);
    drop(['export.zip']);
    expect(store.getView().stage).toBe('loading');
    expect(world.read().files.map((file) => file.name)).toEqual(['export.zip']);
    world.read().progress(progress({ bytesRead: 400, bytesTotal: 1000, conversations: 2 }));
    expect(text('main')).toContain('Reading your export in this tab: 2 conversations so far. Large exports can take a minute.');

    click('[data-cancel-read]');
    expect(world.read().cancelled).toBe(true);
    expect(store.getView().stage).toBe('steps');

    drop(['export.zip']);
    await world.read().end({ ok: true, reading: exampleReading('current', true), report: report() });
    settle();
    expect(store.getView().stage).toBe('done');
    const page = text('main');
    for (const sentence of [
      '3 conversations · 6 answers in the last 30 days · newest message 2 Oct',
      'Your export was read in this tab.',
      'Likely CO₂e from ChatGPT in the 25 days up to your newest message (8 Sep – 2 Oct)',
      'Hidden work in ChatGPT',
      'Plus or Pro plan',
      'Set from your export: memory was used',
      'Your whole ChatGPT history, since July 2026:',
      'We tried 3 changes on your ChatGPT numbers and suggest none',
      'Thinking tokens per second of thinking',
    ]) expect(page).toContain(sentence);
    expect(page).not.toMatch(neverOnThePage);

    click('[data-switches-list] [data-switch="plan-paid"]');
    settle();
    expect(text('main')).toContain('Changed by you.');
    expect(text('main')).toContain('We counted it as a small model, because you chose Free or Go.');
    expect(world.reads).toHaveLength(2);
  });

  it('ChatGPT: a drop that is no export is said so, and switching tools starts afresh', async () => {
    const world = outside();
    const store = open(world);
    click('[data-choose-source="chatgpt"]');
    drop(['holiday.jpg']);
    await world.read().end({ ok: true, reading: exampleReading('current'), report: report({ files: [], notices: [{ code: 'ignored', path: ['holiday.jpg'] }], totals: { ...report().totals, archives: 0, conversationFiles: 0 } }) });
    settle();
    expect(store.getView().stage).toBe('problem');
    expect(text('main')).toContain('None of these files is a ChatGPT export.');
    click('[data-switch-source]');
    settle();
    expect(store.getView()).toMatchObject({ stage: 'steps', source: 'claude-code', result: null });
    expect(document.querySelectorAll('.sl input')).toHaveLength(7);
  });
});
