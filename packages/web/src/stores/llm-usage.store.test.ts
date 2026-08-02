import { DailyBalanceSchema } from "@almanac/core/schemas";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLlmUsageStore } from "./llm-usage.store.js";

const balance = {
  tokensUsed: 10000,
  callsToday: 5,
  softLimit: 50000,
  avgTokensPerLog: 2000,
  logsLeftEstimate: 20,
  pctRemaining: 80,
  overSoftLimit: false,
  overHardCap: false,
  resetsAt: "4am",
};

function fakeClient(resp: unknown) {
  const get = vi.fn().mockResolvedValue(DailyBalanceSchema.parse(resp));
  return { get } as unknown as import("../api/client.js").ApiClient & { get: typeof get };
}

describe("llm-usage store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("refresh() fetches the feature-scoped /v1/llm/usage and stores the balance", async () => {
    const store = useLlmUsageStore();
    const client = fakeClient(balance);
    await store.refresh(client, "meal_chat");
    expect(client.get).toHaveBeenCalledWith("/v1/llm/usage?feature=meal_chat", expect.anything());
    expect(store.balance?.logsLeftEstimate).toBe(20);
  });

  it("swallows an error (e.g. 403 disabled) and leaves balance null", async () => {
    const store = useLlmUsageStore();
    const get = vi.fn().mockRejectedValueOnce(new Error("403"));
    const client = { get } as unknown as import("../api/client.js").ApiClient;
    await store.refresh(client, "insights_chat");
    expect(store.balance).toBeNull();
  });

  it("starts with a null balance", () => {
    const store = useLlmUsageStore();
    expect(store.balance).toBeNull();
  });
});
