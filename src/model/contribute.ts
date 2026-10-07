// The three ways to give money: what each is, what it costs for the person's estimate, and the words
// around them. Prices and minimums change, so they sit in one place (PRICES), and every figure in a
// sentence is worked out from there.

import type { Spread } from '../contracts/usage';
import type { ContributeOption, ContributeView, MassUnit, Rich } from '../contracts/view';
import { PER_KG, longDate, mass, massRange, money, plainNumber, printsSame } from '../format';
import { carryThrough } from './estimate';

/** The numbers that will change. Check them before every release, and change the date with them. */
export const PRICES: {
  /** The day the prices and minimums were read, as YYYY-MM-DD. */
  readonly checked: string;
  /** US dollars, before any tax. */
  readonly climeworksPerTonne: number;
  /** Euros, for EU emission rights only. */
  readonly forTomorrowPerTonne: number;
  /** The smallest donation, in euros. */
  readonly forTomorrowMin: number;
  readonly effektivMin: number;
} = Object.freeze({
  checked: '2026-10-07',
  climeworksPerTonne: 500,
  forTomorrowPerTonne: 114,
  forTomorrowMin: 5,
  effektivMin: 10,
});

// How ForTomorrow's form counts. These are its rules, not prices.
const FORTOMORROW_STEP_KG = 10;
const FORTOMORROW_LARGEST = 999999;

// ---------- the price rules ----------

/** Takes out computer rounding noise: 3.0000000000000004 kg must not cost a fourth kilogram. */
const cleanKg = (kg: number): number => Math.round(kg * 1000) / 1000;

/**
 * Climeworks, in US dollars before tax. null: show no cost.
 * The order is rounded UP to whole kilograms, so the person never funds less than the estimate. That
 * is a choice made here: nobody could try it at a checkout.
 */
export function climeworksCost(kg: number, pricePerTonne: number = PRICES.climeworksPerTonne, minKg = 0): number | null {
  if (!(kg > 0) || !(pricePerTonne > 0)) return null;
  const orderKg = Math.max(minKg, 1, Math.ceil(cleanKg(kg)));
  return (orderKg * pricePerTonne) / 1000;
}

/** ForTomorrow, EU emission rights only, as a one-off donation in whole euros. null: no cost, or more than its form takes. */
export function forTomorrowCost(kg: number): number | null {
  if (!(kg > 0)) return null;
  const steps = Math.max(1, Math.ceil(cleanKg(kg) / FORTOMORROW_STEP_KG));
  const euros = Math.max(PRICES.forTomorrowMin, Math.ceil((steps * PRICES.forTomorrowPerTonne * FORTOMORROW_STEP_KG) / 1000));
  return euros > FORTOMORROW_LARGEST ? null : euros;
}

/** The most kilograms the smallest ForTomorrow donation covers, in the form's whole steps. */
export function forTomorrowMinKg(): number {
  return FORTOMORROW_STEP_KG * Math.floor((PRICES.forTomorrowMin * 1000) / (PRICES.forTomorrowPerTonne * FORTOMORROW_STEP_KG));
}

/** The kilograms the reader sees: the printed number, read back in the shown unit. */
export function printedKg(kg: number, unit: MassUnit): number {
  return Number(mass(kg, unit).replace(/,/g, '')) / PER_KG[unit];
}

/**
 * "Print the kilograms as the page does, then price them": the cost then matches the number on screen.
 * A printed 0 has no price, so the unrounded number is priced instead. NaN stands for "no cost": the
 * check on the carried range refuses it.
 */
const priced =
  (cost: (kg: number) => number | null, unit: MassUnit) =>
  (kg: number): number =>
    cost(printedKg(kg, unit)) ?? cost(kg) ?? Number.NaN;

// Above the form's largest amount there is still a cost, only no way to pay it there. Infinity keeps
// the rule from going down at that point.
const forTomorrowOrMore = (kg: number): number | null => (kg > 0 ? (forTomorrowCost(kg) ?? Infinity) : null);

