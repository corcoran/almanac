import { z } from "zod";

/**
 * Resolved, validated LLM configuration. Read once at boot. The provider is a
 * reserved seam — only "anthropic" is valid; a non-anthropic value fails fast
 * so the name is reserved without a multi-provider implementation.
 */
export type LlmConfig = {
  enabled: boolean;
  provider: "anthropic";
  model: string;
  /** The model for the INSIGHTS coach (harder reasoning → a stronger model than
   *  the meal parser). Separate from `model` (meal chat). */
  insightsModel: string;
  apiKey: string | undefined;
  defaultDailyTokenLimit: number | undefined;
  hardDailyTokenCap: number | undefined;
  tokensPerSearch: number;
  hardDailySearchCap: number | undefined;
};

/**
 * docker-compose maps optional vars as `"${VAR:-}"`, so an UNSET var arrives as
 * an empty string rather than absent. Coercing `""` straight through
 * `z.coerce.number()` yields 0, which then fails `.positive()` and throws at
 * boot, crashlooping the API. Normalize empty/whitespace to `undefined` first
 * so an empty string reads identically to the var being absent.
 */
const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const Schema = z.object({
  ALMANAC_LLM_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Reserved seam: validated only. A future provider adds a branch here.
  ALMANAC_LLM_PROVIDER: z
    .string()
    .default("anthropic")
    .refine((v) => v === "anthropic", {
      message: "ALMANAC_LLM_PROVIDER must be 'anthropic' (only provider supported)",
    }),
  ALMANAC_LLM_MODEL: z.string().default("claude-haiku-4-5"),
  ALMANAC_LLM_INSIGHTS_MODEL: z.preprocess(
    emptyToUndefined,
    z.string().default("claude-sonnet-4-6"),
  ),
  ANTHROPIC_API_KEY: z.string().optional(),
  ALMANAC_LLM_DEFAULT_DAILY_TOKEN_LIMIT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  ALMANAC_LLM_HARD_DAILY_TOKEN_CAP: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  ALMANAC_LLM_TOKENS_PER_SEARCH: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(2500),
  ),
  ALMANAC_LLM_HARD_DAILY_SEARCH_CAP: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
});

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const parsed = Schema.parse(env);
  return {
    enabled: parsed.ALMANAC_LLM_ENABLED,
    provider: parsed.ALMANAC_LLM_PROVIDER as "anthropic",
    model: parsed.ALMANAC_LLM_MODEL,
    insightsModel: parsed.ALMANAC_LLM_INSIGHTS_MODEL,
    apiKey: parsed.ANTHROPIC_API_KEY,
    defaultDailyTokenLimit: parsed.ALMANAC_LLM_DEFAULT_DAILY_TOKEN_LIMIT,
    hardDailyTokenCap: parsed.ALMANAC_LLM_HARD_DAILY_TOKEN_CAP,
    tokensPerSearch: parsed.ALMANAC_LLM_TOKENS_PER_SEARCH,
    hardDailySearchCap: parsed.ALMANAC_LLM_HARD_DAILY_SEARCH_CAP,
  };
}
