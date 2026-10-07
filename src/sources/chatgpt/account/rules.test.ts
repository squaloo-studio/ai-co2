import { describe, expect, it } from 'vitest';
import * as reference from './fixtures/reference.mjs';
import { imageTokens, isThinkingSlug, normaliseTime, promptWeight, recapSeconds, withoutMarkers } from './rules';
import { RECAP_WORDINGS, seeded } from './test-kit';

describe('thinking times', () => {
  it('reads every wording the exports show', () => {
    const read = (text: string) => recapSeconds(undefined, text);
    expect([
      read('Thought for 19s'), read('Thought for 1m 12s'), read('Worked for 24s'), read('Thought for 5 seconds'), read('Thought for a couple of seconds'),
      read('Thought for a few seconds'), read('Thought for a second'), read('Thought for 2 minutes'), read('Thought for 1h 2m 3s'),
      read('Thought about 3 hypotheses for 5s'), read('Thought for a minute'), read('Worked for 2m 9s'), read('Nachgedacht'), read(''),
    ]).toEqual([19, 72, 24, 5, 2, 4, 1, 120, 3723, 5, 60, 129, null, null]);
  });

  it('prefers the number the export gives', () => {
    expect(recapSeconds(7, 'Thought for 19s')).toBe(7);
    expect(recapSeconds(0, 'Thought for 19s')).toBe(0);
    expect(recapSeconds(-1, 'Thought for 19s')).toBe(19);
    expect(recapSeconds('7', 'Thought for 19s')).toBe(19);
    expect(recapSeconds(Infinity, 'Thought for 19s')).toBe(19);
  });

  it('agrees with the reference on every listed wording', () => {
    for (const text of RECAP_WORDINGS) expect(recapSeconds(undefined, text), text).toBe(reference.recapSeconds({ content: { content: text } }));
  });

  it('takes anything that is not a text as unreadable, and reads only the start of a long one', () => {
    for (const odd of [null, undefined, 5, {}, [], true]) expect(recapSeconds(undefined, odd)).toBeNull();
    const started = performance.now();
    expect(recapSeconds(undefined, '1'.repeat(2_000_000))).toBeNull();
    expect(recapSeconds(undefined, `${' '.repeat(300)}Thought for 19s`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('image tokens', () => {
  it('follows the published rule at high detail', () => {
    expect([imageTokens(1024, 1024), imageTokens(2048, 2048), imageTokens(4096, 512), imageTokens(512, 512), imageTokens(1, 1)]).toEqual([1229, 3000, 2458, 308, 2]);
    expect(imageTokens(4032, 3024)).toBeLessThanOrEqual(3000);
  });

  it('agrees with the reference on a thousand sizes', () => {
    const random = seeded(3);
    for (let i = 0; i < 1000; i++) {
      const [w, h] = [1 + Math.floor(random() * 9000), 1 + Math.floor(random() * 9000)];
      expect(imageTokens(w, h), `${w} x ${h}`).toBe(reference.imageTokens(w, h));
    }
  });

  it('counts a size that cannot be true as an image of unknown size', () => {
    for (const [w, h] of [[0, 0], [-5, 100], [NaN, 100], [Infinity, 100], [1e300, 1e300], ['1024', 1024], [null, undefined], [2_000_000, 10]]) {
      expect(imageTokens(w, h)).toBe(1229);
    }
  });

  it('never gives more than 3,000 tokens or less than none', () => {
    for (const [w, h] of [[1_000_000, 1], [1, 1_000_000], [1_000_000, 1_000_000], [0.001, 0.001], [33, 1_000_000]]) {
      const tokens = imageTokens(w, h);
      expect(tokens).toBeGreaterThanOrEqual(0);
      expect(tokens).toBeLessThanOrEqual(3000);
    }
  });
});

describe('the system prompt weight', () => {
  const at = (day: string) => Date.parse(day) / 1000;

  it('follows the periods and the model name', () => {
    expect([
      promptWeight('gpt-5-6', at('2026-09-01')), promptWeight('gpt-5-5', at('2026-05-01')), promptWeight('gpt-5-2', at('2025-12-01')),
      promptWeight('gpt-4o', at('2025-01-01')), promptWeight('gpt-4', at('2023-06-01')), promptWeight('gpt-5-3-mini', at('2026-09-01')),
      promptWeight('gpt-5-6-t-mini', at('2026-09-01')), promptWeight('gpt-5-6', null),
    ]).toEqual([1, 0.8, 0.65, 0.12, 0.04, 0.06, 1, 1]);
  });

  it('agrees with the reference on every day since 2023', () => {
    for (let t = at('2023-01-01'); t < at('2027-01-01'); t += 86_400) {
      for (const slug of ['gpt-5-6', 'gpt-4o-mini', 'o4-mini', 'gpt-5-nano']) expect(promptWeight(slug, t)).toBe(reference.promptWeight(slug, t));
    }
  });
});

describe('thinking models by name', () => {
  it('agrees with the reference', () => {
    for (const slug of ['gpt-5-6', 'gpt-5-6-thinking', 'gpt-5-t-mini', 'gpt-5-6-pro', 'o3', 'o4-mini-high', 'gpt-4o', 'auto', 'unknown', 'gpt-5-1-auto-thinking', 'opus']) {
      expect(isThinkingSlug(slug), slug).toBe(reference.isThinkingSlug(slug));
    }
  });
});

describe('times', () => {
  it('reads seconds, and milliseconds as seconds', () => {
    expect(normaliseTime(1_790_000_000.5)).toBe(1_790_000_000.5);
    expect(normaliseTime(1_790_000_000_500)).toBe(1_790_000_000.5);
  });

  it('takes everything else as missing', () => {
    for (const odd of [null, undefined, '1790000000', 0, -1, 5, 1_000_000, NaN, Infinity, 1e300, 1e15, {}, [], true]) expect(normaliseTime(odd)).toBeNull();
  });
});

describe('thinking models by name', () => {
  it('are the names with "thinking", the endings "-t-mini" and "-pro", the o-series, and deep research', () => {
    for (const name of ['gpt-5-5-thinking', 'gpt-5-t-mini', 'gpt-6-pro', 'o3', 'o4-mini', 'research', 'deep-research', 'gpt-5-6-deep-research']) expect(isThinkingSlug(name), name).toBe(true);
    for (const name of ['gpt-5-6', 'gpt-4o', 'gpt-5-3-mini', 'researcher', 'my-research', 'auto', '']) expect(isThinkingSlug(name), name).toBe(false);
  });
});

describe('citation markers', () => {
  const OPEN = '\ue200';
  const SEPARATOR = '\ue202';
  const CLOSE = '\ue201';
  const cite = `${OPEN}cite${SEPARATOR}turn0search0${CLOSE}`;

  it('go, with the words inside them', () => {
    expect(withoutMarkers(`Paris${cite} is a city.${cite}`)).toBe('Paris is a city.');
    expect(withoutMarkers(`${OPEN}entity${SEPARATOR}["city","Paris"]${CLOSE}`)).toBe('');
    expect(withoutMarkers(`a${OPEN}one\ntwo${CLOSE}b`)).toBe('ab');
  });

  it('leave a text without them as it is', () => {
    for (const text of ['', 'plain words', 'a private-use sign of another range: \ue000 \uf8ff', 'emoji \u{1f600}']) expect(withoutMarkers(text)).toBe(text);
  });

  it('take along every character of the range that is left over', () => {
    // An opening sign with nothing to close it, a closing sign alone, and the rarer signs of the range.
    expect(withoutMarkers(`a${OPEN}b`)).toBe('ab');
    expect(withoutMarkers(`a${CLOSE}b${SEPARATOR}c`)).toBe('abc');
    expect(withoutMarkers('a\ue203b\ue204c\ue206d\ue20fe\ue210')).toBe('abcde\ue210');
    // A marker inside a marker: the first closing sign ends it, and the second one goes as a leftover.
    expect(withoutMarkers(`x${OPEN}a${OPEN}b${CLOSE}c${CLOSE}y`)).toBe('xcy');
  });

  it('give what the two replacements of the rule give, on made-up texts', () => {
    const random = seeded(31);
    const signs = [OPEN, CLOSE, SEPARATOR, '\ue203', 'a', 'b', ' ', '\n'];
    for (let n = 0; n < 2_000; n++) {
      const text = Array.from({ length: Math.floor(random() * 30) }, () => signs[Math.floor(random() * signs.length)]).join('');
      expect(withoutMarkers(text)).toBe(text.replace(/\ue200[^\ue201]*\ue201/g, '').replace(/[\ue200-\ue20f]/g, ''));
    }
  });

  it('take one pass, whatever the text holds', () => {
    const started = performance.now();
    expect(withoutMarkers(OPEN.repeat(2_000_000))).toBe('');
    expect(withoutMarkers(`${OPEN}x`.repeat(500_000) + CLOSE)).toBe('');
    expect(withoutMarkers(`${OPEN}${CLOSE}`.repeat(500_000) + 'end')).toBe('end');
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
