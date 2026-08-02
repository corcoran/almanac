import type { LlmConfig } from "@almanac/core/llm";
import { ApiError } from "./errors.js";

/** The user fields the gate needs. */
type GateUser = { llm_logging_enabled: number };

/**
 * Throw a 403 unless ALL three gate conditions hold: server master switch on,
 * provider API key present, and the per-user flag on. Fail-safe — a missing key
 * yields a 403, never a 500 mid-request. Pure (config + user in), so it unit
 * tests without a request.
 */
export function assertLlmEnabled(cfg: LlmConfig, user: GateUser): void {
  if (!cfg.enabled) {
    throw new ApiError(403, "llm_disabled", "LLM features are disabled on this server");
  }
  if (!cfg.apiKey) {
    throw new ApiError(403, "llm_disabled", "LLM provider key is not configured");
  }
  if (user.llm_logging_enabled !== 1) {
    throw new ApiError(403, "llm_disabled", "LLM features are not enabled for this user");
  }
}
