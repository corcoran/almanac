import {
  type AgentUsage,
  assembleMealContext,
  buildInsightsSystemPrompt,
  type CreateMessage,
  computeCostUsd,
  computeDailyBalance,
  DEFAULT_AVG_TOKENS_BY_FEATURE,
  getSearchesForDay,
  getUsageForDay,
  INSIGHTS_TOOLS,
  type LlmConfig,
  makeInsightsDispatch,
  makeLookupPastMeals,
  perSearchPrice,
  recentAvgTokensPerCall,
  recordLlmUsage,
  runAgent,
  runMealAgent,
} from "@almanac/core/llm";
import {
  appendTurns,
  clearDay,
  findPriorDayTakeaway,
  listDaysWithTurns,
  listTurnsForDay,
} from "@almanac/core/repos";
import {
  DailyBalanceSchema,
  InsightsChatRequestSchema,
  InsightsChatResponseSchema,
  InsightsDaysResponseSchema,
  InsightsHistoryResponseSchema,
  MealChatRequestSchema,
  MealChatResponseSchema,
  type UsageSummary,
  type WebSource,
} from "@almanac/core/schemas";
import { assembleReport, buildReportMarkdown } from "@almanac/core/signals";
import { currentUserDate } from "@almanac/core/types";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { ApiError } from "../errors.js";
import { assertLlmEnabled } from "../llm-gate.js";

export type LlmDeps = {
  config: LlmConfig;
  createMessage: CreateMessage;
};

/**
 * Build the response `usage` summary from raw agent usage. Pure: the four
 * token/cache buckets feed both the response object and the cost computation,
 * so they're listed once here rather than triplicated at each call site.
 */
function toUsageSummary(
  provider: LlmConfig["provider"],
  model: string,
  usage: AgentUsage,
  webSearchRequests: number,
  sources: WebSource[],
): UsageSummary {
  const buckets = {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    cache_creation_tokens: usage.cache_creation_tokens,
  };
  return {
    ...buckets,
    web_search_requests: webSearchRequests,
    sources,
    cost_usd: computeCostUsd(provider, model, buckets),
    model,
  };
}

/**
 * Factory for the meal-chat route plugin. Closes over the LLM deps (config +
 * message-creator) so tests can inject a stub createMessage. Register with
 * `apiApp.register(makeLlmRoutes(deps))`.
 */
/** Optional `?date=YYYY-MM-DD`; an invalid value fails the schema → 422 (this
 *  repo's zod validator-compiler surfaces querystring validation as 422). */
const HistoryQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Optional `?feature=` selects which surface's per-log cost drives the
 *  "logs left" estimate; omitted → the legacy blended average. Invalid → 422. */
const UsageQuery = z.object({
  feature: z.enum(["meal_chat", "insights_chat"]).optional(),
});

