// The sentences of words.ts that hold a number or a name from somewhere else. Each test reads both:
// the sentence as a person sees it, word for word, and the constant it has to agree with. A constant
// that changes without its sentence, or a sentence without its constant, fails here.

import { describe, expect, it } from 'vitest';
import { ASSUMPTION_ROWS, ENERGY_ROWS, MARKET_GRID, SLIDERS, rowOf } from '../model/assumptions';
import { RULES, pickTips } from '../model/tips';
import { CEILING, FILE_LIMITS, WARM_SECONDS } from '../sources/chatgpt';
import { summary } from './derive-result';
import { ANSWER_A, TODAY, answer, chose, exampleReading, paste, readIn, setTo, shownFor, stateAfter, toggle } from './test-kit';
import {
  FABLE_NOTE,
  FIXED_ASSUMPTIONS,
  LEAST_CERTAIN,
  LEAST_CERTAIN_WITH_UNKNOWN,
  UNKNOWN_SIZE_NOTE,
  WIDER_FROM_SHARE,
  appliedLabel,
  extremeLabel,
  marketNote,
  mattersMostNote,
  problemWords,
  shortDataNote,
  summaryWords,
  unknownModelNote,
  unnamedStepsNote,
} from './words';

describe('a number in a sentence is the number the page counts with', () => {
  it('E2 names the reader\'s own limit of dropped files', () => {
    expect(FILE_LIMITS.maxDroppedFiles).toBe(20);
    expect(problemWords({ code: 'E2' })).toBe('That is more than 20 ZIP files. Drop the export ZIP on its own, or only the conversations files from inside it.');
  });

  it('the two fixed assumptions of the ChatGPT count name the reader\'s own minutes and ceilings', () => {
    expect(WARM_SECONDS).toBe(30 * 60);
    expect(CEILING).toEqual({ paid: { instant: 34_000, thinking: 236_000 }, free: { instant: 7_000, thinking: 7_000 } });
    expect(FIXED_ASSUMPTIONS[0]).toBe(
      'We assume ChatGPT reuses its earlier reading when you reply within 30 minutes. OpenAI documents this for its developer service, not for ChatGPT.',
    );
    expect(FIXED_ASSUMPTIONS[1]).toBe(
      'We assume ChatGPT keeps at most about 34,000 tokens of earlier conversation for instant models and 236,000 for thinking models on Plus or Pro, and 7,000 on Free or Go. OpenAI publishes the total window, not this share.',
    );
  });

  it('the plans in that sentence are the two places of the plan switch, never "paid" and "free": Go is paid and counts as Free', () => {
    const text = FIXED_ASSUMPTIONS.join(' ');
    expect(text).not.toMatch(/paid plan|free plan/i);
    const { view } = shownFor(stateAfter([chose('chatgpt'), ...readIn(exampleReading('current', true))]));
    const plan = view.result?.switches.items.find((item) => item.id === 'plan-paid');
    expect(plan?.label).toContain('Plus or Pro');
    expect(FIXED_ASSUMPTIONS[1]).toContain('on Plus or Pro, and');
    expect(FIXED_ASSUMPTIONS[1]).toContain('on Free or Go.');
  });

  it('the clean-power line names the grid value the estimate is worked out with', () => {
    expect(MARKET_GRID).toBe(70);
    expect(marketNote(1.1, 2.8, 9.6, 'kg', false)).toBe(
      "Counted with the clean power that Google and Microsoft buy, about 70 g per kWh, and with making the hardware counted as before, your range would be 1.1–9.6 kg, middle estimate 2.8 kg. The power their data centres draw is no cleaner than the local grid's, so this is shown only for comparison.",
    );
    expect(marketNote(1.7, 1.7, 1.7, 'kg', true)).toBe(
      "Counted with the clean power that Google and Microsoft buy, about 70 g per kWh, and with making the hardware counted as before, your result would be about 1.7 kg. The power their data centres draw is no cleaner than the local grid's, so this is shown only for comparison.",
    );
  });

  it('the clean-power line says why it is more than the shown result times 70/350: the hardware is counted as before', () => {
    const { calc } = shownFor(stateAfter([chose('claude-code'), paste(ANSWER_A)]));
    if (!calc?.full.market) throw new Error('no market line');
    const typicalGrid = ASSUMPTION_ROWS.grid.triple[1];
    // What a reader would work out from the formula on the page.
    const byFormula = calc.full.range.mid * MARKET_GRID / typicalGrid;
    expect(calc.full.market.mid).toBeGreaterThan(byFormula * 1.2);
    expect(marketNote(calc.full.market.p5, calc.full.market.mid, calc.full.market.p95, 'kg', false)).toContain('and with making the hardware counted as before,');
  });

  it('"100 times" and "108 times" are the high value over the low value of their rows', () => {
    const [low, , high] = ASSUMPTION_ROWS.cacheRead.triple;
    expect(Math.round(high / low)).toBe(100);
    const [unknownLow, , unknownHigh] = ENERGY_ROWS.unknown.triple;
    expect(Math.round(unknownHigh / unknownLow)).toBe(108);
    expect(LEAST_CERTAIN).toBe(
      'The least certain number in the list of assumptions below is “Re-reading a stored token, compared with writing one”: its high value is 100 times its low value.',
    );
    expect(LEAST_CERTAIN_WITH_UNKNOWN).toBe(
      "Among the numbers that apply to everyone, the least certain is “Re-reading a stored token, compared with writing one”: its high value is 100 times its low value. The energy of the models we don't know is as uncertain: its high value is 108 times its low value.",
    );
  });

  it('the energy ranges of Fable and of the models nobody can place are those of their rows', () => {
    const ends = (size: 'fable' | 'unknown'): string => `${String(ENERGY_ROWS[size].triple[0])} to ${String(ENERGY_ROWS[size].triple[2])} Wh per 1,000 tokens.`;
    expect(ends('fable')).toBe('0.5 to 10.8 Wh per 1,000 tokens.');
    expect(ends('unknown')).toBe('0.05 to 5.4 Wh per 1,000 tokens.');
    expect(FABLE_NOTE.endsWith(` Its energy runs from ${ends('fable')}`)).toBe(true);
    expect(UNKNOWN_SIZE_NOTE.endsWith(`: ${ends('unknown')}`)).toBe(true);
    // One wording of the price fact: the slider's own.
    expect(FABLE_NOTE.startsWith(ENERGY_ROWS.fable.explanation)).toBe(true);
  });

  it('"the last 30 days" and "a month" start at the same number of covered days', () => {
    const [from] = RULES.monthDays;
    const day = (daysCovered: number): string => {
      // The first day with use, so that the answer covers exactly that many days up to 7 Oct.
      const start = new Date(Date.UTC(2026, 9, 7 - daysCovered + 1));
      return start.toISOString().slice(0, 10);
    };
    for (const days of [from - 1, from]) {
      const { counted, view } = shownFor(stateAfter([chose('claude-code'), paste(answer([{ model: 'claude-opus-5-5', in: 4_000_000, out: 2_000_000 }], { first: day(days) }))]));
      if (!counted || !view.result) throw new Error('no result');
      const month = days >= from;
      expect(counted.covered.days).toBe(month ? 30 : days);
      expect(summary(counted, false, TODAY).includes('in the last 30 days')).toBe(month);
      expect(view.tips.length).toBeGreaterThan(0);
      for (const tip of view.tips) expect(JSON.stringify(tip.body).includes('a month')).toBe(month);
    }
  });
});

