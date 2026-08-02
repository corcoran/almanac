import { describe, expect, it, vi } from "vitest";
import { MAX_ITERATIONS, MAX_SOURCES, runAgent } from "./run-agent.js";

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
      toolChoice: "auto",
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
