import type { Connection } from "@almanac/core/db";
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
  notesFromReply,
  perSearchPrice,
  recentTypicalTokensPerCall,
  recordLlmUsage,
  resolveDailyLimits,
  runAgent,
  runMealAgent,
  stripLookupsLine,
} from "@almanac/core/llm";
import {
  appendTurns,
  clearDay,
  countPointsForTurn,
  findPriorDayTakeaway,
  getTurnForHelpful,
  insertPoints,
  listDaysWithTurns,
  listRecentPoints,
  listTurnsForDay,
  setTurnHelpful,
} from "@almanac/core/repos";
import {
  DailyBalanceSchema,
  InsightsChatRequestSchema,
  InsightsChatResponseSchema,
  InsightsDaysResponseSchema,
  InsightsHelpfulRequestSchema,
  InsightsHistoryResponseSchema,
  MealChatRequestSchema,
  MealChatResponseSchema,
  type UsageSummary,
  type WebSource,
} from "@almanac/core/schemas";
import { assembleReport, buildReportMarkdown } from "@almanac/core/signals";
import { currentUserDate, localClockTime, type User } from "@almanac/core/types";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { ApiError } from "../errors.js";
import { assertLlmEnabled } from "../llm-gate.js";
import { IdParamsSchema } from "../params.js";

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

/** Earlier coach turn as replayed to the model, with its lookups as a system note. */
function toReplayTurn(t: { role: "user" | "assistant"; content: string; lookups?: string[] }): {
  role: "user" | "assistant";
  content: string;
  note?: string;
} {
  if (t.role !== "assistant") return { role: t.role, content: t.content };
  const content = stripLookupsLine(t.content);
  if (t.lookups === undefined) return { role: t.role, content };
  const note =
    t.lookups.length > 0
      ? `Lookups behind the next reply: ${t.lookups.join("; ")}`
      : "The next reply used only the overview; no lookups.";
  return { role: t.role, content, note };
}

const NO_ANALYSIS_TEXT = "I couldn't generate an analysis just now.";

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

const INSIGHTS_MAX_TOKENS = 16000;
const INSIGHTS_MAX_ITERATIONS = 8;
const POINTS_WINDOW_DAYS = 60;
const POINTS_LIMIT = 30;

/**
 * Web-search budget: search stays enabled UNLESS the daily search cap is
 * exhausted. A boolean (not a remaining count) keeps the tools block
 * byte-identical across requests, which the system prompt-cache requires.
 */
function resolveSearch(
  db: Connection,
  config: LlmConfig,
  user: { id: number; timezone: string },
  today: string,
): { searchEnabled: boolean; searchNote?: string } {
  const cap = config.hardDailySearchCap;
  if (cap !== undefined && getSearchesForDay(db, user.id, user.timezone, today) >= cap) {
    return {
      searchEnabled: false,
      searchNote: "Web search limit reached — I'll estimate without it.",
    };
  }
  return { searchEnabled: true };
}

/**
 * Factory for the meal-chat route plugin. Closes over the LLM deps (config +
 * message-creator) so tests can inject a stub createMessage. Register with
 * `apiApp.register(makeLlmRoutes(deps))`.
 */