describe('an assumption is named by the words that stand on its slider', () => {
  it('for both tools: the name in the sentence is a label that is on the page', () => {
    for (const source of ['claude-code', 'chatgpt'] as const) {
      const text = source === 'claude-code' ? [chose(source), paste(ANSWER_A)] : [chose(source), ...readIn(exampleReading('current', true))];
      const { view } = shownFor(stateAfter(text));
      const labels = view.method.assumptions.map((entry) => entry.label);
      expect(labels.length).toBeGreaterThan(5);
      const note = view.method.notes[0] ?? '';
      const named = /what matters most (?:for your result )?is “(.*)”\. Set its slider/i.exec(note)?.[1];
      // The name in the sentence is a label a person can find on the page.
      expect(labels).toContain(named);
    }
  });

  it('in both forms of the sentence, in quotation marks', () => {
    expect(mattersMostNote('Re-reading a stored token, compared with writing one', 5.1, 19, 'kg', false)).toBe(
      'What matters most for your result is “Re-reading a stored token, compared with writing one”. Set its slider to low and then to high: your middle estimate goes from 5.1 to 19 kg.',
    );
    expect(mattersMostNote('CO₂ per unit of electricity', 0.0051, 0.019, 'g', true)).toBe(
      'Of the assumptions you have not set, what matters most is “CO₂ per unit of electricity”. Set its slider to low and then to high: your middle estimate goes from 5.1 to 19 g.',
    );
  });

  it('and the sentence stays away when its two numbers print the same: "from 17 to 17 kg" tells nobody anything', () => {
    // Every slider but the hardware one is set, and the energy slider high enough for whole kilograms.
    const others = SLIDERS['claude-code'].filter((id) => id !== 'hardware' && id !== 'energy');
    const events = [chose('claude-code'), paste(ANSWER_A), setTo('energy', 2.05), ...others.map((id) => setTo(id, rowOf(id, 'large').triple[1]))];
    const { calc, view } = shownFor(stateAfter(events));
    const biggest = calc?.full.biggestUnknown;
    if (!calc || !biggest) throw new Error('no biggest unknown');
    // The case is the one meant: a range, the hardware slider is what is left, and both ends print as one number.
    expect(calc.full.single).toBe(false);
    expect(biggest.id).toBe('hardware');
    expect(biggest.middleAtHigh).toBeGreaterThan(biggest.middleAtLow);
    expect(Math.round(biggest.middleAtLow)).toBe(Math.round(biggest.middleAtHigh));
    expect(biggest.middleAtLow).toBeGreaterThan(10);
    expect(view.method.notes.some((note) => /matters most/i.test(note))).toBe(false);
    expect(view.method.notes.some((note) => /goes from (\S+) to \1 /.test(note))).toBe(false);
    // With numbers that differ on screen, both sentences are there.
    const typical = shownFor(stateAfter([chose('claude-code'), paste(ANSWER_A), ...['energy' as const, ...others].map((id) => setTo(id, rowOf(id, 'large').triple[1]))])).view;
    expect(typical.method.notes[0]).toMatch(/^Of the assumptions you have not set, what matters most is “Making the hardware, as a factor on top”\. Set its slider to low and then to high: your middle estimate goes from 8\.5 to 8\.7 kg\.$/);
    expect(typical.method.notes[1]).toContain('“Matters most” is worked out like this');
  });
});

