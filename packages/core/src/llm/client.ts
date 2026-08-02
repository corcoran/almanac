import Anthropic from "@anthropic-ai/sdk";

/**
 * Construct the Anthropic client. The SDK reads ANTHROPIC_API_KEY from the
 * environment by default; we pass it explicitly from resolved config so the
 * caller controls the source. Throws if no key — callers gate on key presence
 * before reaching here, so this is defense-in-depth.
 */
export function createAnthropicClient(apiKey: string | undefined): Anthropic {
  if (!apiKey) {
    throw new Error("createAnthropicClient: missing API key");
  }
  return new Anthropic({ apiKey });
}
