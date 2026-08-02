import { describe, expect, it, vi } from "vitest";
import { nthCall } from "../test-support/assertions.js";
import { runMealAgent } from "./agent.js";
import type { MealContext } from "./context.js";

const ctx: MealContext = {
  unitSystem: "metric",
  timezone: "America/New_York",
  today: "2026-06-22",
  activePhaseTargets: null,
  storedMeals: [],
  recentMeals: [],
  todayMacros: null,
  aboutMe: null,
};

// Minimal fake of the Anthropic message shape the loop reads.
function fakeMessage(content: unknown[], usage: Record<string, number>) {
  return {
    content,
    usage: {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    },
    stop_reason: "tool_use",
  };
}

describe("runMealAgent", () => {
  it("returns a proposal when the model calls propose_log", async () => {
    const createMessage = vi.fn().mockResolvedValue(
      fakeMessage(
        [
          {
            type: "tool_use",
            id: "t1",
            name: "propose_log",
            input: {
              meals: [
                {
                  source: "estimated",
                  name: "beer",
                  kcal: 150,
                  protein_g: 1,
                  carb_g: 13,
                  fat_g: 0,
                  eaten_at: "2026-06-22T18:30:00",
                  confidence: 0.6,
                  suggest_store: false,
                },
              ],
            },
          },
        ],
        { input_tokens: 800, output_tokens: 120 },
      ),
    );

    const result = await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "I had a beer",
      searchEnabled: false,
    });

    expect(result.result.kind).toBe("proposal");
    if (result.result.kind === "proposal") {
      expect(result.result.meals).toHaveLength(1);
      expect(result.result.meals[0]?.name).toBe("beer");
    }
    expect(result.usage.input_tokens).toBe(800);
    expect(result.usage.output_tokens).toBe(120);
  });

  it("returns an alcohol session when the model calls propose_log with alcohol_sessions", async () => {
    const createMessage = vi.fn().mockResolvedValue(
      fakeMessage(
        [
          {
            type: "tool_use",
            id: "t1",
            name: "propose_log",
            input: {
              meals: [],
              alcohol_sessions: [
                { drinks_count: 2, est_kcal: 300, started_at: "2026-06-22T19:30:00" },
              ],
            },
          },
        ],
        { input_tokens: 500, output_tokens: 60 },
      ),
    );

    const result = await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "I had two beers",
      searchEnabled: false,
    });

    expect(result.result.kind).toBe("proposal");
    if (result.result.kind === "proposal") {
      expect(result.result.meals).toHaveLength(0);
      expect(result.result.alcoholSessions).toHaveLength(1);
      expect(result.result.alcoholSessions[0]?.drinks_count).toBe(2);
      expect(result.result.alcoholSessions[0]?.est_kcal).toBe(300);
    }
  });

  it("splits a mixed propose_log into meals AND alcoholSessions", async () => {
    const createMessage = vi.fn().mockResolvedValue(
      fakeMessage(
        [
          {
            type: "tool_use",
            id: "t1",
            name: "propose_log",
            input: {
              meals: [
                {
                  source: "estimated",
                  name: "burger",
                  kcal: 600,
                  protein_g: 30,
                  carb_g: 45,
                  fat_g: 32,
                  suggest_store: false,
                },
              ],
              alcohol_sessions: [{ drinks_count: 2, est_kcal: 300 }],
            },
          },
        ],
        { input_tokens: 700, output_tokens: 90 },
      ),
    );

    const result = await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "a burger and two beers",
      searchEnabled: false,
    });

    expect(result.result.kind).toBe("proposal");
    if (result.result.kind === "proposal") {
      expect(result.result.meals).toHaveLength(1);
      expect(result.result.alcoholSessions).toHaveLength(1);
    }
  });

  it("drops malformed alcohol entries but keeps valid ones", async () => {
    const createMessage = vi.fn().mockResolvedValue(
      fakeMessage(
        [
          {
            type: "tool_use",
            id: "t1",
            name: "propose_log",
            input: {
              meals: [],
              alcohol_sessions: [
                { drinks_count: 2, est_kcal: 300, started_at: "2026-06-22T19:30:00", note: "IPA" },
                { drinks_count: 0, est_kcal: 100 },
              ],
            },
          },
        ],
        { input_tokens: 400, output_tokens: 40 },
      ),
    );

    const result = await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "drinks",
      searchEnabled: false,
    });

    // Assert the kind BEFORE the type guard so the test can't pass vacuously.
    expect(result.result.kind).toBe("proposal");
    if (result.result.kind === "proposal") {
      expect(result.result.alcoholSessions).toHaveLength(1);
      // The valid entry round-trips its optional started_at/note through the schema.
      expect(result.result.alcoholSessions[0]?.started_at).toBe("2026-06-22T19:30:00");
      expect(result.result.alcoholSessions[0]?.note).toBe("IPA");
    }
  });

  it("keeps a well-shaped meal and drops a wrong-shaped one (real-model regression)", async () => {
    // Regression for the live bug: the model can emit a wrong-shaped meal
    // (energy/macros{}/description) alongside a correct one. The agent must drop
    // the malformed entry via ProposedMealSchema, not pass it through or crash.
    const createMessage = vi.fn().mockResolvedValue(
      fakeMessage(
        [
          {
            type: "tool_use",
            id: "t1",
            name: "propose_log",
            input: {
              meals: [
                // correct shape, no eaten_at/confidence (now optional)
                {
                  source: "estimated",
                  name: "eggs and toast",
                  kcal: 330,
                  protein_g: 18,
                  carb_g: 28,
                  fat_g: 16,
                },
                // wrong shape the model used to emit — must be dropped
                {
                  source: "estimated",
                  description: "beer",
                  energy: 150,
                  macros: { protein: 1, carbs: 13, fat: 0 },
                },
              ],
            },
          },
        ],
        { input_tokens: 900, output_tokens: 150 },
      ),
    );

    const result = await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "eggs and toast and a beer",
      searchEnabled: false,
    });

    expect(result.result.kind).toBe("proposal");
    if (result.result.kind === "proposal") {
      // Only the well-shaped meal survives.
      expect(result.result.meals).toHaveLength(1);
      expect(result.result.meals[0]?.name).toBe("eggs and toast");
    }
  });

  it("passes through eaten_at when the model captures a stated time", async () => {
    const createMessage = vi.fn().mockResolvedValue(
      fakeMessage(
        [
          {
            type: "tool_use",
            id: "t1",
            name: "propose_log",
            input: {
              meals: [
                {
                  source: "estimated",
                  name: "Big Mac",
                  kcal: 550,
                  protein_g: 25,
                  carb_g: 45,
                  fat_g: 30,
                  // naive-local string, no Z suffix — the write path normalizes it
                  eaten_at: "2026-06-22T13:00:00",
                },
              ],
            },
          },
        ],
        { input_tokens: 700, output_tokens: 90 },
      ),
    );

    const result = await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "I had a Big Mac at 1pm",
      searchEnabled: false,
    });

    expect(result.result.kind).toBe("proposal");
    if (result.result.kind === "proposal") {
      const meal = result.result.meals[0];
      expect(meal?.source).toBe("estimated");
      if (meal?.source === "estimated") {
        expect(meal.eaten_at).toBe("2026-06-22T13:00:00");
      }
    }
  });

  it("returns a question when the model calls ask_clarification", async () => {
    const createMessage = vi.fn().mockResolvedValue(
      fakeMessage(
        [
          {
            type: "tool_use",
            id: "t1",
            name: "ask_clarification",
            input: { question: "What did you have for lunch?" },
          },
        ],
        { input_tokens: 500, output_tokens: 30 },
      ),
    );

    const result = await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "I had lunch",
      searchEnabled: false,
    });

    expect(result.result.kind).toBe("question");
    if (result.result.kind === "question") {
      expect(result.result.question).toMatch(/lunch/i);
    }
  });

  it("stops after the iteration cap and returns a clarifying fallback", async () => {
    // Model never calls a terminal tool — only the read tool, forever.
    const createMessage = vi
      .fn()
      .mockResolvedValue(
        fakeMessage(
          [{ type: "tool_use", id: "t1", name: "lookup_past_meals", input: { query: "x" } }],
          { input_tokens: 100, output_tokens: 10 },
        ),
      );

    const result = await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "the usual",
      searchEnabled: false,
    });

    // Loop must terminate (not hang) and degrade to a question.
    expect(result.result.kind).toBe("question");
    expect(createMessage.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("forces a tool call (tool_choice: any) so the model can't answer in plain text", async () => {
    // Regression for the live bug: with the default tool_choice the model
    // replied in plain text (stop_reason 'end_turn', a text block, no tool_use),
    // which the loop discarded and replaced with a canned question. Forcing
    // tool_choice:any makes the model route every turn through a tool — a real
    // clarification goes via ask_clarification (returning the model's question),
    // a parseable meal via propose_log.
    const createMessage = vi.fn().mockResolvedValue(
      fakeMessage(
        [
          {
            type: "tool_use",
            id: "t1",
            name: "ask_clarification",
            input: { question: "What size is the burger?" },
          },
        ],
        { input_tokens: 600, output_tokens: 40 },
      ),
    );

    await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "a hot honey burger",
      searchEnabled: false,
    });

    const [callArgs] = nthCall(createMessage, 0);
    // disable_parallel_tool_use is set so the model emits one tool_use per turn
    // (the loop dispatches one tool + one tool_result per turn — see run-agent.ts).
    expect(callArgs.tool_choice).toEqual({ type: "any", disable_parallel_tool_use: true });
  });

  it("includes the web_search tool with a CONSTANT max_uses when searchEnabled", async () => {
    // max_uses is a fixed per-turn ceiling (NOT the remaining daily count) so the
    // tools block is byte-identical across requests — required for the system
    // prompt-cache to survive (a varying max_uses busts it).
    const createMessage = vi
      .fn()
      .mockResolvedValue(
        fakeMessage(
          [{ type: "tool_use", id: "t1", name: "ask_clarification", input: { question: "?" } }],
          { input_tokens: 100, output_tokens: 10 },
        ),
      );
    await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "x",
      searchEnabled: true,
    });
    const [callArgs] = nthCall(createMessage, 0);
    const ws = (callArgs.tools as Array<{ type?: string; name?: string; max_uses?: number }>).find(
      (t) => t.name === "web_search",
    );
    expect(ws?.type).toBe("web_search_20250305");
    // The fixed per-turn ceiling (PER_TURN_SEARCH_CEILING) — same on every call.
    expect(ws?.max_uses).toBe(5);
  });

  it("omits the web_search tool entirely when searchEnabled is false", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValue(
        fakeMessage(
          [{ type: "tool_use", id: "t1", name: "ask_clarification", input: { question: "?" } }],
          { input_tokens: 100, output_tokens: 10 },
        ),
      );
    await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "x",
      searchEnabled: false,
    });
    const [callArgs] = nthCall(createMessage, 0);
    const ws = (callArgs.tools as Array<{ name?: string }>).find((t) => t.name === "web_search");
    expect(ws).toBeUndefined();
  });

  it("sums web_search_requests from usage.server_tool_use across the turn", async () => {
    const withSearch = {
      content: [
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } },
        { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
      ],
      usage: { input_tokens: 500, output_tokens: 20, server_tool_use: { web_search_requests: 1 } },
      stop_reason: "pause_turn",
    };
    const thenPropose = fakeMessage(
      [
        {
          type: "tool_use",
          id: "t1",
          name: "propose_log",
          input: {
            meals: [
              {
                source: "estimated",
                name: "poke bowl",
                kcal: 600,
                protein_g: 30,
                carb_g: 60,
                fat_g: 20,
              },
            ],
          },
        },
      ],
      { input_tokens: 700, output_tokens: 80 },
    );
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(withSearch)
      .mockResolvedValueOnce(thenPropose);

    const result = await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "a poke bowl from X",
      searchEnabled: true,
    });

    expect(result.result.kind).toBe("proposal");
    expect(result.usage.web_search_requests).toBe(1);
    // pause_turn must continue the loop, not terminate it.
    expect(createMessage.mock.calls.length).toBe(2);
  });

  it("continues (not canned fallback) when a search turn ends in plain text, then proposes", async () => {
    // Regression for a live dogfood bug: after web_search, Anthropic relaxes
    // tool_choice:any, so the model can answer in PLAIN TEXT — stop_reason
    // 'end_turn', blocks = [server_tool_use, web_search_tool_result, text...],
    // NO tool_use. The loop used to hit the `!toolUse` branch and bail to the
    // canned "Could you tell me what you ate?" — throwing away the search. It
    // must instead push the turn back with a nudge and continue to a terminal
    // tool.
    const searchedThenText = {
      content: [
        {
          type: "server_tool_use",
          id: "s1",
          name: "web_search",
          input: { query: "Ali Babas shawarma calories" },
        },
        { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
        { type: "text", text: "A chicken shawarma wrap from Ali Baba's is roughly 600 kcal." },
      ],
      usage: {
        input_tokens: 4000,
        output_tokens: 120,
        server_tool_use: { web_search_requests: 1 },
      },
      stop_reason: "end_turn",
    };
    const thenPropose = fakeMessage(
      [
        {
          type: "tool_use",
          id: "t1",
          name: "propose_log",
          input: {
            meals: [
              {
                source: "estimated",
                name: "chicken shawarma wrap",
                kcal: 600,
                protein_g: 35,
                carb_g: 55,
                fat_g: 25,
              },
            ],
          },
        },
      ],
      { input_tokens: 600, output_tokens: 70 },
    );
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(searchedThenText)
      .mockResolvedValueOnce(thenPropose);

    const result = await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "chicken shawarma from Ali Babas",
      searchEnabled: true,
    });

    // Must NOT be the canned fallback — it's a real proposal built on the search.
    expect(result.result.kind).toBe("proposal");
    if (result.result.kind === "proposal") {
      expect(result.result.meals[0]?.name).toBe("chicken shawarma wrap");
    }
    expect(result.usage.web_search_requests).toBe(1);
    // The loop continued past the plain-text turn rather than bailing at i=0.
    expect(createMessage.mock.calls.length).toBe(2);
    // The nudge was appended as a user turn before the second call.
    const [secondCallArgs] = nthCall(createMessage, 1);
    const lastMsg = secondCallArgs.messages[secondCallArgs.messages.length - 1];
    expect(lastMsg.role).toBe("user");
  });

  it("runMealAgent passes web-search sources through", async () => {
    const responses = [
      {
        content: [
          {
            type: "web_search_tool_result",
            content: [
              {
                type: "web_search_result",
                url: "https://example.com/a",
                title: "A",
                page_age: null,
              },
            ],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "pause_turn",
      },
      {
        content: [
          { type: "tool_use", id: "t1", name: "ask_clarification", input: { question: "?" } },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "tool_use",
      },
    ];
    let call = 0;
    const { sources } = await runMealAgent({
      createMessage: (async () => responses[call++]) as never,
      model: "m",
      context: ctx,
      history: [],
      message: "hi",
      searchEnabled: true,
    });
    expect(sources).toEqual([{ url: "https://example.com/a", title: "A", domain: "example.com" }]);
  });

  it("passes today's macros to the model as an uncached volatile system block", async () => {
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(
        fakeMessage(
          [{ type: "tool_use", id: "t1", name: "ask_clarification", input: { question: "?" } }],
          { input_tokens: 100, output_tokens: 10 },
        ),
      );
    const ctxWithMacros: MealContext = {
      unitSystem: "metric",
      timezone: "America/New_York",
      today: "2026-06-24",
      activePhaseTargets: { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 },
      storedMeals: [],
      recentMeals: [],
      todayMacros: {
        consumed: { kcal: 500, protein_g: 40, carb_g: 50, fat_g: 15 },
        target: { kcal: 2000, protein_g: 150, carb_g: 200, fat_g: 60 },
        remaining: { kcal: 1500, protein_g: 110, carb_g: 150, fat_g: 45 },
        status: "on_track",
      },
      aboutMe: null,
    };
    await runMealAgent({
      createMessage,
      model: "m",
      context: ctxWithMacros,
      history: [],
      message: "what's left?",
      searchEnabled: false,
    });
    const [callArgs] = nthCall(createMessage, 0);
    const sentSystem = callArgs.system as Array<{
      text: string;
      cache_control?: unknown;
    }>;
    expect(sentSystem).toHaveLength(2);
    expect(sentSystem[1]?.cache_control).toBeUndefined();
    expect(sentSystem[1]?.text).toContain("Today so far");
  });

  it("still degrades to the canned question when there is NO search and no tool", async () => {
    // The genuinely-empty case must keep the existing fallback (don't loop
    // forever on a model that returns nothing actionable and never searched).
    const emptyText = {
      content: [{ type: "text", text: "Hello!" }],
      usage: { input_tokens: 100, output_tokens: 10 },
      stop_reason: "end_turn",
    };
    const createMessage = vi.fn().mockResolvedValue(emptyText);

    const result = await runMealAgent({
      createMessage,
      model: "claude-haiku-4-5",
      context: ctx,
      history: [],
      message: "hi",
      searchEnabled: true,
    });

    expect(result.result.kind).toBe("question");
    // Bails immediately (no search to act on) — does not spin the loop.
    expect(createMessage.mock.calls.length).toBe(1);
  });
});
