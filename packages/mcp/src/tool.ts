import type { z } from "zod";

/**
 * MCP tool annotations, mirrored from the SDK 1.x ToolAnnotationsSchema.
 * Clients (Claude Desktop, Claude Code, ChatGPT Apps SDK) use these to
 * decide whether to prompt-confirm before invoking a tool, whether to
 * surface it as "read" vs "write", and whether to skip caching.
 *
 *   readOnlyHint    — tool does NOT change anything in the user's data.
 *                     Read tools. Clients can skip the "are you sure?"
 *                     prompt entirely.
 *   destructiveHint — tool can DELETE or overwrite user data in ways
 *                     that aren't easily undone. Triggers stronger
 *                     warning UI. Only set true when really destructive
 *                     (deletes, full-record overwrites — not patches).
 *   idempotentHint  — calling the same tool with the same input again
 *                     produces the same result with no side effects.
 *                     Used by retry / cache layers.
 *   openWorldHint   — tool touches state outside the server's own
 *                     domain (e.g., third-party APIs). Always false for
 *                     Almanac — everything lives in our SQLite.
 */
export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type Tool<I> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  annotations?: ToolAnnotations;
  handler: (input: I) => Promise<unknown>;
};

export type ToolDeps = {
  api: import("./client.js").ApiClient;
  currentUserId: () => Promise<number>;
  /**
   * Returns the bearer captured at MCP connection time (SSE) or from the
   * stdio operator's env (`ALMANAC_MCP_CLIENT_TOKEN`). Tool handlers pass
   * the result to `api.request(..., { bearer: deps.currentToken() })` on
   * every outbound call. The MCP SDK hides HTTP details from
   * `CallToolRequest`, so closing over the bearer in this getter is how we
   * thread per-session credentials through to the API.
   *
   * Bearer token for API calls. Captured at connection-start time and
   * returned synchronously from this getter — there's no async lookup
   * because MCP sessions present credentials once on connect. Do NOT
   * change to `() => Promise<string>` without also revisiting whether
   * refresh semantics need to be added across all tool factories.
   */
  currentToken: () => string;
};

/**
 * Throw from a tool handler to surface a structured `isError: true` MCP
 * envelope to the client (instead of a generic exception). The `payload` is
 * serialized into the text content verbatim — used for pass-through of
 * structured API error envelopes (e.g., the 422 `tdee_unavailable` envelope
 * from `POST /api/v1/nutrition-phases`) and for MCP-side validation errors
 * (e.g., the coherence-rule rejection in `update_phase`).
 *
 * The dispatcher in `tools/index.ts` catches this and emits:
 *   { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true }
 */
export class ToolError extends Error {
  readonly payload: unknown;
  constructor(payload: unknown, message?: string) {
    super(
      message ??
        (typeof payload === "object" && payload !== null && "error" in payload
          ? String((payload as { error: unknown }).error)
          : "tool error"),
    );
    this.name = "ToolError";
    this.payload = payload;
  }
}
