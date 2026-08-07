import { backfillDailyNet, runOnce } from "@almanac/core/bootstrap";
import { backupBeforeMigrations, type Connection, openDb, runMigrations } from "@almanac/core/db";
import {
  type CreateMessage,
  createAnthropicClient,
  type LlmConfig,
  loadLlmConfig,
} from "@almanac/core/llm";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { ZodError } from "zod";
import { makeAuthPreHandler } from "./auth.js";
import { ApiError, toErrorBody } from "./errors.js";
import { registerIdempotency } from "./idempotency.js";
import { registerAccomplishmentsRoutes } from "./routes/accomplishments.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAlcoholRoutes } from "./routes/alcohol.js";
import { makeAuthRoutes } from "./routes/auth.js";
import { registerBodyWeightsRoutes } from "./routes/body-weights.js";
import { registerCalendarRoutes } from "./routes/calendar.js";
import { registerCardioRoutes } from "./routes/cardio.js";
import { registerExerciseGroupsRoutes } from "./routes/exercise-groups.js";
import { registerExercisesRoutes } from "./routes/exercises.js";
import { registerHealthRoutes } from "./routes/health.js";
import { makeLlmRoutes } from "./routes/llm.js";
import { registerMacrosRoutes } from "./routes/macros.js";
import { registerMealsRoutes } from "./routes/meals.js";
import { registerNutritionPhasesRoutes } from "./routes/nutrition-phases.js";
import { registerReportRoutes } from "./routes/report.js";
import { registerSignalsRoutes } from "./routes/signals.js";
import { registerSleepRoutes } from "./routes/sleep.js";
import { registerStepLogsRoutes } from "./routes/step-logs.js";
import { registerStoredMealsRoutes } from "./routes/stored-meals.js";
import { registerUntrackedPeriodsRoutes } from "./routes/untracked-periods.js";
import { registerUsersRoutes } from "./routes/users.js";
import { registerWorkoutTemplatesRoutes } from "./routes/workout-templates.js";
import { registerWorkoutsRoutes } from "./routes/workouts.js";
import { RELEASE_TAG } from "./version.js";

// Module augmentation: declare `app.db` on every `FastifyInstance` reachable
// from this app. Route handlers and tests reference `app.db` directly — this
// is what makes the type stick.
declare module "fastify" {
  interface FastifyInstance {
    db: Connection;
  }
  // Route config flag — set `config: { quietLog: true }` to demote that route's
  // request log to debug (used by the health/version probes; see the
  // onResponse hook below).
  interface FastifyContextConfig {
    quietLog?: boolean;
  }
}

export type AppOptions = {
  dbPath: string;
  trustProxyHeaders: boolean;
  allowedEmails?: Set<string>;
  // `false` disables logging (tests). An options object configures pino
  // (format/level/serializers — see logger.ts). `true` uses Fastify defaults.
  logger?: boolean | FastifyServerOptions["logger"];
  /**
   * LLM wiring. Omit in production to build from env (loadLlmConfig + the real
   * Anthropic client); tests inject a stub createMessage + explicit config.
   */
  llm?: {
    config: LlmConfig;
    createMessage: CreateMessage;
  };
};

/** Fastify error object exposed by validation failures has a `validation` array. */
type FastifyValidationError = Error & {
  validation?: unknown[];
  validationContext?: string;
  code?: string;
};

/**
 * Build LLM deps from environment config. The real Anthropic client is only
 * constructed when enabled + keyed; otherwise createMessage throws (the route
 * guard 403s before it is ever called, so this is just defense-in-depth).
 */
