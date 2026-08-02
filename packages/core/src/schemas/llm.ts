import { z } from "zod";

/** A meal matched against the user's stored-meal library (logged via copy). */
export const StoredProposedMealSchema = z.object({
  source: z.literal("stored"),
  stored_meal_id: z.number().int().positive(),
  name: z.string(),
  // Optional naive-local string (no Z) when the user stated a time ("for lunch").
  // Stored matches copy macros from the library but still honor a stated time.
  eaten_at: z.string().optional(),
  // Optional: the model's self-reported match confidence; absent is fine.
  confidence: z.number().min(0).max(1).optional(),
  note: z.string().optional(),
});

/** A newly estimated meal. Macro field names match the meals table. */
export const EstimatedProposedMealSchema = z.object({
  source: z.literal("estimated"),
  name: z.string(),
  kcal: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carb_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  // Optional naive-local string in the user's timezone (no Z suffix). The model
  // need not fabricate a time; the confirm step / route defaults it to "now".
  eaten_at: z.string().optional(),
  // Optional: the model's self-reported estimate confidence.
  confidence: z.number().min(0).max(1).optional(),
  suggest_store: z.boolean().default(false),
  note: z.string().optional(),
});

export const ProposedMealSchema = z.discriminatedUnion("source", [
  StoredProposedMealSchema,
  EstimatedProposedMealSchema,
]);
export type ProposedMeal = z.infer<typeof ProposedMealSchema>;

/**
 * A proposed alcohol session (kcal-only — alcohol carries no macros). Shape
 * mirrors the loggable alcohol fields; `note` maps to the `notes` column at
 * confirm time. The meal chat logs point-in-time, so there's no ended_at.
 */
export const ProposedAlcoholSchema = z.object({
  drinks_count: z.number().positive(),
  est_kcal: z.number().int().nonnegative(),
  // Optional naive-local ISO string (no Z), same rule as a meal's eaten_at.
  started_at: z.string().optional(),
  note: z.string().optional(),
});
export type ProposedAlcohol = z.infer<typeof ProposedAlcoholSchema>;

/** A web page the model consulted, surfaced as a source chip in the chat. */
export const WebSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  domain: z.string(),
});
export type WebSource = z.infer<typeof WebSourceSchema>;

/** One conversation turn supplied by the client. */
export const ChatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  sources: z.array(WebSourceSchema).optional(),
});

export const MealChatRequestSchema = z.object({
  message: z.string().min(1),
  history: z.array(ChatTurnSchema).default([]),
});
export type MealChatRequest = z.infer<typeof MealChatRequestSchema>;

export const UsageSummarySchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  cache_creation_tokens: z.number().int().nonnegative(),
  // How many web searches this turn ran (0 for a normal turn). Lets the chat
  // show a retroactive "🔍 searched the web" note on turns that searched.
  web_search_requests: z.number().int().nonnegative().default(0),
  // The pages the model consulted this turn (empty for a non-search turn).
  // Rendered as an expandable favicon footnote under the reply.
  sources: z.array(WebSourceSchema).default([]),
  cost_usd: z.number().nonnegative(),
  model: z.string(),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const InsightsChatRequestSchema = z.object({
  message: z.string().min(1),
  history: z.array(ChatTurnSchema).default([]),
  on_date: IsoDate.optional(),
});
export type InsightsChatRequest = z.infer<typeof InsightsChatRequestSchema>;

export const InsightsHistoryResponseSchema = z.object({
  on_date: z.string(),
  turns: z.array(ChatTurnSchema),
});
export type InsightsHistoryResponse = z.infer<typeof InsightsHistoryResponseSchema>;

export const InsightsDaysResponseSchema = z.object({ days: z.array(z.string()) });
export type InsightsDaysResponse = z.infer<typeof InsightsDaysResponseSchema>;

export const InsightsChatResponseSchema = z.object({
  kind: z.literal("answer"),
  text: z.string(),
  usage: UsageSummarySchema,
});
export type InsightsChatResponse = z.infer<typeof InsightsChatResponseSchema>;

export const MealChatResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("proposal"),
    meals: z.array(ProposedMealSchema),
    alcohol_sessions: z.array(ProposedAlcoholSchema).default([]),
    usage: UsageSummarySchema,
    searchNote: z.string().optional(),
  }),
  z.object({
    kind: z.literal("question"),
    question: z.string(),
    usage: UsageSummarySchema,
    searchNote: z.string().optional(),
  }),
]);
export type MealChatResponse = z.infer<typeof MealChatResponseSchema>;