describe('the extreme range is called by its name where its number stands', () => {
  it('in every form of its label', () => {
    expect(extremeLabel(false, 0)).toBe('Extreme range (every low or every high assumption combined)');
    expect(extremeLabel(true, 0)).toBe('Extreme range (every assumption you have not set, at its low or at its high)');
    expect(extremeLabel(false, 1)).toBe('Extreme range (every low or every high assumption combined, with your tip applied)');
    expect(extremeLabel(true, 2)).toBe('Extreme range (every assumption you have not set, at its low or at its high, with your tips applied)');
  });
});

describe('the days a result stands for are named by what the page knows', () => {
  const FIRST = '2026-09-11';
  const LAST = '2026-10-02';

  it('Claude Code: the first use the script found, not where "the logs start"', () => {
    expect(shortDataNote(FIRST, '2026-10-07', 27)).toBe(
      'The first use found in these 30 days was on 11 Sep. The result covers 27 days (11 Sep – 7 Oct), not a full 30. If you used Claude Code on this computer earlier in these 30 days, those logs are no longer here.',
    );
    expect(shortDataNote('2026-10-07', '2026-10-07', 1)).toBe(
      'The first use found in these 30 days was on 7 Oct. The result covers one day (7 Oct), not a full 30. If you used Claude Code on this computer earlier in these 30 days, those logs are no longer here.',
    );
    expect(summaryWords('claude-code', 'days', FIRST, '2026-10-07', 27, false)).toBe('Likely CO₂e from Claude Code in the 27 days from your first use (11 Sep – 7 Oct)');
    expect(summaryWords('claude-code', 'one-day', '2026-10-07', '2026-10-07', 1, false)).toBe('Likely CO₂e from Claude Code on the one day with use (7 Oct)');
    expect(summaryWords('claude-code', 'days', FIRST, '2026-10-07', 27, true)).toBe(
      'CO₂e from Claude Code in the 27 days from your first use (11 Sep – 7 Oct), with every assumption that changes your result set by you',
    );
  });

  it('ChatGPT: the oldest and the newest message, not what "the export covers"', () => {
    expect(summaryWords('chatgpt', 'days', '2026-09-08', LAST, 25, false, 'end')).toBe('Likely CO₂e from ChatGPT in the 25 days up to your newest message (8 Sep – 2 Oct)');
    expect(summaryWords('chatgpt', 'days', FIRST, '2026-10-07', 27, false, 'start')).toBe('Likely CO₂e from ChatGPT in the 27 days from your oldest message (11 Sep – 7 Oct)');
    expect(summaryWords('chatgpt', 'days', FIRST, LAST, 22, false, 'both')).toBe('Likely CO₂e from ChatGPT in the 22 days from your oldest to your newest message (11 Sep – 2 Oct)');
    expect(summaryWords('chatgpt', 'one-day', LAST, LAST, 1, false, 'both')).toBe('Likely CO₂e from ChatGPT on the one day with messages (2 Oct)');
    expect(summaryWords('chatgpt', 'one-day', LAST, LAST, 1, true)).toBe(
      'CO₂e from ChatGPT on the one day with messages (2 Oct), with every assumption that changes your result set by you',
    );
  });

  it('says that the range is a what-if while a tip that changes it is applied', () => {
    expect(summaryWords('claude-code', 'last-30', '2026-09-08', '2026-10-07', 30, false, 'end', 1)).toBe('Likely CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct), with your tip applied');
    expect(summaryWords('claude-code', 'last-30', '2026-09-08', '2026-10-07', 30, false, 'end', 2)).toBe('Likely CO₂e from Claude Code in the last 30 days (8 Sep – 7 Oct), with your tips applied');
    expect(summaryWords('chatgpt', 'days', '2026-09-08', LAST, 25, false, 'end', 1)).toBe('Likely CO₂e from ChatGPT in the 25 days up to your newest message (8 Sep – 2 Oct), with your tip applied');
    expect(summaryWords('claude-code', 'older-30', '2026-08-01', '2026-08-30', 30, true, 'end', 1)).toBe(
      'CO₂e from Claude Code in the 30 days from 1 Aug to 30 Aug, with your tip applied and every assumption that changes your result set by you',
    );
    expect(summaryWords('claude-code', 'last-30', '2026-09-08', '2026-10-07', 30, false, 'end', 0)).toBe(summaryWords('claude-code', 'last-30', '2026-09-08', '2026-10-07', 30, false));
  });

  it('the full 30 days are worded as before', () => {
    expect(summaryWords('chatgpt', 'last-30', '2026-09-08', '2026-10-07', 30, false)).toBe('Likely CO₂e from ChatGPT in the last 30 days (8 Sep – 7 Oct)');
    expect(summaryWords('claude-code', 'older-30', '2026-08-01', '2026-08-30', 30, false)).toBe('Likely CO₂e from Claude Code in the 30 days from 1 Aug to 30 Aug');
  });

  it('no sentence says what the logs or the export "cover", or where the logs "start"', () => {
    const all = [
      shortDataNote(FIRST, '2026-10-07', 27),
      ...(['claude-code', 'chatgpt'] as const).flatMap((source) =>
        (['last-30', 'older-30', 'days', 'one-day'] as const).flatMap((form) =>
          (['start', 'end', 'both'] as const).flatMap((gap) => [true, false].map((single) => summaryWords(source, form, FIRST, LAST, 22, single, gap))))),
    ];
    for (const text of all) expect(text).not.toMatch(/logs cover|export covers|logs start/);
  });
});

