import { InsightsChatResponseSchema } from "@almanac/core/schemas";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInsightsChatStore } from "./insights-chat.store.js";

function fakeClient(responses: unknown[]) {
  const post = vi.fn();
  for (const r of responses) post.mockResolvedValueOnce(InsightsChatResponseSchema.parse(r));
  return { post } as unknown as import("../api/client.js").ApiClient & { post: typeof post };
}

const answerResponse = {
  kind: "answer",
  text: "you're on track",
  usage: {
    input_tokens: 1,
    output_tokens: 1,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    web_search_requests: 0,
    cost_usd: 0,
    model: "claude-haiku-4-5",
  },
};

describe("insights-chat store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("send() pushes a user turn then an assistant answer turn", async () => {
    const store = useInsightsChatStore();
    const client = fakeClient([answerResponse]);

    await store.send(client, "how am I doing?");

    expect(store.turns).toHaveLength(2);
    expect(store.turns[0]).toEqual({ role: "user", content: "how am I doing?" });
    expect(store.turns[1]).toEqual({ role: "assistant", content: "you're on track" });
    expect(store.pending).toBe(false);
  });

  it("sends prior turns as history (oldest first), excluding the newest message", async () => {
    const store = useInsightsChatStore();
    const client = fakeClient([answerResponse, answerResponse]);

    await store.send(client, "first question");
    await store.send(client, "second question");

    const secondCallBody = client.post.mock.calls[1]?.[1] as {
      message: string;
      history: { role: string; content: string }[];
    };
    expect(secondCallBody.message).toBe("second question");
    expect(secondCallBody.history).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "you're on track" },
    ]);
  });

  it("sets pending true mid-flight and resets it false after", async () => {
    const store = useInsightsChatStore();
    let resolve: ((v: unknown) => void) | undefined;
    const deferred = new Promise((r) => {
      resolve = r;
    });
    const post = vi.fn().mockReturnValueOnce(deferred);
    const client = { post } as unknown as import("../api/client.js").ApiClient;

    const sendPromise = store.send(client, "how am I doing?");
    expect(store.pending).toBe(true);
    resolve?.(InsightsChatResponseSchema.parse(answerResponse));
    await sendPromise;
    expect(store.pending).toBe(false);
  });

  it("surfaces an error and keeps the user message on a failed send", async () => {
    const store = useInsightsChatStore();
    const post = vi.fn().mockRejectedValueOnce(new Error("network"));
    const client = { post } as unknown as import("../api/client.js").ApiClient;

    await store.send(client, "how am I doing?");

    expect(store.error).toBeTruthy();
    expect(store.turns).toHaveLength(1);
    expect(store.turns[0]).toEqual({ role: "user", content: "how am I doing?" });
    expect(store.pending).toBe(false);
  });

  it("surfaces the server's message on an HTTP error (e.g. the usage-cap 429)", async () => {
    const store = useInsightsChatStore();
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

    await store.send(client, "how am I doing?");

    expect(store.error).toContain("Daily AI usage cap reached");
    expect(store.turns).toHaveLength(1);
  });

  it("keeps sources on the assistant turn but not in outbound history", async () => {
    const store = useInsightsChatStore();
    const sourcedResponse = {
      kind: "answer",
      text: "a",
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        web_search_requests: 1,
        sources: [{ url: "https://x.com/a", title: "A", domain: "x.com" }],
        cost_usd: 0,
        model: "m",
      },
    };
    const client = fakeClient([sourcedResponse, answerResponse]);

    await store.send(client, "first question");

    const assistant = store.turns.at(-1);
    expect(assistant?.sources).toEqual([{ url: "https://x.com/a", title: "A", domain: "x.com" }]);

    // The NEXT send's outbound history must be role+content only — sources are
    // display-only and are NEVER sent back to the model.
    await store.send(client, "second question");
    const secondBody = client.post.mock.calls[1]?.[1] as {
      history: { role: string; content: string }[];
    };
    for (const h of secondBody.history) {
      expect(Object.keys(h).sort()).toEqual(["content", "role"]);
      expect("sources" in h).toBe(false);
    }
  });

  it("hydrates sources from history", async () => {
    const store = useInsightsChatStore();
    const get = vi.fn((path: string) => {
      if (path.startsWith("/v1/llm/insights-chat/history")) {
        return Promise.resolve({
          on_date: "2026-06-24",
          turns: [
            {
              role: "assistant",
              content: "a",
              sources: [{ url: "https://x.com/a", title: "A", domain: "x.com" }],
            },
          ],
        });
      }
      return Promise.resolve({ days: ["2026-06-24"] });
    });
    const client = { get } as unknown as import("../api/client.js").ApiClient;

    await store.load(client);

    expect(store.turns[0]?.sources).toEqual([
      { url: "https://x.com/a", title: "A", domain: "x.com" },
    ]);
  });

  it("reset() clears turns and error", async () => {
    const store = useInsightsChatStore();
    const client = fakeClient([answerResponse]);
    await store.send(client, "how am I doing?");
    store.reset();
    expect(store.turns).toHaveLength(0);
    expect(store.error).toBeNull();
  });

  it("load() hydrates turns/viewedDate/days from history+days, making NO post (no AI)", async () => {
    const store = useInsightsChatStore();
    const post = vi.fn();
    const get = vi.fn((path: string) => {
      if (path.startsWith("/v1/llm/insights-chat/history")) {
        return Promise.resolve({
          on_date: "2026-06-23",
          turns: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "yo" },
          ],
        });
      }
      return Promise.resolve({ days: ["2026-06-23", "2026-06-20"] });
    });
    const client = { get, post } as unknown as import("../api/client.js").ApiClient;

    await store.load(client);

    expect(store.turns).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "yo" },
    ]);
    expect(store.viewedDate).toBe("2026-06-23");
    expect(store.days).toEqual(["2026-06-23", "2026-06-20"]);
    expect(store.loaded).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it("load(client, date) requests the history with ?date=", async () => {
    const store = useInsightsChatStore();
    const get = vi.fn((path: string) => {
      if (path.startsWith("/v1/llm/insights-chat/history")) {
        return Promise.resolve({ on_date: "2026-06-20", turns: [] });
      }
      return Promise.resolve({ days: ["2026-06-20"] });
    });
    const client = { get } as unknown as import("../api/client.js").ApiClient;

    await store.load(client, "2026-06-20");

    const historyCall = get.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("/v1/llm/insights-chat/history"),
    );
    expect(historyCall?.[0]).toBe("/v1/llm/insights-chat/history?date=2026-06-20");
  });

  it("send() includes on_date: viewedDate in the POST body", async () => {
    const store = useInsightsChatStore();
    const client = fakeClient([answerResponse]);
    store.viewedDate = "2026-06-22";

    await store.send(client, "how am I doing?");

    const body = client.post.mock.calls[0]?.[1] as { on_date?: string };
    expect(body.on_date).toBe("2026-06-22");
  });

  it("stepDay(client, -1) loads the next-older day and updates viewedDate", async () => {
    const store = useInsightsChatStore();
    store.days = ["2026-06-23", "2026-06-20"];
    store.viewedDate = "2026-06-23";
    const get = vi.fn((path: string) => {
      if (path.startsWith("/v1/llm/insights-chat/history")) {
        return Promise.resolve({ on_date: "2026-06-20", turns: [] });
      }
      return Promise.resolve({ days: ["2026-06-23", "2026-06-20"] });
    });
    const client = { get } as unknown as import("../api/client.js").ApiClient;

    await store.stepDay(client, -1);

    const historyCall = get.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("/v1/llm/insights-chat/history"),
    );
    expect(historyCall?.[0]).toBe("/v1/llm/insights-chat/history?date=2026-06-20");
    expect(store.viewedDate).toBe("2026-06-20");
  });

  it("stepDay(client, -1) from a FRESH today (not in days) reaches the newest past day", async () => {
    // Today (2026-06-24) has no conversation, so it isn't in `days`; the only
    // entry is a past day. ◀ must still step into the archive (days[0]).
    const store = useInsightsChatStore();
    store.days = ["2026-06-23"];
    store.viewedDate = "2026-06-24"; // fresh today, NOT in days
    const get = vi.fn((path: string) =>
      path.startsWith("/v1/llm/insights-chat/history")
        ? Promise.resolve({ on_date: "2026-06-23", turns: [] })
        : Promise.resolve({ days: ["2026-06-23"] }),
    );
    const client = { get } as unknown as import("../api/client.js").ApiClient;

    await store.stepDay(client, -1);

    const historyCall = get.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].startsWith("/v1/llm/insights-chat/history"),
    );
    expect(historyCall?.[0]).toBe("/v1/llm/insights-chat/history?date=2026-06-23");
    expect(store.viewedDate).toBe("2026-06-23");
  });

  it("stepDay(client, 1) from a fresh today is a no-op (nothing newer)", async () => {
    const store = useInsightsChatStore();
    store.days = ["2026-06-23"];
    store.viewedDate = "2026-06-24";
    const get = vi.fn(() => Promise.resolve({ days: ["2026-06-23"] }));
    const client = { get } as unknown as import("../api/client.js").ApiClient;
    await store.stepDay(client, 1);
    expect(get).not.toHaveBeenCalled(); // bailed, no load
    expect(store.viewedDate).toBe("2026-06-24");
  });

  it("load() sets loading true mid-flight and false after", async () => {
    const store = useInsightsChatStore();
    let resolve: ((v: unknown) => void) | undefined;
    const deferred = new Promise((r) => {
      resolve = r;
    });
    const get = vi.fn().mockReturnValueOnce(deferred);
    const client = { get } as unknown as import("../api/client.js").ApiClient;

    const loadPromise = store.load(client);
    expect(store.loading).toBe(true);
    resolve?.({ on_date: "2026-06-23", turns: [] });
    await loadPromise;
    expect(store.loading).toBe(false);
  });

  it("load() is a no-op while a prior load is in flight (drops the racing second call)", async () => {
    const store = useInsightsChatStore();
    let resolveHistory: ((v: unknown) => void) | undefined;
    const get = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveHistory = r;
        }),
      )
      .mockResolvedValue({ days: ["2026-06-23"] });
    const client = { get } as unknown as import("../api/client.js").ApiClient;

    const first = store.load(client);
    // Second call lands while the first is still awaiting history → dropped.
    await store.load(client, "2026-06-20");
    expect(get).toHaveBeenCalledTimes(1);

    resolveHistory?.({ on_date: "2026-06-23", turns: [] });
    await first;
    expect(store.loading).toBe(false);
  });

  it("stepDay() bails when a load is already in flight", async () => {
    const store = useInsightsChatStore();
    store.days = ["2026-06-23", "2026-06-20"];
    store.viewedDate = "2026-06-23";
    store.loading = true;
    const get = vi.fn();
    const client = { get } as unknown as import("../api/client.js").ApiClient;

    await store.stepDay(client, -1);

    expect(get).not.toHaveBeenCalled();
    expect(store.viewedDate).toBe("2026-06-23");
  });

  it("newChat() bails when a load is already in flight (no double-delete)", async () => {
    const store = useInsightsChatStore();
    store.loading = true;
    const del = vi.fn();
    const get = vi.fn();
    const client = { delete: del, get } as unknown as import("../api/client.js").ApiClient;

    await store.newChat(client);

    expect(del).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("newChat() deletes the history then reloads today empty", async () => {
    const store = useInsightsChatStore();
    store.turns = [{ role: "user", content: "old" }];
    const del = vi.fn((_path: string) => Promise.resolve(undefined));
    const get = vi.fn((path: string) => {
      if (path.startsWith("/v1/llm/insights-chat/history")) {
        return Promise.resolve({ on_date: "2026-06-23", turns: [] });
      }
      return Promise.resolve({ days: [] });
    });
    const client = { delete: del, get } as unknown as import("../api/client.js").ApiClient;

    await store.newChat(client);

    expect(del).toHaveBeenCalled();
    expect(del.mock.calls[0]?.[0]).toBe("/v1/llm/insights-chat/history");
    expect(store.turns).toHaveLength(0);
  });
});
