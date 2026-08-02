import { ShareReportSchema } from "@almanac/core/schemas";
import { assembleReport } from "@almanac/core/signals";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireUser } from "../auth.js";

/**
 * GET /v1/report — the assembled LLM-share report (today's full context, a
 * 14-day per-day macros grid, and a workout-window summary). All assembly logic
 * lives in `assembleReport` (core); this route is a thin DB → signal wrapper.
 */
export const registerReportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/v1/report", { schema: { response: { 200: ShareReportSchema } } }, async (req) => {
    const user = requireUser(app.db, req);
    return assembleReport(app.db, user.id, new Date());
  });
};