describe('models the page cannot place', () => {
  it('"that makes your range wider" is said from 1% of the tokens, where it can be true', () => {
    expect(WIDER_FROM_SHARE).toBe(0.01);
    expect(unknownModelNote('acme', 0.0099)).toBe("We don't know the model “acme”. It makes up 1% of your tokens. We counted it with our widest range, from a small model to a large one.");
    expect(unknownModelNote('acme', 0.001)).toBe("We don't know the model “acme”. It makes up <1% of your tokens. We counted it with our widest range, from a small model to a large one.");
    expect(unknownModelNote('acme', 0.01)).toBe(
      "We don't know the model “acme”. It makes up 1% of your tokens. We counted it with our widest range, from a small model to a large one. That makes your range wider.",
    );
    expect(unnamedStepsNote(0.001)).toBe('Some steps in your logs name no model. They make up <1% of your tokens. We counted them with our widest range, from a small model to a large one.');
    expect(unnamedStepsNote(0.3)).toBe(
      'Some steps in your logs name no model. They make up 30% of your tokens. We counted them with our widest range, from a small model to a large one. That makes your range wider.',
    );
  });
});

describe('the tag for applied tips', () => {
  it('is worded as the tip list words it, for one tip and for several', () => {
    expect(appliedLabel([])).toBeNull();
    for (const applied of [['cc-clear'], ['cc-clear', 'cc-effort'], ['cc-clear', 'cc-effort', 'cc-opus-to-sonnet']]) {
      const { counted, calc, view } = shownFor(stateAfter([chose('claude-code'), paste(ANSWER_A), ...applied.map((id) => toggle(id))]));
      if (!counted || !calc) throw new Error('no result');
      const picked = pickTips({ source: 'claude-code', built: counted.built, result: calc.full, unit: calc.fullUnit, coveredDays: counted.covered.days });
      expect(view.result?.appliedLabel).toBe(picked.appliedLabel);
      expect(view.result?.appliedLabel).toBe(applied.length === 1 ? 'With: A third less re-reading' : `With ${applied.length} tips applied`);
    }
  });
});

