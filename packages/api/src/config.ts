import { readFileSync } from "node:fs";
import { z } from "zod";

const ConfigSchema = z.object({
  ALMANAC_DB_PATH: z.string().default("./data/almanac.sqlite"),
  ALMANAC_API_PORT: z.coerce.number().int().positive().default(3001),
  ALMANAC_API_HOST: z.string().default("127.0.0.1"),
  ALMANAC_TRUST_PROXY_HEADERS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  ALMANAC_FIRST_LOGIN_EMAIL: z.string().optional(),
  // File path or comma-separated list of emails allowed to auto-provision.
  // When empty/unset, any authenticated email can create an account.
  ALMANAC_ALLOWED_EMAILS: z.string().optional(),
  // Drives log format + default level. "production" → JSON at info; anything
  // else → pretty-printed at debug. Standard Node convention.
  NODE_ENV: z.string().optional(),
  // Pino level override. Falls back to debug (dev) / info (prod) when unset.
  // Coerce empty string (blank/commented .env entry) to undefined so it takes
  // the default rather than failing the enum check.
  ALMANAC_LOG_LEVEL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  ),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse(env);
}

export function loadAllowedEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  if (raw.startsWith("/") || raw.startsWith("./")) {
    try {
      const content = readFileSync(raw, "utf-8");
      return new Set(
        content
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#")),
      );
    } catch {
      console.error(`WARNING: Could not read allowed-emails file ${raw}`);
      return new Set();
    }
  }
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean),
  );
}
