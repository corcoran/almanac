import type { WebSource } from "../schemas/llm.js";

export type { WebSource };

/** Token usage normalized from an Anthropic message. */
export type AgentUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  web_search_requests: number;
};

/** Max sources surfaced per turn — keeps the footnote compact. */
export const MAX_SOURCES = 10;

/**
 * A compact, human-readable domain for a source URL; null if the URL is
 * malformed. Strips a leading `www.` and returns the rest of the host as-is.
 * This is only a display label for a favicon footnote — keeping subdomains
 * (e.g. `en.wikipedia.org`) is correct, and avoids over-trimming registrable
 * domains with multi-part suffixes (e.g. `bbc.co.uk`).
 */
function deriveDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * The message-creation function the loop depends on — the subset of the
 * Anthropic SDK's messages.create we use. Injected so the loop is testable.
 */
export type CreateMessage = (args: {
  model: string;
  max_tokens: number;
  system: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
  }>;
  tools: unknown[];
  // Force the model to call one of our tools every turn. Without this the model
  // can answer in plain text (stop_reason 'end_turn'), which some surfaces treat
  // as a degrade — so a tool-only surface should pass tool_choice 'any'.
  tool_choice?: ({ type: "any" } | { type: "auto" } | { type: "tool"; name: string }) & {
    disable_parallel_tool_use?: boolean;
  };
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
}) => Promise<{
  content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
  stop_reason: string;
}>;

/** A user-defined tool the model may call. */
export type AgentTool = { name: string; description: string; input_schema: unknown };

/**
 * The outcome of dispatching a tool call: either feed a result back and keep
 * looping, or terminate the agent with the surface's result value.
 */
export type ToolOutcome<T> =
  | { kind: "continue"; toolResult: unknown }
  | { kind: "terminal"; value: T };

export type RunAgentArgs<T> = {
  createMessage: CreateMessage;
  model: string;
  /** The prebuilt system-prompt string; wrapped in a 1h-cached block internally. */
  system: string;
  /**
   * Optional per-day volatile context appended as a SECOND system block AFTER
   * the cached `system` block — and deliberately WITHOUT cache_control, so it
   * sits outside the cache prefix. Put data that changes within a day here
   * (today's macros, recent meals, the date) so it never busts the cached
   * prefix. Omitted entirely when empty/undefined (single-block, as before).
   */
  volatileSystem?: string;
  tools: AgentTool[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  // Whether web search is available this turn. When false, the web_search tool
  // is omitted entirely. Kept as a boolean — not a remaining-count — so the
  // tools block stays byte-identical across requests and the system-prompt
  // prompt-cache survives (see PER_TURN_SEARCH_CEILING).
  searchEnabled?: boolean;
  /** Called for a tool_use block matching a user tool; decides continue/terminal. */
  dispatch: (toolName: string, input: unknown) => ToolOutcome<T>;
  /** Called when a turn ends without a terminal tool; receives any plain text (or null). */
  onNoTerminalTool: (assistantText: string | null) => T;
  toolChoice?: "any" | "auto";
};

export const MAX_ITERATIONS = 4;
export const MAX_TOKENS = 2000;

// A CONSTANT per-request ceiling on searches within a single turn. The daily cap
// is enforced by the route (it passes searchEnabled=false at the cap so the tool
// is dropped entirely). Keeping the tool's max_uses constant — rather than the
// remaining daily count — keeps the tools block byte-identical across requests,
// which is REQUIRED for the system-prompt prompt-cache to survive: the cache
// prefix is tools → system, so a varying max_uses in the tools block busts the
// cached system prompt on every turn.
export const PER_TURN_SEARCH_CEILING = 5;

export function normalizeUsage(u: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
}): AgentUsage {
  return {
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_tokens: u.cache_read_input_tokens ?? 0,
    cache_creation_tokens: u.cache_creation_input_tokens ?? 0,
    web_search_requests: u.server_tool_use?.web_search_requests ?? 0,
  };
}

export function addUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
    cache_creation_tokens: a.cache_creation_tokens + b.cache_creation_tokens,
    web_search_requests: a.web_search_requests + b.web_search_requests,
  };
}

/**
 * Run a surface-agnostic, tool-calling agent loop. Returns the surface's result
 * value plus summed usage across all model calls. Caps iterations so a
 * misbehaving model can't spin; on cap-exhaustion degrades via onNoTerminalTool.
 */
