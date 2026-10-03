import type { WebSource } from "../schemas/llm.js";
import type { InsightsEffort } from "./config.js";

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
  messages: Array<{ role: "user" | "assistant" | "system"; content: unknown }>;
  thinking?: { type: "adaptive" };
  output_config?: { effort: InsightsEffort };
  fallbacks?: "default";
  betas?: string[];
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
  /**
   * A `note` on an assistant entry goes to the model as a system message just
   * before that turn; dropped for models without mid-conversation system messages.
   */
  history: Array<{ role: "user" | "assistant"; content: string; note?: string }>;
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
  /** Omit for models that should not think (meal chat). */
  thinking?: { type: "adaptive" };
  effort?: InsightsEffort;
  maxTokens?: number;
  maxIterations?: number;
  /** Server-side retry on another model after a refusal; ignored for models that don't support it. */
  refusalFallback?: boolean;
  /** Feed onNoTerminalTool the text from every response in the turn, not just the last. */
  accumulateText?: boolean;
  /** Let the model emit several tool_use blocks per response and dispatch each one. */
  parallelToolUse?: boolean;
  /** Tool names dispatched but left out of the returned `lookups`. */
  omitFromLookups?: string[];
};

export const MAX_ITERATIONS = 4;
export const MAX_LOOKUP_CHARS = 80;

function clip(s: string): string {
  return s.length > MAX_LOOKUP_CHARS ? `${s.slice(0, MAX_LOOKUP_CHARS - 1)}…` : s;
}

