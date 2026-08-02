import type { Connection } from "../db/connection.js";
import { listMeals } from "../repos/index.js";
import {
  type ProposedAlcohol,
  ProposedAlcoholSchema,
  type ProposedMeal,
  ProposedMealSchema,
} from "../schemas/llm.js";
import type { MealContext } from "./context.js";
import { buildMealSystemPrompt } from "./prompts.js";
import {
  type AgentTool,
  type AgentUsage,
  type CreateMessage,
  runAgent,
  type WebSource,
} from "./run-agent.js";

export type MealChatResult =
  | { kind: "proposal"; meals: ProposedMeal[]; alcoholSessions: ProposedAlcohol[] }
  | { kind: "question"; question: string };

export type RunMealAgentArgs = {
  createMessage: CreateMessage;
  model: string;
  context: MealContext;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  // Whether web search is available this turn. The route passes false only when
  // the daily search cap is exhausted (drops the tool). Kept as a boolean — not
  // a remaining-count — so the tools block stays byte-identical across requests
  // and the system-prompt prompt-cache survives (see PER_TURN_SEARCH_CEILING).
  searchEnabled: boolean;
  // Optional read-tool backend for lookup_past_meals (real route passes db+userId).
  lookupPastMeals?: (query: string) => Array<{ name: string; kcal: number; eaten_at: string }>;
};

// Build the three meal user-tools. The web_search server tool is appended by
// runAgent (driven by searchEnabled), not here — so this returns user tools only.
function buildTools(): AgentTool[] {
  return [
    {
      name: "propose_log",
      description:
        "Return the parsed items as a proposal. FOOD goes in `meals` (each EITHER a library " +
        "match with source='stored' + stored_meal_id, OR a new estimate with source='estimated' " +
        "+ name, kcal, protein_g, carb_g, fat_g, suggest_store). ALCOHOL goes in " +
        "`alcohol_sessions` (drinks_count = US standard drinks, est_kcal = your kcal estimate) — " +
        "NEVER as a meal, and alcohol has NO macros. A mixed message ('a burger and two beers') " +
        "fills BOTH lists in one call. Either list may be empty. Terminal.",
      input_schema: {
        type: "object",
        properties: {
          meals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                source: { type: "string", enum: ["stored", "estimated"] },
                stored_meal_id: {
                  type: "integer",
                  description: "Required when source='stored': the matched library meal's id.",
                },
                name: { type: "string", description: "Human-readable meal name." },
                kcal: { type: "number", description: "Total energy in kcal (estimated meals)." },
                protein_g: { type: "number", description: "Protein in grams (estimated meals)." },
                carb_g: { type: "number", description: "Carbohydrate in grams (estimated meals)." },
                fat_g: { type: "number", description: "Fat in grams (estimated meals)." },
                suggest_store: {
                  type: "boolean",
                  description:
                    "Estimated meals: true if this looks like a repeatable meal worth saving.",
                },
                confidence: {
                  type: "number",
                  description: "Optional 0..1 self-reported confidence.",
                },
                eaten_at: {
                  type: "string",
                  description:
                    "Optional. ONLY when the user states or implies a time ('at 1pm', 'this " +
                    "morning', 'an hour ago'): the wall-clock time as a naive-local ISO string " +
                    "with NO timezone/Z suffix, e.g. '2026-06-22T13:00:00'. Resolve relative " +
                    "times against the current local date/time given above. If the user gives " +
                    "no time, OMIT this field entirely — do not guess a time.",
                },
                note: { type: "string", description: "Optional short note for the user." },
              },
              required: ["source", "name"],
            },
          },
          alcohol_sessions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                drinks_count: {
                  type: "number",
                  description: "US standard drinks; half-drinks OK (e.g. 1.5).",
                },
                est_kcal: {
                  type: "integer",
                  description: "Your kcal estimate for the drinks. Alcohol has no macros.",
                },
                started_at: {
                  type: "string",
                  description:
                    "Optional. ONLY when the user states/implies a time: naive-local ISO with " +
                    "NO timezone/Z suffix, e.g. '2026-06-22T19:30:00'. Omit if no time given.",
                },
                note: { type: "string", description: "Optional short note, e.g. '2 pints IPA'." },
              },
              required: ["drinks_count", "est_kcal"],
            },
          },
        },
        required: ["meals"],
      },
    },
    {
      name: "ask_clarification",
      description: "Ask one specific question when the message is too vague to estimate. Terminal.",
      input_schema: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
      },
    },
    {
      name: "lookup_past_meals",
      description:
        "Look up past logged meals by a text query (for 'the usual'/'same as last Tuesday') when the recent-meals list is not enough. Read-only.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  ];
}

/**
 * Run the meal-logging agent loop. Returns the structured result plus summed
 * usage across all model calls. Never writes to the DB. A thin wrapper over the
 * surface-agnostic {@link runAgent}: it supplies the meal system prompt, the
 * three meal user-tools (tool_choice 'any'), and a dispatch mirroring the
 * meal-specific terminal/continue logic. Web search is appended by runAgent.
 */
export async function runMealAgent(args: RunMealAgentArgs): Promise<{
  result: MealChatResult;
  usage: AgentUsage;
  sources: WebSource[];
}> {
  const { stable, volatile } = buildMealSystemPrompt(args.context);
  return runAgent<MealChatResult>({
    createMessage: args.createMessage,
    model: args.model,
    system: stable,
    volatileSystem: volatile,
    tools: buildTools(),
    history: args.history,
    message: args.message,
    searchEnabled: args.searchEnabled,
    toolChoice: "any",
    // No terminal tool (empty turn or iteration-cap exhaustion) → canned question.
    onNoTerminalTool: () => ({
      kind: "question",
      question: "Could you tell me what you ate?",
    }),
    dispatch: (name, input) => {
      if (name === "propose_log") {
        const raw = input as { meals?: unknown[]; alcohol_sessions?: unknown[] };
        const meals = (raw.meals ?? []).flatMap((m) => {
          const parsed = ProposedMealSchema.safeParse(m);
          return parsed.success ? [parsed.data] : [];
        });
        const alcoholSessions = (raw.alcohol_sessions ?? []).flatMap((a) => {
          const parsed = ProposedAlcoholSchema.safeParse(a);
          return parsed.success ? [parsed.data] : [];
        });
        return { kind: "terminal", value: { kind: "proposal", meals, alcoholSessions } };
      }
      if (name === "ask_clarification") {
        const q = (input as { question?: string }).question ?? "Could you clarify?";
        return { kind: "terminal", value: { kind: "question", question: q } };
      }
      if (name === "lookup_past_meals") {
        const found = args.lookupPastMeals?.((input as { query?: string }).query ?? "") ?? [];
        return { kind: "continue", toolResult: found };
      }
      // Unknown tool — degrade to the canned question (matches the old `break`).
      return {
        kind: "terminal",
        value: { kind: "question", question: "Could you tell me what you ate?" },
      };
    },
  });
}

/** Build a lookupPastMeals backend bound to a db + user (used by the route). */
export function makeLookupPastMeals(db: Connection, userId: number) {
  return (query: string) => {
    const q = query.toLowerCase();
    return listMeals(db, userId, { limit: 50 })
      .filter((m) => (m.name ?? "").toLowerCase().includes(q))
      .slice(0, 10)
      .map((m) => ({ name: m.name ?? "(unnamed)", kcal: m.kcal, eaten_at: m.eaten_at }));
  };
}