type Result = { readonly range: Spread; readonly dots: readonly number[]; readonly single: boolean };

/** The three costs of one provider, or null when the rule could not be carried through. */
function costs(result: Result, rule: (kg: number) => number): Spread | null {
  try {
    return carryThrough(result.range, rule, result.dots);
  } catch {
    return null;
  }
}

// ---------- the words for "for your range" ----------

export const NO_PRICE = 'See their site for the price.';
export const TOO_MUCH_FOR_FORM = 'More than their form accepts.';

/**
 * Climeworks. `highKg` is the printed high end in kilograms. `single`: the result is one outcome,
 * so the page shows no range and the sentence must not name one.
 */
export function climeworksWords(cost: Spread | null, highKg: number, single = false): string {
  const tax = 'Plus tax where it applies.';
  const one = climeworksCost(1);
  if (cost === null || one === null) return NO_PRICE;
  if (highKg < 1) return `$${money(one)} for 1 kg. Climeworks counts in whole kilograms, and your ${single ? 'estimate' : 'range'} is below 1 kg. ${tax}`;
  if (cost.p5 === cost.p95) return `About $${money(cost.p5)}. ${tax}`;
  return `$${money(cost.p5)}–${money(cost.p95)}. At the middle estimate: $${money(cost.mid)}. ${tax}`;
}

/** ForTomorrow. A cost above its form's largest amount arrives as Infinity. */
export function forTomorrowWords(cost: Spread | null): string {
  if (cost === null) return NO_PRICE;
  const min = PRICES.forTomorrowMin;
  if (![cost.p5, cost.mid, cost.p95].every(Number.isFinite)) return TOO_MUCH_FOR_FORM;
  // "That is their minimum" only when the minimum is the cause. Equal ends can have another one.
  if (cost.p5 === min && cost.mid === min && cost.p95 === min) {
    return `€${money(min)}. That is their minimum. On their form it covers up to ${plainNumber(forTomorrowMinKg())} kg.`;
  }
  if (cost.p5 === cost.p95) return `About €${money(cost.p5)}.`;
  const range = `€${money(cost.p5)}–${money(cost.p95)}. At the middle estimate: €${money(cost.mid)}.`;
  return cost.p5 === min ? `${range} €${money(min)} is their minimum.` : range;
}

export function effektivWords(): string {
  return `You choose. The smallest donation is ${money(PRICES.effektivMin)} euros.`;
}

// ---------- the three options ----------

/** What an option is, apart from its cost for this person. */
export type OptionFacts = Omit<ContributeOption, 'forYourRange'> & {
  /** The day its price and minimum were read, as YYYY-MM-DD. */
  readonly checked: string;
};