export function makeLlmRoutes(deps: LlmDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      "/v1/llm/meal-chat",
      {
        schema: {
          body: MealChatRequestSchema,
          response: { 200: MealChatResponseSchema },
        },
      },
      async (req) => {
        const user = requireUser(app.db, req);
        assertLlmEnabled(deps.config, user);

        const today = currentUserDate(new Date(), user.timezone);

        // Hard backstop: a runaway circuit-breaker, separate from the advisory
        // soft limit (which never blocks). Only this hard cap stops the chat.
        const hardCap = deps.config.hardDailyTokenCap ?? null;
        if (hardCap !== null) {
          const day = getUsageForDay(app.db, user.id, user.timezone, today);
          if (day.billed_tokens >= hardCap) {
            throw new ApiError(
              429,
              "usage_limit_exceeded",
              "Daily AI usage cap reached. You can still log meals manually.",
            );
          }
        }

        // Web-search budget: enable the search tool UNLESS the daily search cap
        // is exhausted. Passed as a boolean (not a remaining count) so the tools
        // block stays byte-identical across requests — required for the system
        // prompt-cache to survive (see agent.ts PER_TURN_SEARCH_CEILING).
        const searchCap = deps.config.hardDailySearchCap;
        let searchEnabled = true;
        let searchNote: string | undefined;
        if (searchCap !== undefined) {
          const usedSearches = getSearchesForDay(app.db, user.id, user.timezone, today);
          if (usedSearches >= searchCap) {
            searchEnabled = false;
            searchNote = "Web search limit reached — I'll estimate without it.";
          }
        }

        const context = assembleMealContext(app.db, user);
        const { result, usage, sources } = await runMealAgent({
          createMessage: deps.createMessage,
          model: deps.config.model,
          context,
          history: req.body.history,
          message: req.body.message,
          lookupPastMeals: makeLookupPastMeals(app.db, user.id),
          searchEnabled,
        });

        // A search debits the budget the same as ONE ordinary chat turn — the
        // recent non-search average (flat fallback until there's history) — NOT
        // its raw tokens and NOT scaled by the search count. The web-result
        // bloat + per-search fee are subsidized (logged truthfully below, but
        // not billed); search volume is capped separately by hardDailySearchCap.
        // This keeps "logs left" honest: a search ≈ one log.
        const billedTokens =
          usage.web_search_requests > 0
            ? perSearchPrice(app.db, user.id, deps.config.tokensPerSearch)
            : usage.input_tokens + usage.output_tokens;

        recordLlmUsage(app.db, {
          userId: user.id,
          createdAt: new Date().toISOString(),
          provider: deps.config.provider,
          model: deps.config.model,
          feature: "meal_chat",
          usage,
          webSearchRequests: usage.web_search_requests,
          billedTokens,
        });

        const usageSummary = toUsageSummary(
          deps.config.provider,
          deps.config.model,
          usage,
          usage.web_search_requests,
          sources,
        );

        if (result.kind === "proposal") {
          return {
            kind: "proposal" as const,
            meals: result.meals,
            alcohol_sessions: result.alcoholSessions,
            usage: usageSummary,
            searchNote,
          };
        }
        return {
          kind: "question" as const,
          question: result.question,
          usage: usageSummary,
          searchNote,
        };
      },
    );

    app.post(
      "/v1/llm/insights-chat",
      {
        schema: {
          body: InsightsChatRequestSchema,
          response: { 200: InsightsChatResponseSchema },
        },
      },
      async (req) => {
        const user = requireUser(app.db, req);
        assertLlmEnabled(deps.config, user);
        const today = currentUserDate(new Date(), user.timezone);
        const onDate = req.body.on_date ?? today;

        const hardCap = deps.config.hardDailyTokenCap ?? null;
        if (hardCap !== null) {
          const day = getUsageForDay(app.db, user.id, user.timezone, today);
          if (day.billed_tokens >= hardCap) {
            throw new ApiError(429, "usage_limit_exceeded", "Daily AI usage cap reached.");
          }
        }

        const reportMd = buildReportMarkdown(assembleReport(app.db, user.id));
        // Cross-day continuity: the prior session's closing takeaway (relative to
        // the VIEWED day, so continuing a past day compares against ITS prior),
        // so the coach can contrast it with today's data instead of repeating the
        // same trend read. Only on the FIRST turn of a conversation — once the
        // user is mid-thread, the in-conversation history already carries context.
        const priorTakeaway =
          req.body.history.length === 0 ? findPriorDayTakeaway(app.db, user.id, onDate) : null;
        const { stable: insightsStable, volatile: insightsVolatile } = buildInsightsSystemPrompt(
          reportMd,
          { today, conversationDate: onDate },
          priorTakeaway,
          user.about_me,
        );
        const { result, usage, sources } = await runAgent<string>({
          createMessage: deps.createMessage,
          model: deps.config.insightsModel,
          system: insightsStable,
          volatileSystem: insightsVolatile,
          tools: INSIGHTS_TOOLS,
          history: req.body.history,
          message: req.body.message,
          searchEnabled: false,
          toolChoice: "auto",
          dispatch: makeInsightsDispatch(app.db, user.id, user.timezone, new Date()),
          onNoTerminalTool: (text) => text ?? "I couldn't generate an analysis just now.",
        });

        const billedTokens = usage.input_tokens + usage.output_tokens;
        recordLlmUsage(app.db, {
          userId: user.id,
          createdAt: new Date().toISOString(),
          provider: deps.config.provider,
          model: deps.config.insightsModel,
          feature: "insights_chat",
          usage,
          webSearchRequests: 0,
          billedTokens,
        });

        appendTurns(
          app.db,
          user.id,
          onDate,
          [
            { role: "user", content: req.body.message },
            { role: "assistant", content: result, sources },
          ],
          new Date().toISOString(),
        );

        return {
          kind: "answer" as const,
          text: result,
          usage: toUsageSummary(deps.config.provider, deps.config.insightsModel, usage, 0, sources),
        };
      },
    );

    app.get(
      "/v1/llm/usage",
      { schema: { querystring: UsageQuery, response: { 200: DailyBalanceSchema } } },
      async (req) => {
        const user = requireUser(app.db, req);
        assertLlmEnabled(deps.config, user);
        const today = currentUserDate(new Date(), user.timezone);
        const day = getUsageForDay(app.db, user.id, user.timezone, today);

        // Per-surface per-log cost: each chat panel's "logs left" reflects ITS
        // own average against the shared remaining budget. No feature → blended
        // (back-compat). No history for the feature → its per-feature default.
        const feature = req.query.feature;
        const recentAvg = recentAvgTokensPerCall(
          app.db,
          user.id,
          feature ? { feature } : undefined,
        );
        const avg = recentAvg ?? (feature ? DEFAULT_AVG_TOKENS_BY_FEATURE[feature] : null);

        return computeDailyBalance({
          tokensUsedToday: day.billed_tokens,
          callsToday: day.calls,
          recentAvgTokensPerCall: avg,
          softLimitTokens: user.llm_daily_token_limit ?? deps.config.defaultDailyTokenLimit ?? null,
          hardCapTokens: deps.config.hardDailyTokenCap ?? null,
          resetsAtLabel: "4am",
        });
      },
    );

    app.get(
      "/v1/llm/insights-chat/history",
      {
        schema: {
          querystring: HistoryQuery,
          response: { 200: InsightsHistoryResponseSchema },
        },
      },
      async (req) => {
        const user = requireUser(app.db, req);
        assertLlmEnabled(deps.config, user);
        const onDate = req.query.date ?? currentUserDate(new Date(), user.timezone);
        return { on_date: onDate, turns: listTurnsForDay(app.db, user.id, onDate) };
      },
    );

    app.get(
      "/v1/llm/insights-chat/days",
      { schema: { response: { 200: InsightsDaysResponseSchema } } },
      async (req) => {
        const user = requireUser(app.db, req);
        assertLlmEnabled(deps.config, user);
        return { days: listDaysWithTurns(app.db, user.id) };
      },
    );

    app.delete(
      "/v1/llm/insights-chat/history",
      { schema: { querystring: HistoryQuery } },
      async (req, reply) => {
        const user = requireUser(app.db, req);
        assertLlmEnabled(deps.config, user);
        const onDate = req.query.date ?? currentUserDate(new Date(), user.timezone);
        clearDay(app.db, user.id, onDate);
        reply.code(204).send();
      },
    );
  };
}
