// The AI "Explain another way" (src/lib/ai). Changing the prompt? Bump the version: cached
// explanations are keyed by it, so old ones are not reused.

export const EXPLAIN_PROMPT_VERSION = "explain-v1";

/** Most words an AI explanation may have (the prompt asks for fewer). */
export const EXPLAIN_MAX_WORDS = 120;

/** Default for the admin setting "ai_explanations_per_day": AI explanations per student per day. */
export const AI_EXPLANATIONS_PER_DAY = 5;

/**
 * Estimated price in US dollars per million tokens, by model. Check the provider's price list;
 * unknown models use "default".
 */
export const AI_PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5-5": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-opus-5-5": { input: 5, output: 25 },
  default: { input: 3, output: 15 },
};
