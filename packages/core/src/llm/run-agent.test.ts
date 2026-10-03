import { describe, expect, it, vi } from "vitest";
import { defined } from "../test-support/index.js";
import {
  MAX_ITERATIONS,
  MAX_SOURCES,
  runAgent,
  supportsMidConversationSystem,
  webSearchToolType,
} from "./run-agent.js";

// Minimal stub responses for the injected createMessage.
function toolUseResp(name: string, input: unknown) {
  return {
    content: [{ type: "tool_use", id: "t1", name, input }],
    usage: { input_tokens: 100, output_tokens: 20 },
    stop_reason: "tool_use",
  };
}
function textResp(text: string) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 100, output_tokens: 20 },
    stop_reason: "end_turn",
  };
}
// A single assistant turn that emits TWO tool_use blocks (parallel tool calls).
function twoToolUseResp(a: { name: string; id: string }, b: { name: string; id: string }) {
  return {
    content: [
      { type: "tool_use", id: a.id, name: a.name, input: {} },
      { type: "tool_use", id: b.id, name: b.name, input: {} },
    ],
    usage: { input_tokens: 100, output_tokens: 20 },
    stop_reason: "tool_use",
  };
}

describe("runAgent", () => {
  it("auto mode: a plain-text reply is the terminal result via onNoTerminalTool", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("you are on track"));
    const { result } = await runAgent<string>({
      createMessage,
      model: "claude-haiku-4-5",
      system: "sys",
      tools: [],
      history: [],
      message: "how am I doing?",
      dispatch: () => ({ kind: "terminal", value: "UNUSED" }),
      onNoTerminalTool: (text) => text ?? "(no answer)",
      toolChoice: "auto",
    });
    expect(result).toBe("you are on track");
  });

  it("dispatch 'continue' feeds a tool_result back, then terminates", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(toolUseResp("get_thing", { q: "x" }))
      .mockResolvedValueOnce(textResp("final answer"));
    const dispatch = vi.fn((name: string) =>
      name === "get_thing"
        ? ({ kind: "continue", toolResult: { ok: 1 } } as const)
        : ({ kind: "terminal", value: "?" } as const),
    );
    const { result } = await runAgent<string>({
      createMessage,
      model: "m",
      system: "sys",
      tools: [{ name: "get_thing", description: "", input_schema: { type: "object" } }],
      history: [],
      message: "go",
      dispatch,
      onNoTerminalTool: (t) => t ?? "",
      toolChoice: "auto",
    });
    expect(dispatch).toHaveBeenCalledWith("get_thing", { q: "x" });
    expect(result).toBe("final answer");
    // second call must include the tool_result in messages
    const secondCallMessages = createMessage.mock.calls[1]?.[0].messages as Array<{
      role: string;
      content: unknown;
    }>;
    expect(JSON.stringify(secondCallMessages)).toContain("tool_result");
  });

  it("dispatch 'terminal' returns the surface value immediately", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(toolUseResp("finish", { a: 1 }));
    const { result } = await runAgent<{ done: boolean }>({
      createMessage,
      model: "m",
      system: "sys",
      tools: [{ name: "finish", description: "", input_schema: { type: "object" } }],
      history: [],
      message: "go",
      dispatch: () => ({ kind: "terminal", value: { done: true } }),
      onNoTerminalTool: () => ({ done: false }),
      toolChoice: "any",
    });
    expect(result).toEqual({ done: true });
  });

  it("pause_turn pushes the assistant turn and continues", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce({
        content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }],
        usage: { input_tokens: 50, output_tokens: 0, server_tool_use: { web_search_requests: 1 } },
        stop_reason: "pause_turn",
      })
      .mockResolvedValueOnce(textResp("answer after search"));
    const { result, usage } = await runAgent<string>({
      createMessage,
      model: "m",
      system: "sys",
      tools: [],
      history: [],
      message: "go",
      searchEnabled: true,
      dispatch: () => ({ kind: "terminal", value: "?" }),
      onNoTerminalTool: (t) => t ?? "",
      toolChoice: "auto",
    });
    expect(result).toBe("answer after search");
    expect(usage.web_search_requests).toBe(1);
  });

  it("iteration-cap exhaustion degrades via onNoTerminalTool(null)", async () => {
    // Always return a tool_use whose dispatch says 'continue', so the loop never
    // terminates and must hit the iteration cap.
    const createMessage = vi.fn().mockResolvedValue(toolUseResp("loop_forever", {}));
    const { result } = await runAgent<string>({
      createMessage,
      model: "m",
      system: "sys",
      tools: [{ name: "loop_forever", description: "", input_schema: { type: "object" } }],
      history: [],
      message: "go",
      dispatch: () => ({ kind: "continue", toolResult: {} }),
      onNoTerminalTool: (t) => (t === null ? "DEGRADED" : "?"),
      toolChoice: "any",
    });
    expect(createMessage).toHaveBeenCalledTimes(MAX_ITERATIONS);
    expect(result).toBe("DEGRADED");
  });

  it("web-search recovery: a searched turn is nudged forward, not degraded", async () => {
    // First turn: the model searched (server_tool_use + web_search_tool_result
    // blocks) but produced NO tool_use and ended the turn. The loop should push
    // it back with a nudge and continue, rather than degrade on the first turn.
    const searchedResp = {
      content: [
        { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
        { type: "web_search_tool_result", content: [] },
      ],
      usage: { input_tokens: 80, output_tokens: 10, server_tool_use: { web_search_requests: 1 } },
      stop_reason: "end_turn",
    };
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(searchedResp)
      .mockResolvedValueOnce(textResp("here is what I found"));
    const { result } = await runAgent<string>({
      createMessage,
      model: "m",
      system: "sys",
      tools: [],
      history: [],
      message: "go",
      searchEnabled: true,
      dispatch: () => ({ kind: "terminal", value: "?" }),
      onNoTerminalTool: (t) => t ?? "(degraded)",
      toolChoice: "any",
    });
    expect(createMessage).toHaveBeenCalledTimes(2);
    expect(result).toBe("here is what I found");
  });

  it("collects deduped web-search sources with derived domains", async () => {
    const responses = [
      {
        content: [
          {
            type: "web_search_tool_result",
            content: [
              {
                type: "web_search_result",
                url: "https://www.healthline.com/a",
                title: "A",
                page_age: "2024",
              },
              {
                type: "web_search_result",
                url: "https://www.healthline.com/a",
                title: "A dup",
                page_age: "2024",
              },
              {
                type: "web_search_result",
                url: "https://en.wikipedia.org/wiki/B",
                title: "B",
                page_age: null,
              },
            ],
          },
        ],
        usage: { input_tokens: 5, output_tokens: 5 },
        stop_reason: "pause_turn",
      },
      {
        content: [{ type: "tool_use", id: "t1", name: "finish", input: {} }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "tool_use",
      },
    ];
    let call = 0;
    const createMessage = async () => responses[call++] as never;

    const { sources } = await runAgent<string>({
      createMessage,
      model: "m",
      system: "s",
      tools: [{ name: "finish", description: "", input_schema: {} }],
      history: [],
      message: "hi",
      searchEnabled: true,
      dispatch: () => ({ kind: "terminal", value: "done" }),
      onNoTerminalTool: () => "none",
    });

    expect(sources).toEqual([
      { url: "https://www.healthline.com/a", title: "A", domain: "healthline.com" },
      { url: "https://en.wikipedia.org/wiki/B", title: "B", domain: "en.wikipedia.org" },
    ]);
  });

  it("skips a malformed source url without throwing", async () => {
    const responses = [
      {
        content: [
          {
            type: "web_search_tool_result",
            content: [
              { type: "web_search_result", url: "not a url", title: "bad", page_age: null },
              {
                type: "web_search_result",
                url: "https://example.com/x",
                title: "good",
                page_age: null,
              },
            ],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "pause_turn",
      },
      {
        content: [{ type: "tool_use", id: "t1", name: "finish", input: {} }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "tool_use",
      },
    ];
    let call = 0;
    const createMessage = async () => responses[call++] as never;
    const { sources } = await runAgent<string>({
      createMessage,
      model: "m",
      system: "s",
      tools: [{ name: "finish", description: "", input_schema: {} }],
      history: [],
      message: "hi",
      searchEnabled: true,
      dispatch: () => ({ kind: "terminal", value: "done" }),
      onNoTerminalTool: () => "none",
    });
    expect(sources).toEqual([
      { url: "https://example.com/x", title: "good", domain: "example.com" },
    ]);
  });

  it("caps collected sources at MAX_SOURCES", async () => {
    const responses = [
      {
        content: [
          {
            type: "web_search_tool_result",
            content: Array.from({ length: MAX_SOURCES + 5 }, (_, i) => ({
              type: "web_search_result",
              url: `https://site${i}.com/p`,
              title: `T${i}`,
              page_age: null,
            })),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "pause_turn",
      },
      {
        content: [{ type: "tool_use", id: "t1", name: "finish", input: {} }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "tool_use",
      },
    ];
    let call = 0;
    const createMessage = async () => responses[call++] as never;
    const { sources } = await runAgent<string>({
      createMessage,
      model: "m",
      system: "s",
      tools: [{ name: "finish", description: "", input_schema: {} }],
      history: [],
      message: "hi",
      searchEnabled: true,
      dispatch: () => ({ kind: "terminal", value: "done" }),
      onNoTerminalTool: () => "none",
    });
    expect(sources.length).toBe(MAX_SOURCES);
  });

  it("falls back to the domain when a result has no title", async () => {
    const responses = [
      {
        content: [
          {
            type: "web_search_tool_result",
            content: [{ type: "web_search_result", url: "https://example.com/x", page_age: null }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "pause_turn",
      },
      {
        content: [{ type: "tool_use", id: "t1", name: "finish", input: {} }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "tool_use",
      },
    ];
    let call = 0;
    const createMessage = async () => responses[call++] as never;
    const { sources } = await runAgent<string>({
      createMessage,
      model: "m",
      system: "s",
      tools: [{ name: "finish", description: "", input_schema: {} }],
      history: [],
      message: "hi",
      searchEnabled: true,
      dispatch: () => ({ kind: "terminal", value: "done" }),
      onNoTerminalTool: () => "none",
    });
    expect(sources).toEqual([
      { url: "https://example.com/x", title: "example.com", domain: "example.com" },
    ]);
  });

  it("dedups sources across separate search iterations", async () => {
    const responses = [
      {
        content: [
          {
            type: "web_search_tool_result",
            content: [
              { type: "web_search_result", url: "https://a.com/x", title: "A", page_age: null },
            ],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "pause_turn",
      },
      {
        content: [
          {
            type: "web_search_tool_result",
            content: [
              {
                type: "web_search_result",
                url: "https://a.com/x",
                title: "A again",
                page_age: null,
              },
              { type: "web_search_result", url: "https://b.com/y", title: "B", page_age: null },
            ],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "pause_turn",
      },
      {
        content: [{ type: "tool_use", id: "t1", name: "finish", input: {} }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "tool_use",
      },
    ];
    let call = 0;
    const createMessage = async () => responses[call++] as never;
    const { sources } = await runAgent<string>({
      createMessage,
      model: "m",
      system: "s",
      tools: [{ name: "finish", description: "", input_schema: {} }],
      history: [],
      message: "hi",
      searchEnabled: true,
      dispatch: () => ({ kind: "terminal", value: "done" }),
      onNoTerminalTool: () => "none",
    });
    expect(sources).toEqual([
      { url: "https://a.com/x", title: "A", domain: "a.com" },
      { url: "https://b.com/y", title: "B", domain: "b.com" },
    ]);
  });

  it("with no volatileSystem, sends a single cached system block (unchanged)", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({
      createMessage,
      model: "m",
      system: "STABLE",
      tools: [],
      history: [],
      message: "hi",
      dispatch: () => ({ kind: "continue", toolResult: {} }),
      onNoTerminalTool: (t) => t ?? "",
    });
    const sentSystem = createMessage.mock.calls[0]?.[0].system as Array<{
      text: string;
      cache_control?: unknown;
    }>;
    expect(sentSystem).toHaveLength(1);
    expect(sentSystem[0]?.text).toBe("STABLE");
    expect(sentSystem[0]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("with volatileSystem, appends a SECOND, UNCACHED system block after the cached one", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({
      createMessage,
      model: "m",
      system: "STABLE",
      volatileSystem: "VOLATILE",
      tools: [],
      history: [],
      message: "hi",
      dispatch: () => ({ kind: "continue", toolResult: {} }),
      onNoTerminalTool: (t) => t ?? "",
    });
    const sentSystem = createMessage.mock.calls[0]?.[0].system as Array<{
      text: string;
      cache_control?: unknown;
    }>;
    expect(sentSystem).toHaveLength(2);
    expect(sentSystem[0]?.text).toBe("STABLE");
    expect(sentSystem[0]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(sentSystem[1]?.text).toBe("VOLATILE");
    expect(sentSystem[1]?.cache_control).toBeUndefined();
  });

  it("omits the volatile block when volatileSystem is an empty string", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({
      createMessage,
      model: "m",
      system: "STABLE",
      volatileSystem: "",
      tools: [],
      history: [],
      message: "hi",
      dispatch: () => ({ kind: "continue", toolResult: {} }),
      onNoTerminalTool: (t) => t ?? "",
    });
    const sentSystem = createMessage.mock.calls[0]?.[0].system as unknown[];
    expect(sentSystem).toHaveLength(1);
  });

  it("disables parallel tool use so the model emits one tool_use per turn", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({
      createMessage,
      model: "m",
      system: "sys",
      tools: [{ name: "t", description: "", input_schema: { type: "object" } }],
      history: [],
      message: "go",
      dispatch: () => ({ kind: "continue", toolResult: {} }),
      onNoTerminalTool: (t) => t ?? "",
      toolChoice: "any",
    });
    const sentToolChoice = createMessage.mock.calls[0]?.[0].tool_choice as {
      type: string;
      disable_parallel_tool_use?: boolean;
    };
    expect(sentToolChoice.type).toBe("any");
    expect(sentToolChoice.disable_parallel_tool_use).toBe(true);
  });

  it("never sends an assistant turn with a tool_use that lacks a tool_result (parallel-call guard)", async () => {
    // Defense-in-depth: even if the API returns two tool_use blocks in one turn,
    // the loop must answer EVERY tool_use with a tool_result, or the next request
    // 400s ("tool_use ids found without tool_result blocks").
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(twoToolUseResp({ name: "a", id: "ta" }, { name: "b", id: "tb" }))
      .mockResolvedValueOnce(textResp("done"));
    await runAgent<string>({
      createMessage,
      model: "m",
      system: "sys",
      tools: [
        { name: "a", description: "", input_schema: { type: "object" } },
        { name: "b", description: "", input_schema: { type: "object" } },
      ],
      history: [],
      message: "go",
      dispatch: () => ({ kind: "continue", toolResult: { ok: 1 } }),
      onNoTerminalTool: (t) => t ?? "",
      toolChoice: "any",
    });
    // The 2nd request's messages must have a tool_result for BOTH tool_use ids.
    const msgs = createMessage.mock.calls[1]?.[0].messages as Array<{
      role: string;
      content: unknown;
    }>;
    const toolUseIds = new Set<string>();
    const toolResultIds = new Set<string>();
    for (const m of msgs) {
      if (!Array.isArray(m.content)) continue;
      for (const block of m.content as Array<{ type: string; id?: string; tool_use_id?: string }>) {
        if (block.type === "tool_use" && block.id) toolUseIds.add(block.id);
        if (block.type === "tool_result" && block.tool_use_id) toolResultIds.add(block.tool_use_id);
      }
    }
    // Every tool_use id sent back in an assistant turn has a matching tool_result.
    for (const id of toolUseIds) {
      expect(toolResultIds.has(id)).toBe(true);
    }
    expect(toolUseIds.size).toBeGreaterThanOrEqual(2);
  });
});

describe("per-call options", () => {
  const base = {
    model: "m",
    system: "S",
    tools: [],
    history: [],
    message: "hi",
    dispatch: () => ({ kind: "continue" as const, toolResult: {} }),
    onNoTerminalTool: (t: string | null) => t ?? "",
  };

  it("sends no thinking/output_config/fallbacks/betas and 2000 max_tokens by default", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({ ...base, createMessage });
    const args = defined(createMessage.mock.calls[0]?.[0], "call");
    expect(args).not.toHaveProperty("thinking");
    expect(args).not.toHaveProperty("output_config");
    expect(args).not.toHaveProperty("fallbacks");
    expect(args).not.toHaveProperty("betas");
    expect(args.max_tokens).toBe(2000);
  });

  it("passes thinking, effort and maxTokens when set", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({
      ...base,
      createMessage,
      thinking: { type: "adaptive" },
      effort: "medium",
      maxTokens: 16000,
    });
    const args = defined(createMessage.mock.calls[0]?.[0], "call");
    expect(args.thinking).toEqual({ type: "adaptive" });
    expect(args.output_config).toEqual({ effort: "medium" });
    expect(args.max_tokens).toBe(16000);
  });

  it("honours maxIterations", async () => {
    const createMessage = vi.fn().mockResolvedValue(toolUseResp("lookup", {}));
    await runAgent<string>({ ...base, createMessage, maxIterations: 6 });
    expect(createMessage).toHaveBeenCalledTimes(6);
  });

  it("returns the text answer after a search when toolChoice is auto", async () => {
    const searched = {
      content: [
        { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
        { type: "web_search_tool_result", content: [] },
        { type: "text", text: "final answer" },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "end_turn",
    };
    const createMessage = vi.fn().mockResolvedValueOnce(searched);
    const out = await runAgent<string>({ ...base, createMessage, toolChoice: "auto" });
    expect(out.result).toBe("final answer");
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it("adds the server-side refusal fallback only for supporting models", async () => {
    const on = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({
      ...base,
      model: "claude-sonnet-5-5",
      createMessage: on,
      refusalFallback: true,
    });
    const a = defined(on.mock.calls[0]?.[0], "call");
    expect(a.fallbacks).toBe("default");
    expect(a.betas).toEqual(["server-side-fallback-2026-07-01"]);

    const off = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({
      ...base,
      model: "claude-sonnet-4-6",
      createMessage: off,
      refusalFallback: true,
    });
    const b = defined(off.mock.calls[0]?.[0], "call");
    expect(b).not.toHaveProperty("fallbacks");
    expect(b).not.toHaveProperty("betas");
  });

  it("returns refusal text through onNoTerminalTool", async () => {
    const refused = {
      content: [],
      usage: { input_tokens: 5, output_tokens: 0 },
      stop_reason: "refusal",
    };
    const createMessage = vi.fn().mockResolvedValueOnce(refused);
    const out = await runAgent<string>({
      ...base,
      createMessage,
      onNoTerminalTool: (t) => t ?? "fallback text",
    });
    expect(out.result).toBe("fallback text");
  });

  it("picks the web search tool type by model", () => {
    expect(webSearchToolType("claude-sonnet-5-5")).toBe("web_search_20260209");
    expect(webSearchToolType("claude-haiku-4-5")).toBe("web_search_20250305");
  });

  it("sends the per-model search type when search is enabled", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({
      ...base,
      model: "claude-sonnet-5-5",
      createMessage,
      searchEnabled: true,
    });
    const tools = defined(createMessage.mock.calls[0]?.[0], "call").tools as Array<{
      type?: string;
    }>;
    expect(tools.some((t) => t.type === "web_search_20260209")).toBe(true);
  });
});

describe("accumulateText and parallelToolUse", () => {
  const base = {
    model: "m",
    system: "S",
    tools: [],
    history: [],
    message: "hi",
    dispatch: () => ({ kind: "continue" as const, toolResult: { ok: true } }),
    onNoTerminalTool: (t: string | null) => t ?? "fallback",
    toolChoice: "auto" as const,
  };
  const answerThenRemember = {
    content: [
      { type: "thinking", thinking: "..." },
      { type: "text", text: "answer" },
      { type: "tool_use", id: "r1", name: "remember_point", input: {} },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
    stop_reason: "tool_use",
  };
  const emptyFinal = {
    content: [],
    usage: { input_tokens: 10, output_tokens: 0 },
    stop_reason: "end_turn",
  };

  it("keeps text written before a tool call when accumulateText is set", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(answerThenRemember)
      .mockResolvedValueOnce(emptyFinal);
    const out = await runAgent<string>({ ...base, createMessage, accumulateText: true });
    expect(out.result).toBe("answer");
  });

  it("joins text from every response in order", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(answerThenRemember)
      .mockResolvedValueOnce(textResp("more"));
    const out = await runAgent<string>({ ...base, createMessage, accumulateText: true });
    expect(out.result).toBe("answer\n\nmore");
  });

  const splitBlocks = {
    content: [
      { type: "text", text: "Sleep matters. " },
      { type: "text", text: "In the abstract, " },
      { type: "text", text: "fat-free mass loss was lower." },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
    stop_reason: "end_turn",
  };

  it("joins one response's text blocks without inserted line breaks", async () => {
    for (const accumulateText of [false, true]) {
      const createMessage = vi.fn().mockResolvedValueOnce(splitBlocks);
      const out = await runAgent<string>({ ...base, createMessage, accumulateText });
      expect(out.result).toBe("Sleep matters. In the abstract, fat-free mass loss was lower.");
    }
  });

  it("separates responses with a blank line when accumulating across split blocks", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ...splitBlocks,
        content: [...splitBlocks.content, { type: "tool_use", id: "r1", name: "x", input: {} }],
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce(textResp("More."));
    const out = await runAgent<string>({ ...base, createMessage, accumulateText: true });
    expect(out.result).toBe(
      "Sleep matters. In the abstract, fat-free mass loss was lower.\n\nMore.",
    );
  });

  it("uses accumulated text when the iteration cap is hit", async () => {
    const createMessage = vi.fn().mockResolvedValue(answerThenRemember);
    const out = await runAgent<string>({
      ...base,
      createMessage,
      accumulateText: true,
      maxIterations: 2,
    });
    expect(out.result).toBe("answer\n\nanswer");
  });

  it("uses only the final response's text without accumulateText", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(answerThenRemember)
      .mockResolvedValueOnce(emptyFinal);
    const out = await runAgent<string>({ ...base, createMessage });
    expect(out.result).toBe("fallback");
  });

  it("parallelToolUse drops disable_parallel_tool_use and answers every tool_use", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(twoToolUseResp({ name: "a", id: "ta" }, { name: "b", id: "tb" }))
      .mockResolvedValueOnce(textResp("done"));
    const dispatch = vi.fn((name: string) => ({
      kind: "continue" as const,
      toolResult: { from: name },
    }));
    const out = await runAgent<string>({ ...base, createMessage, dispatch, parallelToolUse: true });
    expect(out.result).toBe("done");
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
    const first = defined(createMessage.mock.calls[0]?.[0], "call");
    expect(first.tool_choice).toEqual({ type: "auto" });
    const second = defined(createMessage.mock.calls[1]?.[0], "call");
    const last = second.messages[second.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toEqual([
      { type: "tool_result", tool_use_id: "ta", content: JSON.stringify({ from: "a" }) },
      { type: "tool_result", tool_use_id: "tb", content: JSON.stringify({ from: "b" }) },
    ]);
  });

  it("parallelToolUse returns the first terminal value", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(twoToolUseResp({ name: "a", id: "ta" }, { name: "b", id: "tb" }));
    const dispatch = (name: string) =>
      name === "b"
        ? ({ kind: "terminal", value: "B" } as const)
        : ({ kind: "continue", toolResult: {} } as const);
    const out = await runAgent<string>({ ...base, createMessage, dispatch, parallelToolUse: true });
    expect(out.result).toBe("B");
  });

  it("keeps disable_parallel_tool_use on the default (meal chat) request", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({ ...base, toolChoice: undefined, createMessage });
    const args = defined(createMessage.mock.calls[0]?.[0], "call");
    expect(args.tool_choice).toEqual({ type: "any", disable_parallel_tool_use: true });
  });
});

describe("lookups", () => {
  const base = {
    model: "m",
    system: "S",
    tools: [],
    history: [],
    message: "hi",
    dispatch: () => ({ kind: "continue" as const, toolResult: { ok: true } }),
    onNoTerminalTool: (t: string | null) => t ?? "fallback",
    toolChoice: "auto" as const,
  };

  it("is empty when no tools run", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("ok"));
    const out = await runAgent<string>({ ...base, createMessage });
    expect(out.lookups).toEqual([]);
  });

  it("records a single tool call with its input rendered compactly", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(toolUseResp("get_training_history", { days: 35 }))
      .mockResolvedValueOnce(toolUseResp("list_workout_templates", {}))
      .mockResolvedValueOnce(textResp("done"));
    const out = await runAgent<string>({ ...base, createMessage });
    expect(out.lookups).toEqual(["get_training_history(days=35)", "list_workout_templates"]);
  });

  it("records every call of a parallel turn in order", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce({
        content: [
          { type: "tool_use", id: "ta", name: "get_report", input: { date: "2026-09-30" } },
          { type: "tool_use", id: "tb", name: "get_meals", input: { from: "a", limit: 3 } },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce(textResp("done"));
    const out = await runAgent<string>({ ...base, createMessage, parallelToolUse: true });
    expect(out.lookups).toEqual(["get_report(date=2026-09-30)", "get_meals(from=a, limit=3)"]);
  });

  it("records web searches by query", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce({
        content: [
          { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "rdl form" } },
        ],
        usage: { input_tokens: 10, output_tokens: 0 },
        stop_reason: "pause_turn",
      })
      .mockResolvedValueOnce(textResp("done"));
    const out = await runAgent<string>({ ...base, createMessage, searchEnabled: true });
    expect(out.lookups).toEqual(['web search: "rdl form"']);
  });

  it("truncates long entries to 80 chars", async () => {
    const q = "x".repeat(200);
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(toolUseResp("get_thing", { q }))
      .mockResolvedValueOnce({
        content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: q } }],
        usage: { input_tokens: 10, output_tokens: 0 },
        stop_reason: "pause_turn",
      })
      .mockResolvedValueOnce(textResp("done"));
    const out = await runAgent<string>({ ...base, createMessage, searchEnabled: true });
    expect(out.lookups).toHaveLength(2);
    for (const l of out.lookups) {
      expect(l.length).toBe(80);
      expect(l.endsWith("…")).toBe(true);
    }
    expect(out.lookups[0]?.startsWith("get_thing(q=xxx")).toBe(true);
    expect(out.lookups[1]?.startsWith('web search: "xxx')).toBe(true);
  });

  it("leaves out tools named in omitFromLookups", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce({
        content: [
          { type: "tool_use", id: "ta", name: "get_report", input: {} },
          { type: "tool_use", id: "tb", name: "remember_point", input: { topic: "t" } },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: "tool_use",
      })
      .mockResolvedValueOnce(textResp("done"));
    const out = await runAgent<string>({
      ...base,
      createMessage,
      parallelToolUse: true,
      omitFromLookups: ["remember_point"],
    });
    expect(out.lookups).toEqual(["get_report"]);
  });
});

describe("history notes", () => {
  const base = {
    system: "S",
    tools: [],
    message: "now",
    dispatch: () => ({ kind: "continue" as const, toolResult: {} }),
    onNoTerminalTool: (t: string | null) => t ?? "",
    toolChoice: "auto" as const,
  };
  const history = [
    { role: "user" as const, content: "q1" },
    { role: "assistant" as const, content: "a1", note: "Lookups behind the next reply: x" },
    { role: "user" as const, content: "q2" },
    { role: "assistant" as const, content: "a2" },
  ];

  it("puts a system message with the note right before its assistant turn", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({ ...base, model: "claude-sonnet-5-5", history, createMessage });
    expect(defined(createMessage.mock.calls[0]?.[0], "call").messages).toEqual([
      { role: "user", content: "q1" },
      { role: "system", content: "Lookups behind the next reply: x" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "now" },
    ]);
  });

  it("sends the plain shape when no entry has a note", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({
      ...base,
      model: "claude-sonnet-5-5",
      history: [
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
      ],
      createMessage,
    });
    expect(defined(createMessage.mock.calls[0]?.[0], "call").messages).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "now" },
    ]);
  });

  it("does not insert a note system message unless the previous message is a user turn", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({
      ...base,
      model: "claude-sonnet-5-5",
      history: [
        { role: "assistant", content: "a0", note: "Lookups behind the next reply: x" },
        { role: "assistant", content: "a1", note: "Lookups behind the next reply: y" },
      ],
      createMessage,
    });
    expect(defined(createMessage.mock.calls[0]?.[0], "call").messages).toEqual([
      { role: "assistant", content: "a0" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "now" },
    ]);
  });

  it("drops notes for a model without mid-conversation system messages", async () => {
    const createMessage = vi.fn().mockResolvedValueOnce(textResp("ok"));
    await runAgent<string>({ ...base, model: "claude-sonnet-4-6", history, createMessage });
    expect(defined(createMessage.mock.calls[0]?.[0], "call").messages).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "now" },
    ]);
    expect(supportsMidConversationSystem("claude-sonnet-5-5")).toBe(true);
    expect(supportsMidConversationSystem("claude-sonnet-4-6")).toBe(false);
  });
});
