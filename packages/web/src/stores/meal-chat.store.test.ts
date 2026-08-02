import { MealChatResponseSchema } from "@almanac/core/schemas";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  lastEstablishedDate,
  lastEstablishedTime,
  type Turn,
  useMealChatStore,
} from "./meal-chat.store.js";

function fakeClient(responses: unknown[]) {
  const post = vi.fn();
  for (const r of responses) post.mockResolvedValueOnce(MealChatResponseSchema.parse(r));
  return { post } as unknown as import("../api/client.js").ApiClient & { post: typeof post };
}

const proposalResponse = {
  kind: "proposal",
  meals: [
    {
      source: "estimated",
      name: "Chicken burrito",
      kcal: 640,
      protein_g: 35,
      carb_g: 70,
      fat_g: 22,
      suggest_store: false,
    },
    {
      source: "estimated",
      name: "Beer",
      kcal: 150,
      protein_g: 1,
      carb_g: 13,
      fat_g: 0,
      suggest_store: false,
    },
  ],
  usage: {
    input_tokens: 800,
    output_tokens: 120,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    web_search_requests: 0,
    cost_usd: 0.002,
    model: "claude-haiku-4-5",
  },
};

const questionResponse = {
  kind: "question",
  question: "What size burrito — regular or large?",
  usage: {
    input_tokens: 500,
    output_tokens: 30,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    web_search_requests: 0,
    cost_usd: 0.001,
    model: "claude-haiku-4-5",
  },
};

describe("meal-chat store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("send() pushes a user turn then an assistant proposal turn with the meals", async () => {
    const store = useMealChatStore();
    const client = fakeClient([proposalResponse]);

    await store.send(client, "a chicken burrito and a beer");

    expect(store.turns).toHaveLength(2);
    expect(store.turns[0]).toMatchObject({ role: "user", content: "a chicken burrito and a beer" });
    const assistant = store.turns[1];
    expect(assistant?.role).toBe("assistant");
    if (assistant?.role === "assistant" && assistant.kind === "proposal") {
      expect(assistant.meals).toHaveLength(2);
      expect(assistant.content).toContain("Chicken burrito");
      expect(assistant.content).toContain("640");
    }
    expect(store.pending).toBe(false);
  });

  it("sends prior turns as history (oldest first), excluding the newest message", async () => {
    const store = useMealChatStore();
    const client = fakeClient([questionResponse, proposalResponse]);

    await store.send(client, "I had a burrito"); // -> question
    await store.send(client, "large"); // -> proposal

    const secondCallBody = client.post.mock.calls[1]?.[1] as {
      message: string;
      history: { role: string; content: string }[];
    };
    expect(secondCallBody.message).toBe("large");
    expect(secondCallBody.history).toEqual([
      { role: "user", content: "I had a burrito" },
      { role: "assistant", content: "What size burrito — regular or large?" },
    ]);
  });

  it("renders a question turn for kind:question", async () => {
    const store = useMealChatStore();
    const client = fakeClient([questionResponse]);

    await store.send(client, "I had lunch");

    const assistant = store.turns[1];
    expect(assistant?.role).toBe("assistant");
    if (assistant?.role === "assistant") {
      expect(assistant.kind).toBe("question");
      if (assistant.kind === "question") expect(assistant.content).toMatch(/burrito/i);
    }
  });

  it("surfaces an error and keeps the user message on a failed send", async () => {
    const store = useMealChatStore();
    const post = vi.fn().mockRejectedValueOnce(new Error("network"));
    const client = { post } as unknown as import("../api/client.js").ApiClient;

    await store.send(client, "burrito");

    expect(store.error).toBeTruthy();
    expect(store.turns).toHaveLength(1);
    expect(store.turns[0]).toMatchObject({ role: "user", content: "burrito" });
    expect(store.pending).toBe(false);
  });

  it("surfaces the server's message on an HTTP error (e.g. the usage-cap 429)", async () => {
    const store = useMealChatStore();
    // ApiClient throws { kind: "http", status, body } where body is the raw JSON
    // envelope { error: { code, message } } the API sends.
    const httpErr = {
      kind: "http" as const,
      status: 429,
      body: JSON.stringify({
        error: {
          code: "usage_limit_exceeded",
          message: "Daily AI usage cap reached. You can still log meals manually.",
        },
      }),
    };
    const post = vi.fn().mockRejectedValueOnce(httpErr);
    const client = { post } as unknown as import("../api/client.js").ApiClient;

    await store.send(client, "a big mac");

    expect(store.error).toContain("Daily AI usage cap reached");
    expect(store.error).toContain("log meals manually");
  });

  it("falls back to a generic message when an HTTP error body is unparseable", async () => {
    const store = useMealChatStore();
    const httpErr = { kind: "http" as const, status: 500, body: "<html>oops</html>" };
    const post = vi.fn().mockRejectedValueOnce(httpErr);
    const client = { post } as unknown as import("../api/client.js").ApiClient;
    await store.send(client, "burrito");
    expect(store.error).toBeTruthy();
    expect(store.error).toMatch(/500|try again/i);
  });

  it("reset() clears turns and error", async () => {
    const store = useMealChatStore();
    const client = fakeClient([proposalResponse]);
    await store.send(client, "burrito");
    store.reset();
    expect(store.turns).toHaveLength(0);
    expect(store.error).toBeNull();
  });

  it("dismissMeal removes one card from a proposal turn", async () => {
    const store = useMealChatStore();
    const client = fakeClient([proposalResponse]);
    await store.send(client, "burrito and beer");
    store.dismissMeal(1, 0); // turn index 1, meal index 0
    const assistant = store.turns[1];
    if (assistant?.role === "assistant" && assistant.kind === "proposal") {
      expect(assistant.meals).toHaveLength(1);
      expect(assistant.meals[0]?.name).toBe("Beer");
    }
  });

  it("a fresh proposal turn starts with an empty loggedSummaries array", async () => {
    const store = useMealChatStore();
    const client = fakeClient([proposalResponse]);
    await store.send(client, "burrito and beer");
    const assistant = store.turns[1];
    if (assistant?.role === "assistant" && assistant.kind === "proposal") {
      expect(assistant.loggedSummaries).toEqual([]);
    }
  });

  it("markLogged removes the meal AND records the summary (dismiss does not)", async () => {
    const store = useMealChatStore();
    const client = fakeClient([proposalResponse]);
    await store.send(client, "burrito and beer");
    store.markLogged(1, 0, "✓ Logged Burrito — 640 kcal");
    const assistant = store.turns[1];
    if (assistant?.role === "assistant" && assistant.kind === "proposal") {
      // The meal was spliced out (like dismiss)…
      expect(assistant.meals).toHaveLength(1);
      expect(assistant.meals[0]?.name).toBe("Beer");
      // …and the summary was recorded (unlike dismiss).
      expect(assistant.loggedSummaries).toEqual(["✓ Logged Burrito — 640 kcal"]);
    }
  });

  it("dismissMeal does NOT add a summary", async () => {
    const store = useMealChatStore();
    const client = fakeClient([proposalResponse]);
    await store.send(client, "burrito and beer");
    store.dismissMeal(1, 0);
    const assistant = store.turns[1];
    if (assistant?.role === "assistant" && assistant.kind === "proposal") {
      expect(assistant.loggedSummaries).toEqual([]);
    }
  });
});

