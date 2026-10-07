// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../../index.html?raw';
import type { View } from '../contracts/view';
import { massChange } from '../format';
import { positionOf, valueAt } from '../track';
import { COPIED_MS, MODEL_ROWS } from './data';
import { MAX_STACK } from './dots';
import { ANNOUNCE_MS, mountPage } from './index';
import { ghostGoneMs } from './motion';
import { fakeStore, loadPage, makeAssumption, makeResult, makeTip, makeView, seen, shown, spoken, spread, text, type FakeStore } from './test-kit';

let unmount: (() => void) | null = null;

function mount(view: View): FakeStore {
  loadPage();
  const store = fakeStore(view);
  unmount = mountPage(store);
  return store;
}
/** Lets every count, slide and fade run out. */
const rest = () => vi.advanceTimersByTime(4000);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  unmount?.();
  unmount = null;
  vi.useRealTimers();
});

describe('units', () => {
  it('prints every mass in grams when the View says so, the scale included', () => {
    const range = spread(0.12, 0.3, 0.86);
    mount(
      makeView({
        result: makeResult({ unit: 'g', range, scaleMax: 1, car: spread(0.75, 1.9, 5.4), baseline: null }),
        tips: [makeTip({ now: range, after: spread(0.1, 0.25, 0.7) })],
        method: { ...makeView().method, unit: 'g', extreme: { low: 0.02, high: 4 } },
      }),
    );
    expect(text('[data-range]')).toBe('Likely range: 120 to 860 120–860g');
    expect(text('[data-likely]')).toBe('Middle estimate: 300 g');
    expect(text('.dp-bracket-label')).toBe('90 of 100 land here: 120–860 g');
    expect(text('.dp-mid-label')).toContain('middle estimate 300 g');
    expect(Array.from(document.querySelectorAll('.dp .tick em'), em => em.textContent)).toEqual(['0', '200', '400', '600', '800', '1,000 g']);
    expect(seen('.pill-range')).toBe('120–860g');
    expect(spoken('.pill-range')).toBe('120 to 860g');
    expect(text('[data-values="now"]')).toBe('120–860 g');
    expect(text('[data-values="after"]')).toBe('100–700 g');
    // The extreme range has its own units: its two ends lie too far apart to share one.
    expect(text('[data-extreme]')).toBe('Every low or every high assumption combined: 20 g to 4 kg');
    expect(seen('.car')).toBe('Like driving a new petrol car 1.9 km Likely 0.75–5.4 km.');
    expect(spoken('.car')).toBe('Like driving a new petrol car 1.9 km Likely 0.75 to 5.4 km.');
    expect(document.querySelector('.dp')?.getAttribute('aria-label')).toBe('Likely range 120 to 860 grams of CO2e, middle estimate 300.');
  });

  it('prints milligrams, and the car line in metres when it is short', () => {
    mount(makeView({ result: makeResult({ unit: 'mg', range: spread(0.00012, 0.0003, 0.00086), scaleMax: 0.001, car: spread(0.00075, 0.0019, 0.0054) }) }));
    expect(text('[data-range]')).toBe('Likely range: 120 to 860 120–860mg');
    expect(Array.from(document.querySelectorAll('.dp .tick em'), em => em.textContent)).toEqual(['0', '200', '400', '600', '800', '1,000 mg']);
    expect(seen('.car')).toBe('Like driving a new petrol car 1.9 m Likely 0.75–5.4 m.');
  });
});

describe('one number instead of a range', () => {
  it('shows a single outcome as "about X", without a bracket, hollow dots or their sentence', () => {
    const range = spread(8.6, 8.6, 8.6);
    mount(makeView({ result: makeResult({ single: true, range, quantiles: Array.from({ length: 100 }, () => 8.6), summary: 'CO₂e from Claude Code, with every assumption set by you' }) }));
    expect(text('[data-range]')).toBe('about 8.6kg');
    expect(shown('[data-range-rest]')).toBe(false);
    expect(shown('[data-likely]')).toBe(false);
    expect(shown('.dp-bracket-line')).toBe(false);
    expect(shown('.dp-bracket-label')).toBe(false);
    expect(document.querySelectorAll('.dp-dot').length).toBe(100);
    expect(document.querySelectorAll('.dp-dot.tail').length).toBe(0);
    expect(shown('[data-caption-range]')).toBe(false);
    expect(shown('[data-caption-one]')).toBe(true);
    expect(text('[data-chart-caption]')).not.toContain('hollow');
    expect(shown('[data-pill-mid]')).toBe(false);
    // One outcome has no range to drive: only the distance stays.
    expect(shown('[data-car-range]')).toBe(false);
    expect(document.querySelector('.dp')?.getAttribute('aria-label')).toBe('About 8.6 kilograms of CO2e.');
  });

  it('uses the same form for a range whose two ends print the same', () => {
    mount(makeView({ result: makeResult({ range: spread(8.56, 8.6, 8.64) }) }));
    expect(text('[data-range]')).toBe('about 8.6kg');
    expect(text('.dp-bracket-label')).toBe('90 of 100 land here: about 8.6 kg');
    // It is still a range: the middle estimate, the bracket and the hollow dots stay.
    expect(shown('[data-likely]')).toBe(true);
    expect(shown('.dp-bracket-line')).toBe(true);
    expect(document.querySelectorAll('.dp-dot.tail').length).toBe(10);
    expect(shown('[data-caption-range]')).toBe(true);
  });

  it('draws a range with 90 filled and 10 hollow dots', () => {
    mount(makeView());
    expect(text('[data-range]')).toBe('Likely range: 3.7 to 34 3.7–34kg');
    expect(document.querySelectorAll('.dp-dot').length).toBe(100);
    expect(document.querySelectorAll('.dp-dot.tail').length).toBe(10);
    expect(text('[data-chart-caption]')).toContain('The 5 lowest and the 5 highest are drawn hollow: 90 of 100 land between them.');
  });
});

describe('tags, tips and the chapters that depend on a result', () => {
  it('shows the tag for applied tips and the tag for set assumptions side by side', () => {
    mount(makeView({ result: makeResult({ appliedLabel: 'With: Sonnet for routine work', setLabel: 'With 1 assumption set by you', baseline: spread(3.7, 9.8, 34), range: spread(2.9, 7.9, 27) }) }));
    expect(text('[data-tag-applied]')).toBe('With: Sonnet for routine work');
    expect(text('[data-tag-set]')).toBe('With 1 assumption set by you');
    // The ghost marks the range without the tip and stays while the tip is applied.
    rest();
    expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(true);
    expect(document.querySelector('.dp-bracket-ghost')?.classList.contains('is-on')).toBe(true);
  });

  it('gives every tip its two small bars and one switch shared with the result card', () => {
    const tip = makeTip({ applied: true });
    const store = mount(
      makeView({
        tips: [tip, makeTip({ id: 'tip-b', title: 'Second tip', afterLabel: 'Cleared' })],
        result: makeResult({ switches: { title: 'Try a change', note: '', items: [{ id: 'tip-a', label: 'Smaller model', note: 'Saves roughly 0.75–7.6 kg a month', noteIcon: null, on: true }] } }),
      }),
    );
    expect(document.querySelectorAll('.tip').length).toBe(2);
    expect(document.querySelectorAll('.tip .band').length).toBe(4);
    expect(Array.from(document.querySelectorAll('.tip .tv-label'), n => n.textContent)).toEqual(['Now', 'Smaller', 'Now', 'Cleared']);
    // The saving is seen with its dash and spoken with "to", in the tip and in the switch's description.
    expect(seen('.tip mark')).toBe('0.75–7.6 kg a month');
    expect(spoken('.tip mark')).toBe('0.75 to 7.6 kg a month');
    expect(seen('[data-switches-list] .tg-src')).toBe('Saves roughly 0.75–7.6 kg a month');
    expect(spoken('[data-switches-list] .tg-src')).toBe('Saves roughly 0.75 to 7.6 kg a month');
    // The numbers of a saving stay on one line, with their unit. The words around them may wrap.
    expect(Array.from(document.querySelectorAll('.tip mark .nowrap'), n => n.textContent)).toEqual(['0.75–7.6 kg', '0.75–7.6 kg']);
    expect(text('.tip code')).toBe('/model small');
    const inCard = document.querySelector<HTMLElement>('[data-switches-list] [data-switch="tip-a"]');
    const besideTip = document.querySelector<HTMLElement>('.tip [data-switch="tip-a"]');
    expect(inCard?.getAttribute('role')).toBe('switch');
    expect(inCard?.getAttribute('aria-checked')).toBe('true');
    expect(besideTip?.getAttribute('aria-checked')).toBe('true');
    inCard?.click();
    besideTip?.click();
    expect(store.actions).toEqual([{ type: 'toggle-switch', id: 'tip-a' }, { type: 'toggle-switch', id: 'tip-a' }]);
  });

  it('copes with no tips: the note takes their place, or the chapter goes', () => {
    const store = mount(makeView({ tips: [], noTipsNote: 'Nothing stands out in your numbers.' }));
    expect(shown('#tips')).toBe(true);
    expect(text('.tips-none')).toBe('Nothing stands out in your numbers.');
    expect(document.querySelectorAll('.tip').length).toBe(0);
    expect(shown('[data-tips-caption]')).toBe(false);
    store.push(makeView({ tips: [], noTipsNote: null }));
    expect(shown('#tips')).toBe(false);
  });

  it('hides the result-dependent chapters until there is a result, and keeps the method', () => {
    mount(makeView({ stage: 'steps', result: null, data: { ...makeView().data, claudeCode: { prompt: 'p', answer: '', status: { state: 'waiting' } } }, method: { ...makeView().method, extreme: null } }));
    expect(shown('[data-result-empty]')).toBe(true);
    expect(shown('[data-result-top]')).toBe(false);
    expect(shown('#tips')).toBe(false);
    expect(shown('#contribute')).toBe(false);
    expect(shown('#how')).toBe(true);
    expect(document.querySelectorAll('[data-empty-axis] .tick').length).toBe(6);
    expect(shown('[data-extreme]')).toBe(false);
    expect(document.querySelector('[data-pill]')?.classList.contains('is-on')).toBe(false);
  });

  it('only follows a provider link that starts with https://', () => {
    const option = { kind: 'Lasting removal', price: '€100 a tonne', minimum: '10 kg', whatYouGet: 'Removal.', forYourRange: '$2–17' };
    mount(
      makeView({
        contribute: {
          costSentence: 'It would cost about $2–17.',
          options: [
            { ...option, id: 'a', name: 'Good', url: 'https://example.org/' },
            { ...option, id: 'b', name: 'Bad', url: 'javascript:alert(1)' },
            { ...option, id: 'c', name: 'Plain', url: 'http://example.org/' },
          ],
          footnote: [{ strong: 'Prices and minimums were checked on 7 Oct 2026 and can change.' }, ' ai-co2 gets nothing from them.'],
        },
      }),
    );
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.opt a'));
    expect(links.map(a => a.getAttribute('href'))).toEqual(['https://example.org/']);
    expect(links[0]?.rel).toBe('noopener noreferrer');
    expect(document.querySelectorAll('.opt').length).toBe(3);
    expect(text('[data-footnote] strong')).toBe('Prices and minimums were checked on 7 Oct 2026 and can change.');
    expect(text('[data-footnote]')).toBe('Prices and minimums were checked on 7 Oct 2026 and can change. ai-co2 gets nothing from them.');
    // The name leads and the kind has its own line under it.
    expect(document.querySelector('.opt h3')?.nextElementSibling?.textContent).toBe('Lasting removal');
  });

  it('writes a long model name and markup-like text from the View as plain text', () => {
    const name = 'a-model-with-a-very-long-name-'.repeat(3).slice(0, 80);
    expect(name.length).toBe(80);
    mount(
      makeView({
        data: {
          claudeCode: { prompt: '<b>p</b>', answer: '', status: { state: 'ok', headline: '<img src=x onerror=alert(1)>', confirmation: '<u>fine</u>', models: [{ name, tokens: 1_100_000_000, share: 0.004 }, { name: '<i>x</i>', tokens: 12, share: 0.996 }], notes: ['Your logs cover 21 days.'] } },
          chatgpt: { status: { state: 'waiting' } },
        },
      }),
    );
    expect(document.querySelector('.tool img, .tool-status i, .models th i, [data-prompt-text] b')).toBeNull();
    expect(text('.models tbody tr:first-child th')).toBe(name);
    expect(text('.models tbody tr:first-child .c-tokens')).toBe('1.10 billion');
    expect(text('.models tbody tr:first-child .share .num')).toBe('<1%');
    expect(text('.models tbody tr:last-child th')).toBe('<i>x</i>');
    expect(text('[data-tool="claude-code"] [data-status]')).toBe('Counted<img src=x onerror=alert(1)>');
    expect(text('.read-notes')).toBe('Your logs cover 21 days.');
    expect(text('[data-prompt-text]')).toBe('<b>p</b>');
  });
});

