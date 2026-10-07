// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '../contracts/store';
import { massChange, plainNumber } from '../format';
import { mountPage } from '../ui';
import { loadPage, seen, shown, text } from '../ui/test-kit';
import { createDemoStore, SAMPLE_ANSWER, scenarioFrom, SCENARIOS, showExampleLabels, type Scenario } from './demo';

let unmount: (() => void) | null = null;

function open(scenario: Scenario): Store {
  loadPage();
  const store = createDemoStore(scenario);
  unmount = mountPage(store);
  return store;
}
const rest = () => vi.advanceTimersByTime(4000);
const click = (selector: string) => {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`nothing matches ${selector}`);
  node.click();
};
/** For a switch that is not always on the page: a tip that saves nothing is only shown while it is on. */
const clickIfThere = (selector: string) => document.querySelector<HTMLElement>(selector)?.click();
const WINDOW = '2026-09-08 to 2026-10-07';
const OPUS = 'claude-opus-5-5 | in 2184390 | cache_write 21662104 | cache_read 548310227 | out 4106552';
/** An answer in the script's format. The total is whatever the test says, so a wrong one can be pasted too. */
const answer = (first = `ai-co2 v1 | ${WINDOW} | data ${WINDOW}`, models = OPUS, total = '576263273') => `${first}\n${models}\ntotal | ${total}`;
const drop = (names: string[]) => {
  const zone = document.querySelector<HTMLElement>('[data-drop]');
  if (!zone) throw new Error('no drop zone');
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: names.map(name => new File(['x'], name)), types: ['Files'] } });
  zone.dispatchEvent(event);
};
const slide = (id: string, position: number) => {
  const input = document.querySelector<HTMLInputElement>(`[data-key="s:${id}"] input`);
  if (!input) throw new Error(`no slider ${id}`);
  input.value = String(Math.round(position * Number(input.max)));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const chipText = (selector: string): string | null => {
  const node = document.querySelector(selector);
  return node?.classList.contains('is-on') ? node.textContent : null;
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  unmount?.();
  unmount = null;
  vi.useRealTimers();
});

describe('scenarioFrom', () => {
  it('reads the scenario from the address and falls back to the first visit', () => {
    expect(scenarioFrom('gpt-done')).toBe('gpt-done');
    expect(scenarioFrom(null)).toBe('choose');
    expect(scenarioFrom('nonsense')).toBe('choose');
  });
});

