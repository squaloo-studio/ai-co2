// What the classifier says about one model name.

/**
 * How big a model is, which decides the energy per token.
 *
 * small   Haiku, the "mini" and "nano" models, GPT-3.5, GPT-5.6 Luna, Gemini Flash-Lite
 * medium  Sonnet, GPT-4o, GPT-4.1, GPT-5 to GPT-5.4, o1 and o3, Gemini Flash
 * large   Opus, GPT-4, GPT-5.5, GPT-5.6 Sol, every "Pro" model, Gemini Pro
 * fable   Fable and Mythos: counted like large, with a high end about twice as far up
 */
export type SizeClass = 'small' | 'medium' | 'large' | 'fable';

/** Smallest first. "unknown" is not a size: a table by size needs one more row for it, the widest. */
export const SIZE_CLASSES: readonly SizeClass[] = ['small', 'medium', 'large', 'fable'];

/**
 * Why a name has no size class.
 *
 * empty         there is no name at all
 * auto          the name is ChatGPT's picker setting "auto", not a model
 * tier-hidden   a GPT name that does not say which model answered. With `byPlan` ("gpt-5-6") the
 *               ChatGPT plan settles it. Without ("gpt-6", "gpt-7") nothing does.
 * unrecognised  everything else: another company's model, a new model line, free text
 */
export type UnknownReason = 'empty' | 'auto' | 'tier-hidden' | 'unrecognised';

/**
 * The ChatGPT plan, as far as it matters here: which GPT-5.6 model answers in normal chats.
 * Go is a paid plan and still gets the small model, so the line is not "free or paid".
 */
export type ChatGptPlan = 'free-or-go' | 'plus-or-pro';

export interface ClassifyOptions {
  /** Leave out for Claude Code, and for ChatGPT while the plan is not known. */
  plan?: ChatGptPlan;
}

interface Common {
  /**
   * The name to show, e.g. "Opus 5.5" or "GPT-5.2 Thinking". A name we do not recognise is shown as
   * it came in. It is always one line of at most 100 characters, and a character that cannot be seen
   * is shown as "�". It is still someone else's text: draw it as a text node, never as HTML.
   *
   * Two raw names can share a display name and differ in class: "gpt-5-6" (by plan) and the API's
   * "gpt-5.6" (always large) are both "GPT-5.6". So the class comes from the raw name, never from
   * the display name.
   */
  displayName: string;
  /**
   * true when the name alone says the model did hidden reasoning (ChatGPT only). Thinking messages in
   * an export are better evidence, and they also occur under names that return false here.
   *
   * For tests and for later: nothing on the page reads it. The ChatGPT count decides "thinking by
   * name" with a rule of its own (isThinkingSlug), and the two differ on some names.
   */
  thinking: boolean;
  /**
   * true when the class came from the ChatGPT plan, or would have if one had been given. The page
   * then says what it assumed and offers the plan switch. Only names such as "gpt-5-6" have it.
   */
  byPlan: boolean;
  /** Which rule decided, e.g. "C2". For tests and bug reports: show it nowhere, decide nothing by it. */
  rule: string;
}

/** What classifyModel says about one name. Look at `class` first: `reason` is only there when it is "unknown". */
export type ModelClass =
  /** A model we can place. */
  | (Common & { class: SizeClass })
  /** A name we cannot place. It is counted with the widest range, never guessed and never dropped. */
  | (Common & { class: 'unknown'; reason: UnknownReason })
  /** Not a model (Claude Code's "<synthetic>" placeholder). The row is left out of the estimate. */
  | (Common & { class: 'skip' });
