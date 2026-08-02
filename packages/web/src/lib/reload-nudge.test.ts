import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { reloadNudge } from "./reload-nudge.js";

describe("reloadNudge", () => {
  it("calls the store's reload with the client", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const client = {} as ApiClient;

    await reloadNudge({ reload }, client);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith(client);
  });

  it("awaits the store reload (propagates rejection)", async () => {
    const reload = vi.fn().mockRejectedValue(new Error("boom"));
    const client = {} as ApiClient;

    await expect(reloadNudge({ reload }, client)).rejects.toThrow("boom");
  });
});