describe('the eight example scenarios', () => {
  const sentences: Record<Scenario, string[]> = {
    choose: ['Use Claude Code', 'Use ChatGPT', 'Choose Claude Code or ChatGPT above. As soon as your data is in, your result appears here as a range.', 'From ChatGPT: nothing.', 'From Claude Code: only the totals.', 'Your range will land here', 'A token is a piece of a word. AI tools count their work in tokens.'],
    'cc-steps': ['Switch to ChatGPT', 'Waiting', 'Paste Claude’s answer', 'Copy this prompt into Claude Code', 'Start a fresh conversation first, so a long one is not read again.', 'Before you paste', 'The script is 120 lines.', 'Copy Claude’s whole reply. The page reads it here in your browser and checks that the numbers add up. Nothing is uploaded.', 'As soon as your data is in'],
    'cc-problem': ['Needs a look', 'This answer gave no result', 'This doesn\'t look like the answer. It should start with a line that begins “ai-co2 v1”.'],
    'cc-done': ['Counted', '3 models · 781 million tokens · 8 Sep – 7 Oct', 'The numbers add up and look plausible.', 'Opus 5.5', 'Likely CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct)', 'Middle estimate: 9.8 kg', 'Try a change', 'About 85% of your estimate comes from Opus 5.5', 'Moving half of your Opus 5.5 work to Sonnet would save roughly 0.59–5.4 kg a month.', 'Apply this tip', 'Three ways to contribute', 'Climeworks', 'Reset sliders'],
    'gpt-steps': ['Switch to Claude Code', 'Waiting', 'Drop your export', 'Settings › Data controls › Export data and choose Export.', 'Wait for the message', 'That can take up to 7 days.', 'If your export came as several files, drop them together.', 'Drop your ChatGPT ZIP here', 'Business, Enterprise and Healthcare workspaces can’t make this export.', 'OpenAI’s Privacy Portal can send it too.'],
    'gpt-loading': ['Reading', 'Reading your export in this tab: 412 conversations so far. Large exports can take a minute.', 'Stop reading'],
    'gpt-problem': ['Needs a look', 'This export gave no result', 'This ZIP isn\'t a ChatGPT export: it has no conversations file.'],
    'gpt-done': ['Read', '1,284 conversations · 612 answers in the last 30 days · newest message 7 Oct', 'Your export was read in this tab.', 'GPT-5.5 Thinking', 'Middle estimate: 1.8 kg', 'Hidden work in ChatGPT', 'Plus or Pro plan', 'Your whole ChatGPT history, since March 2023: 16–130 kg.', 'ChatGPT thought for about 25 minutes before its answers', 'Half as much thinking would save roughly 0.04–0.45 kg a month.'],
  };

  for (const scenario of SCENARIOS) {
    it(`${scenario} mounts without an error and shows its key sentences`, () => {
      const errors = vi.spyOn(console, 'error');
      open(scenario);
      rest();
      const page = seen('main');
      for (const sentence of sentences[scenario]) expect(page).toContain(sentence);
      const done = scenario.endsWith('done');
      expect(shown('[data-result-top]')).toBe(done);
      expect(shown('[data-result-empty]')).toBe(!done);
      expect(shown('#tips')).toBe(done);
      expect(shown('#contribute')).toBe(done);
      expect(shown('#how')).toBe(true);
      expect(shown('[data-choose]')).toBe(true);
      expect(document.querySelector('[data-chapter="data"]')?.getAttribute('data-picked')).toBe(String(scenario !== 'choose'));
      // Seven assumptions for Claude Code. ChatGPT has no cache writes, and six more for its hidden work.
      expect(document.querySelectorAll('.sl input').length).toBe(scenario.startsWith('gpt') ? 12 : 7);
      expect(document.querySelectorAll('h1').length).toBe(1);
      expect(page).not.toMatch(/\boffset|\bneutral|compensat|saves? up to|\bowe/i);
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });
  }

  it('shows the range, the scale and the car line of the Claude Code example', () => {
    open('cc-done');
    expect(text('[data-range]')).toBe('Likely range: 3.7 to 34 3.7–34kg');
    expect(Array.from(document.querySelectorAll('.dp .tick em'), em => em.textContent)).toEqual(['0', '10', '20', '30', '40', '50 kg']);
    expect(seen('.car-lead')).toBe('Like driving a new petrol car 61 km');
    expect(seen('.car-place')).toBe('About the drive from Munich to Augsburg (66 km).');
    expect(seen('.car-range')).toBe('Likely 23–210 km.');
    // The road is a picture of the sentence: hidden from screen readers, labelled with the drive's two ends.
    expect(document.querySelector('[data-road]')?.getAttribute('aria-hidden')).toBe('true');
    expect(seen('[data-road-from]')).toBe('Munich');
    expect(seen('[data-road-to]')).toBe('Augsburg');
    expect(text('[data-extreme]')).toBe('Every low or every high assumption combined: 1.7–152 kg');
    expect(text('[data-cost]')).toBe('Each option shows below what it would cost for 3.7–34 kg of CO₂, the size of your estimate. They do different things, so the three costs cannot be compared.');
  });
});

