import { at } from "@almanac/core/test-support";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClient } from "../client.js";
import { connectTestClient } from "../test-support/mcp-harness.js";
import { type Tool, type ToolDeps, ToolError } from "../tool.js";
import { makeUserTzResolver, registerOneTool } from "./register.js";

function deps(): ToolDeps {
  const api = new ApiClient({
    baseUrl: "http://x",
    // /api/v1/users/me -> tz resolver; everything else unused here.
    fetchImpl: vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ timezone: "America/Toronto" }),
    })) as unknown as typeof fetch,
  });
  return { api, currentUserId: async () => 1, currentToken: () => "alm_test" };
}

function build(tool: Tool<unknown>) {
  const server = new McpServer({ name: "t", version: "0.0.0" }, { capabilities: { tools: {} } });
  const d = deps();
  registerOneTool(server, tool, makeUserTzResolver(d));
  return server;
}

describe("registerOneTool", () => {
  it("stamps _meta.server_now and _meta.user_tz on a successful result", async () => {
    const tool: Tool<{ x: number }> = {
      name: "echo",
      description: "echo",
      inputSchema: z.object({ x: z.number() }),
      handler: async (input) => ({ got: input.x }),
    };
    const client = await connectTestClient(build(tool as Tool<unknown>));
    const res = (await client.callTool({ name: "echo", arguments: { x: 7 } })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(at(res.content, 0).text) as {
      got: number;
      _meta: { server_now: string; user_tz: string };
    };
    expect(payload.got).toBe(7);
    expect(payload._meta.user_tz).toBe("America/Toronto");
    expect(payload._meta.server_now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("passes a ToolError payload through as an isError text envelope (no _meta)", async () => {
    const tool: Tool<Record<string, never>> = {
      name: "boom",
      description: "boom",
      inputSchema: z.object({}),
      handler: async () => {
        throw new ToolError({ error: "tdee_unavailable", detail: "nope" });
      },
    };
    const client = await connectTestClient(build(tool as Tool<unknown>));
    const res = (await client.callTool({ name: "boom", arguments: {} })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(res.isError).toBe(true);
    const payload = JSON.parse(at(res.content, 0).text) as Record<string, unknown>;
    expect(payload.error).toBe("tdee_unavailable");
    expect(payload._meta).toBeUndefined();
  });

  it("wraps a non-object handler result as { result, _meta }", async () => {
    const tool: Tool<Record<string, never>> = {
      name: "stringy",
      description: "stringy",
      inputSchema: z.object({}),
      handler: async () => "hello",
    };
    const client = await connectTestClient(build(tool as Tool<unknown>));
    const res = (await client.callTool({ name: "stringy", arguments: {} })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(at(res.content, 0).text) as {
      result: string;
      _meta: { server_now: string; user_tz: string };
    };
    expect(payload.result).toBe("hello");
    expect(payload._meta.user_tz).toBe("America/Toronto");
  });
});
