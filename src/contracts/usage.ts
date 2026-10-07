// What a data source hands to the maths: token counts by model and by type.

/** The two tools the page can read. The page works with one at a time, never both. */
export type SourceId = 'claude-code' | 'chatgpt';

export interface TokenCounts {
  /** Input the model read for the first time. */
  freshInput: number;
  /** Input written into the cache. */
  cacheWrite: number;
  /** Input read back from the cache. */
  cacheRead: number;
  /** Everything the model wrote, thinking included where the source counts it. */
  output: number;
}

export interface ModelUsage extends TokenCounts {
  /** The model's name exactly as the source spells it, e.g. "claude-opus-5-5" or "gpt-4o". */
  model: string;
}

export interface Usage {
  source: SourceId;
  /** First and last day the counts cover, as YYYY-MM-DD. */
  from: string;
  to: string;
  models: ModelUsage[];
}

/** A low end, a middle and a high end: the 5th percentile, the median and the 95th percentile. */
export interface Spread {
  p5: number;
  mid: number;
  p95: number;
}
