import type { PinoLoggerOptions } from "fastify/types/logger.js";

/**
 * Build the Fastify/pino logger options.
 *
 * - **Format**: pretty-printed (colorized, one line per request) in dev;
 *   structured JSON in production for log aggregation. Selected by `isProd`.
 * - **Level**: explicit `level` wins; otherwise `info` in prod, `debug` in dev.
 *
 * Request logging is handled by a single `onResponse` hook (see server.ts)
 * rather than Fastify's default two-line incoming/completed pair — that hook
 * fires after auth, so it can include the resolved `userId`, and it's one line
 * instead of two. Fastify's built-in request logging is disabled via
 * `disableRequestLogging` where the app is built.
 */
export function buildLoggerOptions(opts: { isProd: boolean; level?: string }): PinoLoggerOptions {
  const level = opts.level ?? (opts.isProd ? "info" : "debug");

  if (opts.isProd) return { level };

  // Dev: route logs through pino-pretty for human-readable output. Self-
  // contained (no shell piping needed) so `pnpm dev:api` is pretty by default.
  return {
    level,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname,reqId",
      },
    },
  };
}