describe('the green line over a pasted answer', () => {
  const status = (lines: Parameters<typeof answer>[0]): { confirmation: string; notes: string[] } => {
    const { view } = shownFor(stateAfter([chose('claude-code'), paste(answer(lines))]));
    const shown = view.data.claudeCode.status;
    if (shown.state !== 'ok') throw new Error('the answer was not accepted');
    return shown;
  };

  it('calls the numbers plausible when no remark says otherwise', () => {
    expect(status([{ model: 'claude-opus-5-5', in: 1000, out: 500 }])).toMatchObject({ confirmation: 'The numbers add up and look plausible.', notes: [] });
    // A remark about a model the page cannot place is not a remark about the numbers.
    expect(status([{ model: 'claude-opus-5-5', in: 1000, out: 500 }, { model: 'my-local-model', in: 400 }]).confirmation).toBe('The numbers add up and look plausible.');
  });

  it('says only that they add up beside a remark that they are unusual', () => {
    const gateway = status([{ model: 'claude-opus-5-5', out: 500 }]);
    expect(gateway.notes).toEqual(['The model “claude-opus-5-5” shows output but no input, which the logs of some gateways cause. The page will use it as it is.']);
    expect(gateway.confirmation).toBe('The numbers add up.');
    for (const lines of [[{ model: 'claude-opus-5-5', in: 10, out: 9e9 }], [{ model: 'claude-opus-5-5', in: 9e11, read: 9e11, out: 10 }]]) {
      const unusual = status(lines);
      expect(unusual.notes.some((note) => note.startsWith('That is an unusually large'))).toBe(true);
      expect(unusual.confirmation).toBe('The numbers add up.');
    }
  });
});