export async function runAgent<T>(
  args: RunAgentArgs<T>,
): Promise<{ result: T; usage: AgentUsage; sources: WebSource[] }> {
  const system: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral"; ttl: "1h" };
  }> = [
    {
      type: "text" as const,
      text: args.system,
      // 1-hour cache TTL (not the 5-minute default). The cached prefix is the
      // tools block + this stable system block, stable for a user's session — 1h
      // holds the cache warm across calls spread out over time. Relies on the
      // tools prefix being byte-stable (see PER_TURN_SEARCH_CEILING) — otherwise
      // no read.
      //
      // ⚠️ Per-model MINIMUM cacheable prefix: Haiku 4.5 (prod's model) won't
      // cache a prefix under 4096 tokens — it SILENTLY declines (usage shows
      // 0 creation / 0 read, no error). So this split only yields a cache HIT
      // once `args.system` (+ tools) clears 4096 on Haiku: meal chat clears it
      // for users with a real stored-meal library (embedded in the stable
      // prompt); a thin prompt (few saved meals, or the insights coach whose
      // library is a tool not embedded) stays under and never caches on Haiku.
      // Sonnet/Opus floor is 1024, where this always caches. We deliberately do
      // NOT pad the prompt to cross 4096 — short prompts that don't cache are
      // cheap. The split's value (surviving a meal log without busting the
      // cache) is real whenever caching IS active.
      cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
    },
  ];
  // Volatile per-day context goes in a SECOND, UNCACHED block after the
  // breakpoint. Changing it (a new meal logged → new macros/recent-meals) does
  // NOT invalidate the cached stable prefix. Omitted when empty.
  if (args.volatileSystem) {
    system.push({ type: "text" as const, text: args.volatileSystem });
  }

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    ...args.history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user" as const, content: args.message },
  ];

  let usage: AgentUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    web_search_requests: 0,
  };

  const sources: WebSource[] = [];
  const seenUrls = new Set<string>();

  const tools: unknown[] = [
    ...args.tools,
    ...(args.searchEnabled
      ? [{ type: "web_search_20250305", name: "web_search", max_uses: PER_TURN_SEARCH_CEILING }]
      : []),
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const resp = await args.createMessage({
      model: args.model,
      max_tokens: MAX_TOKENS,
      system,
      tools,
      // disable_parallel_tool_use forces the model to emit exactly ONE tool_use
      // block per turn. This loop dispatches a single tool and answers it with a
      // single tool_result; without this, a parallel-tool turn would leave the
      // extra tool_use blocks unanswered and the next request 400s ("tool_use
      // ids found without tool_result blocks"). The guard below is a second line
      // of defense in case the flag is ever ignored.
      tool_choice: { type: args.toolChoice ?? "any", disable_parallel_tool_use: true },
      messages,
    });
    usage = addUsage(usage, normalizeUsage(resp.usage));

    // Collect any web-search results this turn returned. The API hands back
    // `web_search_tool_result` blocks whose `content` is an array of results with
    // url/title. We dedup by url, derive the domain in core (so the client never
    // parses URLs), and cap the list so the footnote stays compact.
    for (const block of resp.content as Array<{ type: string; content?: unknown }>) {
      if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
      for (const r of block.content as Array<{ url?: unknown; title?: unknown }>) {
        if (sources.length >= MAX_SOURCES) break;
        const url = typeof r.url === "string" ? r.url : null;
        if (url === null || seenUrls.has(url)) continue;
        const domain = deriveDomain(url);
        if (domain === null) continue;
        seenUrls.add(url);
        sources.push({ url, title: typeof r.title === "string" ? r.title : domain, domain });
      }
    }

    // A hosted server tool (web_search) ran and the model paused. Push the
    // assistant turn (incl. the server-tool result blocks) back and let it
    // resume — our dispatch only matches our own user tools.
    if (resp.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: resp.content });
      continue;
    }

    // Dispatch at most one tool_use per turn — parallel tool calls aren't
    // supported by these single-terminal-tool surfaces.
    const toolUse = resp.content.find((b) => b.type === "tool_use");
    if (!toolUse?.name) {
      // No terminal tool call this turn. After a web search, Anthropic relaxes
      // tool_choice:any — the model is allowed to answer in plain text. Bailing
      // here would throw away the search the model just did. Instead, if the
      // response shows web-search activity and iterations remain, push it back
      // with a nudge and let the loop continue. Otherwise degrade via
      // onNoTerminalTool with the assistant text (or null).
      const searched = resp.content.some(
        (b) => b.type === "server_tool_use" || b.type === "web_search_tool_result",
      );
      if (searched && i < MAX_ITERATIONS - 1) {
        messages.push({ role: "assistant", content: resp.content });
        messages.push({
          role: "user",
          content:
            "Based on what you found, give your answer or call a tool. Do not stop mid-task.",
        });
        continue;
      }
      const text =
        resp.content
          .filter(
            (b): b is typeof b & { text: string } =>
              b.type === "text" && typeof b.text === "string",
          )
          .map((b) => b.text)
          .join("\n")
          .trim() || null;
      return { result: args.onNoTerminalTool(text), usage, sources };
    }

    const outcome = args.dispatch(toolUse.name, toolUse.input);
    if (outcome.kind === "terminal") return { result: outcome.value, usage, sources };
    // Continuing requires feeding a tool_result back keyed by the tool_use id.
    // The id is typed string | undefined, and the API 400s on a missing
    // tool_use_id — so if it's absent, degrade safely instead of looping.
    const toolUseId = toolUse.id;
    if (!toolUseId) return { result: args.onNoTerminalTool(null), usage, sources };
    messages.push({ role: "assistant", content: resp.content });
    // The API requires a tool_result for EVERY tool_use block in the assistant
    // turn we just pushed — a missing one 400s the next request. We dispatch only
    // the first tool (disable_parallel_tool_use should make it the only one), but
    // guard against any extras by answering them with a benign placeholder so the
    // conversation stays valid even if a parallel turn slips through.
    const toolResults = resp.content
      .filter(
        (b): b is typeof b & { id: string } => b.type === "tool_use" && typeof b.id === "string",
      )
      .map((b) => ({
        type: "tool_result" as const,
        tool_use_id: b.id,
        content:
          b.id === toolUseId
            ? JSON.stringify(outcome.toolResult)
            : JSON.stringify({
                error: "tool not processed (only one tool call is handled per turn)",
              }),
      }));
    messages.push({ role: "user", content: toolResults });
  }

  // Iteration cap hit without a terminal tool.
  return { result: args.onNoTerminalTool(null), usage, sources };
}
