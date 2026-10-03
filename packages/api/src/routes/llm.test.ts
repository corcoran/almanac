import { type CreateMessage, recordLlmUsage } from "@almanac/core/llm";
import { appendTurns, insertPoints, listTurnsForDay, updateUser } from "@almanac/core/repos";
import { DailyBalanceSchema } from "@almanac/core/schemas";
import { defined } from "@almanac/core/test-support";
import { currentUserDate } from "@almanac/core/types";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../server.js";

describe("/api/v1/llm/meal-chat", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };

  const proposeStub: CreateMessage = async () => ({
    content: [
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
    usage: { input_tokens: 800, output_tokens: 120 },
    stop_reason: "tool_use",
  });

  function setup(opts: { userFlag: number; createMessage?: CreateMessage }) {
    const a = buildApp({
      dbPath: ":memory:",
      trustProxyHeaders: true,
      llm: {
        config: {
          enabled: true,
          provider: "anthropic",
          model: "claude-haiku-4-5",
          insightsModel: "claude-sonnet-4-6",
          insightsEffort: "medium",
          apiKey: "sk-test",
          defaultDailyTokenLimit: undefined,
          hardDailyTokenCap: undefined,
          tokensPerSearch: 2500,
          hardDailySearchCap: undefined,
        },
        createMessage: opts.createMessage ?? proposeStub,
      },
    });
    a.db
      .prepare(
        `INSERT INTO users (name, dob, height_cm, sex, email, timezone, preferred_unit_system, llm_logging_enabled)
         VALUES ('Jeff','1990-01-01',180,'male','test@example.com','America/New_York','metric', ?)`,
      )
      .run(opts.userFlag);
    return a;
  }

  it("403s when the per-user flag is off", async () => {
    app = setup({ userFlag: 0 });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/meal-chat",
      headers: auth,
      payload: { message: "I had a beer", history: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns a proposal and records usage when enabled", async () => {
    app = setup({ userFlag: 1 });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/meal-chat",
      headers: auth,
      payload: { message: "I had a beer", history: [] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe("proposal");
    expect(body.meals[0].name).toBe("beer");
    expect(body.usage.input_tokens).toBe(800);

    const count = app.db.prepare("SELECT COUNT(*) AS n FROM llm_usage").get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe("/api/v1/llm/meal-chat hard backstop", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };

  const proposeStub: CreateMessage = async () => ({
    content: [
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
    usage: { input_tokens: 800, output_tokens: 120 },
    stop_reason: "tool_use",
  });

  function setup(opts: {
    createMessage: CreateMessage;
    defaultDailyTokenLimit?: number;
    hardDailyTokenCap?: number;
  }) {
    const a = buildApp({
      dbPath: ":memory:",
      trustProxyHeaders: true,
      llm: {
        config: {
          enabled: true,
          provider: "anthropic",
          model: "claude-haiku-4-5",
          insightsModel: "claude-sonnet-4-6",
          insightsEffort: "medium",
          apiKey: "sk-test",
          defaultDailyTokenLimit: opts.defaultDailyTokenLimit,
          hardDailyTokenCap: opts.hardDailyTokenCap,
          tokensPerSearch: 2500,
          hardDailySearchCap: undefined,
        },
        createMessage: opts.createMessage,
      },
    });
    a.db
      .prepare(
        `INSERT INTO users (name, dob, height_cm, sex, email, timezone, preferred_unit_system, llm_logging_enabled)
         VALUES ('Jeff','1990-01-01',180,'male','test@example.com','America/New_York','metric', 1)`,
      )
      .run();
    return a;
  }

  function seedUsage(db: FastifyInstance["db"], input: number, output: number) {
    recordLlmUsage(db, {
      userId: 1,
      createdAt: new Date().toISOString(),
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "meal_chat",
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 0,
      billedTokens: input + output,
    });
  }

  it("429s and never calls the model when over the hard cap", async () => {
    const createMessage = vi.fn(proposeStub);
    app = setup({ createMessage, hardDailyTokenCap: 1000 });
    // 600 + 500 = 1100 input+output >= 1000 cap.
    seedUsage(app.db, 600, 500);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/meal-chat",
      headers: auth,
      payload: { message: "I had a beer", history: [] },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("usage_limit_exceeded");
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("429s on the per-user hard cap when it is tighter than the env cap", async () => {
    const createMessage = vi.fn(proposeStub);
    app = setup({ createMessage, hardDailyTokenCap: 100000 });
    updateUser(app.db, 1, { llm_daily_hard_cap: 1000 });
    seedUsage(app.db, 600, 500); // 1100: past the user's 1000, far under the env 100k

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/meal-chat",
      headers: auth,
      payload: { message: "I had a beer", history: [] },
    });

    expect(res.statusCode).toBe(429);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("429s on a per-user hard cap with no env cap configured", async () => {
    // The shipping default leaves the env cap unset, so a per-user cap has to
    // bite on its own or the admin control is inert on a fresh install.
    const createMessage = vi.fn(proposeStub);
    app = setup({ createMessage, hardDailyTokenCap: undefined });
    updateUser(app.db, 1, { llm_daily_hard_cap: 1000 });
    seedUsage(app.db, 600, 500);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/meal-chat",
      headers: auth,
      payload: { message: "I had a beer", history: [] },
    });

    expect(res.statusCode).toBe(429);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("does not let a loose per-user cap raise the env ceiling", async () => {
    const createMessage = vi.fn(proposeStub);
    app = setup({ createMessage, hardDailyTokenCap: 1000 });
    updateUser(app.db, 1, { llm_daily_hard_cap: 500000 });
    seedUsage(app.db, 600, 500); // past the env 1000, under the user's 500k

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/meal-chat",
      headers: auth,
      payload: { message: "I had a beer", history: [] },
    });

    expect(res.statusCode).toBe(429);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("still 200s and calls the model when over the soft limit but under the hard cap", async () => {
    const createMessage = vi.fn(proposeStub);
    app = setup({ createMessage, defaultDailyTokenLimit: 500, hardDailyTokenCap: 100000 });
    // 600 + 200 = 800 over the 500 soft limit, far under the 100k hard cap.
    seedUsage(app.db, 600, 200);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/meal-chat",
      headers: auth,
      payload: { message: "I had a beer", history: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe("proposal");
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it("never blocks by usage when no hard cap is configured", async () => {
    const createMessage = vi.fn(proposeStub);
    app = setup({ createMessage, hardDailyTokenCap: undefined });
    // Huge usage — would blow any cap, but none is set.
    seedUsage(app.db, 5_000_000, 5_000_000);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/meal-chat",
      headers: auth,
      payload: { message: "I had a beer", history: [] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe("proposal");
    expect(createMessage).toHaveBeenCalledTimes(1);
  });
});

describe("/api/v1/llm/usage", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };

  function setup(opts: {
    userFlag: number;
    defaultDailyTokenLimit?: number;
    hardDailyTokenCap?: number;
  }) {
    const a = buildApp({
      dbPath: ":memory:",
      trustProxyHeaders: true,
      llm: {
        config: {
          enabled: true,
          provider: "anthropic",
          model: "claude-haiku-4-5",
          insightsModel: "claude-sonnet-4-6",
          insightsEffort: "medium",
          apiKey: "sk-test",
          defaultDailyTokenLimit: opts.defaultDailyTokenLimit,
          hardDailyTokenCap: opts.hardDailyTokenCap,
          tokensPerSearch: 2500,
          hardDailySearchCap: undefined,
        },
        createMessage: async () => ({
          content: [],
          usage: { input_tokens: 0, output_tokens: 0 },
          stop_reason: "end_turn",
        }),
      },
    });
    a.db
      .prepare(
        `INSERT INTO users (name, dob, height_cm, sex, email, timezone, preferred_unit_system, llm_logging_enabled)
         VALUES ('Jeff','1990-01-01',180,'male','test@example.com','America/New_York','metric', ?)`,
      )
      .run(opts.userFlag);
    return a;
  }

  it("403s when the per-user flag is off", async () => {
    app = setup({ userFlag: 0, defaultDailyTokenLimit: 50000 });
    const res = await app.inject({ method: "GET", url: "/api/v1/llm/usage", headers: auth });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("llm_disabled");
  });

  it("returns today's daily balance validating against the schema", async () => {
    app = setup({ userFlag: 1, defaultDailyTokenLimit: 50000 });
    // Seed two rows in the user's current day (now → always inside today's window),
    // totalling 10000 input+output tokens.
    for (const [input, output] of [
      [4000, 1000],
      [4000, 1000],
    ] as const) {
      recordLlmUsage(app.db, {
        userId: 1,
        createdAt: new Date().toISOString(),
        provider: "anthropic",
        model: "claude-haiku-4-5",
        feature: "meal_chat",
        usage: {
          input_tokens: input,
          output_tokens: output,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
        },
        webSearchRequests: 0,
        billedTokens: input + output,
      });
    }

    const res = await app.inject({ method: "GET", url: "/api/v1/llm/usage", headers: auth });
    expect(res.statusCode).toBe(200);
    const body = DailyBalanceSchema.parse(res.json());
    expect(body.tokensUsed).toBe(10000);
    expect(body.callsToday).toBe(2);
    expect(body.softLimit).toBe(50000);
    expect(body.overSoftLimit).toBe(false);
  });

  it("returns a no-limit balance when no soft limit is configured", async () => {
    app = setup({ userFlag: 1, defaultDailyTokenLimit: undefined });
    const res = await app.inject({ method: "GET", url: "/api/v1/llm/usage", headers: auth });
    expect(res.statusCode).toBe(200);
    const body = DailyBalanceSchema.parse(res.json());
    expect(body.softLimit).toBeNull();
    expect(body.logsLeftEstimate).toBeNull();
    expect(body.tokensUsed).toBe(0);
    expect(body.callsToday).toBe(0);
  });

  it("surfaces the ceiling in the gap between the soft limit and the 429", async () => {
    app = setup({ userFlag: 1, defaultDailyTokenLimit: 50000, hardDailyTokenCap: 150000 });
    recordLlmUsage(app.db, {
      userId: 1,
      createdAt: new Date().toISOString(),
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "meal_chat",
      usage: {
        input_tokens: 40000,
        output_tokens: 20000,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 0,
      billedTokens: 60000,
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/llm/usage", headers: auth });
    const body = DailyBalanceSchema.parse(res.json());
    // Past the soft limit, nowhere near the ceiling. The soft figures floor at
    // zero here, so the hard ones are the only thing left to plan against.
    expect(body.overSoftLimit).toBe(true);
    expect(body.pctRemaining).toBe(0);
    expect(body.overHardCap).toBe(false);
    expect(body.hardCap).toBe(150000);
    expect(body.hardPctRemaining).toBe(60);
  });

  it("derives the ceiling from the soft limit when no hard cap is configured", async () => {
    app = setup({ userFlag: 1, defaultDailyTokenLimit: 50000 });
    const res = await app.inject({ method: "GET", url: "/api/v1/llm/usage", headers: auth });
    const body = DailyBalanceSchema.parse(res.json());
    expect(body.hardCap).toBe(75000); // 1.5 × 50000
  });

  it("reports a null ceiling only when there is no soft limit to derive from", async () => {
    app = setup({ userFlag: 1, defaultDailyTokenLimit: undefined });
    const res = await app.inject({ method: "GET", url: "/api/v1/llm/usage", headers: auth });
    const body = DailyBalanceSchema.parse(res.json());
    expect(body.hardCap).toBeNull();
    expect(body.hardPctRemaining).toBeNull();
  });

  it("scopes logsLeftEstimate to the requested feature", async () => {
    app = setup({ userFlag: 1, defaultDailyTokenLimit: 60000 });
    // One cheap meal row (600) and one heavy insights row (6000).
    recordLlmUsage(app.db, {
      userId: 1,
      createdAt: new Date().toISOString(),
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "meal_chat",
      usage: {
        input_tokens: 550,
        output_tokens: 50,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 0,
      billedTokens: 600,
    });
    recordLlmUsage(app.db, {
      userId: 1,
      createdAt: new Date().toISOString(),
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "insights_chat",
      usage: {
        input_tokens: 5800,
        output_tokens: 200,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 0,
      billedTokens: 6000,
    });

    const meal = await app.inject({
      method: "GET",
      url: "/api/v1/llm/usage?feature=meal_chat",
      headers: auth,
    });
    const insights = await app.inject({
      method: "GET",
      url: "/api/v1/llm/usage?feature=insights_chat",
      headers: auth,
    });
    const mealBody = DailyBalanceSchema.parse(meal.json());
    const insightsBody = DailyBalanceSchema.parse(insights.json());

    // Same shared budget + same tokensUsed, but different per-log divisor.
    expect(mealBody.tokensUsed).toBe(insightsBody.tokensUsed);
    expect(mealBody.avgTokensPerLog).toBe(600);
    expect(insightsBody.avgTokensPerLog).toBe(6000);
    // Meal logs-left must exceed insights logs-left from the same budget.
    expect(mealBody.logsLeftEstimate).toBeGreaterThan(insightsBody.logsLeftEstimate ?? 0);
  });

  it("falls back to the per-feature default when that surface has no history", async () => {
    app = setup({ userFlag: 1, defaultDailyTokenLimit: 60000 });
    // Only meal history exists; ask for insights → default 5000.
    recordLlmUsage(app.db, {
      userId: 1,
      createdAt: new Date().toISOString(),
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "meal_chat",
      usage: {
        input_tokens: 550,
        output_tokens: 50,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 0,
      billedTokens: 600,
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/llm/usage?feature=insights_chat",
      headers: auth,
    });
    const body = DailyBalanceSchema.parse(res.json());
    expect(body.avgTokensPerLog).toBe(5000);
  });

  it("estimates insights messages from the heavy end of recent history", async () => {
    app = setup({ userFlag: 1, defaultDailyTokenLimit: 60000 });
    for (const billed of [1500, 2500, 9500]) {
      recordLlmUsage(app.db, {
        userId: 1,
        createdAt: new Date().toISOString(),
        provider: "anthropic",
        model: "claude-haiku-4-5",
        feature: "insights_chat",
        usage: {
          input_tokens: billed,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
        },
        webSearchRequests: 0,
        billedTokens: billed,
      });
    }
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/llm/usage?feature=insights_chat",
      headers: auth,
    });
    expect(DailyBalanceSchema.parse(res.json()).avgTokensPerLog).toBe(9500);
  });

  it("422s on an invalid feature value", async () => {
    app = setup({ userFlag: 1, defaultDailyTokenLimit: 60000 });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/llm/usage?feature=bogus",
      headers: auth,
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("/api/v1/llm/insights-chat", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };

  // Plain-text answer → the agent terminates via onNoTerminalTool.
  const answerStub: CreateMessage = async () => ({
    content: [{ type: "text", text: "you're on track" }],
    usage: { input_tokens: 900, output_tokens: 140 },
    stop_reason: "end_turn",
  });

  function setup(opts: {
    userFlag: number;
    createMessage?: CreateMessage;
    hardDailyTokenCap?: number;
    aboutMe?: string;
    insightsModel?: string;
  }) {
    const a = buildApp({
      dbPath: ":memory:",
      trustProxyHeaders: true,
      llm: {
        config: {
          enabled: true,
          provider: "anthropic",
          model: "claude-haiku-4-5",
          insightsModel: opts.insightsModel ?? "claude-sonnet-4-6",
          insightsEffort: "medium",
          apiKey: "sk-test",
          defaultDailyTokenLimit: undefined,
          hardDailyTokenCap: opts.hardDailyTokenCap,
          tokensPerSearch: 2500,
          hardDailySearchCap: undefined,
        },
        createMessage: opts.createMessage ?? answerStub,
      },
    });
    a.db
      .prepare(
        `INSERT INTO users (name, dob, height_cm, sex, email, timezone, preferred_unit_system, llm_logging_enabled, about_me)
         VALUES ('Jeff','1990-01-01',180,'male','test@example.com','America/New_York','metric', ?, ?)`,
      )
      .run(opts.userFlag, opts.aboutMe ?? null);
    return a;
  }

  const post = (a: FastifyInstance) =>
    a.inject({
      method: "POST",
      url: "/api/v1/llm/insights-chat",
      headers: auth,
      payload: { message: "hi", history: [] },
    });

  it("sends adaptive thinking, the configured effort and insights limits", async () => {
    const createMessage = vi.fn(answerStub);
    app = setup({ userFlag: 1, createMessage, insightsModel: "claude-sonnet-5-5" });
    await post(app);
    const args = defined(createMessage.mock.calls[0]?.[0], "call");
    expect(args.thinking).toEqual({ type: "adaptive" });
    expect(args.output_config).toEqual({ effort: "medium" });
    expect(args.max_tokens).toBe(16000);
    expect(args.fallbacks).toBe("default");
  });

  it("offers web search under the cap and records searches", async () => {
    const searched: CreateMessage = async () => ({
      content: [
        { type: "server_tool_use", id: "s", name: "web_search", input: {} },
        { type: "text", text: "ans" },
      ],
      usage: { input_tokens: 900, output_tokens: 140, server_tool_use: { web_search_requests: 1 } },
      stop_reason: "end_turn",
    });
    const createMessage = vi.fn(searched);
    app = setup({ userFlag: 1, createMessage });
    await post(app);
    const tools = defined(createMessage.mock.calls[0]?.[0], "call").tools as Array<{
      name?: string;
    }>;
    expect(tools.some((t) => t.name === "web_search")).toBe(true);
    const row = app.db
      .prepare("SELECT web_search_requests FROM llm_usage WHERE feature = 'insights_chat'")
      .get() as { web_search_requests: number };
    expect(row.web_search_requests).toBe(1);
  });

  it("persists remembered points against the assistant turn and returns its id", async () => {
    let call = 0;
    const createMessage: CreateMessage = async () =>
      call++ === 0
        ? {
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "remember_point",
                input: { topic: "x", gist: "y" },
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
            stop_reason: "tool_use",
          }
        : {
            content: [{ type: "text", text: "done" }],
            usage: { input_tokens: 10, output_tokens: 5 },
            stop_reason: "end_turn",
          };
    app = setup({ userFlag: 1, createMessage });
    const res = await post(app);
    const turnId = res.json().assistant_turn_id as number;
    const pts = app.db.prepare("SELECT topic, turn_id FROM insights_points").all() as Array<{
      topic: string;
      turn_id: number;
    }>;
    expect(pts).toEqual([{ topic: "x", turn_id: turnId }]);
  });

  it("persists the kind of a remembered point", async () => {
    let call = 0;
    const createMessage: CreateMessage = async () =>
      call++ === 0
        ? {
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "remember_point",
                input: { topic: "x", gist: "y", kind: "learned" },
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
            stop_reason: "tool_use",
          }
        : {
            content: [{ type: "text", text: "done" }],
            usage: { input_tokens: 10, output_tokens: 5 },
            stop_reason: "end_turn",
          };
    app = setup({ userFlag: 1, createMessage });
    await post(app);
    const pts = app.db.prepare("SELECT topic, kind FROM insights_points").all();
    expect(pts).toEqual([{ topic: "x", kind: "learned" }]);
  });

  it("saves and returns the lookups behind a reply, leaving out remember_point", async () => {
    let call = 0;
    const createMessage: CreateMessage = async () =>
      call++ === 0
        ? {
            content: [
              { type: "tool_use", id: "t1", name: "get_training_history", input: { days: 35 } },
              {
                type: "tool_use",
                id: "t2",
                name: "remember_point",
                input: { topic: "x", gist: "y" },
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
            stop_reason: "tool_use",
          }
        : {
            content: [{ type: "text", text: "done" }],
            usage: { input_tokens: 10, output_tokens: 5 },
            stop_reason: "end_turn",
          };
    app = setup({ userFlag: 1, createMessage });
    const res = await post(app);
    expect(res.statusCode).toBe(200);
    expect(res.json().lookups).toEqual(["get_training_history(days=35)"]);
    const today = currentUserDate(new Date(), "America/New_York");
    const turns = listTurnsForDay(app.db, 1, today);
    expect(turns[0]?.lookups).toBeUndefined();
    expect(turns[1]?.lookups).toEqual(["get_training_history(days=35)"]);
    expect(turns[1]?.content).toBe("done");
  });

  it("returns an empty lookups array when the reply used no tools", async () => {
    app = setup({ userFlag: 1 });
    const res = await post(app);
    expect(res.json().lookups).toEqual([]);
  });

  it("a reloaded overview-only reply keeps lookups: [] from the history endpoint", async () => {
    app = setup({ userFlag: 1 });
    await post(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/llm/insights-chat/history",
      headers: auth,
    });
    const turns = res.json().turns as Array<{ role: string; lookups?: string[] }>;
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect("lookups" in defined(turns[0], "user turn")).toBe(false);
    expect(turns[1]?.lookups).toEqual([]);
  });

  it("tells the model which lookups were behind each earlier reply", async () => {
    const createMessage = vi.fn(answerStub);
    app = setup({ userFlag: 1, createMessage, insightsModel: "claude-sonnet-5-5" });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/insights-chat",
      headers: auth,
      payload: {
        message: "really?",
        history: [
          { role: "user", content: "q1" },
          { role: "assistant", content: "a1", lookups: ["get_report", "get_tdee"] },
          { role: "user", content: "q2" },
          { role: "assistant", content: "a2", lookups: [] },
          { role: "user", content: "q3" },
          { role: "assistant", content: "a3" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const msgs = defined(createMessage.mock.calls[0]?.[0], "call").messages;
    expect(msgs).toEqual([
      { role: "user", content: "q1" },
      { role: "system", content: "Lookups behind the next reply: get_report; get_tdee" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "system", content: "The next reply used only the overview; no lookups." },
      { role: "assistant", content: "a2" },
      { role: "user", content: "q3" },
      { role: "assistant", content: "a3" },
      { role: "user", content: "really?" },
    ]);
    const today = currentUserDate(new Date(), "America/New_York");
    const stored = listTurnsForDay(app.db, 1, today).map((t) => t.content);
    expect(stored).toEqual(["really?", "you're on track"]);
  });

  it("falls back to the canned text when the reply is only a lookups line", async () => {
    const createMessage = vi.fn<CreateMessage>(async () => ({
      content: [{ type: "text", text: "[Lookups: x, y]" }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "end_turn",
    }));
    app = setup({ userFlag: 1, createMessage, insightsModel: "claude-sonnet-5-5" });
    const res = await post(app);
    expect(res.json().text).toBe("I couldn't generate an analysis just now.");
  });

  it("strips a model-written lookups line from the reply it stores and returns", async () => {
    const createMessage = vi.fn<CreateMessage>(async () => ({
      content: [{ type: "text", text: "you're on track\n\n[Lookups: x, y]" }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "end_turn",
    }));
    app = setup({ userFlag: 1, createMessage, insightsModel: "claude-sonnet-5-5" });
    const res = await post(app);
    expect(res.json().text).toBe("you're on track");
    const today = currentUserDate(new Date(), "America/New_York");
    const stored = listTurnsForDay(app.db, 1, today).map((t) => t.content);
    expect(stored).toEqual(["hi", "you're on track"]);
  });

  it("replays an earlier reply without its trailing lookups line", async () => {
    const createMessage = vi.fn(answerStub);
    app = setup({ userFlag: 1, createMessage, insightsModel: "claude-sonnet-5-5" });
    await app.inject({
      method: "POST",
      url: "/api/v1/llm/insights-chat",
      headers: auth,
      payload: {
        message: "more",
        history: [
          { role: "user", content: "q1" },
          { role: "assistant", content: "a1\n\n[Lookups: training history (35 days)]" },
        ],
      },
    });
    const msgs = defined(createMessage.mock.calls[0]?.[0], "call").messages;
    expect(msgs.map((m) => m.content)).toEqual(["q1", "a1", "more"]);
  });

  it("keeps the answer written before remember_point when the final response is empty", async () => {
    let call = 0;
    const createMessage = vi.fn<CreateMessage>(async () =>
      call++ === 0
        ? {
            content: [
              { type: "text", text: "full answer" },
              {
                type: "tool_use",
                id: "t1",
                name: "remember_point",
                input: { topic: "x", gist: "y" },
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
            stop_reason: "tool_use",
          }
        : { content: [], usage: { input_tokens: 10, output_tokens: 0 }, stop_reason: "end_turn" },
    );
    app = setup({ userFlag: 1, createMessage });
    const res = await post(app);
    expect(res.json().text).toBe("full answer");
    expect(defined(createMessage.mock.calls[0]?.[0], "call").tool_choice).toEqual({
      type: "auto",
    });
    const n = (app.db.prepare("SELECT COUNT(*) AS n FROM insights_points").get() as { n: number })
      .n;
    expect(n).toBe(1);
  });

  it("writes no points when the model call fails", async () => {
    let call = 0;
    app = setup({
      userFlag: 1,
      createMessage: async () => {
        if (call++ > 0) throw new Error("boom");
        return {
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "remember_point",
              input: { topic: "x", gist: "y" },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: "tool_use",
        };
      },
    });
    const res = await post(app);
    expect(res.statusCode).toBe(500);
    expect(call).toBe(2);
    expect(
      (app.db.prepare("SELECT COUNT(*) AS n FROM insights_points").get() as { n: number }).n,
    ).toBe(0);
    expect(
      (app.db.prepare("SELECT COUNT(*) AS n FROM insights_chat_turns").get() as { n: number }).n,
    ).toBe(0);
  });

  it("PATCH helpful toggles the caller's assistant turn", async () => {
    app = setup({ userFlag: 1 });
    const res = await post(app);
    const id = res.json().assistant_turn_id as number;
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/llm/insights-chat/turns/${id}`,
      headers: auth,
      payload: { helpful: true },
    });
    expect(patch.statusCode).toBe(204);
    const hist = await app.inject({
      method: "GET",
      url: "/api/v1/llm/insights-chat/history",
      headers: auth,
    });
    expect(hist.json().turns[1].helpful).toBe(true);
  });

  describe("helpful tap writes notes", () => {
    const noteResponse = {
      content: [
        {
          type: "tool_use",
          id: "n1",
          name: "save_notes",
          input: { notes: [{ topic: "tdee-up", gist: "TDEE rose to 2727" }] },
        },
      ],
      usage: { input_tokens: 300, output_tokens: 30 },
      stop_reason: "tool_use",
    };
    // Chat calls answer in text; the forced save_notes call returns notes.
    const stub = () =>
      vi.fn<CreateMessage>(async (args) =>
        args.tool_choice?.type === "tool" ? noteResponse : await answerStub(args),
      );
    const noteCalls = (cm: ReturnType<typeof stub>) =>
      cm.mock.calls.filter(([a]) => a.tool_choice?.type === "tool");
    const tap = (a: FastifyInstance, id: number, helpful: boolean) =>
      a.inject({
        method: "PATCH",
        url: `/api/v1/llm/insights-chat/turns/${id}`,
        headers: auth,
        payload: { helpful },
      });
    const pointRows = (a: FastifyInstance) =>
      a.db.prepare("SELECT topic, on_date, helpful, turn_id FROM insights_points").all();
    const usageRows = (a: FastifyInstance) =>
      a.db
        .prepare("SELECT model, billed_tokens FROM llm_usage WHERE feature = 'insights_chat'")
        .all() as Array<{ model: string; billed_tokens: number }>;

    it("tapping a reply with no notes makes one forced call and stores a helpful note", async () => {
      const createMessage = stub();
      app = setup({ userFlag: 1, createMessage });
      const id = (await post(app)).json().assistant_turn_id as number;
      const usageBefore = usageRows(app).length;
      expect((await tap(app, id, true)).statusCode).toBe(204);
      const calls = noteCalls(createMessage);
      expect(calls).toHaveLength(1);
      const args = defined(calls[0]?.[0], "call");
      expect(args.model).toBe("claude-haiku-4-5");
      expect(args.tool_choice).toEqual({ type: "tool", name: "save_notes" });
      expect(args.thinking).toBeUndefined();
      const turnDate = (
        app.db.prepare("SELECT on_date FROM insights_chat_turns WHERE id = ?").get(id) as {
          on_date: string;
        }
      ).on_date;
      expect(pointRows(app)).toEqual([
        { topic: "tdee-up", on_date: turnDate, helpful: 1, turn_id: id },
      ]);
      const usage = usageRows(app);
      expect(usage).toHaveLength(usageBefore + 1);
      expect(usage[usage.length - 1]).toEqual({ model: "claude-haiku-4-5", billed_tokens: 330 });
    });

    it("tapping a reply that already has notes makes no call and flags them", async () => {
      const createMessage = stub();
      app = setup({ userFlag: 1, createMessage });
      const id = (await post(app)).json().assistant_turn_id as number;
      insertPoints(
        app.db,
        1,
        id,
        "2026-10-01",
        [{ topic: "have", gist: "g" }],
        new Date().toISOString(),
      );
      expect((await tap(app, id, true)).statusCode).toBe(204);
      expect(noteCalls(createMessage)).toHaveLength(0);
      expect(pointRows(app)).toMatchObject([{ topic: "have", helpful: 1 }]);
    });

    it("untap makes no call and clears the notes' flag", async () => {
      const createMessage = stub();
      app = setup({ userFlag: 1, createMessage });
      const id = (await post(app)).json().assistant_turn_id as number;
      await tap(app, id, true);
      expect(noteCalls(createMessage)).toHaveLength(1);
      expect((await tap(app, id, false)).statusCode).toBe(204);
      expect(noteCalls(createMessage)).toHaveLength(1);
      expect(pointRows(app)).toMatchObject([{ helpful: 0 }]);
    });

    it("untapping a reply with no notes makes no model call", async () => {
      const createMessage = stub();
      app = setup({ userFlag: 1, createMessage });
      const id = (await post(app)).json().assistant_turn_id as number;
      expect((await tap(app, id, false)).statusCode).toBe(204);
      expect(noteCalls(createMessage)).toHaveLength(0);
      expect(pointRows(app)).toEqual([]);
    });

    it("a failing note call still returns 204 with the flag saved and no notes", async () => {
      const createMessage = vi.fn<CreateMessage>(async (args) => {
        if (args.tool_choice?.type === "tool") throw new Error("boom");
        return await answerStub(args);
      });
      app = setup({ userFlag: 1, createMessage });
      const id = (await post(app)).json().assistant_turn_id as number;
      expect((await tap(app, id, true)).statusCode).toBe(204);
      expect(pointRows(app)).toEqual([]);
      const hist = await app.inject({
        method: "GET",
        url: "/api/v1/llm/insights-chat/history",
        headers: auth,
      });
      expect(hist.json().turns[1].helpful).toBe(true);
    });

    it("skips the note call when the hard cap is reached", async () => {
      const createMessage = stub();
      app = setup({ userFlag: 1, createMessage, hardDailyTokenCap: 1000 });
      const id = (await post(app)).json().assistant_turn_id as number;
      // The chat itself billed 1040 tokens, which is over the 1000 cap.
      expect((await tap(app, id, true)).statusCode).toBe(204);
      expect(noteCalls(createMessage)).toHaveLength(0);
      expect(pointRows(app)).toEqual([]);
    });
  });

  it("PATCH helpful 404s for an unknown turn and 422s for a user turn", async () => {
    app = setup({ userFlag: 1 });
    const res = await post(app);
    const id = res.json().assistant_turn_id as number;
    const patch = (turn: number) =>
      app?.inject({
        method: "PATCH",
        url: `/api/v1/llm/insights-chat/turns/${turn}`,
        headers: auth,
        payload: { helpful: true },
      });
    expect((await patch(99999))?.statusCode).toBe(404);
    expect((await patch(id - 1))?.statusCode).toBe(422);
  });

  it("PATCH helpful 404s for another user's assistant turn", async () => {
    app = setup({ userFlag: 1 });
    app.db
      .prepare(
        `INSERT INTO users (name, dob, height_cm, sex, email, timezone, preferred_unit_system, llm_logging_enabled)
         VALUES ('Other','1990-01-01',170,'female','other@example.com','America/New_York','metric', 1)`,
      )
      .run();
    const otherId = (
      app.db.prepare("SELECT id FROM users WHERE email = 'other@example.com'").get() as {
        id: number;
      }
    ).id;
    const [, theirs] = appendTurns(
      app.db,
      otherId,
      "2026-09-30",
      [
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
      ],
      new Date().toISOString(),
    );
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/llm/insights-chat/turns/${defined(theirs, "turn id")}`,
      headers: auth,
      payload: { helpful: true },
    });
    expect(patch.statusCode).toBe(404);
    const row = app.db
      .prepare("SELECT helpful FROM insights_chat_turns WHERE id = ?")
      .get(defined(theirs, "turn id")) as { helpful: number | null };
    expect(row.helpful).not.toBe(1);
  });

  it("feeds recent points into the volatile system block", async () => {
    const createMessage = vi.fn(answerStub);
    app = setup({ userFlag: 1, createMessage });
    const now = new Date().toISOString();
    const [, t] = appendTurns(
      app.db,
      1,
      "2026-09-30",
      [
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
      ],
      now,
    );
    insertPoints(app.db, 1, t ?? -1, "2026-09-30", [{ topic: "seen-topic", gist: "g" }], now);
    await post(app);
    const system = defined(createMessage.mock.calls[0]?.[0], "call").system as Array<{
      text: string;
    }>;
    expect(system[1]?.text).toContain("seen-topic");
  });

  it("threads user.about_me into the insights system prompt (fenced, in the cached stable block)", async () => {
    const createMessage = vi.fn(answerStub);
    const aboutMe = "I'm training for a marathon and prefer vegetarian meals.";
    app = setup({ userFlag: 1, createMessage, aboutMe });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/insights-chat",
      headers: auth,
      payload: { message: "how am I doing?", history: [] },
    });
    expect(res.statusCode).toBe(200);
    const sentSystem = createMessage.mock.calls[0]?.[0].system as Array<{ text: string }>;
    // The about-me fence belongs in the cached stable block (system[0]).
    const stable = sentSystem[0]?.text ?? "";
    expect(stable).toContain("BEGIN USER ABOUT-ME");
    expect(stable).toContain(aboutMe);
  });

  it("returns a plain-text answer when enabled", async () => {
    app = setup({ userFlag: 1 });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/insights-chat",
      headers: auth,
      payload: { message: "how am I doing?", history: [] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe("answer");
    expect(typeof body.text).toBe("string");
  });

  it("sends the overview as an uncached volatile system block (cache split)", async () => {
    const createMessage = vi.fn(answerStub);
    app = setup({ userFlag: 1, createMessage });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/insights-chat",
      headers: auth,
      payload: { message: "how am I doing?", history: [] },
    });
    expect(res.statusCode).toBe(200);
    const sentSystem = createMessage.mock.calls[0]?.[0].system as Array<{
      text: string;
      cache_control?: unknown;
    }>;
    expect(sentSystem).toHaveLength(2);
    expect(sentSystem[0]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(sentSystem[1]?.cache_control).toBeUndefined();
    expect(sentSystem[1]?.text).toContain("CURRENT OVERVIEW");
  });

  it("403s when the per-user flag is off", async () => {
    app = setup({ userFlag: 0 });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/insights-chat",
      headers: auth,
      payload: { message: "how am I doing?", history: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("records an insights_chat usage row with positive billed tokens", async () => {
    app = setup({ userFlag: 1 });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/insights-chat",
      headers: auth,
      payload: { message: "how am I doing?", history: [] },
    });
    expect(res.statusCode).toBe(200);
    const row = app.db
      .prepare("SELECT feature, billed_tokens FROM llm_usage WHERE user_id = 1")
      .get() as { feature: string; billed_tokens: number };
    expect(row.feature).toBe("insights_chat");
    expect(row.billed_tokens).toBeGreaterThan(0);
  });

  it("persists the user+assistant turns to today when no on_date is given", async () => {
    app = setup({ userFlag: 1 });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/insights-chat",
      headers: auth,
      payload: { message: "how am I doing?", history: [] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe("answer");
    expect(body.text).toBe("you're on track");

    const today = currentUserDate(new Date(), "America/New_York");
    const turns = listTurnsForDay(app.db, 1, today);
    expect(turns).toMatchObject([
      { role: "user", content: "how am I doing?" },
      { role: "assistant", content: "you're on track" },
    ]);
  });

  it("persists the turns to a given past on_date, not today", async () => {
    app = setup({ userFlag: 1 });
    const onDate = "2026-01-15";
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/insights-chat",
      headers: auth,
      payload: { message: "how was that day?", history: [], on_date: onDate },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe("answer");

    const past = listTurnsForDay(app.db, 1, onDate);
    expect(past).toMatchObject([
      { role: "user", content: "how was that day?" },
      { role: "assistant", content: "you're on track" },
    ]);

    const today = currentUserDate(new Date(), "America/New_York");
    expect(listTurnsForDay(app.db, 1, today)).toEqual([]);
  });

  it("429s and never calls the model when over the hard cap", async () => {
    const createMessage = vi.fn(answerStub);
    app = setup({ userFlag: 1, createMessage, hardDailyTokenCap: 1000 });
    // 600 + 500 = 1100 billed >= 1000 cap.
    recordLlmUsage(app.db, {
      userId: 1,
      createdAt: new Date().toISOString(),
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "insights_chat",
      usage: {
        input_tokens: 600,
        output_tokens: 500,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 0,
      billedTokens: 1100,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/insights-chat",
      headers: auth,
      payload: { message: "how am I doing?", history: [] },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("usage_limit_exceeded");
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("429s on the per-user hard cap here too, not just on meal chat", async () => {
    // The two 429 sites share effectiveHardCap; this pins the insights one so a
    // future edit can't quietly leave it reading the env cap alone.
    const createMessage = vi.fn(answerStub);
    app = setup({ userFlag: 1, createMessage, hardDailyTokenCap: undefined });
    updateUser(app.db, 1, { llm_daily_hard_cap: 1000 });
    recordLlmUsage(app.db, {
      userId: 1,
      createdAt: new Date().toISOString(),
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "insights_chat",
      usage: {
        input_tokens: 600,
        output_tokens: 500,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 0,
      billedTokens: 1100,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/insights-chat",
      headers: auth,
      payload: { message: "how am I doing?", history: [] },
    });

    expect(res.statusCode).toBe(429);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("GET /history returns today's turns for the user when no date is given", async () => {
    app = setup({ userFlag: 1 });
    const today = currentUserDate(new Date(), "America/New_York");
    appendTurns(
      app.db,
      1,
      today,
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      new Date().toISOString(),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/llm/insights-chat/history",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      on_date: today,
      turns: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });
  });

  it("GET /history?date= returns that past day's turns", async () => {
    app = setup({ userFlag: 1 });
    const onDate = "2026-01-15";
    appendTurns(app.db, 1, onDate, [{ role: "user", content: "old" }], new Date().toISOString());

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/llm/insights-chat/history?date=${onDate}`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      on_date: onDate,
      turns: [{ role: "user", content: "old" }],
    });
  });

  it("GET /history returns empty turns for a fresh day", async () => {
    app = setup({ userFlag: 1 });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/llm/insights-chat/history?date=2026-02-02",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ on_date: "2026-02-02", turns: [] });
  });

  it("GET /history 403s when the per-user flag is off", async () => {
    app = setup({ userFlag: 0 });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/llm/insights-chat/history",
      headers: auth,
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /history rejects an invalid date via the querystring schema", async () => {
    // The repo's zod validator-compiler surfaces validation failures as 422.
    app = setup({ userFlag: 1 });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/llm/insights-chat/history?date=foo",
      headers: auth,
    });
    expect(res.statusCode).toBe(422);
  });

  it("GET /days returns the user's conversation dates newest-first", async () => {
    app = setup({ userFlag: 1 });
    appendTurns(
      app.db,
      1,
      "2026-06-20",
      [{ role: "user", content: "a" }],
      new Date().toISOString(),
    );
    appendTurns(
      app.db,
      1,
      "2026-06-22",
      [{ role: "user", content: "b" }],
      new Date().toISOString(),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/llm/insights-chat/days",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ days: ["2026-06-22", "2026-06-20"] });
  });

  it("GET /days excludes another user's conversation days", async () => {
    app = setup({ userFlag: 1 });
    // A second user with their own conversation days.
    app.db
      .prepare(
        `INSERT INTO users (name, dob, height_cm, sex, email, timezone, preferred_unit_system, llm_logging_enabled)
         VALUES ('Other','1990-01-01',180,'male','other@example.com','America/New_York','metric', 1)`,
      )
      .run();
    appendTurns(
      app.db,
      1,
      "2026-06-22",
      [{ role: "user", content: "mine" }],
      new Date().toISOString(),
    );
    appendTurns(
      app.db,
      2,
      "2026-06-21",
      [{ role: "user", content: "theirs" }],
      new Date().toISOString(),
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/llm/insights-chat/days",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ days: ["2026-06-22"] });
  });

  it("DELETE /history clears that day's turns and 204s", async () => {
    app = setup({ userFlag: 1 });
    const onDate = "2026-06-22";
    appendTurns(app.db, 1, onDate, [{ role: "user", content: "x" }], new Date().toISOString());

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/llm/insights-chat/history?date=${onDate}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);

    expect(listTurnsForDay(app.db, 1, onDate)).toEqual([]);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/llm/insights-chat/history?date=${onDate}`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ on_date: onDate, turns: [] });
  });

  it("runs the insights coach on the insights model (sonnet), not the meal model", async () => {
    const cm = vi.fn(answerStub);
    app = setup({ userFlag: 1, createMessage: cm });
    await app.inject({
      method: "POST",
      url: "/api/v1/llm/insights-chat",
      headers: { "x-forwarded-email": "test@example.com", "content-type": "application/json" },
      payload: { message: "how am I doing?" },
    });
    expect(cm.mock.calls[0]?.[0].model).toBe("claude-sonnet-4-6");
  });
});

describe("/api/v1/llm/meal-chat web search", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });
  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };

  // A stub that "searched once" then proposes in the same response.
  const searchStub: CreateMessage = async () => ({
    content: [
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
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
    usage: { input_tokens: 5500, output_tokens: 500, server_tool_use: { web_search_requests: 1 } },
    stop_reason: "tool_use",
  });

  function setup(opts: {
    hardDailySearchCap?: number;
    tokensPerSearch?: number;
    createMessage: CreateMessage;
  }) {
    const a = buildApp({
      dbPath: ":memory:",
      trustProxyHeaders: true,
      llm: {
        config: {
          enabled: true,
          provider: "anthropic",
          model: "claude-haiku-4-5",
          insightsModel: "claude-sonnet-4-6",
          insightsEffort: "medium",
          apiKey: "sk-test",
          defaultDailyTokenLimit: undefined,
          hardDailyTokenCap: undefined,
          tokensPerSearch: opts.tokensPerSearch ?? 2500,
          hardDailySearchCap: opts.hardDailySearchCap,
        },
        createMessage: opts.createMessage,
      },
    });
    a.db
      .prepare(
        `INSERT INTO users (name, dob, height_cm, sex, email, timezone, preferred_unit_system, llm_logging_enabled)
         VALUES ('Jeff','1990-01-01',180,'male','test@example.com','America/New_York','metric', 1)`,
      )
      .run();
    return a;
  }

  it("bills the flat per-search price (not real tokens) and records the real tokens", async () => {
    app = setup({ createMessage: searchStub, tokensPerSearch: 2500 });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/meal-chat",
      headers: auth,
      payload: { message: "a poke bowl from X", history: [] },
    });
    expect(res.statusCode).toBe(200);
    const row = app.db
      .prepare(
        "SELECT input_tokens, output_tokens, web_search_requests, billed_tokens FROM llm_usage WHERE user_id = 1",
      )
      .get() as {
      input_tokens: number;
      output_tokens: number;
      web_search_requests: number;
      billed_tokens: number;
    };
    expect(row.input_tokens).toBe(5500); // real, logged
    expect(row.output_tokens).toBe(500);
    expect(row.web_search_requests).toBe(1);
    expect(row.billed_tokens).toBe(2500); // flat × 1 search (default, no history yet)
  });

  it("meal-chat response carries web-search sources", async () => {
    // A stub that returns a populated web_search_tool_result, then proposes.
    const sourcedStub: CreateMessage = async () => ({
      content: [
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "a" } },
        {
          type: "web_search_tool_result",
          tool_use_id: "s1",
          content: [
            { type: "web_search_result", url: "https://example.com/a", title: "A", page_age: null },
          ],
        },
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
      usage: {
        input_tokens: 5500,
        output_tokens: 500,
        server_tool_use: { web_search_requests: 1 },
      },
      stop_reason: "tool_use",
    });
    app = setup({ createMessage: sourcedStub });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/meal-chat",
      headers: auth,
      payload: { message: "a poke bowl from X", history: [] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.usage.sources).toEqual([
      { url: "https://example.com/a", title: "A", domain: "example.com" },
    ]);
  });

  it("disables search (no searchNote on a normal turn) but sets searchNote at the cap", async () => {
    // Cap of 1: pre-seed one search so remaining = 0 → max_uses 0 → searchNote set.
    app = setup({ createMessage: searchStub, hardDailySearchCap: 1 });
    recordLlmUsage(app.db, {
      userId: 1,
      createdAt: new Date().toISOString(),
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "meal_chat",
      usage: {
        input_tokens: 100,
        output_tokens: 10,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 1,
      billedTokens: 2500,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/meal-chat",
      headers: auth,
      payload: { message: "another bowl", history: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().searchNote).toMatch(/web search limit/i);
  });
});
