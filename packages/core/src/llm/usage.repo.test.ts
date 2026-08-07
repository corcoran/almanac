import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Connection } from "../db/connection.js";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import {
  getSearchesForDay,
  getUsageForDay,
  perSearchPrice,
  recentAvgTokensPerCall,
  recordLlmUsage,
} from "./usage.repo.js";

describe("usage.repo", () => {
  let db: Connection;
  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    db.prepare(
      "INSERT INTO users (name, dob, height_cm, sex, email) VALUES ('Jeff','1990-01-01',180,'male','t@e.com')",
    ).run();
  });
  afterEach(() => db.close());

  it("records a row with frozen cost and the four token buckets", () => {
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-22T15:00:00.000Z",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "meal_chat",
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_tokens: 500,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 0,
      billedTokens: 1200,
    });
    const row = db.prepare("SELECT * FROM llm_usage WHERE user_id = 1").get() as {
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cost_usd: number;
    };
    expect(row.input_tokens).toBe(1000);
    expect(row.output_tokens).toBe(200);
    expect(row.cache_read_tokens).toBe(500);
    expect(row.cost_usd).toBeGreaterThan(0);
  });

  it("sums tokens for a user-local day, honoring the 4am rollover and tz", () => {
    // America/New_York (UTC-4 in June). 2026-06-22 21:00 EDT == 2026-06-23T01:00Z.
    // That instant is still the LOCAL day 2026-06-22 (before the 4am rollover),
    // even though its UTC date is the 23rd. UTC bucketing would mis-attribute it.
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-23T01:00:00.000Z", // 9pm EDT on the 22nd
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "meal_chat",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 0,
      billedTokens: 150,
    });
    const total = getUsageForDay(db, 1, "America/New_York", "2026-06-22");
    expect(total.input_tokens).toBe(100);
    expect(total.output_tokens).toBe(50);
    expect(total.calls).toBe(1);

    // The next local day should see zero of it.
    const next = getUsageForDay(db, 1, "America/New_York", "2026-06-23");
    expect(next.input_tokens).toBe(0);
    expect(next.calls).toBe(0);
  });

  it("recentAvgTokensPerCall averages input+output over recent meal_chat rows", () => {
    for (const [i, o] of [
      [1000, 200],
      [1500, 300],
      [2000, 400],
    ] as const) {
      recordLlmUsage(db, {
        userId: 1,
        createdAt: "2026-06-22T12:00:00.000Z",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        feature: "meal_chat",
        usage: {
          input_tokens: i,
          output_tokens: o,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
        },
        webSearchRequests: 0,
        billedTokens: i + o,
      });
    }
    expect(recentAvgTokensPerCall(db, 1)).toBe(1800);
  });

  it("recentAvgTokensPerCall returns null when the user has no history", () => {
    expect(recentAvgTokensPerCall(db, 99)).toBeNull();
  });

  it("records billed_tokens = input+output for a no-search call", () => {
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-22T15:00:00.000Z",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "meal_chat",
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 0,
      billedTokens: 1200,
    });
    const row = db
      .prepare("SELECT billed_tokens, web_search_requests FROM llm_usage WHERE user_id = 1")
      .get() as {
      billed_tokens: number;
      web_search_requests: number;
    };
    expect(row.billed_tokens).toBe(1200);
    expect(row.web_search_requests).toBe(0);
  });

  it("getUsageForDay sums billed_tokens and search count over the user-local day", () => {
    // Real tokens 6000, but billed only 2500 (a flat-priced search call).
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-23T01:00:00.000Z", // 9pm EDT on the 22nd
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "meal_chat",
      usage: {
        input_tokens: 5500,
        output_tokens: 500,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 1,
      billedTokens: 2500,
    });
    const day = getUsageForDay(db, 1, "America/New_York", "2026-06-22");
    expect(day.input_tokens).toBe(5500); // real, unchanged
    expect(day.billed_tokens).toBe(2500); // billed
    expect(getSearchesForDay(db, 1, "America/New_York", "2026-06-22")).toBe(1);
    expect(getSearchesForDay(db, 1, "America/New_York", "2026-06-23")).toBe(0);
  });

  it("perSearchPrice falls back to the config flat rate when there is no non-search history", () => {
    expect(perSearchPrice(db, 1, 2500)).toBe(2500);
    expect(perSearchPrice(db, 1, 4000)).toBe(4000);
  });

  it("perSearchPrice = recent NON-SEARCH average chat cost (a search bills like one ordinary turn)", () => {
    // Two ordinary chats: 600 and 700 tokens → average 650.
    for (const [i, o] of [
      [550, 50],
      [640, 60],
    ] as const) {
      recordLlmUsage(db, {
        userId: 1,
        createdAt: "2026-06-22T12:00:00.000Z",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        feature: "meal_chat",
        usage: {
          input_tokens: i,
          output_tokens: o,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
        },
        webSearchRequests: 0,
        billedTokens: i + o,
      });
    }
    // A search bills the non-search average (650), NOT the fallback.
    expect(perSearchPrice(db, 1, 2500)).toBe(650);
  });

  it("perSearchPrice never compounds — search rows with huge input_tokens do not raise it", () => {
    // The charge derives ONLY from non-search rows. Averaging over SEARCH calls
    // would compound without bound — a search's input_tokens carries web-result
    // bloat, so each search would inflate the next one's price.
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-22T12:00:00.000Z",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "meal_chat",
      usage: {
        input_tokens: 600,
        output_tokens: 50,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 0,
      billedTokens: 650,
    });
    // Record several search calls with huge, varied input_tokens. The price must
    // stay pinned to the non-search average.
    for (const inputTokens of [11274, 7608, 20860]) {
      recordLlmUsage(db, {
        userId: 1,
        createdAt: "2026-06-22T12:01:00.000Z",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        feature: "meal_chat",
        usage: {
          input_tokens: inputTokens,
          output_tokens: 300,
          cache_read_tokens: 12816,
          cache_creation_tokens: 6956,
        },
        webSearchRequests: 1,
        billedTokens: 650,
      });
    }
    expect(perSearchPrice(db, 1, 2500)).toBe(650); // unmoved by the search rows
  });

  it("recentAvgTokensPerCall excludes search calls (one search must not poison the logs-left estimate)", () => {
    // Two ordinary chats (~500 tokens each) → estimate ~500.
    for (const [i, o] of [
      [450, 50],
      [500, 50],
    ] as const) {
      recordLlmUsage(db, {
        userId: 1,
        createdAt: "2026-06-22T12:00:00.000Z",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        feature: "meal_chat",
        usage: {
          input_tokens: i,
          output_tokens: o,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
        },
        webSearchRequests: 0,
        billedTokens: i + o,
      });
    }
    // A single search call with 11k input_tokens (web-result bloat). Its raw
    // tokens must be ignored by the conversation-cost estimate (it's billed the
    // non-search average, not these tokens).
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-22T12:05:00.000Z",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "meal_chat",
      usage: {
        input_tokens: 11274,
        output_tokens: 256,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 1,
      billedTokens: 2500,
    });
    // Average over the two non-search chats only: (500 + 550) / 2 = 525.
    expect(recentAvgTokensPerCall(db, 1)).toBe(525);
  });

  it("recentAvgTokensPerCall returns null when the only history is search calls", () => {
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-22T12:00:00.000Z",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "meal_chat",
      usage: {
        input_tokens: 11274,
        output_tokens: 256,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 1,
      billedTokens: 2500,
    });
    expect(recentAvgTokensPerCall(db, 1)).toBeNull();
  });

  it("recentAvgTokensPerCall includes insights_chat turns (both AI surfaces share the estimate)", () => {
    // A meal-chat turn (600) and an insights turn (800) → average 700.
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-22T12:00:00.000Z",
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
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-22T12:05:00.000Z",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "insights_chat",
      usage: {
        input_tokens: 750,
        output_tokens: 50,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 0,
      billedTokens: 800,
    });
    expect(recentAvgTokensPerCall(db, 1)).toBe(700);
  });

  it("recentAvgTokensPerCall scopes to meal_chat when feature is given", () => {
    // meal: 600, insights: 5200 → meal-only average is 600
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-22T12:00:00.000Z",
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
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-22T12:05:00.000Z",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "insights_chat",
      usage: {
        input_tokens: 5000,
        output_tokens: 200,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 0,
      billedTokens: 5200,
    });
    expect(recentAvgTokensPerCall(db, 1, { feature: "meal_chat" })).toBe(600);
    expect(recentAvgTokensPerCall(db, 1, { feature: "insights_chat" })).toBe(5200);
  });

  it("recentAvgTokensPerCall returns null for a feature with no rows", () => {
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-22T12:00:00.000Z",
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
    expect(recentAvgTokensPerCall(db, 1, { feature: "insights_chat" })).toBeNull();
  });

  it("recentAvgTokensPerCall still excludes search rows when feature-scoped", () => {
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-22T12:00:00.000Z",
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
    // A meal_chat SEARCH row with bloat — must be excluded from the meal average.
    recordLlmUsage(db, {
      userId: 1,
      createdAt: "2026-06-22T12:05:00.000Z",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      feature: "meal_chat",
      usage: {
        input_tokens: 11000,
        output_tokens: 300,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      },
      webSearchRequests: 1,
      billedTokens: 600,
    });
    expect(recentAvgTokensPerCall(db, 1, { feature: "meal_chat" })).toBe(600);
  });
});