describe("meal-chat store — alcohol", () => {
  beforeEach(() => setActivePinia(createPinia()));

  const mixedResponse = {
    kind: "proposal",
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
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      cost_usd: 0,
      model: "claude-haiku-4-5",
    },
  };

  it("stores alcoholSessions on the proposal turn with stable keys", async () => {
    const store = useMealChatStore();
    await store.send(fakeClient([mixedResponse]), "a burger and two beers");
    const turn = store.turns[store.turns.length - 1];
    expect(turn?.role).toBe("assistant");
    if (turn?.role === "assistant" && turn.kind === "proposal") {
      expect(turn.meals).toHaveLength(1);
      expect(turn.alcoholSessions).toHaveLength(1);
      expect(turn.alcoholSessions[0]?._key).toBeTypeOf("number");
      expect(turn.alcoholSessions[0]?.drinks_count).toBe(2);
      // Meals and alcohol share one monotonic key counter, so a meal card and an
      // alcohol card in the same turn must never collide (both render in ChatThread).
      expect(turn.meals[0]?._key).not.toBe(turn.alcoholSessions[0]?._key);
    }
  });

  it("dismissAlcohol removes the alcohol card without a summary", async () => {
    const store = useMealChatStore();
    await store.send(fakeClient([mixedResponse]), "x");
    const ti = store.turns.length - 1;
    store.dismissAlcohol(ti, 0);
    const turn = store.turns[ti];
    if (turn?.role === "assistant" && turn.kind === "proposal") {
      expect(turn.alcoholSessions).toHaveLength(0);
      expect(turn.loggedSummaries).toHaveLength(0);
    }
  });

  it("markAlcoholLogged removes the card and records a summary", async () => {
    const store = useMealChatStore();
    await store.send(fakeClient([mixedResponse]), "x");
    const ti = store.turns.length - 1;
    store.markAlcoholLogged(ti, 0, "✓ Logged 2 drinks — ~300 kcal");
    const turn = store.turns[ti];
    if (turn?.role === "assistant" && turn.kind === "proposal") {
      expect(turn.alcoholSessions).toHaveLength(0);
      expect(turn.loggedSummaries).toContain("✓ Logged 2 drinks — ~300 kcal");
    }
  });
});

