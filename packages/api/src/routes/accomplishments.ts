import {
  AccomplishmentHistoryResponseSchema,
  AccomplishmentsResponseSchema,
} from "@almanac/core/schemas";
import { getAccomplishmentHistory, getRecentAccomplishments } from "@almanac/core/signals";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireUserId } from "../auth.js";

export const registerAccomplishmentsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/signals/accomplishments",
    { schema: { response: { 200: AccomplishmentsResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      return getRecentAccomplishments(app.db, userId);
    },
  );

  app.get(
    "/v1/signals/accomplishments/history",
    { schema: { response: { 200: AccomplishmentHistoryResponseSchema } } },
    async (req) => {
      const userId = requireUserId(req);
      return getAccomplishmentHistory(app.db, userId);
    },
  );
};
