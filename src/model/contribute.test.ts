import { describe, expect, it } from 'vitest';
import type { Spread } from '../contracts/usage';
import type { ContributeView, MassUnit } from '../contracts/view';
import { unitFor } from '../format';
import { MODEL_TABLE } from './assumptions';
import {
  NO_PRICE,
  PRICES,
  PROVIDER_LINKS,
  TOO_MUCH_FOR_FORM,
  climeworksCost,
  climeworksWords,
  contributeView,
  costSentence,
  effektivWords,
  footnote,
  forTomorrowCost,
  forTomorrowMinKg,
  forTomorrowWords,
  options,
  printedKg,
} from './contribute';
import { estimate } from './estimate';

const BANNED = /offset|neutral|compensat|net[ -]zero|\bowe|\bdebt/i;

/** A made-up result: the three ends as given, and 100 dots spread evenly from below the low end to above the high end. */
function result(p5: number, mid: number, p95: number, single = false) {
  const from = p5 * 0.8;
  const to = p95 * 1.2;
  const dots = Array.from({ length: 100 }, (_, i) => (single ? mid : from + ((to - from) * i) / 99));
  return { range: { p5, mid, p95 }, dots, single };
}

const words = (view: ContributeView, id: string): string => {
  const option = view.options.find((one) => one.id === id);
  if (option === undefined) throw new Error(`no option ${id}`);
  return option.forYourRange;
};

// The two formulas exactly as the spec prints them, with today's numbers typed in.
const cleanKg = (kg: number) => Math.round(kg * 1000) / 1000;
function specClimeworks(kg: number, pricePerTonne = 500, minKg = 0): number | null {
  if (!(kg > 0) || !(pricePerTonne > 0)) return null;
  const orderKg = Math.max(minKg, 1, Math.ceil(cleanKg(kg)));
  return (orderKg * pricePerTonne) / 1000;
}
function specForTomorrow(kg: number): number | null {
  if (!(kg > 0)) return null;
  const steps = Math.max(1, Math.ceil(cleanKg(kg) / 10));
  const euros = Math.max(5, Math.ceil((steps * 114) / 100));
  return euros > 999999 ? null : euros;
}

describe('the numbers that will change', () => {
  it('are 500 dollars, 114 euros, 5 and 10 euros, checked on 7 Oct 2026', () => {
    expect(PRICES).toEqual({ checked: '2026-10-07', climeworksPerTonne: 500, forTomorrowPerTonne: 114, forTomorrowMin: 5, effektivMin: 10 });
    expect(Object.isFrozen(PRICES)).toBe(true);
  });

  it('give 40 kg as the most the smallest ForTomorrow donation covers', () => {
    expect(forTomorrowMinKg()).toBe(40);
    expect(forTomorrowCost(40)).toBe(PRICES.forTomorrowMin);
    expect(forTomorrowCost(40.001)).toBeGreaterThan(PRICES.forTomorrowMin);
  });
});

