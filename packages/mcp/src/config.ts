import { z } from "zod";

const ConfigSchema = z
  .object({
    ALMANAC_API_URL: z.string().url().default("http://127.0.0.1:3001"),
    // `sse` is deprecated per the 2025-03-26 MCP spec rev. The default flips
    // to `http` (Streamable HTTP) in Task 6; `sse` is retained as a fallback
    // for existing .env files until Task 13 retires it entirely.
    ALMANAC_MCP_TRANSPORT: z.enum(["stdio", "sse", "http"]).default("http"),
    // HTTP-listener fields (used by both `sse` and `http`). We keep them on
    // the base schema (rather than a discriminated union) because most
    // operators set them in .env even when running stdio, and we don't want
    // to surface confusing validation errors. The stdio runtime simply
    // ignores them.
    ALMANAC_MCP_PORT: z.coerce.number().int().positive().default(3030),
    ALMANAC_MCP_HOST: z.string().default("127.0.0.1"),
    // The PAT this MCP process uses to authenticate its API calls. ONLY
    // consumed when ALMANAC_MCP_TRANSPORT=stdio — stdio has no incoming
    // HTTP request to extract a bearer from, so the env var is the process's
    // identity. For `http` and `sse`, each client connection brings its own
    // bearer in the Authorization header (validated by the API against
    // `personal_access_tokens`); this env var is unread there.
    ALMANAC_MCP_CLIENT_TOKEN: z.string().min(8).optional(),

    // OAuth 2.1 — used when ALMANAC_MCP_TRANSPORT=http to let Claude mobile /
    // ChatGPT connect via the standard MCP OAuth discovery flow. Reuses the
    // same Google OAuth credentials as oauth2-proxy.
    ALMANAC_MCP_OAUTH_CLIENT_ID: z.string().optional(),
    ALMANAC_MCP_OAUTH_CLIENT_SECRET: z.string().optional(),
    // Public URL of this MCP server (e.g. https://almanac.example.com).
    // Used as the OAuth issuer URL and to construct the Google redirect URI.
    // Empty string is coerced to undefined first: compose passes
    // `${ALMANAC_MCP_PUBLIC_URL:-}` (blank when unset), and per the OAuth gate
    // in index.ts a blank value means "OAuth disabled, PAT-only" — it must not
    // fail .url() validation. Mirrors how the blank OAuth client vars behave.
    ALMANAC_MCP_PUBLIC_URL: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().url().optional(),
    ),
    // Shared email allowlist — file path or comma-separated emails.
    // Same var as the API uses. Falls back to ALMANAC_MCP_ALLOWED_EMAILS
    // for backward compatibility.
    ALMANAC_ALLOWED_EMAILS: z.string().optional(),
    ALMANAC_MCP_ALLOWED_EMAILS: z.string().optional(),
  })
  .superRefine((cfg, ctx) => {
    // ALMANAC_MCP_CLIENT_TOKEN: stdio mode threads this directly to API calls
    // (stdio has no incoming HTTP request to extract a bearer from). For http
    // and sse, the bearer comes from the incoming Authorization header — the
    // env var is not consumed there.
    if (cfg.ALMANAC_MCP_TRANSPORT === "stdio" && !cfg.ALMANAC_MCP_CLIENT_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ALMANAC_MCP_CLIENT_TOKEN"],
        message:
          "ALMANAC_MCP_CLIENT_TOKEN is required when ALMANAC_MCP_TRANSPORT=stdio " +
          "(it's the PAT this MCP process uses for API calls). Mint a PAT via " +
          "the web Settings UI and set it here.",
      });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse(env);
}
