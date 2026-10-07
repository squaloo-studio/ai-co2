// @vitest-environment happy-dom
// The entry of the page. Tests run like the development server does, so the switch for the stand-in
// store exists here. That it is left out of the published build is src/build.test.ts's to show.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_A } from './app/test-kit';
import { loadPage, text } from './ui/test-kit';

const picked = (): string | null | undefined => document.querySelector('[data-chapter="data"]')?.getAttribute('data-picked');

async function start(address: string): Promise<void> {
  loadPage();
  history.replaceState(null, '', address);
  vi.resetModules();
  await import('./main');
}

afterEach(() => {
  history.replaceState(null, '', '/');
  document.body.replaceChildren();
});

describe('the entry of the page', () => {
  it('starts the real store: nothing chosen, no example label, and a pasted answer gives the real estimate', async () => {
    await start('/');
    expect(location.search).toBe('');
    expect(picked()).toBe('false');
    expect(document.querySelectorAll('[data-example]').length).toBe(0);

    document.querySelector<HTMLElement>('[data-choose-source="claude-code"]')?.click();
    const box = document.querySelector<HTMLTextAreaElement>('[data-answer]');
    if (!box) throw new Error('no paste box');
    box.value = ANSWER_A;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    // Fixture A of the statistics vectors: 3.7–34 kg, worked out by the real store.
    await vi.waitFor(() => expect(text('[data-range-seen]')).toBe('3.7–34'), { timeout: 3000 });
    expect(document.querySelectorAll('[data-example]').length).toBe(0);
  });

  it('starts the stand-in store when the address names a scenario, and marks the page as example data', async () => {
    await start('/?demo=cc-done');
    await vi.waitFor(() => expect(document.querySelectorAll('[data-example]').length).toBe(2), { timeout: 3000 });
    expect(picked()).toBe('true');
    expect(text('.example-bar')).toBe('Example data. Every figure on this page is made up to show how it works. None of it is your own use.');
    expect(text('[data-range-seen]')).toBe('3.7–34');
  });

  it('takes a scenario it does not know for the first visit of the stand-in store', async () => {
    await start('/?demo=nothing-like-this');
    await vi.waitFor(() => expect(document.querySelectorAll('[data-example]').length).toBe(2), { timeout: 3000 });
    expect(picked()).toBe('false');
  });
});
