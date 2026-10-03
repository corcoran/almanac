/** Per-million-token USD prices for each provider:model. */
type Prices = {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
};

export type TokenCounts = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
};

// Keyed by `${provider}:${model}`. USD per 1M tokens. Cache reads are 0.1x input.
// Cache writes use the 1-hour rate (2x input): every cached block runAgent sends
// has ttl "1h".
const PRICE_TABLE: Record<string, Prices> = {
  "anthropic:claude-haiku-4-5": {
    inputPerM: 1.0,
    outputPerM: 5.0,
    cacheReadPerM: 0.1,
    cacheWritePerM: 2.0,
  },
  "anthropic:claude-sonnet-4-6": {
    inputPerM: 3.0,
    outputPerM: 15.0,
    cacheReadPerM: 0.3,
    cacheWritePerM: 6.0,
  },
  "anthropic:claude-sonnet-5-5": {
    inputPerM: 2.0,
    outputPerM: 10.0,
    cacheReadPerM: 0.2,
    cacheWritePerM: 4.0,
  },
  "anthropic:claude-opus-4-8": {
    inputPerM: 5.0,
    outputPerM: 25.0,
    cacheReadPerM: 0.5,
    cacheWritePerM: 10.0,
  },
};

/**
 * Compute the USD cost for one LLM call from its four token buckets. Throws on
 * an unknown provider:model rather than returning a wrong (zero) cost — a
 * missing price is a config bug, not a $0 call.
 */
export function computeCostUsd(provider: string, model: string, t: TokenCounts): number {
  const prices = PRICE_TABLE[`${provider}:${model}`];
  if (!prices) {
    throw new Error(`no price entry for ${provider}:${model} — add it to PRICE_TABLE`);
  }
  return (
    (t.input_tokens * prices.inputPerM +
      t.output_tokens * prices.outputPerM +
      t.cache_read_tokens * prices.cacheReadPerM +
      t.cache_creation_tokens * prices.cacheWritePerM) /
    1_000_000
  );
}
