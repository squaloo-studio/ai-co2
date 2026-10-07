// Model names: what the rest of the page needs to turn a raw name into a size class.
//
//   small    Haiku, "mini", "nano", GPT-3.5, GPT-5.6 Luna
//   medium   Sonnet, GPT-4o, GPT-4.1, GPT-5 to GPT-5.4, o1, o3
//   large    Opus, GPT-4, GPT-5.5, GPT-5.6 Sol, every "Pro" model
//   fable    Fable and Mythos: like large, with a higher top end
//   unknown  a name we cannot place: count it with the widest range and say so on the page
//   skip     not a model: leave the row out, and say how many tokens it held
//
// One name depends on the person's ChatGPT plan: "gpt-5-6" (and later 5.x) is the small model on
// Free and Go and the large one on Plus and Pro. Pass the plan when it is known. Without it the
// name is unknown with the reason "tier-hidden". Either way the result has byPlan: true.
//
// The display name is safe to draw as text: one line, at most 100 characters, nothing invisible.

export { classifyModel } from './classify';
/** For tests: the four size classes, smallest first. The page takes its rows from the assumptions table. */
export { SIZE_CLASSES } from './types';
export type { ChatGptPlan, ClassifyOptions, ModelClass, SizeClass, UnknownReason } from './types';
