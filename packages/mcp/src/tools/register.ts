import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Tool, type ToolDeps, ToolError } from "../tool.js";

/**
 * Format the current wall-clock time as ISO 8601 with offset, in the user's
 * timezone. Used by the dispatcher to stamp `_meta.server_now` on every
 * successful tool response so AI consumers stay anchored on real time without
 * having to ask.
 *
 * Falls back to UTC ("+00:00") if `tz` is invalid for the runtime's ICU.
 */
export function formatServerNow(tz: string, now: Date = new Date()): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "longOffset",
    }).formatToParts(now);
  } catch {
    // Invalid tz — fall back to UTC.
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "longOffset",
    }).formatToParts(now);
  }
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const yyyy = get("year");
  const mm = get("month");
  const dd = get("day");
  // Intl quirk under hour12:false: midnight may be reported as "24".
  let hh = get("hour");
  if (hh === "24") hh = "00";
  const mi = get("minute");
  const ss = get("second");
  // timeZoneName "longOffset" produces e.g. "GMT-04:00" — for UTC it's "GMT".
  const tzName = get("timeZoneName");
  const stripped = tzName.replace(/^GMT/, "");
  const offset = stripped === "" ? "+00:00" : stripped;
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${offset}`;
}

/**
 * Resolves the user's IANA timezone for the `_meta` envelope, memoized.
 *
 * The cache has no TTL by design: a timezone changes only when the user
 * writes their profile, and that write calls `invalidate()`. A TTL would
 * leave a stale window for no benefit. Without invalidation this cached for
 * the entire process lifetime, so `_meta.user_tz` served the first value
 * ever resolved until the client reconnected.
 */
export type UserTzResolver = {
  get: () => Promise<string>;
  invalidate: () => void;
};

export function makeUserTzResolver(deps: ToolDeps): UserTzResolver {
  let cached: string | undefined;
  return {
    get: async () => {
      if (cached !== undefined) return cached;
      try {
        const user = await deps.api.request<{ timezone?: string | null }>(
          "GET",
          "/api/v1/users/me",
          undefined,
          { bearer: deps.currentToken() },
        );
        const tz = user?.timezone;
        cached = typeof tz === "string" && tz.length > 0 ? tz : "UTC";
      } catch {
        cached = "UTC";
      }
      return cached;
    },
    invalidate: () => {
      cached = undefined;
    },
  };
}

/**
 * Inject the `_meta` envelope (server_now + user_tz) into a tool's result
 * payload. Most tools return a JSON object — we attach `_meta` as a top-level
 * key. For non-object results (string, array, null), we wrap into
 * `{ result, _meta }` so the meta block is still observable without losing
 * the original payload.
 */
function withMeta(payload: unknown, meta: { server_now: string; user_tz: string }): unknown {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { result: payload, _meta: meta };
  }
  return { ...(payload as Record<string, unknown>), _meta: meta };
}

/**
 * Register one `Tool` onto an `McpServer`, preserving the two cross-cutting
 * behaviors the SDK does NOT do for us:
 *   1. `_meta.server_now` + `_meta.user_tz` stamped on every SUCCESSFUL result.
 *   2. `ToolError` -> structured `isError` text envelope (no _meta).
 *
 * The SDK handles name routing and Zod input validation (config.inputSchema),
 * so this callback only sees already-parsed `args`. Validation failures are
 * turned into the SDK's own `isError` envelope before we're called.
 */
export function registerOneTool(
  server: McpServer,
  tool: Tool<unknown>,
  getUserTz: () => Promise<string>,
): void {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    },
    async (args: unknown) => {
      try {
        const result = await tool.handler(args);
        const userTz = await getUserTz();
        const enriched = withMeta(result, {
          server_now: formatServerNow(userTz),
          user_tz: userTz,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(enriched) }] };
      } catch (err) {
        if (err instanceof ToolError) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(err.payload) }],
            isError: true,
          };
        }
        throw err;
      }
    },
  );
}