describe('the method sliders', () => {
  const groups = ['Energy', 'Energy', 'Energy', 'Energy', 'Data centre and grid', 'Data centre and grid', 'Hardware', 'Hardware', 'Hardware', 'Hardware'];
  const ten = groups.map((group, i) => makeAssumption({ id: `a${i}`, group, label: `Assumption ${i}` }));

  it('lays out ten sliders under three group headings', () => {
    mount(makeView({ method: { ...makeView().method, assumptions: ten, notes: ['Cache reads matter most for your result.'] } }));
    expect(document.querySelectorAll('.sl input[type="range"]').length).toBe(10);
    expect(Array.from(document.querySelectorAll('.sl-group'), h => h.textContent)).toEqual(['Energy', 'Data centre and grid', 'Hardware']);
    // Each heading sits right before the first slider of its group.
    const order = Array.from(document.querySelector('[data-sliders]')?.children ?? [], n => (n.matches('.sl-group') ? 'G' : 's')).join('');
    expect(order).toBe('GssssGssGssss');
    expect(text('[data-method-notes-list]')).toBe('Cache reads matter most for your result.');
    expect(shown('[data-method-notes]')).toBe(true);
  });

  it('marks a slider that is set, and leaves one that still varies hollow and dashed', () => {
    mount(
      makeView({
        method: {
          ...makeView().method,
          assumptions: [makeAssumption({ id: 'free' }), makeAssumption({ id: 'set', value: 2.3, pinned: true, soft: true, sourceUrl: 'javascript:alert(1)' })],
        },
      }),
    );
    const [free, set] = Array.from(document.querySelectorAll<HTMLElement>('.sl'));
    expect(free?.classList.contains('is-set')).toBe(false);
    expect(set?.classList.contains('is-set')).toBe(true);
    expect(free?.querySelector('output')?.textContent).toBe('1.0 Wh');
    expect(set?.querySelector('output')?.textContent).toBe('2.3 Wh');
    expect(Array.from(free?.querySelectorAll('.sl-scale span') ?? [], n => n.textContent)).toEqual(['0.50 Wh', 'typical', '5.4 Wh']);
    expect(free?.querySelector('input')?.getAttribute('aria-valuetext')).toContain('Not set');
    expect(set?.querySelector('input')?.getAttribute('aria-valuetext')).toBe('2.3 Wh, set by you');
    // The source is a link only when its address is https. The date and the word "soft" are spelled out.
    expect(free?.querySelector('.sl-src a')?.getAttribute('href')).toBe('https://example.org/study');
    expect(set?.querySelector('.sl-src a')).toBeNull();
    expect(text('.sl:last-child .sl-src')).toBe('Source: A study. Checked 27 Sep 2026. Soft: there is little evidence behind this number so far.');
    expect(document.querySelector('[data-reset]')?.getAttribute('aria-disabled')).toBe('false');
  });

  it('places the thumb with positionOf and sends valueAt, both from track.ts', () => {
    const a = makeAssumption({ value: 2.3, pinned: true });
    const triple = [a.low, a.typical, a.high] as const;
    const store = mount(makeView({ method: { ...makeView().method, assumptions: [a] } }));
    const input = document.querySelector<HTMLInputElement>('.sl input');
    if (!input) throw new Error('no slider');
    const max = Number(input.max);
    expect(Number(input.value)).toBe(Math.round(positionOf(triple, 2.3) * max));
    expect(input.style.getPropertyValue('--p')).toBe(`${(positionOf(triple, 2.3) * 100).toFixed(2)}%`);

    input.value = String(max * 0.75);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = String(max * 0.25);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.actions).toEqual([
      { type: 'set-assumption', id: 'energy', value: valueAt(triple, 0.75), settled: false },
      { type: 'set-assumption', id: 'energy', value: valueAt(triple, 0.25), settled: false },
      { type: 'set-assumption', id: 'energy', value: valueAt(triple, 0.25), settled: true },
    ]);
    // The ends and the middle of the track are the low, the typical and the high value exactly.
    for (const [at, value] of [[0, a.low], [max / 2, a.typical], [max, a.high]] as const) {
      input.value = String(at);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      expect(store.actions.at(-1)).toEqual({ type: 'set-assumption', id: 'energy', value, settled: true });
    }
  });

  it('sends "Reset sliders" only when something is set', () => {
    const store = mount(makeView());
    const reset = document.querySelector<HTMLButtonElement>('[data-reset]');
    expect(reset?.textContent).toBe('Reset sliders');
    expect(reset?.getAttribute('aria-disabled')).toBe('true');
    reset?.click();
    expect(store.actions).toEqual([]);
    store.push(makeView({ method: { ...makeView().method, assumptions: [makeAssumption({ pinned: true, value: 2 })] } }));
    reset?.click();
    expect(store.actions).toEqual([{ type: 'reset-assumptions' }]);
  });
});

describe('the change chip', () => {
  const chips = () => Array.from(document.querySelectorAll<HTMLElement>('.dp-mid-label .delta, [data-pill-chip]'));
  const withMid = (mid: number, over: Parameters<typeof makeResult>[0] = {}) => makeView({ result: makeResult({ range: spread(mid * 0.4, mid, mid * 3.3), ...over }) });

  it('always equals massChange of the two printed middle estimates', () => {
    const mids = [9.8, 7.84, 6.26, 8.74, 9.8, 9.84, 9.76, 9.96, 9.94, 0.44, 0.449, 1234.4, 1230];
    const store = mount(withMid(mids[0] ?? 13));
    rest();
    for (const node of chips()) expect(node.classList.contains('is-on')).toBe(false);
    // The number the reader last saw standing still. A change that comes mid-count is measured from there.
    let atRest = mids[0] ?? 13;
    for (let i = 1; i < mids.length; i++) {
      const to = mids[i] ?? 0;
      store.push(withMid(to, { scaleMax: 5000 }));
      const expected = massChange(atRest, to, 'kg');
      for (const node of chips()) {
        expect(node.classList.contains('is-on')).toBe(expected !== null);
        if (expected !== null) expect(node.textContent).toBe(expected);
      }
      if (i % 2) {
        rest();
        atRest = to;
      }
    }
  });

  it('measures a second change from the number the reader last saw printed', () => {
    const store = mount(withMid(13));
    rest();
    store.push(withMid(11));
    vi.advanceTimersByTime(60);
    // Still on its way: 13 has not become 11 yet, so 11 was never seen.
    expect(text('[data-likely] [data-num]')).toBe('12');
    store.push(withMid(8.7));
    // The reader saw 13 become 8.7. A chip of −2.3 would describe a step nobody watched.
    expect(chips().map(n => n.textContent)).toEqual(['−4.3 kg', '−4.3 kg']);
    for (const node of chips()) expect(node.classList.contains('is-on')).toBe(true);
    rest();

    // There and back before the first number was printed: it ends where it began, so there is no chip and no ghost.
    store.push(withMid(10));
    vi.advanceTimersByTime(60);
    expect(text('[data-likely] [data-num]')).not.toBe('10');
    store.push(withMid(8.7));
    for (const node of chips()) expect(node.classList.contains('is-on')).toBe(false);
    expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(false);
    rest();

    // Once the count is over, the next change starts from the new number.
    store.push(withMid(10));
    expect(chips().map(n => n.textContent)).toEqual(['+1.3 kg', '+1.3 kg']);
  });

  it('starts from a number as soon as it is printed, before the count has run out', () => {
    const store = mount(withMid(19));
    rest();
    store.push(withMid(16));
    expect(chips().map(n => n.textContent)).toEqual(['−3 kg', '−3 kg']);
    // The count runs for 700 ms, and the printed number reaches 16 long before that.
    vi.advanceTimersByTime(400);
    expect(text('[data-likely] [data-num]')).toBe('16');
    store.push(withMid(13));
    // 16 stood on the page with its own chip. The step the reader now sees is 16 to 13, not 19 to 13.
    expect(chips().map(n => n.textContent)).toEqual(['−3 kg', '−3 kg']);
    for (const node of chips()) expect(node.classList.contains('is-on')).toBe(true);
    vi.advanceTimersByTime(400);
    expect(text('[data-likely] [data-num]')).toBe('13');
    // Back to the number before: that is a step too, and it gets its chip.
    store.push(withMid(16));
    expect(chips().map(n => n.textContent)).toEqual(['+3 kg', '+3 kg']);
    for (const node of chips()) expect(node.classList.contains('is-on')).toBe(true);
  });

  it('with reduced motion nothing counts, so every change starts from the number just shown', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
    try {
      const store = mount(withMid(13));
      store.push(withMid(11));
      vi.advanceTimersByTime(150);
      store.push(withMid(8.7));
      expect(chips().map(n => n.textContent)).toEqual(['−2.3 kg', '−2.3 kg']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows no chip, and clears the one before, when the printed number does not change', () => {
    const store = mount(withMid(13));
    store.push(withMid(11));
    expect(chips().map(n => n.textContent)).toEqual(['−2 kg', '−2 kg']);
    vi.advanceTimersByTime(800);
    for (const node of chips()) expect(node.classList.contains('is-on')).toBe(true);
    store.push(withMid(11.3));
    for (const node of chips()) expect(node.classList.contains('is-on')).toBe(false);
  });

  it('reads the earlier number in the unit it was shown in when the unit changes', () => {
    const store = mount(withMid(2.287));
    rest();
    expect(text('[data-likely]')).toBe('Middle estimate: 2.3 kg');
    store.push(withMid(0.358, { unit: 'g', scaleMax: 1 }));
    rest();
    expect(text('[data-likely]')).toBe('Middle estimate: 358 g');
    // 2.3 kg is 2,300 g on screen, whatever the hidden decimals were.
    expect(chips().map(n => n.textContent)).toEqual(['−1,942 g', '−1,942 g']);
  });

  it('uses the unit that is shown now', () => {
    const store = mount(withMid(1.2));
    store.push(withMid(0.3, { unit: 'g', scaleMax: 1 }));
    expect(massChange(1.2, 0.3, 'g')).toBe('−900 g');
    expect(chips().map(n => n.textContent)).toEqual(['−900 g', '−900 g']);
  });

  it('goes away by itself, and so does the ghost unless a tip is applied', () => {
    const store = mount(withMid(13));
    store.push(withMid(11));
    expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(true);
    rest();
    for (const node of chips()) expect(node.classList.contains('is-on')).toBe(false);
    expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(false);
    expect(document.querySelector('.band-ghost')?.classList.contains('is-on')).toBe(false);
  });

  it('counts the numbers across to their new value', () => {
    const store = mount(withMid(13));
    store.push(withMid(11));
    vi.advanceTimersByTime(60);
    const during = Number(text('[data-likely] [data-num]'));
    expect(during).toBeLessThan(13);
    expect(during).toBeGreaterThan(11);
    rest();
    expect(text('[data-likely] [data-num]')).toBe('11');
  });

  it('with reduced motion nothing counts, and the ghost and the chip still show', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
    try {
      const store = mount(withMid(13));
      store.push(withMid(11));
      expect(text('[data-likely] [data-num]')).toBe('11');
      expect(chips().map(n => n.textContent)).toEqual(['−2 kg', '−2 kg']);
      expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(true);
      // The ghost stays longer, to make up for the slide that did not happen.
      vi.advanceTimersByTime(2000);
      expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stays quiet while a slider is dragged and covers the whole move on release', () => {
    const a = makeAssumption();
    const at = (mid: number) => ({ ...withMid(mid), method: { ...makeView().method, assumptions: [a] } });
    loadPage();
    const store = fakeStore(at(13));
    // A store that answers every slider action at once, the way the real one does.
    const answers = [at(14), at(16), at(19), at(19)];
    store.dispatch = action => {
      store.actions.push(action);
      const next = answers.shift();
      if (next) store.push(next);
    };
    unmount = mountPage(store);
    const input = document.querySelector<HTMLInputElement>('.sl input');
    if (!input) throw new Error('no slider');

    for (const step of [120, 140, 160]) {
      input.value = String(step);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(document.body.classList.contains('is-dragging')).toBe(true);
      for (const node of chips()) expect(node.classList.contains('is-on')).toBe(false);
      expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(false);
    }
    // The page follows once a frame, and without counting: the number is there as soon as it is drawn.
    expect(text('[data-likely] [data-num]')).toBe('13');
    vi.advanceTimersByTime(20);
    expect(text('[data-likely] [data-num]')).toBe('19');

    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.body.classList.contains('is-dragging')).toBe(false);
    expect(chips().map(n => n.textContent)).toEqual(['+6 kg', '+6 kg']);
    expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(true);
    // Nothing was said while the thumb moved. The result is spoken once it has been still for a second.
    expect(text('[data-live]')).toBe('');
    vi.advanceTimersByTime(ANNOUNCE_MS);
    expect(text('[data-live]')).toBe('Estimate updated. Likely range 7.6 to 63 kilograms of CO2e, middle estimate 19.');
  });
});