/** The three options, one of each kind, in the order the page shows them. Built from PRICES on every call. */
export function options(): [climeworks: OptionFacts, forTomorrow: OptionFacts, effektiv: OptionFacts] {
  const checked = longDate(PRICES.checked);
  return [
    {
      id: 'climeworks',
      kind: 'Lasting removal',
      name: 'Climeworks',
      price: `${money(PRICES.climeworksPerTonne)} US dollars per tonne of CO₂, which is ${plainNumber(PRICES.climeworksPerTonne / 10)} cents per kilogram. Tax may be added at checkout. Price on ${checked}.`,
      minimum: 'Climeworks states none. It counts in whole kilograms.',
      whatYouGet:
        'You pay now, and Climeworks delivers later: it says within 7 years after the year you buy. Paying today does not take CO₂ out of the air today. This is its “Technology focus” portfolio, which Climeworks describes as 100% technology-based. You get an order confirmation and an invoice, and after delivery a delivery note and a certificate. This is a purchase, not a donation.',
      url: 'https://climeworks.com/actnow',
      checked: PRICES.checked,
    },
    {
      id: 'fortomorrow',
      kind: 'EU avoidance',
      name: 'ForTomorrow',
      price: `${money(PRICES.forTomorrowPerTonne)} euros per tonne for EU emission rights only, which is about ${plainNumber(Math.round(PRICES.forTomorrowPerTonne / 10))} cents per kilogram. Price on ${checked}.`,
      minimum: `${money(PRICES.forTomorrowMin)} euros. Whole euros only.`,
      whatYouGet:
        'ForTomorrow, a non-profit company in Berlin, buys EU emission allowances and keeps them in its own account, so no company can use them. It says it will cancel them later. This does not take CO₂ out of the air. Your payment is a donation, and you get a certificate straight away. Their form can also include tree planting: choose “EU emission rights” if you want allowances only.',
      // "?mix=0" opens the form on EU emission rights only. The link carries nothing about the person.
      url: 'https://www.fortomorrow.eu/en/donate-for-climate-protection/?mix=0',
      checked: PRICES.checked,
    },
    {
      id: 'effektiv-spenden',
      kind: 'Donation fund',
      name: 'Effektiv Spenden',
      price: `No price per tonne. You choose the amount. Checked on ${checked}.`,
      minimum: `${money(PRICES.effektivMin)} euros, or ${money(PRICES.effektivMin)} francs in the Swiss form. Whole amounts only.`,
      whatYouGet:
        'A donation to its climate fund, which passes your money to organisations that work on climate policy and clean technology. The fund does not promise an amount of CO₂. You get a donation receipt, not a certificate. Tax-deductible in Germany, Austria, Switzerland and Czechia, through the form for your country.',
      url: 'https://effektiv-spenden.org/en/spenden-fonds-klima-schutzen/',
      checked: PRICES.checked,
    },
  ];
}

/** The three `url` values, for the test of the addresses the site may carry. */
export const PROVIDER_LINKS: readonly string[] = Object.freeze(options().map((option) => option.url));

// ---------- the chapter ----------

/**
 * The sentence over the options. It names kilograms and no money: the costs cannot form one range.
 * Only the first two options have a cost for an amount of CO₂. The third has no price per tonne.
 */
export function costSentence(range: Spread, unit: MassUnit, single: boolean, tipsApplied = 0): string {
  const size = single || printsSame(range.p5, range.p95, unit) ? `about ${mass(range.mid, unit)} ${unit}` : massRange(range, unit);
  // With a tip applied the range on screen is a what-if, and the costs are for that what-if. The sentence says so.
  const tips = tipsApplied > 0 ? ` with your ${tipsApplied === 1 ? 'tip' : 'tips'} applied` : '';
  return `The first two options show below what they would cost for ${size} of CO₂, the size of your estimate${tips}. The third has no price per tonne. They do different things, so the costs cannot be compared.`;
}

/** The line under the options, its opening sentence as `strong`. */
export function footnote(): Rich {
  return [
    { strong: `Prices, minimums and terms were checked on ${longDate(PRICES.checked)} and can change.` },
    " These are three examples, one of each kind. ai-co2 gets nothing from them.",
  ];
}

function shown(option: OptionFacts, forYourRange: string): ContributeOption {
  const { id, kind, name, price, minimum, whatYouGet, url } = option;
  return { id, kind, name, price, minimum, whatYouGet, forYourRange, url };
}

/**
 * The whole chapter: cost sentence, three options, footnote. `unit` is the unit the result is shown in.
 * `range`, `dots` and `single` are those of the estimate that is on screen. `tipsApplied` is how many
 * applied tips change that estimate. Never throws.
 */
export function contributeView(result: Result, unit: MassUnit, tipsApplied = 0): ContributeView {
  const [climeworks, forTomorrow, effektiv] = options();
  return {
    costSentence: costSentence(result.range, unit, result.single, tipsApplied),
    options: [
      shown(climeworks, climeworksWords(costs(result, priced(climeworksCost, unit)), printedKg(result.range.p95, unit), result.single)),
      shown(forTomorrow, forTomorrowWords(costs(result, priced(forTomorrowOrMore, unit)))),
      shown(effektiv, effektivWords()),
    ],
    footnote: footnote(),
  };
}
