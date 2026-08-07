import { z } from "zod";
import { validateIssuerUrl } from "./oidc.js";

const ConfigSchema = z
  .object({
    ALMANAC_API_URL: z.string().url().default("http://127.0.0.1:3001"),
    // `sse` is deprecated per the 2025-03-26 MCP spec rev; kept as a fallback
    // for existing .env files.
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
    // Blank coerces to undefined — compose passes `${VAR:-}` when unset, and
    // the all-or-nothing gate must treat that as absent.
    ALMANAC_MCP_OAUTH_CLIENT_ID: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().optional(),
    ),
    ALMANAC_MCP_OAUTH_CLIENT_SECRET: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().optional(),
    ),
    // Public URL of this MCP server (e.g. https://almanac.example.com).
    // Used as the OAuth issuer URL and to construct the Google redirect URI.
    // Blank coerces to undefined before .url() runs — blank means PAT-only.
    ALMANAC_MCP_PUBLIC_URL: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().url().optional(),
    ),
    // Shared email allowlist — file path or comma-separated emails.
    // Same var as the API uses. Falls back to ALMANAC_MCP_ALLOWED_EMAILS
    // for backward compatibility.
    ALMANAC_ALLOWED_EMAILS: z.string().optional(),
    ALMANAC_MCP_ALLOWED_EMAILS: z.string().optional(),
    // OIDC issuer URL for multi-provider OAuth support. When present, enables
    // OAuth authorization flow. Empty string coerces to undefined: compose passes
    // `${ALMANAC_MCP_OIDC_ISSUER:-}` (blank when unset), and a blank value means
    // "OAuth disabled, PAT-only" — it must not fail validation.
    ALMANAC_MCP_OIDC_ISSUER: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),

    // OAuth redirect callback path (e.g. /oauth/callback). Must start with /,
    // carry no query string or fragment, and have no trailing slash.
    // Defaults to /oauth/callback.
    //
    // Two shapes the character-class regex alone would let through, both of
    // which break login rather than merely looking odd:
    //   - a leading "//" ("//evil.com") — Express registers it literally, and
    //     it reads as a protocol-relative URL to anything that concatenates it.
    //   - a ".." segment ("/oauth/../../x") — Express matches the literal
    //     string, but the browser normalizes the redirect target to "/x", so
    //     the IdP's callback 404s and sign-in dead-ends.
    ALMANAC_MCP_OAUTH_CALLBACK_PATH: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z
        .string()
        .regex(/^\/[A-Za-z0-9\-._~/]*[A-Za-z0-9\-._~]$/, {
          message:
            "ALMANAC_MCP_OAUTH_CALLBACK_PATH must start with '/', carry no query " +
            "string or fragment, and have no trailing slash (e.g. /oauth/callback)",
        })
        .refine((p) => !p.startsWith("//"), {
          message:
            "ALMANAC_MCP_OAUTH_CALLBACK_PATH must not start with '//' " +
            "(that reads as a protocol-relative URL, not a path)",
        })
        .refine((p) => !p.split("/").includes(".."), {
          message:
            "ALMANAC_MCP_OAUTH_CALLBACK_PATH must not contain a '..' path segment " +
            "(browsers normalize it away, so the callback route would never match)",
        })
        .default("/oauth/callback"),
    ),
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

    // All-or-nothing OAuth gate: the four OAuth vars must be either ALL present
    // or ALL absent. Half-configured deployments must fail loudly at boot, not
    // silently degrade to PAT-only mode (which looks identical to an intentional
    // PAT-only deploy).
    const oauthVars = {
      ALMANAC_MCP_OAUTH_CLIENT_ID: cfg.ALMANAC_MCP_OAUTH_CLIENT_ID,
      ALMANAC_MCP_OAUTH_CLIENT_SECRET: cfg.ALMANAC_MCP_OAUTH_CLIENT_SECRET,
      ALMANAC_MCP_PUBLIC_URL: cfg.ALMANAC_MCP_PUBLIC_URL,
      ALMANAC_MCP_OIDC_ISSUER: cfg.ALMANAC_MCP_OIDC_ISSUER,
    };
    const presentVars = Object.entries(oauthVars).filter(([, value]) => value !== undefined);
    const absentVars = Object.entries(oauthVars).filter(([, value]) => value === undefined);

    // If some but not all are present, fail with an issue naming each missing one.
    if (presentVars.length > 0 && absentVars.length > 0) {
      for (const [varName] of absentVars) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [varName],
          message: `${varName} is required when any OAuth var is set (all four must be present or all absent)`,
        });
      }
    }

    // Validate the issuer URL if present.
    if (cfg.ALMANAC_MCP_OIDC_ISSUER !== undefined) {
      try {
        validateIssuerUrl(cfg.ALMANAC_MCP_OIDC_ISSUER);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ALMANAC_MCP_OIDC_ISSUER"],
          message: err instanceof Error ? err.message : "Invalid OIDC issuer URL",
        });
      }
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse(env);
}