function buildLlmDepsFromEnv(): { config: LlmConfig; createMessage: CreateMessage } {
  const config = loadLlmConfig();
  const createMessage: CreateMessage =
    config.enabled && config.apiKey
      ? async (args) => {
          const client = createAnthropicClient(config.apiKey);
          return (await client.messages.create(
            args as Parameters<typeof client.messages.create>[0],
          )) as Awaited<ReturnType<CreateMessage>>;
        }
      : async () => {
          throw new Error("LLM not configured");
        };
  return { config, createMessage };
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? false,
    // We log one rich line per request via the onResponse hook below (which
    // runs after auth, so it has userId), instead of Fastify's default
    // incoming+completed pair. See logger.ts.
    disableRequestLogging: true,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Fastify 5 rejects an empty body when `content-type: application/json` is
  // set (FST_ERR_CTP_EMPTY_JSON_BODY), which breaks bodyless requests that
  // still carry that header — notably DELETEs from clients/proxies that set it
  // unconditionally. Restore Fastify 4's lenient behavior: treat an empty body
  // as `undefined` rather than a parse error.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = body as string;
    if (text.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const db = openDb(opts.dbPath);
  const backupPath = backupBeforeMigrations(db, { dbPath: opts.dbPath, tag: RELEASE_TAG });
  if (backupPath !== null) app.log.info({ backup: backupPath }, "pre-migration snapshot written");
  runMigrations(db);

  // Re-snapshots every intake day's frozen daily_net via computeTdeeAsOf.
  // Idempotent + run-once: skipped on every subsequent boot.
  runOnce(db, "net_recompute_2026_06_robust_slope", (d) => backfillDailyNet(d));

  app.decorate("db", db);

  const llmDeps = opts.llm ?? buildLlmDepsFromEnv();

  // One structured log line per completed request. Fires in onResponse —
  // after the auth preHandler — so `req.userId` is resolved. `reply.elapsedTime`
  // is Fastify's own timer.
  //
  // Level: `error` for 5xx (failures always surface); `debug` for routes
  // flagged `config.quietLog` (health/version probes — hidden at the default
  // info level, visible at ALMANAC_LOG_LEVEL=debug); `info` otherwise. The
  // root logger level gates these, so quiet routes truly vanish in prod.
  app.addHook("onResponse", async (req, reply) => {
    const level =
      reply.statusCode >= 500 ? "error" : req.routeOptions.config?.quietLog ? "debug" : "info";
    req.log[level](
      {
        method: req.method,
        url: req.url,
        statusCode: reply.statusCode,
        responseTime: Math.round(reply.elapsedTime),
        userId: req.userId,
      },
      "request completed",
    );
  });

  // API responses must never be cached by the browser or any intermediary —
  // every GET reflects live user data, and a stale cached response (e.g. an
  // accomplishment message from before a deploy) silently serves wrong data.
  // `no-store` is the simplest guarantee: never cache, never revalidate-from-cache.
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  // Idempotency hooks live at the root level so test routes registered
  // outside the `/api` scope (e.g. `app.post(...)` directly in unit tests)
  // still get the cache behavior. Production routes opt in via
  // `config: { idempotent: true }` on each route — the hook is otherwise
  // a no-op, so it doesn't matter where it's registered.
  registerIdempotency(app, db);

  // All routes live under a `/api` prefix. oauth2-proxy in front of the API
  // does NOT strip its own `--upstream=http://almanac-api:3001/api/` prefix
  // — it forwards the path verbatim — so the API has to own that segment.
  // Internal callers (smoke script, MCP) hit `http://almanac-api:3001/api/v1/*`
  // too. The auth preHandler is registered INSIDE the prefixed scope so its
  // PUBLIC_PATHS allowlist sees the prefixed paths (`/api/v1/health` etc.) and
  // it only applies to API routes.
  void app.register(
    async (apiApp) => {
      apiApp.register(registerHealthRoutes);
      apiApp.addHook(
        "preHandler",
        makeAuthPreHandler({
          db,
          trustProxyHeaders: opts.trustProxyHeaders,
          allowedEmails: opts.allowedEmails ?? new Set(),
        }),
      );
      apiApp.register(registerUsersRoutes);
      apiApp.register(makeAuthRoutes(llmDeps.config));
      apiApp.register(registerAdminRoutes);
      apiApp.register(registerExerciseGroupsRoutes);
      apiApp.register(registerExercisesRoutes);
      apiApp.register(registerWorkoutTemplatesRoutes);
      apiApp.register(registerBodyWeightsRoutes);
      apiApp.register(registerMealsRoutes);
      apiApp.register(makeLlmRoutes(llmDeps));
      apiApp.register(registerStoredMealsRoutes);
      apiApp.register(registerNutritionPhasesRoutes);
      apiApp.register(registerCardioRoutes);
      apiApp.register(registerSleepRoutes);
      apiApp.register(registerStepLogsRoutes);
      apiApp.register(registerUntrackedPeriodsRoutes);
      apiApp.register(registerAlcoholRoutes);
      apiApp.register(registerWorkoutsRoutes);
      apiApp.register(registerSignalsRoutes);
      apiApp.register(registerReportRoutes);
      apiApp.register(registerAccomplishmentsRoutes);
      apiApp.register(registerMacrosRoutes);
      apiApp.register(registerCalendarRoutes);
    },
    { prefix: "/api" },
  );

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) {
      reply.code(err.status).send(toErrorBody(err));
      return;
    }
    // Zod-validated input failures arrive as a `ZodError` thrown by the
    // fastify-type-provider-zod validator. Fastify tags it with
    // `code === 'FST_ERR_VALIDATION'` but does NOT set `.validation` (because
    // the ZodError is already an Error instance — see Fastify's wrapValidationError).
    // We accept both the canonical `.validation` array path AND the
    // FST_ERR_VALIDATION+ZodError shape.
    const fastifyErr = err as FastifyValidationError;
    if (fastifyErr.validation !== undefined) {
      reply.code(422).send({
        error: {
          code: "validation_failed",
          message: "Invalid request",
          details: fastifyErr.validation,
        },
      });
      return;
    }
    if (err instanceof ZodError || fastifyErr.code === "FST_ERR_VALIDATION") {
      const issues = err instanceof ZodError ? err.issues : undefined;
      reply.code(422).send({
        error: {
          code: "validation_failed",
          message: "Invalid request",
          details: issues ?? fastifyErr.message,
        },
      });
      return;
    }
    reply.code(500).send({
      error: { code: "internal", message: fastifyErr.message },
    });
  });

  // Close the DB when the server closes (graceful shutdown + test teardown).
  app.addHook("onClose", async (instance) => {
    instance.db.close();
  });

  return app;
}