describe('every control works on the example data', () => {
  it('picks a tool, switches to the other and back', () => {
    open('choose');
    click('[data-choose-source="chatgpt"]');
    expect(text('[data-chosen-name]')).toBe('ChatGPT');
    expect(shown('[data-tool="chatgpt"]')).toBe(true);
    expect(shown('[data-tool="claude-code"]')).toBe(false);
    expect(text('.notes')).not.toContain('From Claude Code');
    click('[data-switch-source]');
    expect(text('[data-chosen-name]')).toBe('Claude Code');
    expect(text('[data-switch-source]')).toBe('Switch to ChatGPT');
    expect(text('.notes')).not.toContain('From ChatGPT');
  });

  it('reads a pasted answer after a short pause, and says what is wrong with anything else', () => {
    open('cc-steps');
    const box = document.querySelector<HTMLTextAreaElement>('[data-answer]');
    if (!box) throw new Error('no paste box');
    const type = (value: string) => {
      box.value = value;
      box.dispatchEvent(new Event('input', { bubbles: true }));
    };
    type('hello');
    expect(text('[data-tool="claude-code"] [data-status]')).toContain('Waiting');
    vi.advanceTimersByTime(200);
    expect(text('[data-answer-msg]')).toBe('This doesn\'t look like the answer. It should start with a line that begins “ai-co2 v1”. Copy the whole block from Claude Code and paste it again.');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.value).toBe('hello');

    type(answer(undefined, 'claude-opus-5-5 | in 1 | cache_write 2 | cache_read 3', '6'));
    vi.advanceTimersByTime(200);
    expect(text('[data-answer-msg]')).toContain('One line of the answer can\'t be read');

    type(answer('ai-co2 v1 | 2026-09-28 to 2026-10-07 | data 2026-09-28 to 2026-10-07'));
    vi.advanceTimersByTime(200);
    expect(text('[data-answer-msg]')).toContain('This answer covers 10 days. The page needs exactly 30.');

    // The numbers have to add up to the answer's own last line.
    type(answer(undefined, OPUS, '576263274'));
    vi.advanceTimersByTime(200);
    expect(text('[data-answer-msg]')).toContain('The numbers don\'t add up to the total in the last line');

    type(answer());
    vi.advanceTimersByTime(200);
    expect(text('[data-tool="claude-code"] [data-status]')).toBe('Counted1 model · 576 million tokens · 8 Sep – 7 Oct');
    expect(text('[data-answer-msg]')).toBe('');
    expect(shown('[data-result-top]')).toBe(true);
    // The steps fold away, and the button that opens them again is there.
    expect(shown('#cc-steps')).toBe(false);
    click('[data-tool="claude-code"] [data-redo]');
    expect(shown('#cc-steps')).toBe(true);
    expect(box.value).toContain('claude-opus-5-5');
  });

  it('says so when Claude Code found nothing, and names the other causes', () => {
    const store = open('cc-steps');
    store.dispatch({ type: 'set-answer', text: `ai-co2 v1 | ${WINDOW} | data none\ntotal | 0` });
    expect(store.getView().stage).toBe('problem');
    expect(text('[data-answer-msg]')).toContain('Claude Code found no use in the last 30 days on this computer.');
    expect(text('[data-answer-msg]')).toContain('Other causes:');
  });

  it('pretends to read dropped files with a count that runs up, then shows a result', () => {
    open('gpt-steps');
    drop(['holiday.jpg']);
    expect(text('[data-drop-msg]')).toBe('None of these files is a ChatGPT export. Drop the ZIP file you downloaded from OpenAI, or the conversations.json files from inside it.');
    expect(document.querySelector('[data-drop]')?.classList.contains('is-bad')).toBe(true);
    expect(document.querySelector('[data-file]')?.getAttribute('aria-invalid')).toBe('true');
    drop(Array.from({ length: 21 }, (_, i) => `conversations-${i}.json`));
    expect(text('[data-drop-msg]')).toContain('That is more than 20 files.');

    drop(['export-1.zip', 'export-2.zip']);
    expect(shown('[data-progress]')).toBe(true);
    expect(shown('[data-drop]')).toBe(false);
    const first = text('[data-progress-text]');
    vi.advanceTimersByTime(600);
    const later = text('[data-progress-text]');
    expect(later).not.toBe(first);
    expect(later).toMatch(/^Reading your export in this tab: \d+ conversations so far\. Large exports can take a minute\.$/);
    expect(Number(document.querySelector('[data-progress-bar]')?.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
    vi.advanceTimersByTime(4000);
    expect(text('[data-tool="chatgpt"] [data-status]')).toContain('Read');
    expect(text('[data-range]')).toBe('Likely range: 0.6 to 6.5 0.6–6.5kg');
    expect(shown('[data-progress]')).toBe(false);
  });

  it('gives up a read with "Stop reading" and goes back to the steps', () => {
    const store = open('gpt-steps');
    drop(['export.zip']);
    vi.advanceTimersByTime(300);
    expect(store.getView().stage).toBe('loading');
    document.querySelector<HTMLElement>('[data-cancel-read]')?.focus();
    click('[data-cancel-read]');
    expect(store.getView().stage).toBe('steps');
    expect(store.getView().data.chatgpt.status).toEqual({ state: 'waiting' });
    expect(shown('[data-progress]')).toBe(false);
    expect(shown('[data-drop]')).toBe(true);
    // Stopping is not a mistake: no message, and the focus is back on the file field.
    expect(text('[data-drop-msg]')).toBe('');
    expect(document.activeElement).toBe(document.querySelector('[data-file]'));
    // The read really stopped: no result turns up later.
    vi.advanceTimersByTime(6000);
    expect(store.getView().result).toBeNull();
    expect(text('[data-tool="chatgpt"] [data-status]')).toBe('WaitingDrop your export');
  });

  it('flips a tip from the result card and from the tip itself as one switch', () => {
    open('cc-done');
    const both = () => Array.from(document.querySelectorAll('[data-switch="cc-opus-to-sonnet"]'), n => n.getAttribute('aria-checked'));
    expect(both()).toEqual(['false', 'false']);
    expect(seen('[data-switches-list] .tg:last-child')).toBe('Sonnet for half of your Opus workSaves roughly 0.59–5.4 kg a month');
    click('[data-switches-list] [data-switch="cc-opus-to-sonnet"]');
    expect(both()).toEqual(['true', 'true']);
    expect(text('[data-tag-applied]')).toBe('With: Sonnet for half of your Opus work');
    rest();
    expect(text('[data-range]')).toBe('Likely range: 3.1 to 29 3.1–29kg');
    expect(seen('.pill-range')).toBe('3.1–29kg');
    expect(text('[data-cost]')).toContain('for 3.1–29 kg of CO₂');
    expect(text('[data-extreme-label]')).toBe('Every low or every high assumption combined, with your tip applied');
    expect(document.querySelector('.dp-ghost')?.classList.contains('is-on')).toBe(true);
    click('.tip [data-switch="cc-opus-to-sonnet"]');
    expect(both()).toEqual(['false', 'false']);
    click('.tip [data-switch="cc-clear"]');
    click('.tip [data-switch="cc-opus-to-sonnet"]');
    expect(text('[data-tag-applied]')).toBe('With 2 tips applied');
  });

  it('sets an assumption with its slider and frees them all with "Reset sliders"', () => {
    open('cc-done');
    slide('grid', 0);
    rest();
    expect(text('[data-key="s:grid"] output')).toBe('270 g/kWh');
    expect(document.querySelector('[data-key="s:grid"]')?.classList.contains('is-set')).toBe(true);
    expect(text('[data-tag-set]')).toBe('With 1 assumption set by you');
    expect(text('[data-likely]')).toBe('Middle estimate: 7.5 kg');
    expect(text('[data-extreme-label]')).toBe('Every assumption you have not set, at its low or at its high');
    expect(text('[data-method-notes-list]')).toContain('Of the assumptions you have not set, what matters most is the weight of a cache read.');
    click('[data-reset]');
    rest();
    expect(document.querySelector('[data-key="s:grid"]')?.classList.contains('is-set')).toBe(false);
    expect(shown('[data-tag-set]')).toBe(false);
    expect(text('[data-likely]')).toBe('Middle estimate: 9.8 kg');
  });

  it('ends on one number once every assumption is set', () => {
    open('cc-done');
    for (const id of ['energy', 'freshInput', 'cacheWrite', 'cacheRead', 'pue', 'grid', 'hardware']) slide(id, 0.5);
    rest();
    expect(text('[data-range]')).toBe('about 9.8kg');
    expect(text('[data-summary-line]')).toBe('CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct), with every assumption that changes your result set by you');
    expect(text('[data-one-note]')).toBe('You have set every assumption that changes your result, so there is one outcome and no range. Reset the sliders to see the range again.');
    expect(shown('[data-likely]')).toBe(false);
    // One outcome has no extreme range, and nothing is left that could matter most.
    expect(shown('[data-extreme]')).toBe(false);
    expect(text('[data-method-notes-list]')).not.toContain('matters most');
    expect(text('[data-cost]')).toContain('for about 9.8 kg of CO₂');
    expect(document.querySelectorAll('.dp-dot.tail').length).toBe(0);
    expect(shown('.dp-bracket-label')).toBe(false);
  });
});

describe('the change chip on the example data', () => {
  /** A fixed sequence of pseudo-random numbers, so a failing order can be found again. */
  const dice = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const printedMid = () => Number(text('.dp-mid-label [data-num]').replace(/,/g, ''));

  const walks: Array<[Scenario, Array<() => void>]> = [
    ['cc-done', [() => click('[data-switches-list] [data-switch="cc-opus-to-sonnet"]'), () => click('.tip [data-switch="cc-opus-to-sonnet"]'), () => click('[data-switches-list] [data-switch="cc-clear"]'), () => click('.tip [data-switch="cc-clear"]')]],
    ['gpt-done', [() => click('[data-switch="thinking"]'), () => click('[data-switch="instructions-memory"]'), () => click('[data-switch="search-files"]'), () => click('[data-switch="plan-paid"]'), () => clickIfThere('.tip [data-switch="gpt-less-thinking"]'), () => click('.tip [data-switch="gpt-shorter-answers"]')]],
  ];

  for (const [scenario, switches] of walks) {
    it(`${scenario}: equals the difference between the two printed numbers, for every switch in any order`, () => {
      const store = open(scenario);
      rest();
      const roll = dice(scenario.length);
      const moves = [...switches, () => slide('grid', roll()), () => slide('cacheRead', roll()), () => click('[data-reset]')];
      let chips = 0;
      for (let step = 0; step < 250; step++) {
        const before = printedMid();
        const from = store.getView().result;
        moves[Math.floor(roll() * moves.length)]?.();
        const to = store.getView().result;
        if (!from || !to) throw new Error('the result went away');
        const chip = chipText('.dp-mid-label .delta');
        expect(chipText('[data-pill-chip]')).toBe(chip);
        expect(chip).toBe(massChange(from.range.mid, to.range.mid, to.unit, from.unit));
        rest();
        // Worked out again from what is on the page, without the function the page itself uses.
        // The number before is read in the unit it was shown in.
        const perKg = { kg: 1, g: 1000, mg: 1_000_000 };
        const difference = Math.round((printedMid() - (before * perKg[to.unit]) / perKg[from.unit]) * 100) / 100;
        const printed = Math.abs(difference).toLocaleString('en', { maximumFractionDigits: 2 });
        expect(chip).toBe(difference === 0 ? null : `${difference < 0 ? '−' : '+'}${printed} ${to.unit}`);
        if (chip) chips += 1;
        expect(chipText('.dp-mid-label .delta')).toBeNull();
      }
      expect(chips).toBeGreaterThan(60);
    });
  }

  it('covers every on/off combination of the three hidden-work switches, in every order', () => {
    const ids = ['thinking', 'instructions-memory', 'search-files'];
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const order of orders) {
      unmount?.();
      const store = open('gpt-done');
      rest();
      // Off one by one in this order, then on again in the same order.
      for (const i of [...order, ...order]) {
        const before = printedMid();
        click(`[data-switch="${ids[i]}"]`);
        const chip = chipText('.dp-mid-label .delta');
        rest();
        const difference = Math.round((printedMid() - before) * 10) / 10;
        expect(chip).toBe(difference === 0 ? null : `${difference < 0 ? '−' : '+'}${plainNumber(Math.abs(difference))} ${store.getView().result?.unit}`);
      }
      expect(printedMid()).toBe(1.8);
    }
  });
});

