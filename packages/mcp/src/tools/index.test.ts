import { at, defined } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { buildMcpServer } from "../server.js";
import { connectTestClient } from "../test-support/mcp-harness.js";

// These tests drive the registry through the MCP SDK's PUBLIC client surface
// (`listTools` / `callTool`) over an in-memory transport, rather than reaching
// into private SDK internals. `buildMcpServer` wires the same dispatcher
// (`registerOneTool`) the production server uses, so the `_meta` envelope and
// ToolError pass-through behavior are exercised end-to-end.

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

// The SDK's CallToolResult types `content` loosely (unknown), so the helpers
// narrow it to the text-envelope shape these tests assert against.
type CallResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

async function buildTestClient(fetchImpl: typeof fetch) {
  const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
  const server = buildMcpServer({ api }, () => "alm_test");
  const client = await connectTestClient(server);
  return {
    listTools: () => client.listTools(),
    callTool: async (args: { name: string; arguments: Record<string, unknown> }) =>
      (await client.callTool(args)) as CallResult,
  };
}

describe("registerTools", () => {
  it("registers all 76 tools and they advertise via ListToolsRequest", async () => {
    const client = await buildTestClient(vi.fn());
    const result = await client.listTools();
    expect(result.tools).toHaveLength(76);
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toContain("log_meal");
    expect(names).toContain("get_today_context");
    expect(names).toContain("update_workout");
    expect(names).toContain("define_exercise_group");
    expect(names).toContain("list_exercise_groups");
    expect(names).toContain("list_exercises");
    expect(names).toContain("list_workout_templates");
    // Removed: it created an email-less user row, which stranded that user's
    // data behind a second account on first sign-in. Provisioning is the auth
    // layer's job now.
    expect(names).not.toContain("bootstrap_user");
    expect(names).toContain("get_recommended_template");
    expect(names).toContain("get_workout_recommendation"); // alias of get_recommended_template
    expect(names).toContain("get_training_history");
    expect(names).toContain("get_calendar");
    expect(names).toContain("get_user_profile");
    expect(names).toContain("update_exercise");
    expect(names).toContain("ping");
    expect(names).toContain("get_day_status");
    // New tools from this commit:
    expect(names).toContain("delete_meal");
    expect(names).toContain("delete_cardio");
    expect(names).toContain("delete_sleep");
    expect(names).toContain("delete_weight");
    expect(names).toContain("delete_alcohol");
    expect(names).toContain("delete_workout");
    expect(names).toContain("delete_set");
    expect(names).toContain("update_phase");
    expect(names).toContain("end_phase");
    expect(names).toContain("get_capabilities");
    expect(names).toContain("create_untracked_period");
    expect(names).toContain("list_untracked_periods");
    expect(names).toContain("delete_untracked_period");
    expect(names).toContain("get_workout_for_day");
    // Spot-check the JSON-Schema shape: log_meal's kcal field should appear.
    const logMeal = result.tools.find((t) => t.name === "log_meal");
    expect(logMeal).toBeDefined();
    const schema = defined(logMeal, "logMeal").inputSchema as {
      properties?: Record<string, unknown>;
    };
    expect(schema.properties).toBeDefined();
    expect(schema.properties).toHaveProperty("kcal");
  });

  // Annotations let MCP clients (Claude Desktop, Claude Code, ChatGPT Apps
  // SDK) decide whether to prompt-confirm before invoking a tool, whether
  // to surface it as "read" vs "write", and whether to skip caching. Two
  // anchor cases:
  it("read tools advertise readOnlyHint: true so clients skip confirmation prompts", async () => {
    const client = await buildTestClient(vi.fn());
    const result = await client.listTools();
    const reads = ["get_today_context", "get_user_profile", "get_tdee", "get_day_status", "ping"];
    for (const name of reads) {
      const t = result.tools.find((tt) => tt.name === name);
      expect(t, `${name} missing from registry`).toBeDefined();
      expect(defined(t, "t").annotations?.readOnlyHint, `${name} should be read-only`).toBe(true);
      expect(defined(t, "t").annotations?.openWorldHint, `${name} should be closed-world`).toBe(
        false,
      );
    }
  });

  it("write tools advertise readOnlyHint: false so clients prompt before invoking", async () => {
    const client = await buildTestClient(vi.fn());
    const result = await client.listTools();
    const writes = ["log_meal", "log_workout", "update_workout", "update_meal", "log_weight"];
    for (const name of writes) {
      const t = result.tools.find((tt) => tt.name === name);
      expect(t, `${name} missing from registry`).toBeDefined();
      expect(defined(t, "t").annotations?.readOnlyHint, `${name} must NOT claim read-only`).toBe(
        false,
      );
    }
  });

  it("define_exercise's group_id description references list_exercise_groups (not the bogus get_exercise_groups)", async () => {
    const client = await buildTestClient(vi.fn());
    const result = await client.listTools();
    const defineExercise = result.tools.find((t) => t.name === "define_exercise");
    expect(defineExercise).toBeDefined();
    const schema = defined(defineExercise, "defineExercise").inputSchema as {
      properties?: Record<string, { description?: string }>;
    };
    const groupIdDesc = schema.properties?.group_id?.description ?? "";
    expect(groupIdDesc).toContain("list_exercise_groups");
    expect(groupIdDesc).not.toContain("get_exercise_groups");
  });

  it("dispatches CallToolRequest to the matching tool's handler", async () => {
    const fetchImpl = vi
      .fn()
      // currentUserId resolver: GET /api/v1/users/me (cached per connection).
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, timezone: "UTC" }))
      .mockResolvedValueOnce(
        mockJsonResponse(201, {
          id: 7,
          eaten_at: "2026-05-12T08:00:00.000Z",
          kcal: 350,
          protein_g: 25,
          carb_g: 30,
          fat_g: 15,
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse(200, {
          date: "2026-05-12",
          day_totals: {
            kcal: 350,
            protein_g: 25,
            carb_g: 30,
            fat_g: 15,
            kcal_from_food: 350,
            kcal_from_alcohol: 0,
          },
          // Post-TDEE-refactor: structured day_target block.
          day_target: {
            target: { kcal: 1900, protein_g: 165, carb_g: 230, fat_g: 75 },
            maintenance: { kcal: 2400 },
            intake: { kcal: 350, protein_g: 25, carb_g: 30, fat_g: 15 },
            observed: {
              cardio_kcal: 0,
              workout_kcal: 0,
              vs_target: -1550,
              vs_maintenance: -2050,
              status: "on_track",
            },
          },
        }),
      );
    const client = await buildTestClient(fetchImpl);
    const result = await client.callTool({
      name: "log_meal",
      arguments: {
        eaten_at: "2026-05-12T08:00:00Z",
        kcal: 350,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
      },
    });
    expect(at(result.content, 0).type).toBe("text");
    const body = JSON.parse(at(result.content, 0).text);
    expect(body.id).toBe(7);
  });

  it("returns an isError envelope for an unknown tool name", async () => {
    const client = await buildTestClient(vi.fn());
    const result = await client.callTool({ name: "no_such_tool", arguments: {} });
    expect(result.isError).toBe(true);
    // The SDK rejects unknown tool names with its own error envelope.
    expect(at(result.content, 0).text).toMatch(/no_such_tool.*not found/);
  });

  it("maps a Zod validation failure to an isError envelope containing the field name", async () => {
    const client = await buildTestClient(vi.fn());
    // log_meal requires kcal to be a non-negative int — pass a string instead.
    const result = await client.callTool({
      name: "log_meal",
      arguments: { eaten_at: "x", kcal: "not-a-number", protein_g: 0, carb_g: 0, fat_g: 0 },
    });
    expect(result.isError).toBe(true);
    expect(at(result.content, 0).text).toMatch(/kcal/);
    // The SDK now produces its own validation-error wording.
    expect(at(result.content, 0).text).toMatch(/[Ii]nput validation error/);
  });

  // -----------------------------------------------------------------------
  // _meta envelope (Follow-up A from TDEE refactor): every successful tool
  // response carries `_meta.server_now` (ISO 8601 with offset, in the user's
  // tz) and `_meta.user_tz` (IANA tz). AI consumers use this to stay
  // anchored on wall-clock time without re-asking. Error envelopes are NOT
  // affected — their shape is its own contract.
  // -----------------------------------------------------------------------

  // ISO 8601 with offset, e.g. "2026-05-23T15:47:00-04:00" or "...+00:00".
  const SERVER_NOW_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

  it("stamps _meta.server_now and _meta.user_tz on a successful ping response", async () => {
    const fetchImpl = vi
      .fn()
      // Tool: GET /api/v1/health (ping handler)
      .mockResolvedValueOnce(mockJsonResponse(200, { ok: true, version: "test" }))
      // Dispatcher: GET /api/v1/users/me (one-shot tz lookup, cached after)
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, timezone: "America/Toronto" }));
    const client = await buildTestClient(fetchImpl);
    const result = await client.callTool({ name: "ping", arguments: {} });
    const body = JSON.parse(at(result.content, 0).text);
    expect(body).toMatchObject({ ok: true, version: "test" });
    expect(body._meta).toBeDefined();
    expect(body._meta.user_tz).toBe("America/Toronto");
    expect(body._meta.server_now).toMatch(SERVER_NOW_RE);
    // Sanity: the offset for Toronto is -04 (EDT) or -05 (EST), never +.
    expect(body._meta.server_now).toMatch(/-0[45]:00$/);
    // The stamp parses as a real Date.
    expect(new Date(body._meta.server_now).toString()).not.toBe("Invalid Date");
  });

  it("includes _meta on a read tool (get_active_phase) too", async () => {
    const phase = {
      id: 1,
      name: "cut",
      intent: "cut",
      phase_type: "cut",
      tdee_at_phase_start: 2400,
      tdee_source: "user_asserted",
      deficit_kcal: -500,
      daily_kcal_target: 1900,
      started_on: "2026-05-01",
    };
    const fetchImpl = vi
      .fn()
      // Tool: GET /api/v1/nutrition-phases/active
      .mockResolvedValueOnce(mockJsonResponse(200, phase))
      // Dispatcher: GET /api/v1/users/me
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, timezone: "UTC" }));
    const client = await buildTestClient(fetchImpl);
    const result = await client.callTool({ name: "get_active_phase", arguments: {} });
    const body = JSON.parse(at(result.content, 0).text);
    // Original payload is preserved verbatim alongside _meta.
    expect(body).toMatchObject(phase);
    expect(body._meta.user_tz).toBe("UTC");
    expect(body._meta.server_now).toMatch(SERVER_NOW_RE);
    expect(body._meta.server_now.endsWith("+00:00")).toBe(true);
  });

  it("falls back to UTC when the user's profile timezone is unset", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(200, { ok: true }))
      // Profile with timezone: null — dispatcher should default to UTC.
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, timezone: null }));
    const client = await buildTestClient(fetchImpl);
    const result = await client.callTool({ name: "ping", arguments: {} });
    const body = JSON.parse(at(result.content, 0).text);
    expect(body._meta.user_tz).toBe("UTC");
  });

  it("does NOT stamp _meta on a structured error envelope (ToolError pass-through)", async () => {
    // update_phase rejects an ambiguous single-field patch on the
    // (tdee, deficit, target) triple as a ToolError, BEFORE any API call.
    // Perfect smoke test for the error-pass-through path: no fetch needed.
    const fetchImpl = vi.fn();
    const client = await buildTestClient(fetchImpl);
    const result = await client.callTool({
      name: "update_phase",
      arguments: { phase_id: 1, tdee_at_phase_start: 2400 },
    });
    expect(result.isError).toBe(true);
    const body = JSON.parse(at(result.content, 0).text);
    // Error envelopes are their own contract — no _meta injection.
    expect(body._meta).toBeUndefined();
    // Confirm we hit the ambiguous-patch ToolError path, not some other error.
    expect(body.error).toBe("ambiguous_patch");
    // And no /api/v1/users/me call was made — dispatcher short-circuits on error.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does NOT stamp _meta on an unknown-tool isError envelope", async () => {
    const client = await buildTestClient(vi.fn());
    const result = await client.callTool({ name: "no_such_tool", arguments: {} });
    expect(result.isError).toBe(true);
    // Unknown-tool envelope is plain text, not JSON. Just make sure no _meta
    // leaked into the text payload.
    expect(at(result.content, 0).text).not.toContain("_meta");
    expect(at(result.content, 0).text).not.toContain("server_now");
  });

  it("caches the user_tz lookup across multiple tool calls", async () => {
    const fetchImpl = vi
      .fn()
      // Call 1: ping handler
      .mockResolvedValueOnce(mockJsonResponse(200, { ok: true }))
      // Call 1: dispatcher tz lookup
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 1, timezone: "America/Toronto" }))
      // Call 2: ping handler — no further tz lookup expected (cached).
      .mockResolvedValueOnce(mockJsonResponse(200, { ok: true }));
    const client = await buildTestClient(fetchImpl);
    await client.callTool({ name: "ping", arguments: {} });
    const result = await client.callTool({ name: "ping", arguments: {} });
    const body = JSON.parse(at(result.content, 0).text);
    expect(body._meta.user_tz).toBe("America/Toronto");
    // Exactly 3 fetches — 2 ping handlers + 1 tz lookup. If we did a tz
    // lookup per call we'd see 4.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("dispatches a read-tool call (get_today_context)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      mockJsonResponse(200, {
        today: {
          kcal_in: 1200,
          protein_g_in: 90,
          // Post-TDEE-refactor: structured target/maintenance/intake/observed.
          target: { kcal: 1900, protein_g: 150, carb_g: 200, fat_g: 60 },
          maintenance: { kcal: 2400 },
          intake: { kcal: 1200, protein_g: 90, carb_g: 120, fat_g: 40 },
          observed: {
            cardio_kcal: 0,
            workout_kcal: 0,
            vs_target: -700,
            vs_maintenance: -1200,
            status: "on_track",
          },
        },
      }),
    );
    // get_today_context also fetches /users/me for the about_me note.
    fetchImpl.mockResolvedValueOnce(mockJsonResponse(200, { about_me: null }));
    const client = await buildTestClient(fetchImpl);
    const result = await client.callTool({ name: "get_today_context", arguments: {} });
    expect(at(result.content, 0).type).toBe("text");
    const body = JSON.parse(at(result.content, 0).text);
    expect(body.today.kcal_in).toBe(1200);
  });
});