describe("lastEstablishedTime", () => {
  const usage = {
    input_tokens: 1,
    output_tokens: 1,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    web_search_requests: 0,
    sources: [],
    cost_usd: 0,
    model: "x",
  };

  function proposalTurn(name: string, eatenAt?: string): Turn {
    return {
      role: "assistant",
      kind: "proposal",
      content: "Proposed: …",
      usage,
      loggedSummaries: [],
      alcoholSessions: [],
      meals: [
        {
          source: "estimated",
          name,
          kcal: 500,
          protein_g: 20,
          carb_g: 40,
          fat_g: 20,
          suggest_store: false,
          _key: 0,
          ...(eatenAt ? { eaten_at: eatenAt } : {}),
        },
      ],
    };
  }

  it("returns null when no proposal has carried a time", () => {
    expect(lastEstablishedTime([{ role: "user", content: "lunch" }])).toBeNull();
    expect(lastEstablishedTime([proposalTurn("Burger")])).toBeNull();
  });

  it("extracts the HH:MM of a proposal that captured a time", () => {
    expect(lastEstablishedTime([proposalTurn("Burger", "2026-06-22T12:30:00")])).toBe("12:30");
  });

  it("returns the MOST RECENT established time across turns", () => {
    // The lunch turn established 12:30; a later turn that omits a time must not
    // erase it — the most recent *established* time wins.
    const turns: Turn[] = [
      { role: "user", content: "today for lunch I ate a hot honey burger" },
      proposalTurn("Hot honey burger", "2026-06-22T12:30:00"),
      { role: "user", content: "it was huge" },
      proposalTurn("Hot honey burger (large)"), // no eaten_at on the re-estimate
    ];
    expect(lastEstablishedTime(turns)).toBe("12:30");
  });

  it("returns null for a stored match that carries no eaten_at", () => {
    const turns: Turn[] = [
      {
        role: "assistant",
        kind: "proposal",
        content: "Proposed: …",
        usage,
        loggedSummaries: [],
        alcoholSessions: [],
        meals: [{ source: "stored", stored_meal_id: 7, name: "Protein Oatmeal", _key: 0 }],
      },
    ];
    expect(lastEstablishedTime(turns)).toBeNull();
  });

  it("establishes a time from a STORED match that carries eaten_at", () => {
    // "big mac for lunch" matches the library (source=stored) but the user
    // stated a time, so the stored proposal now carries eaten_at — a later
    // estimate ("and an apple") must inherit 12:30, not default to now.
    const turns: Turn[] = [
      { role: "user", content: "I had a big mac for lunch" },
      {
        role: "assistant",
        kind: "proposal",
        content: "Matched your Big Mac",
        usage,
        loggedSummaries: [],
        alcoholSessions: [],
        meals: [
          {
            source: "stored",
            stored_meal_id: 3,
            name: "Big Mac",
            eaten_at: "2026-06-22T12:30:00",
            _key: 0,
          },
        ],
      },
      { role: "user", content: "and an apple" },
      proposalTurn("Apple"), // estimated, no own eaten_at
    ];
    expect(lastEstablishedTime(turns)).toBe("12:30");
  });
});

describe("lastEstablishedDate", () => {
  const usage = {
    input_tokens: 1,
    output_tokens: 1,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    web_search_requests: 0,
    sources: [],
    cost_usd: 0,
    model: "x",
  };
  function proposalTurn(name: string, eatenAt?: string): Turn {
    return {
      role: "assistant",
      kind: "proposal",
      content: "Proposed: …",
      usage,
      loggedSummaries: [],
      alcoholSessions: [],
      meals: [
        {
          source: "estimated",
          name,
          kcal: 500,
          protein_g: 20,
          carb_g: 40,
          fat_g: 20,
          suggest_store: false,
          _key: 0,
          ...(eatenAt ? { eaten_at: eatenAt } : {}),
        },
      ],
    };
  }

  it("returns null when no proposal carried a date", () => {
    expect(lastEstablishedDate([proposalTurn("Burger")])).toBeNull();
  });

  it("extracts the YYYY-MM-DD of a proposal that captured a time", () => {
    expect(lastEstablishedDate([proposalTurn("Burger", "2026-06-22T12:30:00")])).toBe("2026-06-22");
  });

  it("returns the date of the most recent dated proposal", () => {
    const turns: Turn[] = [
      proposalTurn("Lunch", "2026-06-22T12:30:00"),
      { role: "user", content: "and an apple" },
      proposalTurn("Apple"), // no own date — must not erase the established one
    ];
    expect(lastEstablishedDate(turns)).toBe("2026-06-22");
  });
});
