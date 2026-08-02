import { describe, expect, it } from "vitest";
import {
  ChatTurnSchema,
  InsightsChatRequestSchema,
  InsightsChatResponseSchema,
  InsightsDaysResponseSchema,
  InsightsHistoryResponseSchema,
  MealChatRequestSchema,
  MealChatResponseSchema,
  ProposedAlcoholSchema,
  ProposedMealSchema,
  UsageSummarySchema,
  WebSourceSchema,
} from "./llm.js";

describe("ProposedMealSchema", () => {
  it("accepts a stored-meal match with a stored_meal_id", () => {
    const r = ProposedMealSchema.safeParse({
      source: "stored",
      stored_meal_id: 7,
      name: "chicken burrito",
      confidence: 0.9,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a stored-meal match missing stored_meal_id", () => {
    const r = ProposedMealSchema.safeParse({
      source: "stored",
      name: "chicken burrito",
      confidence: 0.9,
    });
    expect(r.success).toBe(false);
  });

  it("preserves eaten_at on a stored proposed meal", () => {
    const parsed = ProposedMealSchema.parse({
      source: "stored",
      stored_meal_id: 3,
      name: "Big Mac",
      eaten_at: "2026-06-22T12:30:00",
    });
    expect(parsed.source).toBe("stored");
    if (parsed.source === "stored") {
      expect(parsed.eaten_at).toBe("2026-06-22T12:30:00");
    }
  });

  it("still accepts a stored proposed meal without eaten_at (optional)", () => {
    const parsed = ProposedMealSchema.parse({
      source: "stored",
      stored_meal_id: 3,
      name: "Big Mac",
    });
    expect(parsed.source).toBe("stored");
    if (parsed.source === "stored") {
      expect(parsed.eaten_at).toBeUndefined();
    }
  });

  it("accepts an estimated meal with macros and suggest_store", () => {
    const r = ProposedMealSchema.safeParse({
      source: "estimated",
      name: "beer",
      kcal: 150,
      protein_g: 1,
      carb_g: 13,
      fat_g: 0,
      eaten_at: "2026-06-22T18:30:00",
      confidence: 0.6,
      suggest_store: true,
    });
    expect(r.success).toBe(true);
  });

  it("accepts an estimated meal WITHOUT eaten_at/confidence (model needn't fabricate them)", () => {
    // Regression: the live model omits eaten_at + confidence. These are optional;
    // suggest_store defaults to false. The meal must still parse.
    const r = ProposedMealSchema.safeParse({
      source: "estimated",
      name: "2 scrambled eggs and toast",
      kcal: 310,
      protein_g: 18,
      carb_g: 25,
      fat_g: 14,
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.source === "estimated") {
      expect(r.data.suggest_store).toBe(false); // applied default
    }
  });

  it("rejects the model's WRONG shape (energy/macros{}/description) — drives the tool schema", () => {
    // This is exactly what the model emitted when the tool input_schema was an
    // untyped object. It must NOT silently coerce — the fix is the tool schema,
    // which steers the model to the correct field names.
    const r = ProposedMealSchema.safeParse({
      source: "estimated",
      description: "2 scrambled eggs and toast",
      energy: 310,
      macros: { protein: 18, carbs: 25, fat: 14 },
      suggest_store: true,
    });
    expect(r.success).toBe(false);
  });
});

describe("MealChatRequestSchema", () => {
  it("accepts a message with empty history", () => {
    const r = MealChatRequestSchema.safeParse({ message: "I had a beer", history: [] });
    expect(r.success).toBe(true);
  });
});

describe("InsightsChatRequestSchema", () => {
  it("parses { message } and defaults history to []", () => {
    const r = InsightsChatRequestSchema.safeParse({ message: "hi" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.history).toEqual([]);
    }
  });

  it("rejects an empty message", () => {
    const r = InsightsChatRequestSchema.safeParse({ message: "" });
    expect(r.success).toBe(false);
  });

  it("history/days schemas + on_date on request", () => {
    expect(
      InsightsHistoryResponseSchema.safeParse({
        on_date: "2026-06-23",
        turns: [{ role: "user", content: "x" }],
      }).success,
    ).toBe(true);
    expect(InsightsDaysResponseSchema.safeParse({ days: ["2026-06-23"] }).success).toBe(true);
    expect(
      InsightsChatRequestSchema.safeParse({ message: "hi", on_date: "2026-06-22" }).success,
    ).toBe(true);
    expect(InsightsChatRequestSchema.safeParse({ message: "hi", on_date: "nope" }).success).toBe(
      false,
    );
  });
});

describe("web source schemas", () => {
  it("WebSourceSchema validates a source", () => {
    const s = WebSourceSchema.parse({ url: "https://x.com/a", title: "A", domain: "x.com" });
    expect(s.domain).toBe("x.com");
  });

  it("UsageSummarySchema defaults sources to []", () => {
    const u = UsageSummarySchema.parse({
      input_tokens: 1,
      output_tokens: 1,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      cost_usd: 0,
      model: "m",
    });
    expect(u.sources).toEqual([]);
  });

  it("ChatTurnSchema accepts optional sources", () => {
    const t = ChatTurnSchema.parse({
      role: "assistant",
      content: "hi",
      sources: [{ url: "https://x.com/a", title: "A", domain: "x.com" }],
    });
    expect(t.sources?.length).toBe(1);
  });
});

describe("InsightsChatResponseSchema", () => {
  it("accepts an answer turn", () => {
    const ok = InsightsChatResponseSchema.safeParse({
      kind: "answer",
      text: "You're trending down ~0.4kg/wk.",
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        web_search_requests: 0,
        cost_usd: 0,
        model: "claude-haiku-4-5",
      },
    });
    expect(ok.success).toBe(true);
  });
});

describe("ProposedAlcoholSchema", () => {
  it("parses a full alcohol proposal", () => {
    const parsed = ProposedAlcoholSchema.safeParse({
      drinks_count: 2,
      est_kcal: 300,
      started_at: "2026-08-02T19:30:00",
      note: "2 pints IPA",
    });
    expect(parsed.success).toBe(true);
  });

  it("parses without the optional started_at / note", () => {
    const parsed = ProposedAlcoholSchema.safeParse({ drinks_count: 1.5, est_kcal: 210 });
    expect(parsed.success).toBe(true);
  });

  it("rejects a non-positive drinks_count", () => {
    expect(ProposedAlcoholSchema.safeParse({ drinks_count: 0, est_kcal: 100 }).success).toBe(false);
  });

  it("rejects a negative est_kcal", () => {
    expect(ProposedAlcoholSchema.safeParse({ drinks_count: 1, est_kcal: -5 }).success).toBe(false);
  });

  it("MealChatResponseSchema proposal variant carries alcohol_sessions", () => {
    const parsed = MealChatResponseSchema.safeParse({
      kind: "proposal",
      meals: [],
      alcohol_sessions: [{ drinks_count: 2, est_kcal: 300 }],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        cost_usd: 0,
        model: "claude-haiku-4-5",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("defaults alcohol_sessions to [] when the proposal omits it", () => {
    const parsed = MealChatResponseSchema.safeParse({
      kind: "proposal",
      meals: [],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        cost_usd: 0,
        model: "claude-haiku-4-5",
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === "proposal") {
      expect(parsed.data.alcohol_sessions).toEqual([]);
    }
  });
});