export function makeLlmRoutes(deps: LlmDeps): FastifyPluginAsyncZod {
  return async (app) => {
    /** Best-effort: a failure leaves the helpful flag saved and no notes written. */
    async function writeNotesForTurn(
      user: User,
      turnId: number,
      log: { warn: (obj: unknown, msg: string) => void },
    ): Promise<void> {
      try {
        const { hardCap } = resolveDailyLimits({
          envSoft: deps.config.defaultDailyTokenLimit,
          userSoft: user.llm_daily_token_limit,
          envCap: deps.config.hardDailyTokenCap,
          userCap: user.llm_daily_hard_cap,
        });
        if (hardCap !== null) {
          const today = currentUserDate(new Date(), user.timezone);
          if (getUsageForDay(app.db, user.id, user.timezone, today).billed_tokens >= hardCap) {
            return;
          }
        }
        const turn = getTurnForHelpful(app.db, user.id, turnId);
        if (!turn) return;
        const { notes, usage } = await notesFromReply({
          createMessage: deps.createMessage,
          model: deps.config.model,
          reply: turn.content,
          priorUserMessage: turn.prior_user_message,
        });
        const now = new Date().toISOString();
        recordLlmUsage(app.db, {
          userId: user.id,
          createdAt: now,
          provider: deps.config.provider,
          model: deps.config.model,
          feature: "insights_chat",
          usage,
          webSearchRequests: 0,
          billedTokens: usage.input_tokens + usage.output_tokens,
        });
        if (notes.length > 0) {
          insertPoints(app.db, user.id, turnId, turn.on_date, notes, now, true);
        }
      } catch (err) {
        log.warn({ err }, "insights helpful: writing notes failed");
      }
    }

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
        const { hardCap } = resolveDailyLimits({
          envSoft: deps.config.defaultDailyTokenLimit,
          userSoft: user.llm_daily_token_limit,
          envCap: deps.config.hardDailyTokenCap,
          userCap: user.llm_daily_hard_cap,
        });
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

        const { searchEnabled, searchNote } = resolveSearch(app.db, deps.config, user, today);

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
            ? perSearchPrice(app.db, user.id, deps.config.tokensPerSearch, "meal_chat")
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
        const now = new Date();
        const today = currentUserDate(now, user.timezone);
        const onDate = req.body.on_date ?? today;

        const { hardCap } = resolveDailyLimits({
          envSoft: deps.config.defaultDailyTokenLimit,
          userSoft: user.llm_daily_token_limit,
          envCap: deps.config.hardDailyTokenCap,
          userCap: user.llm_daily_hard_cap,
        });
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
        const points = listRecentPoints(
          app.db,
          user.id,
          new Date(Date.now() - POINTS_WINDOW_DAYS * 86_400_000).toISOString(),
          POINTS_LIMIT,
        );
        const { stable: insightsStable, volatile: insightsVolatile } = buildInsightsSystemPrompt(
          reportMd,
          { today, conversationDate: onDate, localTime: localClockTime(now, user.timezone) },
          priorTakeaway,
          user.about_me,
          points,
        );
        const { dispatch, takePoints } = makeInsightsDispatch(app.db, user.id, user.timezone, now);
        const { searchEnabled } = resolveSearch(app.db, deps.config, user, today);
        const {
          result: rawResult,
          usage,
          sources,
          lookups,
        } = await runAgent<string>({
          createMessage: deps.createMessage,
          model: deps.config.insightsModel,
          system: insightsStable,
          volatileSystem: insightsVolatile,
          tools: INSIGHTS_TOOLS,
          history: req.body.history.map(toReplayTurn),
          omitFromLookups: ["remember_point"],
          message: req.body.message,
          searchEnabled,
          toolChoice: "auto",
          dispatch,
          thinking: { type: "adaptive" },
          effort: deps.config.insightsEffort,
          maxTokens: INSIGHTS_MAX_TOKENS,
          maxIterations: INSIGHTS_MAX_ITERATIONS,
          refusalFallback: true,
          accumulateText: true,
          parallelToolUse: true,
          onNoTerminalTool: (text) => text ?? NO_ANALYSIS_TEXT,
        });
        const result = stripLookupsLine(rawResult) || NO_ANALYSIS_TEXT;

        const billedTokens =
          usage.web_search_requests > 0
            ? perSearchPrice(app.db, user.id, deps.config.tokensPerSearch, "insights_chat")
            : usage.input_tokens + usage.output_tokens;
        recordLlmUsage(app.db, {
          userId: user.id,
          createdAt: new Date().toISOString(),
          provider: deps.config.provider,
          model: deps.config.insightsModel,
          feature: "insights_chat",
          usage,
          webSearchRequests: usage.web_search_requests,
          billedTokens,
        });

        const ids = appendTurns(
          app.db,
          user.id,
          onDate,
          [
            { role: "user", content: req.body.message },
            { role: "assistant", content: result, sources, lookups },
          ],
          new Date().toISOString(),
        );
        const assistantTurnId = ids[1];
        if (assistantTurnId === undefined) {
          throw new Error("appendTurns returned no assistant id");
        }
        const pts = takePoints();
        if (pts.length > 0) {
          insertPoints(app.db, user.id, assistantTurnId, onDate, pts, new Date().toISOString());
        }

        return {
          kind: "answer" as const,
          text: result,
          assistant_turn_id: assistantTurnId,
          usage: toUsageSummary(
            deps.config.provider,
            deps.config.insightsModel,
            usage,
            usage.web_search_requests,
            sources,
          ),
          lookups,
        };
      },
    );

    app.patch(
      "/v1/llm/insights-chat/turns/:id",
      { schema: { params: IdParamsSchema, body: InsightsHelpfulRequestSchema } },
      async (req, reply) => {
        const user = requireUser(app.db, req);
        assertLlmEnabled(deps.config, user);
        const r = setTurnHelpful(app.db, user.id, req.params.id, req.body.helpful);
        if (r === "not_found") {
          throw new ApiError(404, "not_found", `Turn ${req.params.id} not found`);
        }
        if (r === "not_assistant") {
          throw new ApiError(422, "validation_failed", "Only coach replies can be marked helpful");
        }
        if (req.body.helpful && countPointsForTurn(app.db, user.id, req.params.id) === 0) {
          await writeNotesForTurn(user, req.params.id, req.log);
        }
        return reply.code(204).send();
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
        // own typical (p75) cost against the shared remaining budget. No feature → blended
        // (back-compat). No history for the feature → its per-feature default.
        const feature = req.query.feature;
        const recentTypical = recentTypicalTokensPerCall(
          app.db,
          user.id,
          feature ? { feature } : undefined,
        );
        const avg = recentTypical ?? (feature ? DEFAULT_AVG_TOKENS_BY_FEATURE[feature] : null);
        const { softLimit, hardCap } = resolveDailyLimits({
          envSoft: deps.config.defaultDailyTokenLimit,
          userSoft: user.llm_daily_token_limit,
          envCap: deps.config.hardDailyTokenCap,
          userCap: user.llm_daily_hard_cap,
        });

        return computeDailyBalance({
          tokensUsedToday: day.billed_tokens,
          callsToday: day.calls,
          recentAvgTokensPerCall: avg,
          softLimitTokens: softLimit,
          hardCapTokens: hardCap,
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
