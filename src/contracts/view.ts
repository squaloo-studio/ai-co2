// Everything the page shows, as plain data. The logic side builds a View; the page side draws it.
// The page never calculates: every number and every sentence that depends on the person's data arrives here.

import type { SourceId, Spread } from './usage';

/**
 * choose   first visit: Claude Code or ChatGPT, nothing picked yet
 * steps    a tool is picked and its data is not in yet
 * loading  ChatGPT only: the export is being read
 * problem  the data that was given could not be used
 * done     there is a result
 */
export type Stage = 'choose' | 'steps' | 'loading' | 'problem' | 'done';

/** Mass is always carried in kilograms. `unit` says how to print it, so every number on the page agrees. */
export type MassUnit = 'kg' | 'g' | 'mg';

/** Text with a few inline marks. Drawn with text nodes only, never as HTML. */
export type Rich = Array<string | { mark: string } | { code: string } | { strong: string }>;

export interface View {
  stage: Stage;
  /** null until the person picks one. */
  source: SourceId | null;
  data: DataView;
  /** null until the chosen tool's data is in. */
  result: ResultView | null;
  /**
   * Ordered by their middle saving, biggest first. At most three, plus any applied tip that ranks below
   * them. Empty until there is a result, and when nothing useful applies.
   */
  tips: TipView[];
  /** Shown instead of tips when there is a result and no tip applies. */
  noTipsNote: string | null;
  contribute: ContributeView | null;
  method: MethodView;
}

// ---------- your data ----------

export interface DataView {
  claudeCode: {
    /** The whole prompt the person copies into Claude Code. */
    prompt: string;
    /** What is in the paste box right now. */
    answer: string;
    status: SourceStatus;
  };
  chatgpt: {
    status: SourceStatus;
  };
}

export type SourceStatus =
  | { state: 'waiting' }
  /** `total` is null while the size is still unknown. `text` is the sentence under the progress bar. */
  | { state: 'reading'; done: number; total: number | null; text: string }
  /**
   * `headline` e.g. "3 models · 781 million tokens · 30 Aug – 29 Sep". `confirmation` is the green line
   * under it, e.g. "The numbers add up and look plausible." `notes` are plain remarks, e.g. that the
   * first use found lies late in the 30 days.
   */
  | { state: 'ok'; headline: string; confirmation: string; models: ModelRow[]; notes: string[] }
  /** `message` says what went wrong and what to do next. */
  | { state: 'problem'; message: string };

export interface ModelRow {
  /** Friendly name, e.g. "Opus 5.5". */
  name: string;
  tokens: number;
  /**
   * Share of the estimate, 0 to 1, with every assumption at its typical value, or at the person's value
   * where they set one. Worked out for the usage as counted, with no tip applied. For ChatGPT it includes
   * the model's part of the hidden work that is switched on.
   */
  share: number;
}

// ---------- your result ----------

export interface ResultView {
  /** "Claude Code" or "ChatGPT". */
  sourceName: string;
  period: { from: string; to: string };
  /**
   * The line under the big range, e.g. "Likely CO₂e from Claude Code in the last 30 days (31 Aug – 29 Sep)".
   * While a tip that changes the result is applied it ends ", with your tip applied".
   */
  summary: string;
  /**
   * The unit for every mass in the result. The logic picks it from what has to fit on the chart
   * (the range, and the ghost while a tip is applied), so applying a tip never changes it.
   */
  unit: MassUnit;
  /** kg CO2e as shown now, with any applied tips. */
  range: Spread;
  /**
   * true when nothing varies any more (the person has set every assumption that matters), so there is
   * one outcome and no range. The page then shows one number and no "90 of 100" bracket.
   */
  single: boolean;
  /** 100 values in kg, ascending: the dots. The 5 lowest and 5 highest lie outside the likely range. */
  quantiles: number[];
  /**
   * Top of the scale in kg: 1, 2 or 5 times a power of ten in the shown unit. It only changes when the
   * range outgrows it or falls far below it, and never steps down while a slider is dragged.
   * The six tick labels are 0, 1/5, 2/5 … of it.
   */
  scaleMax: number;
  /**
   * The same range as kilometres in a new petrol car. Printed in metres when it is short (see format.ts).
   * The page leaves the car line out when the far end is under one metre.
   */
  car: Spread;
  /**
   * A real distance of about the car figure's middle, to picture it: a sentence and a road with the car on it.
   * null when the middle is shorter than the shortest place on the list.
   */
  carPlace: CarPlace | null;
  /**
   * ChatGPT only: the whole export, as a second line. `since` is ready to print, e.g. "March 2023".
   * The page prints this range in its own unit, unitFor(history.range), and says "about" only when
   * this range's own two ends print the same. No tip is applied to it.
   */
  history: { range: Spread; since: string } | null;
  /** The range without the applied tips, while at least one tip is applied. Drawn as the dashed ghost. */
  baseline: Spread | null;
  /** e.g. "With: Sonnet for routine work" or "With 2 tips applied". null when no tip is applied. */
  appliedLabel: string | null;
  /** e.g. "With 1 assumption set by you". null while no method slider is set. Drawn as a second dashed tag. */
  setLabel: string | null;
  /** The switches inside the result card. */
  switches: SwitchGroup;
}

