import { at } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { buildMcpServer } from "../server.js";
import { connectTestClient } from "../test-support/mcp-harness.js";

// These tests drive the resource registry through the MCP SDK's PUBLIC client
// surface (`listResources` / `readResource`) over an in-memory transport,
// rather than reaching into private SDK internals. `buildMcpServer` wires the
// same registration the production server uses.

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

async function buildTestClient(fetchImpl: typeof fetch) {
  const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
  const server = buildMcpServer({ api }, () => "alm_test");
  return connectTestClient(server);
}

describe("registerResources", () => {
  it("registers all 5 resources and advertises them via ListResourcesRequest", async () => {
    const client = await buildTestClient(vi.fn());
    const result = await client.listResources();
    expect(result.resources).toHaveLength(5);
    const uris = result.resources.map((r) => r.uri).sort();
    expect(uris).toEqual([
      "almanac://exercises",
      "almanac://phase/current",
      "almanac://stim-states",
      "almanac://templates",
      "almanac://today",
    ]);
    // Spot-check that mimeType is set per resource.
    for (const r of result.resources) {
      expect(r.mimeType).toBe("application/json");
    }
  });

  it("dispatches ReadResource for almanac://today", async () => {
    // The today resource handler calls only GET /api/v1/signals/today with the
    // per-connection bearer — it does NOT resolve currentUserId, so no
    // /users/me fetch precedes it. A single mock suffices.
    const todayCtx = { today: { kcal_in: 1200 } };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, todayCtx));
    const client = await buildTestClient(fetchImpl);
    const result = await client.readResource({ uri: "almanac://today" });
    const content = at(result.contents, 0);
    expect(content.uri).toBe("almanac://today");
    expect(content.mimeType).toBe("application/json");
    // The SDK types `contents` as a text|blob union; narrow to the text variant.
    if (!("text" in content)) throw new Error("expected a text content entry");
    expect(JSON.parse(content.text)).toEqual(todayCtx);
  });

  it("rejects an unknown resource uri", async () => {
    const client = await buildTestClient(vi.fn());
    await expect(client.readResource({ uri: "almanac://nope" })).rejects.toThrow();
  });
});
