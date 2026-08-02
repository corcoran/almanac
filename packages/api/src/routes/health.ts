import { appliedVersions } from "@almanac/core/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { API_VERSION, GIT_SHA } from "../version.js";

export const registerHealthRoutes: FastifyPluginAsyncZod = async (app) => {
  // `config.quietLog` demotes these probes' request log to debug (see the
  // onResponse hook in server.ts), so health-check / version polling stays out
  // of the default info stream but reappears at ALMANAC_LOG_LEVEL=debug.
  app.get("/v1/health", { config: { quietLog: true } }, async () => ({
    ok: true,
    migrations_applied: appliedVersions(app.db).length,
    version: API_VERSION,
    commit: GIT_SHA,
  }));
  app.get("/v1/version", { config: { quietLog: true } }, async () => ({
    version: API_VERSION,
    commit: GIT_SHA,
  }));
};