describe('the three options', () => {
  const [climeworks, forTomorrow, effektiv] = options();

  it('Climeworks, word for word', () => {
    expect(climeworks).toEqual({
      id: 'climeworks',
      kind: 'Lasting removal',
      name: 'Climeworks',
      price: '500 US dollars per tonne of CO₂, which is 50 cents per kilogram. Tax may be added at checkout. Price on 7 Oct 2026.',
      minimum: 'Climeworks states none. It counts in whole kilograms.',
      whatYouGet:
        'You pay now, and Climeworks delivers later: it says within 7 years after the year you buy. Paying today does not take CO₂ out of the air today. This is its “Technology focus” portfolio, which Climeworks describes as 100% technology-based. You get an order confirmation and an invoice, and after delivery a delivery note and a certificate. This is a purchase, not a donation.',
      url: 'https://climeworks.com/actnow',
      checked: '2026-10-07',
    });
  });

  it('ForTomorrow, word for word', () => {
    expect(forTomorrow).toEqual({
      id: 'fortomorrow',
      kind: 'EU avoidance',
      name: 'ForTomorrow',
      price: '114 euros per tonne for EU emission rights only, which is about 11 cents per kilogram. Price on 7 Oct 2026.',
      minimum: '5 euros. Whole euros only.',
      whatYouGet:
        'ForTomorrow, a non-profit company in Berlin, buys EU emission allowances and keeps them in its own account, so no company can use them. It says it will cancel them later. This does not take CO₂ out of the air. Your payment is a donation, and you get a certificate straight away. Their form can also include tree planting: choose “EU emission rights” if you want allowances only.',
      url: 'https://www.fortomorrow.eu/en/donate-for-climate-protection/?mix=0',
      checked: '2026-10-07',
    });
  });

  it('Effektiv Spenden, word for word', () => {
    expect(effektiv).toEqual({
      id: 'effektiv-spenden',
      kind: 'Donation fund',
      name: 'Effektiv Spenden',
      price: 'No price per tonne. You choose the amount. Checked on 7 Oct 2026.',
      minimum: '10 euros, or 10 francs in the Swiss form. Whole amounts only.',
      whatYouGet:
        'A donation to its climate fund, which passes your money to organisations that work on climate policy and clean technology. The fund does not promise an amount of CO₂. You get a donation receipt, not a certificate. Tax-deductible in Germany, Austria, Switzerland and Czechia, through the form for your country.',
      url: 'https://effektiv-spenden.org/en/spenden-fonds-klima-schutzen/',
      checked: '2026-10-07',
    });
    expect(effektivWords()).toBe('You choose. The smallest donation is 10 euros.');
  });

  it('starts every link with https://, and lists the three for the address test', () => {
    expect(PROVIDER_LINKS).toEqual([climeworks.url, forTomorrow.url, effektiv.url]);
    for (const link of PROVIDER_LINKS) expect(link).toMatch(/^https:\/\/[a-z0-9.-]+\//);
  });

  it('carries nothing about the person in a link: only ForTomorrow has a query, and it is "?mix=0"', () => {
    expect(PROVIDER_LINKS.map((link) => new URL(link).search)).toEqual(['', '?mix=0', '']);
    const before = [...PROVIDER_LINKS];
    const view = contributeView(result(3.7, 9.8, 34), 'kg');
    expect(view.options.map((option) => option.url)).toEqual(before);
  });

  it('never suggests an amount with cents for Effektiv Spenden', () => {
    expect(`${effektiv.price} ${effektiv.minimum} ${effektivWords()}`).not.toMatch(/\d[.,]\d\d\b/);
  });
});

describe('the price rules', () => {
  it.each([
    [0.4, 5, 0.5],
    [2.4, 5, 1.5],
    [13, 5, 6.5],
    [40, 5, 20],
    [43, 6, 21.5],
    [150, 18, 75],
    [1000, 114, 500],
  ])('%s kg: %s euros with ForTomorrow, %s dollars with Climeworks', (kg, euros, dollars) => {
    expect(forTomorrowCost(kg)).toBe(euros);
    expect(climeworksCost(kg)).toBe(dollars);
  });

  it('show no cost for zero kilograms, for less, and for what is not a number', () => {
    for (const kg of [0, -0, -3, Number.NaN, -Infinity]) {
      expect(climeworksCost(kg)).toBeNull();
      expect(forTomorrowCost(kg)).toBeNull();
    }
    expect(climeworksCost(5, 0)).toBeNull();
    expect(climeworksCost(5, Number.NaN)).toBeNull();
  });

  it('do not let rounding noise push the price up one step', () => {
    expect(climeworksCost(3.0000000000000004)).toBe(1.5);
    expect(climeworksCost(0.1 + 0.2 + 2.7)).toBe(1.5);
    expect(forTomorrowCost(50.00000000000001)).toBe(6);
    expect(climeworksCost(50.00000000000001)).toBe(25);
    expect(forTomorrowCost(3.0000000000000004)).toBe(5);
  });

  it('Climeworks: whole kilograms, rounded up, never less than one', () => {
    expect(climeworksCost(0.0001)).toBe(0.5);
    expect(climeworksCost(1)).toBe(0.5);
    expect(climeworksCost(1.001)).toBe(1);
    expect(climeworksCost(9.8)).toBe(5);
  });

  it('Climeworks: another price and a minimum can be handed over', () => {
    expect(climeworksCost(2, 250)).toBe(0.5);
    expect(climeworksCost(2, 500, 10)).toBe(5);
    expect(climeworksCost(12, 500, 10)).toBe(6);
  });

  it('ForTomorrow: steps of 10 kg, whole euros, never less than 5, and null above its form’s largest amount', () => {
    expect(forTomorrowCost(0.0001)).toBe(5);
    expect(forTomorrowCost(50)).toBe(6);
    expect(forTomorrowCost(50.001)).toBe(7);
    expect(forTomorrowCost(8_771_910)).toBe(999_998);
    expect(forTomorrowCost(8_771_920)).toBe(999_999);
    expect(forTomorrowCost(8_771_920.001)).toBeNull();
    expect(forTomorrowCost(1e12)).toBeNull();
  });

  it('agree with the formulas of the spec for every tenth of a kilogram up to 10,000 kg', () => {
    for (let tenths = 0; tenths <= 100_000; tenths++) {
      const kg = tenths / 10;
      if (forTomorrowCost(kg) !== specForTomorrow(kg) || climeworksCost(kg) !== specClimeworks(kg)) {
        throw new Error(`the rules differ from the spec at ${kg} kg`);
      }
    }
  });

  it('never go down when the kilograms go up: every gram up to 300 kg, then wider steps up to 20 million kg', () => {
    let kg = 0.001;
    let climeworks = 0;
    let forTomorrow = 0;
    let steps = 0;
    while (kg < 2e7) {
      const c = climeworksCost(kg);
      const f = forTomorrowCost(kg) ?? Infinity;
      if (c === null || !(c >= climeworks) || !(f >= forTomorrow)) throw new Error(`a price went down at ${kg} kg`);
      climeworks = c;
      forTomorrow = f;
      steps += 1;
      kg = kg < 300 ? Math.round(kg * 1000 + 1) / 1000 : kg * 1.0007;
    }
    expect(steps).toBeGreaterThan(300_000);
    expect(forTomorrow).toBe(Infinity);
  });

  it('never go down either when the kilograms are first printed as the page prints them, in any unit', () => {
    for (const unit of ['kg', 'g', 'mg'] as const) {
      let before = { c: 0, f: 0 };
      for (let kg = 1e-7; kg < 5e6; kg *= 1.003) {
        const seen = printedKg(kg, unit);
        const c = climeworksCost(seen) ?? climeworksCost(kg);
        const f = (seen > 0 ? forTomorrowCost(seen) ?? Infinity : null) ?? forTomorrowCost(kg);
        if (c === null || f === null || !(c >= before.c) || !(f >= before.f)) throw new Error(`a price went down at ${kg} kg shown in ${unit}`);
        before = { c, f };
      }
    }
  });

  it('reads the printed number back in the shown unit', () => {
    expect(printedKg(3.04, 'kg')).toBe(3);
    expect(printedKg(0.354, 'g')).toBe(0.354);
    expect(printedKg(0.0654, 'g')).toBe(0.065);
    expect(printedKg(1234.4, 'kg')).toBe(1234);
    expect(printedKg(0.9996, 'g')).toBe(1);
    expect(printedKg(0.00000034, 'mg')).toBeCloseTo(0.00000034, 12);
    expect(printedKg(0.000000001, 'mg')).toBe(0);
  });
});

describe('"for your range", Climeworks', () => {
  it('a range below 1 kg, shown in grams: the price of 1 kg', () => {
    const view = contributeView(result(0.065, 0.15, 0.354), 'g');
    expect(words(view, 'climeworks')).toBe('$0.50 for 1 kg. Climeworks counts in whole kilograms, and your range is below 1 kg. Plus tax where it applies.');
  });

  it('a range below 1 kg that is still shown in kilograms: the same', () => {
    expect(words(contributeView(result(0.31, 0.5, 0.94), 'kg'), 'climeworks')).toBe(
      '$0.50 for 1 kg. Climeworks counts in whole kilograms, and your range is below 1 kg. Plus tax where it applies.',
    );
  });

  it('one outcome below 1 kg: "your estimate", because there is no range', () => {
    const one = { range: { p5: 0.194, mid: 0.194, p95: 0.194 }, dots: [0.194], single: true };
    expect(words(contributeView(one, 'g'), 'climeworks')).toBe('$0.50 for 1 kg. Climeworks counts in whole kilograms, and your estimate is below 1 kg. Plus tax where it applies.');
    const cost = { p5: 0.5, mid: 0.5, p95: 0.5 };
    expect(climeworksWords(cost, 0.194, true)).toMatch(/and your estimate is below 1 kg\./);
    expect(climeworksWords(cost, 0.194, false)).toMatch(/and your range is below 1 kg\./);
    expect(climeworksWords(cost, 0.194)).toMatch(/and your range is below 1 kg\./);
  });

  it('two ends with the same cost: once, with "about"', () => {
    expect(words(contributeView(result(8.5, 8.6, 8.7), 'kg'), 'climeworks')).toBe('About $4.50. Plus tax where it applies.');
  });

  it('a range: the sign once, and the middle estimate', () => {
    expect(words(contributeView(result(3.7, 9.8, 34), 'kg'), 'climeworks')).toBe('$2–17. At the middle estimate: $5. Plus tax where it applies.');
    expect(words(contributeView(result(0.73, 2, 10), 'kg'), 'climeworks')).toBe('$0.50–5. At the middle estimate: $1. Plus tax where it applies.');
  });

  it('a cost with cents at the far end: "$2–17.50"', () => {
    expect(words(contributeView(result(3.7, 9.8, 35), 'kg'), 'climeworks')).toBe('$2–17.50. At the middle estimate: $5. Plus tax where it applies.');
  });

  it('prices the kilograms the reader sees: 3.04 kg prints "3" and costs 3 kg, not 4', () => {
    expect(climeworksCost(3.04)).toBe(2);
    expect(words(contributeView(result(1.02, 2.04, 3.04), 'kg'), 'climeworks')).toBe('$0.50–1.50. At the middle estimate: $1. Plus tax where it applies.');
  });

  it('one outcome: once, with "about"', () => {
    expect(words(contributeView(result(12.6, 12.6, 12.6, true), 'kg'), 'climeworks')).toBe('About $6.50. Plus tax where it applies.');
  });

  it('a printed high end of exactly 1 kg is not "below 1 kg"', () => {
    expect(words(contributeView(result(0.4, 0.7, 0.9996), 'g'), 'climeworks')).toBe('About $0.50. Plus tax where it applies.');
  });

  it('thousands: commas in the money, and still one sign', () => {
    expect(words(contributeView(result(2000, 5000, 12000), 'kg'), 'climeworks')).toBe('$1,000–6,000. At the middle estimate: $2,500. Plus tax where it applies.');
  });
});

describe('"for your range", ForTomorrow', () => {
  it('more than the form takes', () => {
    expect(words(contributeView(result(1_000_000, 4_000_000, 9_000_000), 'kg'), 'fortomorrow')).toBe('More than their form accepts.');
    expect(TOO_MUCH_FOR_FORM).toBe('More than their form accepts.');
  });

  it('all three at the minimum', () => {
    expect(words(contributeView(result(3.7, 9.8, 34), 'kg'), 'fortomorrow')).toBe('€5. That is their minimum. On their form it covers up to 40 kg.');
    expect(words(contributeView(result(0.065, 0.15, 0.354), 'g'), 'fortomorrow')).toBe('€5. That is their minimum. On their form it covers up to 40 kg.');
  });

  it('two ends with the same cost above the minimum: once, with "about", and no word about a minimum', () => {
    expect(words(contributeView(result(83, 85, 87), 'kg'), 'fortomorrow')).toBe('About €11.');
  });

  it('the low end at the minimum and the high end above it', () => {
    expect(words(contributeView(result(40, 80, 150), 'kg'), 'fortomorrow')).toBe('€5–18. At the middle estimate: €10. €5 is their minimum.');
  });

  it('a range above the minimum', () => {
    expect(words(contributeView(result(150, 400, 1000), 'kg'), 'fortomorrow')).toBe('€18–114. At the middle estimate: €46.');
  });

  it('one outcome above the minimum: once, with "about"', () => {
    expect(words(contributeView(result(400, 400, 400, true), 'kg'), 'fortomorrow')).toBe('About €46.');
  });

  it('takes the cases from top to bottom', () => {
    const at = (p5: number, mid: number, p95: number): Spread => ({ p5, mid, p95 });
    expect(forTomorrowWords(at(5, 5, Infinity))).toBe('More than their form accepts.');
    expect(forTomorrowWords(at(5, 5, 5))).toBe('€5. That is their minimum. On their form it covers up to 40 kg.');
    expect(forTomorrowWords(at(6, 6, 6))).toBe('About €6.');
    expect(forTomorrowWords(at(5, 5, 6))).toBe('€5–6. At the middle estimate: €5. €5 is their minimum.');
    expect(forTomorrowWords(at(6, 7, 1200))).toBe('€6–1,200. At the middle estimate: €7.');
  });
});

describe('"for your range", the edges', () => {
  it('a result so small that it prints as 0: priced by its unrounded kilograms', () => {
    const view = contributeView(result(0.000000001, 0.000000002, 0.000000004), 'mg');
    expect(words(view, 'climeworks')).toBe('$0.50 for 1 kg. Climeworks counts in whole kilograms, and your range is below 1 kg. Plus tax where it applies.');
    expect(words(view, 'fortomorrow')).toBe('€5. That is their minimum. On their form it covers up to 40 kg.');
  });

  it('no kilograms at all, which the store never hands over: no cost, and no error', () => {
    for (const broken of [result(0, 0, 0), result(Number.NaN, Number.NaN, Number.NaN), result(-1, 0, 1), result(0, 5, 50)]) {
      const view = contributeView(broken, 'kg');
      expect(words(view, 'climeworks')).toBe('See their site for the price.');
      expect(words(view, 'fortomorrow')).toBe('See their site for the price.');
      expect(words(view, 'effektiv-spenden')).toBe('You choose. The smallest donation is 10 euros.');
    }
    expect(NO_PRICE).toBe('See their site for the price.');
    expect(climeworksWords(null, 0.5)).toBe(NO_PRICE);
    expect(forTomorrowWords(null)).toBe(NO_PRICE);
  });

  it('a real estimate always gets a cost, in whichever unit it is shown', () => {
    for (const output of [20, 3_000, 400_000, 60_000_000, 9_000_000_000]) {
      const full = estimate({ rows: [{ model: 'gpt-5', sizeClass: 'medium', output, cacheRead: output * 20 }], table: MODEL_TABLE }, { tips: false, biggestUnknown: false });
      for (const unit of new Set<MassUnit>([unitFor(full.range), 'kg'])) {
        const view = contributeView(full, unit);
        expect(view.options).toHaveLength(3);
        for (const option of view.options) expect(option.forYourRange).not.toBe(NO_PRICE);
        expect(words(view, 'climeworks')).toMatch(/^(About )?\$\d/);
        expect(words(view, 'fortomorrow')).toMatch(/^(About )?€\d/);
      }
    }
  });

  it('the same with every slider set, when there is one outcome', () => {
    const pins = { energy: 0.5, freshInput: 0.5, cacheWrite: 0.5, cacheRead: 0.5, pue: 0.5, grid: 0.5, hardware: 0.5 };
    const one = estimate({ rows: [{ model: 'claude-opus-5-5', sizeClass: 'large', output: 40_000_000, cacheRead: 900_000_000 }], pins, table: MODEL_TABLE }, { tips: false });
    expect(one.single).toBe(true);
    const view = contributeView(one, unitFor(one.range));
    expect(words(view, 'climeworks')).toMatch(/^About \$[\d.,]+\. Plus tax where it applies\.$/);
    expect(view.costSentence).toMatch(/ for about [\d.,]+ kg of CO₂, /);
  });
});

describe('the chapter', () => {
  it('gives the three options in the spec’s order, with every field of the contract', () => {
    const view = contributeView(result(3.7, 9.8, 34), 'kg');
    expect(view.options.map((option) => option.id)).toEqual(['climeworks', 'fortomorrow', 'effektiv-spenden']);
    const facts = options();
    view.options.forEach((option, index) => {
      expect(Object.keys(option).sort()).toEqual(['forYourRange', 'id', 'kind', 'minimum', 'name', 'price', 'url', 'whatYouGet']);
      expect(option).toMatchObject({ kind: facts[index]?.kind, name: facts[index]?.name, price: facts[index]?.price, url: facts[index]?.url });
    });
  });

  it('names the range in the cost sentence, and no money', () => {
    expect(contributeView(result(3.7, 9.8, 34), 'kg').costSentence).toBe(
      'The first two options show below what they would cost for 3.7–34 kg of CO₂, the size of your estimate. The third has no price per tonne. They do different things, so the costs cannot be compared.',
    );
    expect(contributeView(result(0.065, 0.15, 0.354), 'g').costSentence).toBe(
      'The first two options show below what they would cost for 65–354 g of CO₂, the size of your estimate. The third has no price per tonne. They do different things, so the costs cannot be compared.',
    );
  });

  it('says "about" with one number when both ends print the same', () => {
    expect(costSentence({ p5: 8.61, mid: 8.62, p95: 8.64 }, 'kg', false)).toBe(
      'The first two options show below what they would cost for about 8.6 kg of CO₂, the size of your estimate. The third has no price per tonne. They do different things, so the costs cannot be compared.',
    );
  });

  it('says "about" with one number for one outcome', () => {
    expect(costSentence({ p5: 12.3, mid: 12.3, p95: 12.3 }, 'kg', true)).toBe(
      'The first two options show below what they would cost for about 12 kg of CO₂, the size of your estimate. The third has no price per tonne. They do different things, so the costs cannot be compared.',
    );
  });

  it('says that the costs are for a what-if while a tip is applied, and counts the tips', () => {
    const range = { p5: 2.9, mid: 7.9, p95: 27 };
    expect(costSentence(range, 'kg', false, 0)).toBe(costSentence(range, 'kg', false));
    expect(costSentence(range, 'kg', false, 1)).toBe(
      'The first two options show below what they would cost for 2.9–27 kg of CO₂, the size of your estimate with your tip applied. The third has no price per tonne. They do different things, so the costs cannot be compared.',
    );
    expect(costSentence(range, 'kg', false, 2)).toContain(' for 2.9–27 kg of CO₂, the size of your estimate with your tips applied. ');
    expect(costSentence({ p5: 7, mid: 7, p95: 7 }, 'kg', true, 1)).toContain(' for about 7 kg of CO₂, the size of your estimate with your tip applied. ');
    expect(contributeView(result(2.9, 7.9, 27), 'kg', 1).costSentence).toBe(costSentence(range, 'kg', false, 1));
    expect(contributeView(result(2.9, 7.9, 27), 'kg').costSentence).toBe(costSentence(range, 'kg', false, 0));
  });

  it('has the footnote word for word, its opening sentence as strong', () => {
    expect(footnote()).toEqual([
      { strong: 'Prices, minimums and terms were checked on 7 Oct 2026 and can change.' },
      " These are three examples, one of each kind. ai-co2 gets nothing from them.",
    ]);
    expect(contributeView(result(1, 2, 3), 'kg').footnote).toEqual(footnote());
    const whole = footnote()
      .map((part) => (typeof part === 'string' ? part : 'strong' in part ? part.strong : ''))
      .join('');
    expect(whole).toBe(
      "Prices, minimums and terms were checked on 7 Oct 2026 and can change. These are three examples, one of each kind. ai-co2 gets nothing from them.",
    );
  });

  it('never converts a currency: dollars for Climeworks only, euros for the other two', () => {
    const view = contributeView(result(40, 80, 150), 'kg');
    expect(words(view, 'climeworks')).not.toMatch(/€|euro/);
    expect(`${words(view, 'fortomorrow')} ${words(view, 'effektiv-spenden')}`).not.toMatch(/\$|dollar/);
  });

  it('uses none of the banned words, in any case of any string', () => {
    const ranges = [
      result(0.000000001, 0.000000002, 0.000000004),
      result(0.065, 0.15, 0.354),
      result(8.5, 8.6, 8.7),
      result(3.7, 9.8, 34),
      result(83, 85, 87),
      result(40, 80, 150),
      result(150, 400, 1000),
      result(1_000_000, 4_000_000, 9_000_000),
      result(12.3, 12.3, 12.3, true),
      result(0, 0, 0),
    ];
    const strings = ranges.flatMap((one) => {
      const view = contributeView(one, unitFor(one.range));
      const note = view.footnote.map((part) => (typeof part === 'string' ? part : Object.values(part).join(' ')));
      return [view.costSentence, ...note, ...view.options.flatMap((option) => [option.kind, option.name, option.price, option.minimum, option.whatYouGet, option.forYourRange])];
    });
    expect(strings.length).toBeGreaterThan(150);
    for (const text of strings) expect(text).not.toMatch(BANNED);
  });
});