describe('what the example data must not claim', () => {
  it('labels the page as example data, in the page and in the result', () => {
    open('cc-done');
    expect(shown('.example-bar')).toBe(false);
    showExampleLabels();
    // Asked twice, the labels are still there once.
    showExampleLabels();
    expect(document.querySelectorAll('[data-example]').length).toBe(2);
    // The bar comes before the header, so it is the first thing read.
    expect(document.querySelector('.example-bar')?.nextElementSibling?.querySelector('header.site')).not.toBeNull();
    expect(text('.example-bar')).toBe('Example data. Every figure on this page is made up to show how it works. None of it is your own use.');
    expect(text('[data-result] [data-example]')).toBe('Example figures, not yours');
    // The tag stands right under the line that names the range, and not in the row of the other tags:
    // on a narrow screen that row moves below the switches, a screen away from the figures.
    const tag = document.querySelector('[data-result] [data-example]');
    expect(tag?.previousElementSibling?.hasAttribute('data-summary-line')).toBe(true);
    expect(tag?.closest('[data-tags]')).toBeNull();
    expect(tag?.compareDocumentPosition(document.querySelector('[data-likely]') as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    click('[data-switches-list] [data-switch="cc-opus-to-sonnet"]');
    expect(document.querySelector('[data-tags]')?.classList.contains('is-empty')).toBe(false);
    expect(text('[data-result] [data-example]')).toBe('Example figures, not yours');
  });

  it('dates only what was really checked: the sources of the assumptions and the three prices', () => {
    for (const scenario of ['cc-done', 'gpt-done'] as const) {
      unmount?.();
      open(scenario);
      for (const source of Array.from(document.querySelectorAll('.sl-src'))) expect(source.textContent).toMatch(/^Source: .+\. Checked 7 Oct 2026\.( Soft: .+)?$/);
      expect(text('[data-result]')).not.toMatch(/checked/i);
      expect(text('#tips')).not.toMatch(/checked/i);
    }
    expect(text('[data-footnote]')).toBe(
      'Prices and minimums were checked on 7 Oct 2026 and can change. These are three examples, one of each kind. ai-co2 gets nothing from them.',
    );
    expect(text('[data-footnote] strong')).toBe('Prices and minimums were checked on 7 Oct 2026 and can change.');
  });

  it('lists hidden work only for ChatGPT, and a hardware share that agrees with its slider', () => {
    open('cc-done');
    expect(text('[data-counted]')).not.toContain('ChatGPT');
    expect(text('[data-counted]')).toContain('Making the hardware, about 10–13% on top.');
    expect(Array.from(document.querySelectorAll('[data-key="s:hardware"] .sl-scale span'), n => n.textContent)).toEqual(['1.100', 'typical', '1.130']);
    expect(text('[data-key="s:hardware"] output')).toBe('1.115');
    expect(text('[data-left-out]')).toContain('Claude Code use on other computers, in cloud sessions and over SSH.');
    unmount?.();
    open('gpt-done');
    expect(text('[data-counted]')).toContain('Estimated on top: thinking, hidden instructions, memory, web pages and files.');
    expect(text('[data-left-out]')).toContain('Temporary and deleted chats. They are not in the export.');
    expect(text('[data-method-notes-list]')).toContain('The whole-history line uses today’s energy and grid values for use from years ago.');
  });

  it('prices each option by its own rule, in its own currency', () => {
    open('cc-done');
    const forYourRange = () => Array.from(document.querySelectorAll('[data-field="forYourRange"]'), n => n.textContent);
    expect(forYourRange()).toEqual([
      '$2–17. At the middle estimate: $5. Plus tax where it applies.',
      '€5. That is their minimum. On their form it covers up to 40 kg.',
      'You choose. The smallest donation is 10 euros.',
    ]);
    expect(Array.from(document.querySelectorAll('.opt a'), a => a.textContent)).toEqual(['Go to Climeworks (opens in a new tab)', 'Go to ForTomorrow (opens in a new tab)', 'Go to Effektiv Spenden (opens in a new tab)']);
    unmount?.();
    open('gpt-done');
    expect(forYourRange()).toEqual([
      '$0.50–3.50. At the middle estimate: $1. Plus tax where it applies.',
      '€5. That is their minimum. On their form it covers up to 40 kg.',
      'You choose. The smallest donation is 10 euros.',
    ]);
  });

  it('uses an example answer in the format the script prints', () => {
    const lines = SAMPLE_ANSWER.split('\n');
    expect(lines[0]).toMatch(/^ai-co2 v1 \| \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d \| data \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d$/);
    const models = lines.slice(1, -1);
    expect(models.length).toBe(3);
    let sum = 0;
    for (const line of models) {
      const m = line.match(/^[A-Za-z][\w.:\/@-]* \| in (\d+) \| cache_write (\d+) \| cache_read (\d+) \| out (\d+)$/);
      if (!m) throw new Error(`not a model line: ${line}`);
      sum += m.slice(1).reduce((a, b) => a + Number(b), 0);
    }
    expect(lines.at(-1)).toBe(`total | ${sum}`);
  });
});

describe('what the example store shows of the finished contract', () => {
  it('prints the energy slider size by size once there is a result, and one row before', () => {
    open('cc-steps');
    expect(text('[data-key="s:energy"] label')).toBe('Energy to write 1,000 tokens, large models');
    expect(text('[data-key="s:energy"] output')).toBe('1.0 Wh');
    unmount?.();
    open('cc-done');
    expect(text('[data-key="s:energy"] output')).toBe('large 1.0 Wh · mid-size 0.60 Wh · small 0.10 Wh');
    slide('energy', 1);
    rest();
    expect(text('[data-key="s:energy"] output')).toBe('large 5.4 Wh · mid-size 2.2 Wh · small 0.40 Wh');
    unmount?.();
    open('gpt-done');
    expect(text('[data-key="s:energy"] label')).toBe('Energy to write 1,000 tokens, mid-size models');
    expect(text('[data-key="s:energy"] output')).toBe('mid-size 0.60 Wh · small 0.10 Wh');
    expect(document.querySelector('[data-key="s:cacheWrite"]')).toBeNull();
  });

  it('keeps the thumb’s place on the track, not the value, when the tool and its energy row change', () => {
    const store = open('cc-done');
    slide('energy', 1);
    click('[data-switch-source]');
    const energy = store.getView().method.assumptions.find(a => a.id === 'energy');
    // Still at the right end, which is 2.2 Wh on the mid-size row.
    expect(energy?.pinned).toBe(true);
    expect(energy?.value).toBe(2.2);
  });

  it('says where each hidden-work setting came from, and that the person changed it', () => {
    open('gpt-done');
    const notes = () => Array.from(document.querySelectorAll('[data-switches-list] .tg-src'), n => n.textContent);
    expect(Array.from(document.querySelectorAll('[data-switches-list] .tg-label'), n => n.textContent)).toEqual(['Thinking', 'Hidden instructions and memory', 'Search results and file contents', 'Plus or Pro plan']);
    expect(notes()).toEqual(['Set from your export', 'Typical setting', 'Set from your export', 'Set from your export']);
    click('[data-switch="instructions-memory"]');
    expect(notes()[1]).toBe('Changed by you.');
    expect(document.querySelector('[data-switches-list] .tg:nth-child(2) .tg-src svg')).toBeNull();
    // Its two sliders stay in the list, and say why they change nothing now.
    expect(text('[data-key="s:hidden:prompt"] .sl-note')).toBe('This is switched off in your result.');
    expect(text('[data-key="s:hidden:personal"] .sl-note')).toBe('This is switched off in your result.');
    expect(shown('[data-key="s:hidden:thinking"] .sl-note')).toBe(false);
    slide('hidden:prompt', 1);
    rest();
    expect(shown('[data-tag-set]')).toBe(false);
    click('[data-switch="instructions-memory"]');
    expect(notes()[1]).toBe('Typical setting');
    expect(text('[data-tag-set]')).toBe('With 1 assumption set by you');
  });

  it('says that a tip saves nothing once its piece of hidden work is switched off', () => {
    open('gpt-done');
    click('.tip [data-switch="gpt-less-thinking"]');
    click('[data-switch="thinking"]');
    rest();
    const tip = document.querySelector('.tip [data-switch="gpt-less-thinking"]')?.closest('.tip');
    expect(tip?.querySelector('[data-body]')?.textContent).toBe('With your current settings this change saves nothing.');
    // Switched off again, a tip that saves nothing is no longer offered.
    click('.tip [data-switch="gpt-less-thinking"]');
    expect(document.querySelector('.tip [data-switch="gpt-less-thinking"]')).toBeNull();
    expect(document.querySelectorAll('.tip').length).toBe(1);
  });

  it('lets the scale only go up while a slider is dragged, and fit again when it is let go', () => {
    const store = open('cc-done');
    const input = document.querySelector<HTMLInputElement>('[data-key="s:energy"] input');
    if (!input) throw new Error('no slider');
    const drag = (position: number) => {
      input.value = String(Math.round(position * Number(input.max)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    expect(store.getView().result?.scaleMax).toBe(50);
    drag(1);
    expect(store.getView().result?.scaleMax).toBe(100);
    drag(0);
    expect(store.getView().result?.scaleMax).toBe(100);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // Let go at the low end, the range is smaller than it was at the start, and the scale fits that.
    expect(store.getView().result?.scaleMax).toBe(20);
  });
});

describe('the example store holds its ground', () => {
  const paste = (value: string) => {
    const box = document.querySelector<HTMLTextAreaElement>('[data-answer]');
    if (!box) throw new Error('no paste box');
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);
  };

  it('takes no pasted answer while ChatGPT is the tool', () => {
    const store = open('gpt-steps');
    store.dispatch({ type: 'set-answer', text: answer() });
    expect(store.getView().stage).toBe('steps');
    expect(store.getView().result).toBeNull();
    expect(shown('[data-result-top]')).toBe(false);
  });

  it('shows no result for ChatGPT when the tool is switched right after a paste', () => {
    open('cc-steps');
    const box = document.querySelector<HTMLTextAreaElement>('[data-answer]');
    if (!box) throw new Error('no paste box');
    box.value = answer();
    box.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(9);
    click('[data-switch-source]');
    rest();
    expect(text('[data-chosen-name]')).toBe('ChatGPT');
    expect(text('[data-tool="chatgpt"] [data-status]')).toBe('WaitingDrop your export');
    expect(shown('[data-result-top]')).toBe(false);
    expect(shown('#tips')).toBe(false);
  });

  it('says what is wrong with dates that do not exist or run backwards', () => {
    open('cc-steps');
    paste(answer('ai-co2 v1 | 2026-13-45 to 2026-99-99 | data 2026-13-45 to 2026-99-99'));
    expect(text('[data-answer-msg]')).toBe('A date in the first line is not a real date. Copy the whole block from Claude Code again.');
    paste(answer('ai-co2 v1 | 2026-02-30 to 2026-03-29 | data 2026-02-30 to 2026-03-29'));
    expect(text('[data-answer-msg]')).toContain('not a real date');
    paste(answer('ai-co2 v1 | 2026-10-07 to 2026-09-08 | data 2026-09-08 to 2026-10-07'));
    expect(text('[data-answer-msg]')).toBe('This answer covers the wrong number of days. The page needs exactly 30. Copy the prompt from this page again and run it once more.');
    expect(text('main')).not.toMatch(/NaN|-\d+ days/);
  });

  it('turns away token counts and answers that are too large to be real', () => {
    open('cc-steps');
    paste(answer(undefined, `claude-opus-5-5 | in 1 | cache_write 2 | cache_read 3 | out ${'4'.repeat(30)}`));
    expect(text('[data-answer-msg]')).toBe('One of the numbers is too large to be a token count. Copy the whole block from Claude Code again.');
    expect(shown('[data-result-top]')).toBe(false);
    const many = Array.from({ length: 2000 }, (_, i) => `claude-model-${i} | in 1 | cache_write 2 | cache_read 3 | out 4`).join('\n');
    paste(answer(undefined, many, '20000'));
    expect(text('[data-answer-msg]')).toContain('That is much longer than an answer from Claude Code.');
    expect(document.querySelectorAll('.models tbody tr').length).toBe(0);
  });

  it('counts only the sliders of the tool on the page as set', () => {
    const store = open('cc-done');
    slide('cacheWrite', 1);
    click('[data-switch-source]');
    drop(['export.zip']);
    vi.advanceTimersByTime(4000);
    // ChatGPT has no cache writes, so that slider is neither on the page nor counted.
    expect(shown('[data-tag-set]')).toBe(false);
    slide('hidden:thinking', 1);
    slide('grid', 1);
    rest();
    expect(text('[data-tag-set]')).toBe('With 2 assumptions set by you');
    click('[data-switch-source]');
    paste(answer());
    rest();
    expect(store.getView().source).toBe('claude-code');
    expect(document.querySelectorAll('.sl.is-set').length).toBe(2);
    expect(text('[data-tag-set]')).toBe('With 2 assumptions set by you');
  });

  it('stops calling a tip’s first bar "Now" once a tip is applied', () => {
    open('cc-done');
    const labels = () => Array.from(document.querySelectorAll('.tip .tv-label'), n => n.textContent);
    expect(labels()).toEqual(['Now', 'Less re-reading', 'Now', 'Sonnet']);
    click('[data-switches-list] [data-switch="cc-opus-to-sonnet"]');
    rest();
    expect(text('[data-range]')).toBe('Likely range: 3.1 to 29 3.1–29kg');
    expect(labels()).toEqual(['Without tips', 'Less re-reading', 'Without tips', 'Sonnet']);
    expect(text('.tip [data-values="now"]')).toBe('3.7–34 kg');
    click('[data-switches-list] [data-switch="cc-opus-to-sonnet"]');
    expect(labels()).toEqual(['Now', 'Less re-reading', 'Now', 'Sonnet']);
  });
});