/** `name(k=v, k=v)`, or the bare name when the input is empty. */
export function renderLookup(name: string, input: unknown): string {
  const entries =
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? Object.entries(input as Record<string, unknown>)
      : [];
  if (entries.length === 0) return clip(name);
  const args = entries
    .map(([k, v]) => `${k}=${v !== null && typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
  return clip(`${name}(${args})`);
}
export const MAX_TOKENS = 2000;

export const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const SERVER_FALLBACK_MODELS = new Set(["claude-sonnet-5-5"]);
const DYNAMIC_SEARCH_MODELS = new Set(["claude-sonnet-5-5"]);
const MIDCONV_SYSTEM_MODELS = new Set(["claude-sonnet-5-5"]);

export function supportsMidConversationSystem(model: string): boolean {
  return MIDCONV_SYSTEM_MODELS.has(model);
}

/** Newer models take the dynamic-filtering search tool; older ones only the basic one. */
export function webSearchToolType(model: string): "web_search_20260209" | "web_search_20250305" {
  return DYNAMIC_SEARCH_MODELS.has(model) ? "web_search_20260209" : "web_search_20250305";
}

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
): Promise<{ result: T; usage: AgentUsage; sources: WebSource[]; lookups: string[] }> {
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
      // Sonnet 5.5's floor is lower (the docs list 512, unconfirmed); check
      // usage.cache_*_input_tokens on a live call. We deliberately do
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

  const notes = supportsMidConversationSystem(args.model);
  const messages: Array<{ role: "user" | "assistant" | "system"; content: unknown }> = [];
  for (const h of args.history) {
    // A system message is only valid directly after a user turn; malformed
    // client history (assistant-first, consecutive assistants) drops the note.
    if (
      notes &&
      h.role === "assistant" &&
      h.note !== undefined &&
      messages.at(-1)?.role === "user"
    ) {
      messages.push({ role: "system", content: h.note });
    }
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: "user", content: args.message });

  let usage: AgentUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    web_search_requests: 0,
  };

  const sources: WebSource[] = [];
  const seenUrls = new Set<string>();
  const lookups: string[] = [];
  const omitted = new Set(args.omitFromLookups ?? []);
  const dispatch = (name: string, input: unknown): ToolOutcome<T> => {
    if (!omitted.has(name)) lookups.push(renderLookup(name, input));
    return args.dispatch(name, input);
  };

  const tools: unknown[] = [
    ...args.tools,
    ...(args.searchEnabled
      ? [
          {
            type: webSearchToolType(args.model),
            name: "web_search",
            max_uses: PER_TURN_SEARCH_CEILING,
          },
        ]
      : []),
  ];

  const accumulated: string[] = [];
  const finalText = (latest: string | null): string | null =>
    args.accumulateText ? accumulated.join("\n\n").trim() || null : latest;

  const maxIterations = args.maxIterations ?? MAX_ITERATIONS;
  for (let i = 0; i < maxIterations; i++) {
    const resp = await args.createMessage({
      model: args.model,
      max_tokens: args.maxTokens ?? MAX_TOKENS,
      ...(args.thinking ? { thinking: args.thinking } : {}),
      ...(args.effort ? { output_config: { effort: args.effort } } : {}),
      ...(args.refusalFallback && SERVER_FALLBACK_MODELS.has(args.model)
        ? { fallbacks: "default" as const, betas: [SERVER_FALLBACK_BETA] }
        : {}),
      system,
      tools,
      // By default the model is limited to one tool_use per response
      // (disable_parallel_tool_use). With parallelToolUse the flag is omitted and
      // every tool_use block is dispatched and answered in one message. The
      // placeholder guard below covers extras if the flag is ever ignored.
      tool_choice: args.parallelToolUse
        ? { type: args.toolChoice ?? "any" }
        : { type: args.toolChoice ?? "any", disable_parallel_tool_use: true },
      messages,
    });
    usage = addUsage(usage, normalizeUsage(resp.usage));

    const respText =
      resp.content
        .filter(
          (b): b is typeof b & { text: string } => b.type === "text" && typeof b.text === "string",
        )
        .map((b) => b.text)
        .join("")
        .trim() || null;
    if (respText !== null) accumulated.push(respText);

    for (const b of resp.content) {
      if (b.type !== "server_tool_use" || b.name !== "web_search") continue;
      const query = (b.input as { query?: unknown } | undefined)?.query;
      lookups.push(clip(`web search: "${typeof query === "string" ? query : ""}"`));
    }

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

    // Without parallelToolUse only the first tool_use is dispatched.
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
      if (searched && (args.toolChoice ?? "any") === "any" && i < maxIterations - 1) {
        messages.push({ role: "assistant", content: resp.content });
        messages.push({
          role: "user",
          content:
            "Based on what you found, give your answer or call a tool. Do not stop mid-task.",
        });
        continue;
      }
      return { result: args.onNoTerminalTool(finalText(respText)), usage, sources, lookups };
    }

    if (args.parallelToolUse) {
      const toolUses = resp.content.filter(
        (b): b is typeof b & { id: string; name: string } =>
          b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string",
      );
      const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
      for (const b of toolUses) {
        const outcome = dispatch(b.name, b.input);
        if (outcome.kind === "terminal") return { result: outcome.value, usage, sources, lookups };
        toolResults.push({
          type: "tool_result",
          tool_use_id: b.id,
          content: JSON.stringify(outcome.toolResult),
        });
      }
      if (toolResults.length === 0) {
        return { result: args.onNoTerminalTool(finalText(null)), usage, sources, lookups };
      }
      messages.push({ role: "assistant", content: resp.content });
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const outcome = dispatch(toolUse.name, toolUse.input);
    if (outcome.kind === "terminal") return { result: outcome.value, usage, sources, lookups };
    // Continuing requires feeding a tool_result back keyed by the tool_use id.
    // The id is typed string | undefined, and the API 400s on a missing
    // tool_use_id — so if it's absent, degrade safely instead of looping.
    const toolUseId = toolUse.id;
    if (!toolUseId)
      return { result: args.onNoTerminalTool(finalText(null)), usage, sources, lookups };
    messages.push({ role: "assistant", content: resp.content });
    // The API requires a tool_result for EVERY tool_use block in the assistant
    // turn we just pushed — a missing one 400s the next request. Tool_use blocks
    // that aren't dispatched get a benign placeholder result.
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
  return { result: args.onNoTerminalTool(finalText(null)), usage, sources, lookups };
}
