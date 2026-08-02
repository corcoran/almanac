import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client.js";
import { ALMANAC_MCP_INSTRUCTIONS } from "./instructions.js";
import { buildMcpServer } from "./server.js";
import { connectTestClient } from "./test-support/mcp-harness.js";

/**
 * The MCP SDK 1.x ships server-level `instructions` to clients in the
 * `initialize` response. Claude Desktop, Claude Code, and ChatGPT MCP all
 * inject that string into the LLM's system prompt alongside the tool
 * list, so it's the right place for cross-cutting behavior guidance. This
 * test pins the wiring — without it, a future refactor could silently
 * drop the field and clients would see an "undocumented" server.
 *
 * Note: this reads the instructions through the PUBLIC client surface
 * (`client.getInstructions()`) after connecting over an in-memory
 * transport, rather than reaching into private SDK internals. The accessor
 * returns whatever the server advertised in the `initialize` response, so
 * it exercises the same wiring real clients see.
 */
describe("buildMcpServer", () => {
  it("ships ALMANAC_MCP_INSTRUCTIONS via ServerOptions.instructions", async () => {
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl: vi.fn() });
    const server = buildMcpServer({ api }, () => "alm_test");
    const client = await connectTestClient(server);
    expect(client.getInstructions()).toBe(ALMANAC_MCP_INSTRUCTIONS);
  });

  it("keeps instructions under the 2 KB Claude Code truncation threshold", () => {
    // Claude Code truncates server instructions at ~2 KB. Going over means
    // the trailing guidance gets silently dropped on that client.
    expect(ALMANAC_MCP_INSTRUCTIONS.length).toBeLessThan(2000);
  });

  it("instructions mention the warning/nudge response protocol", () => {
    // Anchor the most important behavioral instruction. If a refactor
    // accidentally trims the wrong section, this catches it.
    expect(ALMANAC_MCP_INSTRUCTIONS).toMatch(/estimate_warning/);
    expect(ALMANAC_MCP_INSTRUCTIONS).toMatch(/nudges/);
    expect(ALMANAC_MCP_INSTRUCTIONS).toMatch(/profile_baseline/);
  });
});