describe('announcements and clean-up', () => {
  it('announces the new range once for each settled change', () => {
    const store = mount(makeView());
    expect(text('[data-live]')).toBe('');
    store.push(makeView({ result: makeResult({ range: spread(4, 11, 36) }) }));
    expect(text('[data-live]')).toBe('');
    vi.advanceTimersByTime(ANNOUNCE_MS);
    expect(text('[data-live]')).toBe('Estimate updated. Likely range 4 to 36 kilograms of CO2e, middle estimate 11.');
    store.push(makeView({ stage: 'steps', result: null }));
    store.push(makeView());
    expect(text('[data-live]')).toBe('Your result is in. Likely range 3.7 to 34 kilograms of CO2e, middle estimate 9.8.');
  });

  it('removes its listeners and timers when it is taken down', () => {
    const store = mount(makeView({ tips: [makeTip()] }));
    store.push(makeView({ tips: [makeTip()], result: makeResult({ range: spread(4, 11, 36) }) }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount?.();
    unmount = null;
    expect(vi.getTimerCount()).toBe(0);
    document.querySelector<HTMLElement>('.tip [data-switch]')?.click();
    document.querySelector<HTMLElement>('[data-reset]')?.click();
    expect(store.actions).toEqual([]);
    // The store no longer reaches the page either.
    store.push(makeView({ result: makeResult({ range: spread(1, 2, 3) }) }));
    expect(text('[data-likely] [data-num]')).not.toBe('2');
  });
});

describe('a slider that is let go without a change event', () => {
  const a = makeAssumption();
  const triple = [a.low, a.typical, a.high] as const;
  const at = (mid: number, assumptions = [a]): View => ({
    ...makeView({ result: makeResult({ range: spread(mid * 0.4, mid, mid * 3.3) }) }),
    method: { ...makeView().method, assumptions },
  });
  const chips = () => Array.from(document.querySelectorAll<HTMLElement>('.dp-mid-label .delta, [data-pill-chip]'));
  const dragging = () => document.body.classList.contains('is-dragging');
  const settledActions = (store: FakeStore) => store.actions.filter(action => action.type === 'set-assumption' && action.settled);

  /** A store that answers every action at once with the next of `views`. */
  function answering(views: View[]): FakeStore {
    loadPage();
    const store = fakeStore(at(13));
    store.dispatch = action => {
      store.actions.push(action);
      const next = views.shift();
      if (next) store.push(next);
    };
    unmount = mountPage(store);
    return store;
  }
  const slider = (): HTMLInputElement => {
    const input = document.querySelector<HTMLInputElement>('.sl input');
    if (!input) throw new Error('no slider');
    return input;
  };
  const drag = (input: HTMLInputElement, step: number) => {
    input.value = String(step);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('ends the drag when the thumb is let go where it started', () => {
    const store = answering([at(16), at(13), at(13)]);
    const input = slider();
    drag(input, 140);
    drag(input, 100);
    expect(dragging()).toBe(true);
    // Back at its starting point, the browser sends no change event. Lifting the pointer ends the move.
    input.dispatchEvent(new Event('pointerup', { bubbles: true }));
    vi.advanceTimersByTime(1);
    expect(dragging()).toBe(false);
    expect(store.actions.at(-1)).toEqual({ type: 'set-assumption', id: 'energy', value: a.typical, settled: true });
    expect(settledActions(store).length).toBe(1);

    // The slider is no longer held: the next View moves its thumb, and the page leaves its traces again.
    store.push(at(11, [makeAssumption({ value: 2.3, pinned: true })]));
    expect(Number(input.value)).toBe(Math.round(positionOf(triple, 2.3) * Number(input.max)));
    expect(chips().map(n => n.textContent)).toEqual(['−2 kg', '−2 kg']);
    store.push(at(11, [makeAssumption()]));
    expect(document.querySelector('.sl')?.classList.contains('is-set')).toBe(false);
  });

  it('settles once when the change event does follow the lifted pointer', () => {
    const store = answering([at(16), at(16)]);
    const input = slider();
    drag(input, 140);
    input.dispatchEvent(new Event('pointerup', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    vi.advanceTimersByTime(50);
    expect(settledActions(store).length).toBe(1);
    expect(chips().map(n => n.textContent)).toEqual(['+3 kg', '+3 kg']);
  });

  it('ends the drag when the slider loses the focus or the pointer', () => {
    for (const type of ['focusout', 'pointercancel']) {
      unmount?.();
      const store = answering([at(16), at(16)]);
      const input = slider();
      drag(input, 140);
      input.dispatchEvent(new Event(type, { bubbles: true }));
      vi.advanceTimersByTime(1);
      expect(dragging()).toBe(false);
      expect(settledActions(store).length).toBe(1);
    }
  });

  it('ends the drag when the slider leaves the page under the finger', () => {
    const store = answering([at(16)]);
    drag(slider(), 140);
    expect(dragging()).toBe(true);
    store.push(at(16, [makeAssumption({ id: 'another' })]));
    expect(dragging()).toBe(false);
    // The move is traced from where it began, like any other that came to rest.
    expect(chips().map(n => n.textContent)).toEqual(['+3 kg', '+3 kg']);
    store.push(at(16, [makeAssumption({ id: 'another', value: 2.3, pinned: true })]));
    expect(document.querySelector('.sl')?.classList.contains('is-set')).toBe(true);
  });

  it('covers the whole move when the store answers on a later turn', () => {
    loadPage();
    // This store only takes the actions in. Its Views come when the test hands them over.
    const store = fakeStore(at(13));
    unmount = mountPage(store);
    const input = slider();
    drag(input, 120);
    store.push(at(14));
    drag(input, 140);
    drag(input, 160);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(dragging()).toBe(false);
    expect(chips().map(n => n.textContent)).toEqual(['+1 kg', '+1 kg']);
    // The answers to the last two moves and to the release arrive late. They add to the same trace.
    vi.advanceTimersByTime(30);
    store.push(at(16));
    vi.advanceTimersByTime(30);
    store.push(at(19));
    store.push(at(19));
    expect(dragging()).toBe(false);
    expect(chips().map(n => n.textContent)).toEqual(['+6 kg', '+6 kg']);
    for (const node of chips()) expect(node.classList.contains('is-on')).toBe(true);
    expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(true);
    expect(text('[data-live]')).toBe('');
    vi.advanceTimersByTime(ANNOUNCE_MS);
    expect(text('[data-live]')).toBe('Estimate updated. Likely range 7.6 to 63 kilograms of CO2e, middle estimate 19.');
  });

  it('speaks the estimate once after a run of arrow keys, and keeps the readout quiet', () => {
    const store = answering([]);
    const said: string[] = [];
    const live = document.querySelector('[data-live]');
    if (!live) throw new Error('no live region');
    new MutationObserver(() => said.push(live.textContent ?? '')).observe(live, { childList: true, characterData: true, subtree: true });
    for (const mid of [14, 15, 16, 17, 18]) {
      store.push(at(mid));
      vi.advanceTimersByTime(140);
      expect(text('[data-live]')).toBe('');
    }
    vi.advanceTimersByTime(ANNOUNCE_MS);
    expect(text('[data-live]')).toBe('Estimate updated. Likely range 7.2 to 59 kilograms of CO2e, middle estimate 18.');
    expect(document.querySelector('.sl output')?.getAttribute('aria-live')).toBe('off');
  });
});

describe('what the method card prints', () => {
  it('prints a slider that stands for several values part by part, and moves them together', () => {
    const energy = makeAssumption({
      parts: [
        { label: 'large', low: 0.5, typical: 1, high: 5.4, value: 1, decimals: 1 },
        { label: 'medium', low: 0.3, typical: 0.6, high: 2.4, value: 0.6, decimals: 1 },
      ],
      note: 'This changes little for your data.',
    });
    const store = mount(makeView({ method: { ...makeView().method, assumptions: [energy, makeAssumption({ id: 'plain' })] } }));
    expect(text('.sl output')).toBe('large 1.0 Wh · medium 0.60 Wh');
    expect(text('.sl .sl-note')).toBe('This changes little for your data.');
    expect(shown('.sl:last-child .sl-note')).toBe(false);
    const input = document.querySelector<HTMLInputElement>('.sl input');
    if (!input) throw new Error('no slider');
    input.value = input.max;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(text('.sl output')).toBe('large 5.4 Wh · medium 2.4 Wh');
    expect(store.actions.at(-1)).toEqual({ type: 'set-assumption', id: 'energy', value: 5.4, settled: false });
  });

  it('leaves out "Checked" when the source has no date', () => {
    mount(makeView({ method: { ...makeView().method, assumptions: [makeAssumption({ checked: '', sourceUrl: null })] } }));
    expect(text('.sl-src')).toBe('Source: A study.');
  });

  it('gives the extreme range and the whole history their own units', () => {
    mount(
      makeView({
        result: makeResult({ unit: 'g', range: spread(0.312, 0.5, 0.733), scaleMax: 1, sourceName: 'ChatGPT', history: { range: spread(7.632, 11, 16.194), since: 'March 2023' } }),
        method: { ...makeView().method, unit: 'g', extreme: { low: 0.067, high: 7.284 } },
      }),
    );
    expect(seen('[data-history]')).toBe('Your whole ChatGPT history, since March 2023: 7.6–16 kg.');
    expect(spoken('[data-history]')).toBe('Your whole ChatGPT history, since March 2023: 7.6 to 16 kilograms.');
    expect(text('[data-extreme]')).toBe('Every low or every high assumption combined: 67 g to 7.3 kg');
  });

  it('says "about" when the two ends of either print the same', () => {
    mount(
      makeView({
        result: makeResult({ history: { range: spread(41.8, 42, 42.2), since: 'March 2023' } }),
        method: { ...makeView().method, extreme: { low: 12.1, high: 12.3 } },
      }),
    );
    expect(text('[data-history]')).toBe('Your whole Claude Code history, since March 2023: about 42 kg.');
    expect(text('[data-extreme]')).toBe('Every low or every high assumption combined: about 12 kg');
  });
});

describe('the tip bars', () => {
  it('calls the first bar "Now" only while it is the range on screen', () => {
    const before = spread(3.7, 9.8, 34);
    const tip = makeTip({ now: before, after: spread(2.9, 7.9, 27) });
    const store = mount(makeView({ tips: [tip] }));
    expect(text('.tip .tv-label')).toBe('Now');
    // A tip is applied: the result moved on, and the tip's first bar still starts without tips.
    store.push(makeView({ tips: [{ ...tip, applied: true }], result: makeResult({ range: spread(2.9, 7.9, 27), baseline: before, appliedLabel: 'With: Smaller' }) }));
    expect(text('.tip .tv-label')).toBe('Without tips');
    expect(document.querySelector('.tip .tv')?.getAttribute('aria-label')).toBe('Without tips: 3.7 to 34 kilograms. Smaller: 2.9 to 27 kilograms.');
    // A store that sends the range as shown keeps the word "Now".
    store.push(makeView({ tips: [{ ...tip, applied: true, now: spread(2.9, 7.9, 27) }], result: makeResult({ range: spread(2.9, 7.9, 27), baseline: before, appliedLabel: 'With: Smaller' }) }));
    expect(text('.tip .tv-label')).toBe('Now');
  });
});

describe('the chart', () => {
  it('numbers its dots for the wave and leaves the delay to the styles', () => {
    mount(makeView());
    const dots = Array.from(document.querySelectorAll<HTMLElement>('.dp-dot'));
    expect(dots[0]?.style.getPropertyValue('--i')).toBe('0');
    expect(dots[99]?.style.getPropertyValue('--i')).toBe('99');
    // An inline delay could not be switched off while a slider is dragged.
    for (const dot of dots) expect(dot.style.transitionDelay).toBe('');
  });

  it('measures its labels while the numbers show their final values', () => {
    const measured: string[] = [];
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        if (this.classList.contains('dp-bracket-label')) measured.push(text('.dp-bracket-label'));
        return 0;
      },
    });
    try {
      const store = mount(makeView({ result: makeResult({ range: spread(3.8, 9.5, 31) }) }));
      rest();
      measured.length = 0;
      store.push(makeView({ result: makeResult({ range: spread(4, 10, 33) }) }));
      expect(measured.at(-1)).toBe('90 of 100 land here: 4–33 kg');
      // The count itself still starts from the old number.
      expect(text('[data-likely] [data-num]')).toBe('9.5');
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', original);
    }
  });

  it('draws nothing for a scale without length', () => {
    const store = mount(makeView());
    const mid = document.querySelector<HTMLElement>('.dp-mid');
    const pin = document.querySelector<HTMLElement>('.band-pin');
    const before = [mid?.style.transform, pin?.style.left];
    for (const scaleMax of [0, Number.NaN]) {
      store.push(makeView({ result: makeResult({ scaleMax, range: spread(1, 2, 3) }) }));
      expect([mid?.style.transform, pin?.style.left]).toEqual(before);
    }
    expect(document.querySelector('.dp')?.innerHTML).not.toContain('NaN');
    expect(document.querySelector('[data-pill-band]')?.innerHTML).not.toContain('NaN');
  });
});

describe('your data', () => {
  const waiting = { state: 'waiting' } as const;
  const steps = (source: 'claude-code' | 'chatgpt', over: Partial<View['data']> = {}): View =>
    makeView({ stage: 'steps', source, result: null, data: { claudeCode: { prompt: 'Count my tokens.', answer: '', status: waiting }, chatgpt: { status: waiting }, ...over } });
  const ok = (headline: string, tokens = 12_000_000): View['data']['claudeCode']['status'] => ({
    state: 'ok', headline, confirmation: 'The numbers add up and look plausible.', models: [{ name: 'Opus 5.5', tokens, share: 1 }], notes: [],
  });
  const done = (answer: string, headline: string, tokens?: number): View =>
    makeView({ data: { claudeCode: { prompt: 'Count my tokens.', answer, status: ok(headline, tokens) }, chatgpt: { status: waiting } } });
  const node = <T extends HTMLElement>(selector: string): T => {
    const found = document.querySelector<T>(selector);
    if (!found) throw new Error(`nothing matches ${selector}`);
    return found;
  };
  const type = (value: string) => {
    const box = node<HTMLTextAreaElement>('[data-answer]');
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const reading = (done: number, total: number | null = 1284): View =>
    steps('chatgpt', { chatgpt: { status: { state: 'reading', done, total, text: `${done} of 1,284 conversations.` } } });

  it('sends the choice, moves the focus to the tool’s name and sends the switch', () => {
    const first = makeView({ stage: 'choose', source: null, result: null, data: steps('chatgpt').data });
    const store = mount(first);
    const card = node('[data-choose-source="chatgpt"]');
    card.focus();
    card.click();
    expect(store.actions).toEqual([{ type: 'choose-source', source: 'chatgpt' }]);
    store.push(steps('chatgpt'));
    expect(document.activeElement).toBe(node('[data-chosen-name]'));
    expect(text('[data-chosen-name]')).toBe('ChatGPT');
    expect(shown('[data-tool="chatgpt"]')).toBe(true);
    expect(shown('[data-tool="claude-code"]')).toBe(false);
    expect(text('.notes')).not.toContain('From Claude Code');
    node('[data-switch-source]').click();
    expect(store.actions.at(-1)).toEqual({ type: 'switch-source' });
    store.push(steps('claude-code'));
    expect(text('[data-switch-source]')).toBe('Switch to ChatGPT');
    expect(text('.notes')).not.toContain('From ChatGPT');
  });

  it('sends what is typed in the paste box once, after a short pause', () => {
    const store = mount(steps('claude-code'));
    type('ai');
    vi.advanceTimersByTime(60);
    type('ai-co2 v1');
    vi.advanceTimersByTime(119);
    expect(store.actions).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(store.actions).toEqual([{ type: 'set-answer', text: 'ai-co2 v1' }]);
  });

  it('does not send a pending paste after the tool was switched', () => {
    const store = mount(steps('claude-code'));
    type('ai-co2 v1 | 2026-08-30 to 2026-09-29');
    node('[data-switch-source]').click();
    vi.advanceTimersByTime(1000);
    expect(store.actions).toEqual([{ type: 'switch-source' }]);

    // The same when the tool changes without the button, for a store that switches by itself.
    store.push(steps('claude-code'));
    type('ai-co2 v1');
    store.push(steps('chatgpt'));
    vi.advanceTimersByTime(1000);
    expect(store.actions).toEqual([{ type: 'switch-source' }]);
    // Back on Claude Code the box shows what the View holds, not what was left behind.
    store.push(steps('claude-code'));
    expect(node<HTMLTextAreaElement>('[data-answer]').value).toBe('');
  });

  it('leaves the box alone while the person types, and takes an answer that comes from the View', () => {
    const store = mount(steps('claude-code'));
    type('ai-co2 v1 | 2026');
    vi.advanceTimersByTime(200);
    type('ai-co2 v1 | 2026-08');
    // The View still holds the text sent a moment ago. It must not overwrite the newer typing.
    store.push(steps('claude-code', { claudeCode: { prompt: 'p', answer: 'ai-co2 v1 | 2026', status: { state: 'problem', message: 'Not the whole answer yet.' } } }));
    expect(node<HTMLTextAreaElement>('[data-answer]').value).toBe('ai-co2 v1 | 2026-08');
    expect(text('[data-answer-msg]')).toBe('Not the whole answer yet.');
    expect(node('[data-answer]').getAttribute('aria-invalid')).toBe('true');
    store.push(steps('claude-code', { claudeCode: { prompt: 'p', answer: 'from elsewhere', status: waiting } }));
    expect(node<HTMLTextAreaElement>('[data-answer]').value).toBe('from elsewhere');
    // No problem, no message. What the box is for stands above it, as fixed text.
    expect(text('[data-answer-msg]')).toBe('');
    expect(node('[data-answer]').getAttribute('aria-invalid')).toBe('false');
    expect(text('#answer-hint')).toBe('Copy Claude’s whole reply. The page reads it here in your browser and checks that the numbers add up. Nothing is uploaded.');
  });

  it('folds the steps each time a good answer is in, also the second time', () => {
    const store = mount(steps('claude-code'));
    expect(shown('#cc-steps')).toBe(true);
    expect(shown('[data-tool="claude-code"] [data-redo]')).toBe(false);
    node('[data-answer]').focus();
    store.push(done('one', '1 model · 12 million tokens · 30 Aug – 29 Sep'));
    expect(shown('#cc-steps')).toBe(false);
    const redo = node('[data-tool="claude-code"] [data-redo]');
    // The box that held the focus is folded away, so the button that opens it again takes it.
    expect(document.activeElement).toBe(redo);
    expect(redo.getAttribute('aria-expanded')).toBe('false');
    redo.click();
    expect(shown('#cc-steps')).toBe(true);
    expect(redo.getAttribute('aria-expanded')).toBe('true');
    // A change elsewhere on the page leaves the opened steps open.
    store.push({ ...done('one', '1 model · 12 million tokens · 30 Aug – 29 Sep'), result: makeResult({ range: spread(4, 11, 36) }) });
    expect(shown('#cc-steps')).toBe(true);
    store.push(done('two', '1 model · 14 million tokens · 30 Aug – 29 Sep', 14_000_000));
    expect(shown('#cc-steps')).toBe(false);
  });

  it('shows the confirmation the View sends, and none of its own', () => {
    const store = mount(done('one', '1 model · 12 million tokens'));
    expect(text('.sum-line')).toBe('The numbers add up and look plausible.');
    const silent = done('one', '1 model · 12 million tokens');
    if (silent.data.claudeCode.status.state === 'ok') silent.data.claudeCode.status.confirmation = '';
    store.push(silent);
    expect(document.querySelector('.sum-line')).toBeNull();
    expect(text('.models tbody th')).toBe('Opus 5.5');
  });

  it('shows the first models of a long list and says how many more there are', () => {
    const models = Array.from({ length: 2000 }, (_, i) => ({ name: `model-${i}`, tokens: 1000, share: 1 / 2000 }));
    mount(makeView({ data: { claudeCode: { prompt: 'p', answer: '', status: { state: 'ok', headline: '2,000 models', confirmation: '', models, notes: [] } }, chatgpt: { status: waiting } } }));
    const rows = Array.from(document.querySelectorAll('.models tbody tr'));
    expect(rows.length).toBe(MODEL_ROWS + 1);
    expect(rows.at(-1)?.textContent).toBe(`and ${(2000 - MODEL_ROWS).toLocaleString('en')} more models`);
    expect(text('.models tbody tr:first-child .share .num')).toBe('<1%');
  });

  it('copies the prompt, says so out of sight, and goes back to "Copy prompt"', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      mount(steps('claude-code'));
      node('[data-copy]').click();
      await vi.advanceTimersByTimeAsync(0);
      expect(writeText).toHaveBeenCalledWith('Count my tokens.');
      expect(text('[data-copy-label]')).toBe('Copied');
      const said = node('[data-copy-msg]');
      expect(said.getAttribute('role')).toBe('status');
      expect(said.textContent).toBe('Prompt copied.');
      expect(said.classList.contains('sr')).toBe(true);
      await vi.advanceTimersByTimeAsync(COPIED_MS);
      expect(text('[data-copy-label]')).toBe('Copy prompt');
      expect(said.textContent).toBe('');
      expect(said.classList.contains('sr')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens the whole prompt and says what to do when the browser refuses to copy', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => Promise.reject(new Error('denied')) } });
    try {
      mount(steps('claude-code'));
      node('[data-copy]').click();
      await vi.advanceTimersByTimeAsync(0);
      const said = node('[data-copy-msg]');
      expect(said.textContent).toBe('Your browser didn’t allow copying. Select the prompt above and copy it by hand.');
      expect(said.classList.contains('sr')).toBe(false);
      expect(text('[data-copy-label]')).toBe('Copy prompt');
      expect(node('[data-prompt]').classList.contains('is-open')).toBe(true);
      expect(node('[data-expand]').getAttribute('aria-expanded')).toBe('true');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens and folds the prompt with "Show all"', () => {
    mount(steps('claude-code'));
    const button = node('[data-expand]');
    button.click();
    expect(node('[data-prompt]').classList.contains('is-open')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent).toBe('Show less');
    button.click();
    expect(node('[data-prompt]').classList.contains('is-open')).toBe(false);
    expect(button.textContent).toBe('Show all');
  });

  const dragEvent = (name: string, types: string[], files: File[] = []) => {
    const event = new Event(name, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files, types } });
    return event;
  };

  it('sends dropped and chosen files, and clears the field for the next choice', () => {
    const store = mount(steps('chatgpt'));
    const drop = node('[data-drop]');
    const files = [new File(['x'], 'export-1.zip'), new File(['y'], 'export-2.zip')];
    const over = dragEvent('dragover', ['Files']);
    drop.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(drop.classList.contains('is-over')).toBe(true);
    drop.dispatchEvent(dragEvent('drop', ['Files'], files));
    expect(drop.classList.contains('is-over')).toBe(false);
    expect(store.actions).toEqual([{ type: 'add-files', files }]);

    const field = node<HTMLInputElement>('[data-file]');
    Object.defineProperty(field, 'files', { configurable: true, value: [files[0]] });
    let cleared = false;
    Object.defineProperty(field, 'value', { configurable: true, get: () => '', set: () => { cleared = true; } });
    field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.actions.at(-1)).toEqual({ type: 'add-files', files: [files[0]] });
    expect(cleared).toBe(true);
  });

  it('reacts to dragged files only, and keeps a file that misses the zone from opening', () => {
    const store = mount(steps('chatgpt'));
    const drop = node('[data-drop]');
    // Dragged text is the browser's business.
    const words = dragEvent('dragover', ['text/plain']);
    drop.dispatchEvent(words);
    expect(words.defaultPrevented).toBe(false);
    expect(drop.classList.contains('is-over')).toBe(false);
    drop.dispatchEvent(dragEvent('drop', ['text/plain']));
    expect(store.actions).toEqual([]);

    const missed = dragEvent('drop', ['Files'], [new File(['x'], 'export.zip')]);
    document.body.dispatchEvent(missed);
    expect(missed.defaultPrevented).toBe(true);
    expect(store.actions).toEqual([]);
    const text = dragEvent('drop', ['text/plain']);
    document.body.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
  });

  it('shows the reading with a bar that fills, and one that travels while the size is unknown', () => {
    const store = mount(steps('chatgpt'));
    store.push(reading(0, null));
    const bar = node('[data-progress-bar]');
    expect(shown('[data-progress]')).toBe(true);
    expect(shown('[data-drop]')).toBe(false);
    expect(bar.classList.contains('is-open-ended')).toBe(true);
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    store.push(reading(321));
    expect(bar.classList.contains('is-open-ended')).toBe(false);
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(node('[data-progress-fill]').style.getPropertyValue('--done')).toBe('25.0%');
    expect(text('[data-progress-text]')).toBe('321 of 1,284 conversations.');
    expect(text('[data-tool="chatgpt"] [data-status]')).toBe('ReadingReading your export');
  });

  it('keeps the focus on the page when a file is given by keyboard', () => {
    const store = mount(steps('chatgpt'));
    const field = node<HTMLInputElement>('[data-file]');
    field.focus();
    store.push(reading(0));
    // The file field is out of sight while the export is read. The bar takes the focus, and says what goes on.
    const bar = node('[data-progress-bar]');
    expect(document.activeElement).toBe(bar);
    expect(bar.getAttribute('tabindex')).toBe('-1');
    expect(text('[data-live]')).toBe('Reading your export.');
    store.push(reading(600));
    expect(document.activeElement).toBe(bar);
    store.push(makeView({ source: 'chatgpt', data: { claudeCode: { prompt: 'p', answer: '', status: waiting }, chatgpt: { status: { state: 'ok', headline: '1,284 conversations', confirmation: 'Your export was read in this tab.', models: [], notes: [] } } } }));
    expect(document.activeElement).toBe(node('[data-tool="chatgpt"] [data-redo]'));
  });

  it('hands the focus back to the file field and says so when the reading fails', () => {
    const store = mount(steps('chatgpt'));
    const message = node('[data-drop-msg]');
    // The message describes the file field. It is no live region itself: the status line speaks it, once.
    expect(message.hasAttribute('hidden')).toBe(false);
    expect(message.hasAttribute('aria-live')).toBe(false);
    expect(node('[data-file]').getAttribute('aria-describedby')).toBe(message.id);
    expect(message.textContent?.trim()).toBe('');
    node('[data-file]').focus();
    store.push(reading(100));
    store.push(steps('chatgpt', { chatgpt: { status: { state: 'problem', message: 'This file isn’t a ChatGPT export.' } } }));
    expect(document.activeElement).toBe(node('[data-file]'));
    expect(text('[data-drop-msg]')).toBe('This file isn’t a ChatGPT export.');
    expect(node('[data-drop]').classList.contains('is-bad')).toBe(true);
    expect(text('[data-live]')).toBe('This export gave no result. This file isn’t a ChatGPT export.');
    // A focus that was somewhere else stays where it was.
    const elsewhere = node('[data-switch-source]');
    elsewhere.focus();
    store.push(reading(100));
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('the pinned pill', () => {
  function mountAt(view: View, bottom: { value: number }): FakeStore {
    loadPage();
    const panel = document.querySelector<HTMLElement>('[data-result]');
    if (!panel) throw new Error('no panel');
    // The test page has no layout. The panel's place on screen is whatever the test says it is.
    panel.getBoundingClientRect = () => ({ bottom: bottom.value, top: bottom.value - 500, left: 0, right: 0, width: 0, height: 500, x: 0, y: 0, toJSON: () => ({}) });
    panel.scrollIntoView = () => {
      bottom.value = 600;
    };
    const store = fakeStore(view);
    unmount = mountPage(store);
    return store;
  }
  const scroll = () => {
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
  };
  const pin = () => document.querySelector<HTMLElement>('[data-pill]');
  const isOn = () => pin()?.classList.contains('is-on') ?? false;

  it('comes once the panel has scrolled away, and goes when it is back', () => {
    const bottom = { value: 600 };
    mountAt(makeView(), bottom);
    expect(isOn()).toBe(false);
    expect(pin()?.hasAttribute('inert')).toBe(true);
    bottom.value = -40;
    scroll();
    expect(isOn()).toBe(true);
    expect(pin()?.hasAttribute('inert')).toBe(false);
    bottom.value = 600;
    scroll();
    expect(isOn()).toBe(false);
    expect(pin()?.hasAttribute('inert')).toBe(true);
  });

  it('never shows without a result, and goes with it', () => {
    const bottom = { value: -40 };
    const store = mountAt(makeView(), bottom);
    expect(isOn()).toBe(true);
    store.push(makeView({ stage: 'steps', result: null }));
    expect(isOn()).toBe(false);
    scroll();
    expect(isOn()).toBe(false);
  });

  it('sends the reader back to the result, which takes the focus under its own name', () => {
    const bottom = { value: -40 };
    mountAt(makeView(), bottom);
    const button = document.querySelector<HTMLElement>('[data-to-result]');
    const panel = document.querySelector<HTMLElement>('[data-result]');
    button?.focus();
    button?.click();
    expect(document.activeElement).toBe(panel);
    expect(panel?.getAttribute('role')).toBe('group');
    // Its own name: the chapter around it is already called "Your result".
    expect(panel?.getAttribute('aria-label')).toBe('Your estimate');
    scroll();
    expect(isOn()).toBe(false);
  });

  it('hands its focus to the panel when it goes while its button is focused', () => {
    const bottom = { value: -40 };
    mountAt(makeView(), bottom);
    document.querySelector<HTMLElement>('[data-to-result]')?.focus();
    bottom.value = 600;
    scroll();
    expect(isOn()).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('[data-result]'));
  });
});

describe('what the page is made of', () => {
  it('keeps both header links reachable where the header hides them, and names no block by its caption', () => {
    mount(makeView());
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('footer a'), a => a.getAttribute('href'));
    expect(links).toEqual(['#how', 'https://github.com/squaloo-studio/ai-co2']);
    expect(document.querySelectorAll('figure, figcaption').length).toBe(0);
    expect(document.querySelector('[data-file]')?.closest('label')?.textContent).not.toMatch(/click/i);
  });

  it('holds no example label of its own: only the example store adds them', () => {
    mount(makeView());
    expect(document.querySelectorAll('[data-example]').length).toBe(0);
    expect(document.body.textContent).not.toMatch(/example (data|figures)/i);
    // Without a tag to show, the tags row is marked empty and never hidden itself.
    const tags = document.querySelector('[data-tags]');
    expect(tags?.classList.contains('is-empty')).toBe(true);
    expect(tags?.hasAttribute('hidden')).toBe(false);
  });
});

describe('what the finished contract carries', () => {
  const ticks = () => Array.from(document.querySelectorAll('.dp .tick em'), em => em.textContent);

  it('prints a model’s share with percent(), and keeps its name apart from the numbers', () => {
    mount(
      makeView({
        data: {
          claudeCode: {
            prompt: 'p', answer: '',
            status: { state: 'ok', headline: '2 models', confirmation: 'The numbers add up and look plausible.', models: [{ name: 'Opus 5.5', tokens: 576_263_273, share: 0.8249 }, { name: 'Haiku 4.5', tokens: 21_415_968, share: 0.1751 }], notes: [] },
          },
          chatgpt: { status: { state: 'waiting' } },
        },
      }),
    );
    expect(Array.from(document.querySelectorAll('.models .share .num'), n => n.textContent)).toEqual(['82%', '18%']);
    expect(Array.from(document.querySelectorAll('.models .c-tokens.num'), n => n.textContent)).toEqual(['576 million', '21.4 million']);
    expect(document.querySelector('.models tbody th bdi')?.textContent).toBe('Opus 5.5');
    expect(text('.sum-line')).toBe('The numbers add up and look plausible.');
  });

  it('prints slider values with assumptionValue(), so a small weight keeps two digits', () => {
    mount(
      makeView({
        method: {
          ...makeView().method,
          assumptions: [
            makeAssumption({ id: 'cacheRead', unit: '', decimals: 2, low: 0.001, typical: 0.015, high: 0.1, value: 0.015 }),
            makeAssumption({ id: 'hardware', unit: '', decimals: 3, low: 1.1, typical: 1.115, high: 1.13, value: 1.115 }),
            makeAssumption({ id: 'grid', unit: ' g/kWh', decimals: 0, low: 270, typical: 350, high: 460, value: 350, note: 'This changes nothing for your data.' }),
          ],
        },
      }),
    );
    const scale = (id: string) => Array.from(document.querySelectorAll(`[data-assumption="${id}"] .sl-scale span`), n => n.textContent);
    expect(scale('cacheRead')).toEqual(['0.0010', 'typical', '0.10']);
    expect(text('[data-assumption="cacheRead"] output')).toBe('0.015');
    expect(scale('hardware')).toEqual(['1.100', 'typical', '1.130']);
    expect(scale('grid')).toEqual(['270 g/kWh', 'typical', '460 g/kWh']);
    // The remark about this person's data stands with the slider, and is part of what the slider says of itself.
    expect(text('[data-assumption="grid"] .sl-note')).toBe('This changes nothing for your data.');
    const input = document.querySelector('[data-assumption="grid"] input');
    expect(input?.getAttribute('aria-describedby')).toContain(document.querySelector('[data-assumption="grid"] .sl-note')?.id);
    expect(shown('[data-assumption="hardware"] .sl-note')).toBe(false);
  });

  it('draws the footnote from its parts, as text', () => {
    mount(
      makeView({
        contribute: {
          costSentence: 'Each option shows below what it would cost for 3.7–34 kg of CO₂, the size of your estimate.',
          options: [],
          footnote: [{ strong: '<b>Prices</b> were checked on 7 Oct 2026.' }, ' ai-co2 gets <i>nothing</i> from them.'],
        },
      }),
    );
    expect(document.querySelector('[data-footnote] b, [data-footnote] i')).toBeNull();
    expect(text('[data-footnote] strong')).toBe('<b>Prices</b> were checked on 7 Oct 2026.');
    expect(text('[data-footnote]')).toBe('<b>Prices</b> were checked on 7 Oct 2026. ai-co2 gets <i>nothing</i> from them.');
    expect(text('[data-cost]')).toBe('Each option shows below what it would cost for 3.7–34 kg of CO₂, the size of your estimate.');
  });

  it('shows "Stop reading" while an export is read, and sends cancel-read', () => {
    const waiting = { state: 'waiting' } as const;
    const gpt = (status: View['data']['chatgpt']['status']): View =>
      makeView({ stage: status.state === 'reading' ? 'loading' : 'steps', source: 'chatgpt', result: null, data: { claudeCode: { prompt: 'p', answer: '', status: waiting }, chatgpt: { status } } });
    const store = mount(gpt(waiting));
    expect(shown('[data-cancel-read]')).toBe(false);
    store.push(gpt({ state: 'reading', done: 10, total: 100, text: 'Reading your export in this tab: 12 conversations so far. Large exports can take a minute.' }));
    const button = document.querySelector<HTMLButtonElement>('[data-cancel-read]');
    expect(shown('[data-cancel-read]')).toBe(true);
    expect(button?.textContent).toBe('Stop reading');
    // The two lines under the steps go with the steps.
    expect(shown('[data-step-notes]')).toBe(false);
    button?.focus();
    button?.click();
    expect(store.actions).toEqual([{ type: 'cancel-read' }]);
    // Back at the steps the button is gone, and the focus it held goes to the file field.
    store.push(gpt(waiting));
    expect(shown('[data-cancel-read]')).toBe(false);
    expect(shown('[data-step-notes]')).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[data-file]'));
    expect(document.querySelector('[data-file]')?.getAttribute('aria-invalid')).toBe('false');
  });

  it('draws the place beside the car figure and its road, with the car at the person’s distance', () => {
    const carOnRoad = (): HTMLElement => document.querySelector<HTMLElement>('[data-road-car]') ?? document.createElement('div');
    const store = mount(makeView({ result: makeResult({ car: spread(23, 61, 210), carPlace: { text: ['About ', { strong: 'the drive from Munich to Augsburg' }, ' (66 km).'], road: { from: 'Munich', to: 'Augsburg', km: 66 }, beyond: false } }) }));
    expect(text('.car-place')).toBe('About the drive from Munich to Augsburg (66 km).');
    expect(document.querySelector('.car-place strong')?.textContent).toBe('the drive from Munich to Augsburg');
    expect(shown('[data-road]')).toBe(true);
    expect(text('[data-road-from]')).toBe('Munich');
    expect(text('[data-road-to]')).toBe('Augsburg');
    // The road runs 6% past the farther of the two ends: 66 km here, so the car stops at 61 of 66 × 1.06.
    expect(carOnRoad().style.left).toBe(`${((61 / (66 * 1.06)) * 100).toFixed(2)}%`);
    // Past the longest drive the car waits at the end of that road.
    store.push(makeView({ result: makeResult({ car: spread(3000, 7500, 20000), carPlace: { text: ['Farther than ', { strong: 'the drive from Tarifa to the North Cape' }, ' (5,670 km). About 2% of the way to the Moon.'], road: { from: 'Tarifa', to: 'the North Cape', km: 5674 }, beyond: true } }) }));
    expect(text('.car-place')).toBe('Farther than the drive from Tarifa to the North Cape (5,670 km). About 2% of the way to the Moon.');
    expect(carOnRoad().style.left).toBe(`${(100 / 1.06).toFixed(2)}%`);
    // A fixed length has no start town.
    store.push(makeView({ result: makeResult({ car: spread(0.01, 0.024, 0.07), carPlace: { text: ['About ', { strong: 'the length of a tennis court' }, ' (24 m).'], road: { from: null, to: 'Tennis court', km: 0.02377 }, beyond: false } }) }));
    expect(text('[data-road-from]')).toBe('start');
    // No place near enough: no sentence and no road.
    store.push(makeView({ result: makeResult({ carPlace: null }) }));
    expect(shown('.car-place')).toBe(false);
    expect(shown('[data-road]')).toBe(false);
  });

  it('leaves the car line out when the far end is under one metre', () => {
    const store = mount(makeView({ result: makeResult({ unit: 'mg', range: spread(0.00001, 0.00004, 0.00015), scaleMax: 0.0002, car: spread(0.00006, 0.00025, 0.00094) }) }));
    expect(shown('.car')).toBe(false);
    // One metre and more is a distance again.
    store.push(makeView({ result: makeResult({ unit: 'mg', range: spread(0.00001, 0.00004, 0.00017), scaleMax: 0.0002, car: spread(0.00006, 0.00025, 0.00106) }) }));
    rest();
    expect(shown('.car')).toBe(true);
    expect(seen('.car')).toBe('Like driving a new petrol car 0.25 m Likely 0.06–1.1 m.');
  });

  it('says "about" once in the car line and in a tip’s bars when their two ends print the same', () => {
    mount(
      makeView({
        result: makeResult({ range: spread(21.8, 23, 26), car: spread(136, 140, 144) }),
        tips: [makeTip({ now: spread(22.6, 23, 23.4), after: spread(18, 20, 22) })],
      }),
    );
    expect(text('.car')).toBe('Like driving a new petrol car 140 km');
    expect(shown('[data-car-range]')).toBe(false);
    expect(text('[data-values="now"]')).toBe('about 23 kg');
    expect(text('[data-values="after"]')).toBe('18–22 kg');
    // The spoken form says the same as the printed one, in words.
    expect(document.querySelector('.tip .tv')?.getAttribute('aria-label')).toBe('Now: about 23 kilograms. Smaller: 18 to 22 kilograms.');
  });

  it('gives one outcome its own sentence in place of the middle estimate, and "about" in every line', () => {
    const one = spread(8.6, 8.6, 8.6);
    mount(
      makeView({
        result: makeResult({
          single: true, range: one, quantiles: Array.from({ length: 100 }, () => 8.6), sourceName: 'ChatGPT',
          car: spread(53.75, 53.75, 53.75), history: { range: spread(42, 42, 42), since: 'March 2023' },
        }),
        method: { ...makeView().method, extreme: null },
      }),
    );
    expect(text('[data-one-note]')).toBe('You have set every assumption that changes your result, so there is one outcome and no range. Reset the sliders to see the range again.');
    expect(shown('[data-likely]')).toBe(false);
    expect(text('.car')).toBe('Like driving a new petrol car 54 km');
    expect(shown('[data-car-range]')).toBe(false);
    expect(text('[data-history]')).toBe('Your whole ChatGPT history, since March 2023: about 42 kg.');
    expect(text('[data-chart-caption]')).toBe('How to read it. Each dot is one possible outcome out of 100. Nothing in your estimate varies any more, so all 100 land on the same value. The line marks it.');
    expect(shown('[data-extreme]')).toBe(false);
    expect(text('.pill-range')).toBe('about 8.6kg');
  });

  it('hides the sentence for one outcome while there is a range', () => {
    mount(makeView());
    expect(shown('[data-one-note]')).toBe(false);
    expect(text('[data-likely]')).toBe('Middle estimate: 9.8 kg');
  });

  it('says "under 1 mg" in place of the number and the chart when the range ends below a milligram', () => {
    const tiny = spread(0.0000001, 0.0000003, 0.0000008);
    const store = mount(makeView({ result: makeResult({ unit: 'mg', range: tiny, scaleMax: 0.000001, car: spread(0.0000006, 0.000002, 0.000005) }) }));
    expect(text('[data-range]')).toBe('under 1 mg');
    expect(shown('[data-chart]')).toBe(false);
    expect(shown('[data-chart-caption]')).toBe(false);
    expect(shown('[data-likely]')).toBe(false);
    expect(shown('.car')).toBe(false);
    expect(text('.pill-range')).toBe('under 1 mg');
    expect(shown('[data-pill-band]')).toBe(false);
    expect(text('[data-live]')).toBe('');
    // A milligram or more is drawn again.
    store.push(makeView({ result: makeResult({ unit: 'mg', range: spread(0.0000004, 0.000001, 0.0000024), scaleMax: 0.000005, car: spread(0.0000025, 0.000006, 0.000015) }) }));
    rest();
    expect(text('[data-range]')).toBe('Likely range: 0.4 to 2.4 0.4–2.4mg');
    expect(shown('[data-chart]')).toBe(true);
    expect(seen('.pill-range')).toBe('0.4–2.4mg');
  });

  it('empties the announcement when the result goes, so the same result is announced again', () => {
    const store = mount(makeView({ stage: 'steps', result: null }));
    store.push(makeView());
    expect(text('[data-live]')).toBe('Your result is in. Likely range 3.7 to 34 kilograms of CO2e, middle estimate 9.8.');
    store.push(makeView({ stage: 'steps', result: null }));
    expect(text('[data-live]')).toBe('');
    store.push(makeView());
    expect(text('[data-live]')).toBe('Your result is in. Likely range 3.7 to 34 kilograms of CO2e, middle estimate 9.8.');
  });

  describe('the scale that steps down', () => {
    const big = makeResult({ range: spread(3.7, 9.8, 34), scaleMax: 50 });
    const small = makeResult({ range: spread(1, 3, 9), scaleMax: 10 });
    const midX = () => document.querySelector<HTMLElement>('.dp-mid')?.style.transform;
    const pin = () => document.querySelector<HTMLElement>('[data-pill-band] .band-pin')?.style.left;

    it('moves the dots first and changes the scale after the ghost has faded', () => {
      const store = mount(makeView({ result: big, tips: [makeTip()] }));
      rest();
      expect(ticks()).toEqual(['0', '10', '20', '30', '40', '50 kg']);
      store.push(makeView({ result: small, tips: [makeTip({ now: small.range, after: spread(0.8, 2.5, 7.5) })] }));
      // The new range is drawn on the scale the old one stood on, next to its ghost.
      expect(ticks()).toEqual(['0', '10', '20', '30', '40', '50 kg']);
      expect(midX()).toBe('translateX(36.0px)');
      expect(pin()).toBe('6.000%');
      expect(document.querySelector('.tip .band-pin')).not.toBeNull();
      expect(document.querySelector<HTMLElement>('.tip .band-fill')?.style.width).toBe('16.000%');
      expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(true);
      vi.advanceTimersByTime(ghostGoneMs() - 1);
      expect(ticks()).toEqual(['0', '10', '20', '30', '40', '50 kg']);
      expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(false);
      vi.advanceTimersByTime(1);
      expect(ticks()).toEqual(['0', '2', '4', '6', '8', '10 kg']);
      expect(midX()).toBe('translateX(180.0px)');
      expect(pin()).toBe('30.000%');
      expect(document.querySelector<HTMLElement>('.tip .band-fill')?.style.width).toBe('80.000%');
      // The step is no change of the estimate: no chip comes back, and no ghost.
      expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(false);
    });

    it('prints the old scale in the new unit while it waits', () => {
      const store = mount(makeView({ result: makeResult({ range: spread(0.5, 1, 1.6), scaleMax: 2 }) }));
      rest();
      store.push(makeView({ result: makeResult({ unit: 'g', range: spread(0.1, 0.3, 0.8), scaleMax: 1 }) }));
      expect(ticks()).toEqual(['0', '400', '800', '1,200', '1,600', '2,000 g']);
      rest();
      expect(text('[data-range]')).toBe('Likely range: 100 to 800 100–800g');
      expect(ticks()).toEqual(['0', '200', '400', '600', '800', '1,000 g']);
    });

    it('steps up at once, and steps down at once where no ghost fades', () => {
      const store = mount(makeView({ result: small }));
      rest();
      store.push(makeView({ result: big }));
      expect(ticks()).toEqual(['0', '10', '20', '30', '40', '50 kg']);
      rest();
      // A tip is applied: its ghost is held and never fades, so there is nothing to wait for.
      store.push(makeView({ result: makeResult({ range: spread(1, 3, 7), baseline: spread(1, 3, 9), scaleMax: 10, appliedLabel: 'With: Smaller' }) }));
      expect(ticks()).toEqual(['0', '2', '4', '6', '8', '10 kg']);
      rest();
      // A new result is placed, not moved: it has no ghost either.
      store.push(makeView({ stage: 'steps', result: null }));
      store.push(makeView({ result: makeResult({ range: spread(0.1, 0.3, 0.8), scaleMax: 1 }) }));
      expect(ticks()).toEqual(['0', '0.2', '0.4', '0.6', '0.8', '1 kg']);
    });

    it('waits again when a second change comes before the step, and never steps down under a dragged slider', () => {
      const a = makeAssumption();
      const withSlider = (result: View['result']): View => ({ ...makeView({ result }), method: { ...makeView().method, assumptions: [a] } });
      loadPage();
      const store = fakeStore(withSlider(big));
      unmount = mountPage(store);
      rest();
      store.push(withSlider(small));
      vi.advanceTimersByTime(ghostGoneMs() - 100);
      store.push(withSlider(makeResult({ range: spread(1, 2.5, 8), scaleMax: 10 })));
      vi.advanceTimersByTime(ghostGoneMs() - 100);
      expect(ticks()).toEqual(['0', '10', '20', '30', '40', '50 kg']);
      // A drag starts while the step still waits: the scale holds until the slider is let go.
      const input = document.querySelector<HTMLInputElement>('.sl input');
      if (!input) throw new Error('no slider');
      input.value = '120';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      store.push(withSlider(makeResult({ range: spread(1, 2.6, 8.2), scaleMax: 10 })));
      vi.advanceTimersByTime(5000);
      expect(ticks()).toEqual(['0', '10', '20', '30', '40', '50 kg']);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      store.push(withSlider(makeResult({ range: spread(1, 2.6, 8.2), scaleMax: 10 })));
      expect(ticks()).toEqual(['0', '10', '20', '30', '40', '50 kg']);
      rest();
      expect(ticks()).toEqual(['0', '2', '4', '6', '8', '10 kg']);
    });
  });

  describe('the dots', () => {
    const places = () =>
      Array.from(document.querySelectorAll<HTMLElement>('.dp-dot'), dot => {
        const m = dot.style.transform.match(/translate3d\((-?[\d.]+)px,(-?[\d.]+)px/);
        return { x: Number(m?.[1]), up: Math.abs(Number(m?.[2])) };
      });

    it('never stacks a column higher than twelve, however narrow the range', () => {
      mount(makeView({ result: makeResult({ range: spread(19.96, 20, 20.04), quantiles: Array.from({ length: 100 }, (_, i) => 19.95 + i / 1000) }) }));
      const dots = places();
      const columns = new Map<number, number>();
      for (const dot of dots) columns.set(dot.x, (columns.get(dot.x) ?? 0) + 1);
      expect(Math.max(...columns.values())).toBe(MAX_STACK);
      expect(columns.size).toBe(Math.ceil(100 / MAX_STACK));
      // The test page has no layout, so the chart falls back to a 600 px scale with 13 px from dot to dot.
      expect(Math.max(...dots.map(dot => dot.up))).toBe((MAX_STACK - 1) * 13);
    });

    it('puts dots past the end of the scale in the gutter, and says how many and how far in its text alternative', () => {
      const range = spread(3.7, 9.8, 34);
      const quantiles = Array.from({ length: 100 }, (_, i) => (i < 97 ? 4 + (i * 44) / 96 : [52, 55.4, 61.3][i - 97] ?? 0));
      const store = mount(makeView({ result: makeResult({ range, quantiles, scaleMax: 50 }) }));
      const dots = places();
      // 600 px of scale, a 24 px gutter, 10 px dots: the gutter's dots stand over its middle, one on the other.
      expect(dots.slice(97).map(dot => dot.x)).toEqual([607, 607, 607]);
      expect(dots.slice(97).map(dot => dot.up)).toEqual([0, 13, 26]);
      expect(Math.max(...dots.slice(0, 97).map(dot => dot.x))).toBeLessThanOrEqual(595);
      expect(document.querySelector('.dp')?.getAttribute('aria-label')).toBe(
        'Likely range 3.7 to 34 kilograms of CO2e, middle estimate 9.8. 3 of the 100 dots lie past the end of the scale at 50 kilograms, the highest at 61.',
      );
      // What is announced stays the result alone.
      store.push(makeView({ result: makeResult({ range: spread(3.7, 9.8, 35), quantiles: [...quantiles.slice(0, 99), 49], scaleMax: 50 }) }));
      vi.advanceTimersByTime(ANNOUNCE_MS);
      expect(text('[data-live]')).toBe('Estimate updated. Likely range 3.7 to 35 kilograms of CO2e, middle estimate 9.8.');
      expect(document.querySelector('.dp')?.getAttribute('aria-label')).toBe(
        'Likely range 3.7 to 35 kilograms of CO2e, middle estimate 9.8. 2 of the 100 dots lie past the end of the scale at 50 kilograms, the highest at 55.',
      );
    });

    it('says nothing about the end of the scale while every dot is on it', () => {
      mount(makeView());
      expect(document.querySelector('.dp')?.getAttribute('aria-label')).toBe('Likely range 3.7 to 34 kilograms of CO2e, middle estimate 9.8.');
    });
  });
});

describe('the fixed sentences of the page', () => {
  const page = () => {
    loadPage();
    return (document.body.textContent ?? '').replace(/\s+/g, ' ');
  };

  it('carries the final text of each chapter, word for word', () => {
    const all = page();
    for (const sentence of [
      'A token is a piece of a word. AI tools count their work in tokens.',
      'Paste it into Claude Code, in the terminal, your IDE or the desktop app. Start a fresh conversation first, so a long one is not read again. Claude runs a short script that reads Claude Code’s own log files on this computer and replies with a few lines of totals.',
      'The script is 120 lines. It reads log files and prints totals. It has no network code and writes no file. Read it before you paste it.',
      'The log files hold your conversations. The script keeps only token counts and model names. No conversation text is printed.',
      'Want to see and approve the command yourself? Switch Claude Code to Manual mode first: Shift+Tab in the terminal, the mode indicator in VS Code, the mode selector in the desktop app. Then choose plain Yes.',
      'It counts all projects on this computer, in any folder you run it from. It does not count other computers, cloud sessions or SSH sessions.',
      'The run itself uses tokens too: about 7,000 for the prompt and the script, and more for Claude Code’s own instructions.',
      'If your Mac offers to install developer tools, you can cancel. Claude can then write the count in another language.',
      'Copy Claude’s whole reply. The page reads it here in your browser and checks that the numbers add up. Nothing is uploaded.',
      'In ChatGPT, open Settings › Data controls › Export data and choose Export.',
      'ChatGPT sends an email or a text message when the export is ready. That can take up to 7 days. The download link works for 24 hours.',
      'It’s read in your browser, and nothing is uploaded. If your export came as several files, drop them together.',
      'Business, Enterprise and Healthcare workspaces can’t make this export.',
      'If the export never arrives, OpenAI’s Privacy Portal can send it too. That download is a ZIP with the export inside. Drop it as it is.',
      'From ChatGPT: nothing. The export is read in this browser tab.',
      'From Claude Code: only the totals. Your own Claude Code does the counting, so they pass through Claude like any other message.',
      'Your result, as a range. It moves whenever you change anything on this page, and a small copy stays on screen while you scroll.',
      'How to read it. Each dot is one possible outcome out of 100, and each stands for the same chance. Where the dots pile up is where your footprint most likely sits. The 5 lowest and the 5 highest are drawn hollow: 90 of 100 land between them. The line marks the middle estimate: half of the dots are below it, half above.',
      'Picked from your own numbers, ordered by their middle saving.',
      'Each saving is a range too. It is worked out for that tip on its own. Apply a tip and your range for these days changes on the page.',
      'Each saving is worked out for that tip on its own. Apply a tip and your result changes on the page.',
      'Switch it off to go back. Menu names and commands as they were on 7 Oct 2026.',
      'ai-co2 turns your use of Claude Code or ChatGPT into a CO₂ range, then looks for ways to cut it.',
      '“Saves roughly A to B” under a tip means this. If the days counted here had been the same except for this one change, your footprint would have been A to B lower in 90 of 100 possible outcomes. The tips are ordered by the middle of each saving, which can differ from the order of the ranges.',
      'A cost range under “Three ways to contribute” means this. In at least 90 of 100 possible outcomes, funding that many kilograms with this provider would cost between the two figures.',
      'Your tokens are counted.',
      'The tokens in your export are counted. Hidden work is estimated on top.',
      'Three ways to contribute',
      'Cutting comes first. If you also want to give money, here are three different ways. None of them undoes your emissions.',
      'The assumptions behind the estimate, where each comes from, and a slider for every number in the list. The model sizes share one slider.',
      'Estimates, not measurements. Every CO₂ figure on this page is an estimate. The extreme range is what the formula gives with every assumption that still varies at its low value, and again with each at its high value.',
      'Your footprint is worked out with one formula: tokens × weight × energy per token × data-centre overhead × grid × hardware. Weight says how much energy reading a token takes compared with writing one. The result is in CO₂e: CO₂ and the other greenhouse gases, counted as CO₂.',
      'The other numbers are not known exactly. For each of them, the list of assumptions below gives a low, a typical and a high value.',
      'The range is only as good as that list. If a real value lies below our low or above our high, your real footprint can lie outside the range too.',
      'The page works out your footprint 10,000 times.',
      'Nothing here is random. The same data always gives the same result.',
      'The car figure counts only what leaves the exhaust: about 160 g of CO₂ per km for a new petrol car in Europe in real driving.',
      'Giving money does not undo emissions. We follow the idea of a contribution claim from a 2024 paper by the University of Oxford: what you give is a contribution to climate work, and your estimate stays what it is.',
      'EEA provisional 2025 data (opens in a new tab), new petrol cars without hybrid drive (136.6 g/km, our own average of the EEA’s table), times the ICCT’s 19% real-world gap (opens in a new tab) for cars registered in 2023. Checked 7 Oct 2026.',
      'Worked out from Google’s and Microsoft’s 2026 environmental reports (65 and 73). The figure swings from year to year: one year earlier it was 91 and 9. Checked 7 Oct 2026.',
    ]) {
      expect(all).toContain(sentence);
    }
    expect(document.querySelector('[data-cancel-read]')?.textContent).toBe('Stop reading');
    expect(document.querySelector('[data-reset]')?.textContent).toBe('Reset sliders');
  });

  it('says once when prices were checked, and holds no figure in a comment but the spec’s own example', () => {
    const all = page();
    expect(all).not.toContain('Prices were checked on the dates shown');
    expect(all).not.toContain('Every assumption, where it comes from, and a slider for each.');
    expect(all).not.toMatch(/Pick your tool|a few thousand tokens|changes everywhere on the page/);
    // The page's only table is the model table: the assumptions are a list of sliders, and the text calls them that.
    expect(all).not.toMatch(/the table gives|as good as the table|takes CO₂ out of the air, and not straight away|If your last 30 days had been/);
    // Comments are part of what every visitor's browser gets.
    const comments = html.match(/<!--[\s\S]*?-->/g) ?? [];
    expect(comments.filter(comment => /\d/.test(comment))).toEqual([
      '<!-- Spoken as "3.7 to 34", seen as "3.7–34". The seen part is one unbroken run of text, so the dash keeps its kerning. -->',
    ]);
  });

  it('never claims what the words must not claim, and never says both tools are needed', () => {
    const all = page();
    expect(all).not.toMatch(/\boffset|\bneutral|compensat|net zero|saves? up to|\bowe\b|\bowes\b|carbon debt|pay off|cancel out|biggest saving first|The last 30 days, as a range|Fund carbon removal|most likely\b(?! sits)|complete\b/i);
    expect(all).not.toMatch(/Claude Code and ChatGPT|both tools|ChatGPT and Claude Code/i);
    expect(all).toContain('Choose Claude Code or ChatGPT. The page then works with the one you pick.');
  });

  it('shows the answer’s real format in the Claude Code card: a header with the data days, model lines and the total', () => {
    loadPage();
    const lines = Array.from(document.querySelectorAll('[data-choose-source="claude-code"] .scene-out'), n => n.textContent ?? '');
    expect(lines[0]).toBe('ai-co2 v1 | 2026-09-08 to 2026-10-07 | data 2026-09-26 to 2026-10-07');
    expect(lines.at(-1)).toBe('total | 1001968186');
    let sum = 0;
    for (const line of lines.slice(1, -1)) {
      const m = line.match(/^[a-z][\w.-]* \| in (\d+) \| cache_write (\d+) \| cache_read (\d+) \| out (\d+)$/);
      if (!m) throw new Error(`not a model line: ${line}`);
      sum += m.slice(1).reduce((a, b) => a + Number(b), 0);
    }
    expect(sum).toBe(1001968186);
    // The lines are a picture: a screen reader gets the card's words, not the sample.
    expect(document.querySelector('[data-choose-source="claude-code"] .choice-scene')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('links the two fixed sources safely, and names the result panel apart from its chapter', () => {
    loadPage();
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.method-src a'));
    expect(links.map(a => a.getAttribute('href'))).toEqual([
      'https://www.eea.europa.eu/en/datahub/datahubitem-view/fa8b1229-3db6-495d-b18e-9c9b3267c02b',
      'https://theicct.org/publication/real-world-co2-emission-values-vehicles-europe-jun26/',
      'https://www.openstreetmap.org/copyright',
      'https://science.nasa.gov/moon/facts/',
    ]);
    for (const link of links) {
      expect(link.rel).toBe('noopener noreferrer');
      expect(link.target).toBe('_blank');
    }
    expect(document.querySelector('#result-chapter')?.getAttribute('aria-labelledby')).toBe('h-result');
    expect(document.querySelector('[data-result]')?.hasAttribute('aria-labelledby')).toBe(false);
    // A pasted answer wraps: nothing in the markup switches wrapping off.
    expect(document.querySelector('[data-answer]')?.hasAttribute('wrap')).toBe(false);
  });
});

describe('the whole-history line', () => {
  const withHistory = (range: ReturnType<typeof spread>, over: Parameters<typeof makeResult>[0] = {}) =>
    makeView({ result: makeResult({ sourceName: 'ChatGPT', history: { range, since: 'November 2025' }, ...over }) });

  it('prints both ends in one unit, the way the readout above it does', () => {
    const store = mount(withHistory(spread(0.513, 1.4, 3.7)));
    expect(seen('[data-history]')).toBe('Your whole ChatGPT history, since November 2025: 0.51–3.7 kg.');
    expect(spoken('[data-history]')).toBe('Your whole ChatGPT history, since November 2025: 0.51 to 3.7 kilograms.');
    store.push(withHistory(spread(0.000179, 0.0008, 0.0026)));
    expect(seen('[data-history]')).toBe('Your whole ChatGPT history, since November 2025: 0.18–2.6 g.');
  });

  it('gives each end its own unit only where the low end would print as 0', () => {
    mount(withHistory(spread(0.0000004, 0.0005, 0.0026)));
    expect(seen('[data-history]')).toBe('Your whole ChatGPT history, since November 2025: 0.4 mg to 2.6 g.');
    expect(spoken('[data-history]')).toBe('Your whole ChatGPT history, since November 2025: 0.4 mg to 2.6 g.');
  });

  it('keeps its range when the 30 days are one outcome and the history still varies', () => {
    const one = spread(0.008, 0.008, 0.008);
    const store = mount(withHistory(spread(0.021, 0.041, 0.074), { single: true, unit: 'g', range: one, scaleMax: 0.01, quantiles: Array.from({ length: 100 }, () => 0.008) }));
    expect(shown('[data-one-note]')).toBe(true);
    expect(seen('[data-history]')).toBe('Your whole ChatGPT history, since November 2025: 21–74 g.');
    // "about" is for a history whose own two ends print the same.
    store.push(withHistory(spread(0.041, 0.041, 0.041), { single: true, unit: 'g', range: one, scaleMax: 0.01, quantiles: Array.from({ length: 100 }, () => 0.008) }));
    expect(seen('[data-history]')).toBe('Your whole ChatGPT history, since November 2025: about 41 g.');
  });
});

describe('found by the last review', () => {
  const waiting = { state: 'waiting' } as const;
  const chips = () => Array.from(document.querySelectorAll<HTMLElement>('.dp-mid-label .delta, [data-pill-chip]'));
  const ticks = () => Array.from(document.querySelectorAll('.dp .tick em'), em => em.textContent);
  const answered = (headline: string, tokens: number, result: View['result']): View =>
    makeView({
      result,
      data: {
        claudeCode: { prompt: 'p', answer: headline, status: { state: 'ok', headline, confirmation: 'The numbers add up and look plausible.', models: [{ name: 'Opus 5.5', tokens, share: 1 }], notes: [] } },
        chatgpt: { status: waiting },
      },
    });
  const gpt = (status: View['data']['chatgpt']['status']): View =>
    makeView({ stage: status.state === 'reading' ? 'loading' : status.state === 'problem' ? 'problem' : 'steps', source: 'chatgpt', result: null, data: { claudeCode: { prompt: 'p', answer: '', status: waiting }, chatgpt: { status } } });
  const reading = { state: 'reading', done: 10, total: 100, text: 'Reading your export in this tab: 12 conversations so far.' } as const;
  /** Everything the live region is given, in order. */
  function listen(): string[] {
    const said: string[] = [];
    const live = document.querySelector('[data-live]');
    if (!live) throw new Error('no live region');
    // Every write to the line is caught as it happens. The test clock holds observers back.
    let proto: object | null = Object.getPrototypeOf(live);
    let own: PropertyDescriptor | undefined;
    while (proto && !own) {
      own = Object.getOwnPropertyDescriptor(proto, 'textContent');
      proto = Object.getPrototypeOf(proto);
    }
    if (!own?.set) throw new Error('textContent cannot be watched');
    Object.defineProperty(live, 'textContent', {
      configurable: true,
      get: () => own?.get?.call(live) as string,
      set: (value: string) => {
        said.push(value);
        own?.set?.call(live, value);
      },
    });
    return said;
  }

  it('places another answer as a new result: no chip, no ghost, no count across, and its own scale at once', () => {
    const big = makeResult({ range: spread(7, 19, 65), scaleMax: 100 });
    const small = makeResult({ unit: 'g', range: spread(0.00027, 0.0006, 0.0018), scaleMax: 0.002 });
    const store = mount(answered('1 model · 781 million tokens', 781_000_000, big));
    rest();
    expect(ticks()).toEqual(['0', '20', '40', '60', '80', '100 kg']);
    store.push(answered('1 model · 12,400 tokens', 12_400, small));
    // Nothing of the old data stays on screen, not even for a frame.
    expect(ticks()).toEqual(['0', '0.4', '0.8', '1.2', '1.6', '2 g']);
    expect(text('[data-likely]')).toBe('Middle estimate: 0.6 g');
    expect(text('[data-range]')).toBe('Likely range: 0.27 to 1.8 0.27–1.8g');
    for (const node of chips()) expect(node.classList.contains('is-on')).toBe(false);
    expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(false);
    expect(document.querySelector('.band-ghost')?.classList.contains('is-on')).toBe(false);
    expect(text('[data-live]')).toBe('Your result is in. Likely range 0.27 to 1.8 grams of CO2e, middle estimate 0.6.');
    vi.advanceTimersByTime(60);
    expect(text('[data-likely]')).toBe('Middle estimate: 0.6 g');
    // A change of that new result is a change again.
    store.push(answered('1 model · 12,400 tokens', 12_400, makeResult({ unit: 'g', range: spread(0.0002, 0.0005, 0.0015), scaleMax: 0.002 })));
    expect(chips().map(n => n.textContent)).toEqual(['−0.1 g', '−0.1 g']);
  });

  it('keeps "Reset sliders" usable for a set slider that the data no longer shows', () => {
    const files = makeAssumption({ id: 'hidden:files', group: 'Hidden work in ChatGPT', label: 'Files without a size', value: 2, pinned: true });
    const withSliders = (assumptions: ReturnType<typeof makeAssumption>[]): View => ({ ...makeView({ source: 'chatgpt' }), method: { ...makeView().method, assumptions } });
    const store = mount(withSliders([makeAssumption(), files]));
    const reset = document.querySelector<HTMLButtonElement>('[data-reset]');
    expect(reset?.getAttribute('aria-disabled')).toBe('false');
    // A new export has no file without a size: the slider leaves the page, still set.
    store.push(withSliders([makeAssumption()]));
    expect(document.querySelectorAll('.sl').length).toBe(1);
    expect(reset?.getAttribute('aria-disabled')).toBe('false');
    reset?.click();
    expect(store.actions).toEqual([{ type: 'reset-assumptions' }]);
    // The store clears every set slider, so there is nothing left to reset.
    store.push(withSliders([makeAssumption()]));
    expect(reset?.getAttribute('aria-disabled')).toBe('true');
    reset?.click();
    expect(store.actions.length).toBe(1);
  });

  it('says that the reading stopped, so the next read is announced again', () => {
    const store = mount(gpt(waiting));
    const said = listen();
    store.push(gpt(reading));
    expect(text('[data-live]')).toBe('Reading your export.');
    store.push(gpt(waiting));
    expect(text('[data-tool="chatgpt"] [data-status]')).toBe('WaitingDrop your export');
    expect(text('[data-live]')).toBe('Stopped reading.');
    store.push(gpt(reading));
    expect(text('[data-live]')).toBe('Reading your export.');
    expect(said).toEqual(['Reading your export.', 'Stopped reading.', 'Reading your export.']);
  });

  it('announces every refused export once, also one that was never read', () => {
    const store = mount(gpt(waiting));
    const said = listen();
    const tooMany = 'That is more than 20 ZIP files. Drop the export ZIP on its own, or only the conversations files from inside it.';
    store.push(gpt({ state: 'problem', message: tooMany }));
    expect(text('[data-live]')).toBe(`This export gave no result. ${tooMany}`);
    // The same View again, as after a slider: nothing is said twice.
    store.push(gpt({ state: 'problem', message: tooMany }));
    store.push(gpt({ state: 'problem', message: 'This export holds no conversations.' }));
    expect(text('[data-live]')).toBe('This export gave no result. This export holds no conversations.');
    expect(said.length).toBe(2);
    // Only one live region speaks: the message under the drop zone is the field's description.
    expect(document.querySelectorAll('[data-tool="chatgpt"] [aria-live]').length).toBe(0);
  });

  it('calls a problem what it is: data that gave no result, read or not', () => {
    const store = mount(makeView({ stage: 'problem', result: null, data: { claudeCode: { prompt: 'p', answer: 'x', status: { state: 'problem', message: 'Claude Code found no use in the last 30 days on this computer.' } }, chatgpt: { status: waiting } } }));
    expect(text('[data-tool="claude-code"] [data-status]')).toBe('Needs a lookThis answer gave no result');
    store.push(gpt({ state: 'problem', message: 'This export has no ChatGPT answers in the last 30 days.' }));
    expect(text('[data-tool="chatgpt"] [data-status]')).toBe('Needs a lookThis export gave no result');
    expect(document.body.textContent).not.toMatch(/couldn’t be read/);
  });

  it('says which tip the spoken numbers go with, in the announcement, the chart and the pill', () => {
    const store = mount(makeView());
    const tipped = makeResult({ range: spread(2.9, 7.9, 27), baseline: spread(3.7, 9.8, 34), appliedLabel: 'With: Sonnet for half of your Opus work' });
    store.push(makeView({ result: tipped }));
    vi.advanceTimersByTime(ANNOUNCE_MS);
    expect(text('[data-live]')).toBe('Estimate updated. Likely range 2.9 to 27 kilograms of CO2e, middle estimate 7.9. With: Sonnet for half of your Opus work.');
    expect(document.querySelector('.dp')?.getAttribute('aria-label')).toBe('Likely range 2.9 to 27 kilograms of CO2e, middle estimate 7.9. With: Sonnet for half of your Opus work.');
    expect(spoken('[data-pill] .pill')).toContain('With: Sonnet for half of your Opus work.');
    expect(seen('[data-pill] .pill')).not.toContain('Sonnet');
    store.push(makeView());
    vi.advanceTimersByTime(ANNOUNCE_MS);
    expect(text('[data-live]')).toBe('Estimate updated. Likely range 3.7 to 34 kilograms of CO2e, middle estimate 9.8.');
    expect(shown('[data-pill-applied]')).toBe(false);
  });

  it('never leaves the live region on a number that is no longer on the page', () => {
    const tipped = makeResult({ range: spread(3.3, 8.1, 27), baseline: spread(3.7, 9.8, 34), appliedLabel: 'With: Less re-reading' });
    const store = mount(makeView());
    store.push(makeView({ result: tipped }));
    vi.advanceTimersByTime(ANNOUNCE_MS);
    expect(text('[data-live]')).toContain('3.3 to 27');
    // The tip goes off, and before that is spoken a slider step changes no printed number.
    store.push(makeView());
    vi.advanceTimersByTime(300);
    store.push(makeView({ result: makeResult({ range: spread(3.7001, 9.8001, 34.001) }) }));
    vi.advanceTimersByTime(3000);
    expect(text('[data-likely]')).toBe('Middle estimate: 9.8 kg');
    expect(text('[data-live]')).toBe('Estimate updated. Likely range 3.7 to 34 kilograms of CO2e, middle estimate 9.8.');
  });

  it('stays silent when a change is taken back before it was spoken', () => {
    const store = mount(makeView());
    const said = listen();
    store.push(makeView({ result: makeResult({ range: spread(2.9, 7.9, 27) }) }));
    vi.advanceTimersByTime(300);
    store.push(makeView());
    vi.advanceTimersByTime(3000);
    expect(said).toEqual([]);
  });

  it('drops the words about ranges where there is one outcome', () => {
    const option = { id: 'a', kind: 'Lasting removal', name: 'Example', price: '$500 a tonne', minimum: 'None', whatYouGet: 'Removal.', forYourRange: 'About $4.50.', url: 'https://example.org/' };
    const contribute = { costSentence: 'Each option shows below what it would cost.', options: [option], footnote: [] };
    const one = makeResult({ single: true, range: spread(8.6, 8.6, 8.6), quantiles: Array.from({ length: 100 }, () => 8.6) });
    const store = mount(makeView({ tips: [makeTip()], contribute }));
    expect(text('[data-tips-caption]')).toBe('Each saving is a range too. It is worked out for that tip on its own. Apply a tip and your range for these days changes on the page. Switch it off to go back. Menu names and commands as they were on 7 Oct 2026.');
    expect(Array.from(document.querySelectorAll('.opt dt'), dt => dt.textContent)).toEqual(['Price', 'Minimum', 'What you get', 'For your range']);
    store.push(makeView({ result: one, tips: [makeTip()], contribute }));
    expect(text('[data-tips-caption]')).toBe('Each saving is worked out for that tip on its own. Apply a tip and your result changes on the page. Switch it off to go back. Menu names and commands as they were on 7 Oct 2026.');
    expect(Array.from(document.querySelectorAll('.opt dt'), dt => dt.textContent)).toEqual(['Price', 'Minimum', 'What you get', 'For your estimate']);
  });

  it('says what is counted in the words that hold for the chosen tool', () => {
    const store = mount(makeView({ stage: 'choose', source: null, result: null }));
    expect(text('.method-text')).toContain('Your tokens are counted. The other numbers are not known exactly.');
    store.push(gpt(waiting));
    expect(text('.method-text')).toContain('The tokens in your export are counted. Hidden work is estimated on top. The other numbers are not known exactly.');
    expect(text('.method-text')).not.toContain('Your tokens are counted.');
  });

  it('promises a result in the empty panel, not 30 days on a scale it cannot know yet', () => {
    const store = mount(makeView({ stage: 'choose', source: null, result: null }));
    expect(text('[data-empty-text]')).toBe('Choose Claude Code or ChatGPT above. As soon as your data is in, your result appears here as a range.');
    store.push(gpt(waiting));
    expect(text('[data-empty-text]')).toBe('As soon as your data is in, your result appears here as a range.');
  });

  it('writes moving shares into the model table that stands, without building it again', () => {
    const models = (share: number) => [{ name: 'Opus 5.5', tokens: 576_263_273, share }, { name: 'Haiku 4.5', tokens: 21_415_968, share: 1 - share }];
    const withShares = (share: number): View =>
      makeView({ data: { claudeCode: { prompt: 'p', answer: '', status: { state: 'ok', headline: '2 models', confirmation: 'Fine.', models: models(share), notes: [] } }, chatgpt: { status: waiting } } });
    const store = mount(withShares(0.8249));
    const table = document.querySelector('.models');
    const firstRow = document.querySelector('.models tbody tr');
    const firstBar = document.querySelector('.models .share-bar i');
    for (const share of [0.81, 0.79, 0.7]) store.push(withShares(share));
    expect(document.querySelector('.models .share-bar i')).toBe(firstBar);
    expect(document.querySelector('.models')).toBe(table);
    expect(document.querySelector('.models tbody tr')).toBe(firstRow);
    expect(Array.from(document.querySelectorAll('.models .share .num'), n => n.textContent)).toEqual(['70%', '30%']);
    expect(document.querySelector<HTMLElement>('.models .share-bar i')?.style.getPropertyValue('--share')).toBe('70.0%');
  });

  it('gives the only slider of a group the whole row, and breaks its readout between two sizes only', () => {
    const energy = makeAssumption({
      parts: [
        { label: 'large', low: 0.5, typical: 1, high: 5.4, value: 1, decimals: 1 },
        { label: 'mid-size', low: 0.3, typical: 0.6, high: 2.4, value: 0.6, decimals: 1 },
        { label: 'small', low: 0.05, typical: 0.1, high: 0.4, value: 0.1, decimals: 1 },
      ],
    });
    const others = ['a', 'b'].map(id => makeAssumption({ id, group: 'Input and cache' }));
    const store = mount(makeView({ method: { ...makeView().method, assumptions: [energy, ...others] } }));
    expect(Array.from(document.querySelectorAll('.sl'), n => n.classList.contains('is-lone'))).toEqual([true, false, false]);
    expect(text('.sl output')).toBe('large 1.0 Wh · mid-size 0.60 Wh · small 0.10 Wh');
    expect(Array.from(document.querySelectorAll('.sl.is-lone output .sl-part'), n => n.textContent)).toEqual(['large 1.0 Wh', 'mid-size 0.60 Wh', 'small 0.10 Wh']);
    // What the slider says of itself: commas between the sizes, and the range named as the first size's.
    const input = document.querySelector<HTMLInputElement>('.sl input');
    expect(input?.getAttribute('aria-valuetext')).toBe('large 1.0 Wh, mid-size 0.60 Wh, small 0.10 Wh, the typical values. Not set: large varies from 0.50 Wh to 5.4 Wh, the others move with it');
    store.push(makeView({ method: { ...makeView().method, assumptions: [{ ...energy, pinned: true }, ...others] } }));
    expect(input?.getAttribute('aria-valuetext')).toBe('large 1.0 Wh, mid-size 0.60 Wh, small 0.10 Wh, set by you');
    // A group that gains a second slider is no longer alone.
    store.push(makeView({ method: { ...makeView().method, assumptions: [energy, makeAssumption({ id: 'c' }), ...others] } }));
    expect(Array.from(document.querySelectorAll('.sl'), n => n.classList.contains('is-lone'))).toEqual([false, false, false, false]);
  });

  it('speaks the pinned range with "to", and one number as it is seen', () => {
    const store = mount(makeView());
    expect(seen('.pill-range')).toBe('3.7–34kg');
    expect(spoken('.pill-range')).toBe('3.7 to 34kg');
    expect(spoken('.car')).toBe('Like driving a new petrol car 61 km Likely 23 to 210 km.');
    store.push(makeView({ result: makeResult({ range: spread(8.56, 8.6, 8.64) }) }));
    rest();
    expect(spoken('.pill-range')).toBe('about 8.6kg');
  });
});