export interface CarPlace {
  /** e.g. "About the drive from Munich to Augsburg (66 km).", with the place in `strong`. */
  text: Rich;
  /** The road drawn under the car figure. `from` is null for a fixed length, such as a bridge. */
  road: { from: string | null; to: string; km: number };
  /** true when the middle is beyond the longest place: the car stops at the end of the road. */
  beyond: boolean;
}

/** For ChatGPT the group holds the hidden-work switches and the plan switch; for Claude Code, the tips. */
export interface SwitchGroup {
  /** e.g. "Hidden work in ChatGPT" or "Try a change". */
  title: string;
  note: string;
  items: SwitchView[];
}

export interface SwitchView {
  /** Unique across the page. Sent back in a `toggle-switch` action. A tip's switch uses the tip's id. */
  id: string;
  label: string;
  /** e.g. "Typical setting", "Set from your export" or "Saves roughly 0.75–7.6 kg a month". */
  note: string;
  /** A small icon before the note: where a hidden-work setting came from. null for tips. */
  noteIcon: 'typical' | 'export' | null;
  on: boolean;
}

// ---------- ways to cut ----------

export interface TipView {
  id: string;
  title: string;
  /** The what-if, stated in full, with the saving as a `mark`. */
  body: Rich;
  /** The command or menu path. */
  how: Rich;
  applied: boolean;
  /** The range now and with this tip alone, for the two small bars. */
  now: Spread;
  after: Spread;
  /** A short name for the second bar, e.g. "Sonnet". The first bar is always "Now". */
  afterLabel: string;
}

// ---------- three ways to contribute ----------

export interface ContributeView {
  /** e.g. "The first two options show below what they would cost for 3.7–34 kg of CO₂, the size of your estimate. …" */
  costSentence: string;
  options: ContributeOption[];
  /** The line under the options, with its opening sentence as `strong`: when prices were checked, and that ai-co2 gets nothing. */
  footnote: Rich;
}

export interface ContributeOption {
  id: string;
  /** e.g. "Lasting removal". */
  kind: string;
  /** e.g. "Climeworks". */
  name: string;
  price: string;
  minimum: string;
  whatYouGet: string;
  /** e.g. "$2–17. At the middle estimate: $5. Plus tax where it applies." or "You choose. The smallest donation is 10 euros." */
  forYourRange: string;
  url: string;
}

// ---------- how it's calculated ----------

export interface MethodView {
  formula: string;
  counted: string[];
  leftOut: string[];
  /**
   * Sentences worked out from the person's own numbers, e.g. which assumption matters most for their
   * result. Empty until there is a result.
   */
  notes: string[];
  assumptions: AssumptionView[];
  /** One sentence on what moving a slider does. */
  sliderNote: string;
  /**
   * Every low and every high assumption combined, in kg. null until there is a result. The two ends lie
   * far apart, so they are printed with massSpan from format.ts, each in the unit that suits it.
   */
  extreme: { low: number; high: number } | null;
  /** The words before the extreme range, e.g. "Extreme range (every low or every high assumption combined)". The page puts a colon after them. */
  extremeLabel: string;
  unit: MassUnit;
}

/** One model size behind the energy slider, e.g. label "large", 0.5 / 1.0 / 5.4, value 1.0. */
export interface AssumptionPart {
  label: string;
  low: number;
  typical: number;
  high: number;
  value: number;
  decimals: number;
}

export interface AssumptionView {
  /** Sent back in a `set-assumption` action. */
  id: string;
  /** The heading this slider sits under, e.g. "Energy" or "Hidden work in ChatGPT". Sliders arrive grouped. */
  group: string;
  label: string;
  /** Printed after the value, e.g. " Wh" or " g/kWh". Empty for plain ratios. */
  unit: string;
  /** The fewest decimals to print. Values are printed with assumptionValue from format.ts. */
  decimals: number;
  low: number;
  typical: number;
  high: number;
  /**
   * Where the thumb sits. Equals `typical` until the person moves it. The thumb's place on the track
   * comes from `positionOf` in track.ts: low at the left end, typical in the middle, high at the right end.
   */
  value: number;
  /**
   * false: the assumption varies between low and high, and the thumb only rests on typical.
   * true: the person has set it, and the page uses `value` in every run until the sliders are reset.
   */
  pinned: boolean;
  /**
   * Only for a slider that stands for several values at once (energy: one value per model size the
   * person used, all moved by the same thumb). The first part repeats low, typical, high and value
   * above, and so sets the thumb. The page prints every part: "large 1.0 Wh · mid-size 0.60 Wh".
   */
  parts?: AssumptionPart[];
  /** One plain sentence on what this number is. */
  explanation: string;
  /** A remark about this slider for this person's data, e.g. "This changes nothing for your data." null for none. */
  note: string | null;
  /** Where the number comes from, e.g. "EcoLogits 0.11.1; Epoch AI (2025)". */
  source: string;
  /** Link to the main source. */
  sourceUrl: string | null;
  /** Date the source was checked, as YYYY-MM-DD. */
  checked: string;
  /** true when the evidence behind this number is thin. */
  soft: boolean;
}
