import {
  MealChatRequestSchema,
  MealChatResponseSchema,
  type ProposedAlcohol,
  type ProposedMeal,
  type UsageSummary,
  type WebSource,
} from "@almanac/core/schemas";
import { defineStore } from "pinia";
import type { ApiClient } from "../api/client.js";
import { isApiError } from "../api/errors.js";

export type { WebSource };

/**
 * A proposed meal plus a stable client-side identity. Logging or dismissing a
 * card splices its meal out of the turn's `meals` array; the render layer keys
 * cards by this `_key` (NOT by array index) so a front/middle splice removes the
 * right card. Index-keyed rendering reuses the wrong component instance on a
 * splice — the un-logged card kept showing the logged meal's (draft-seeded)
 * name, so logging the first card made the second appear to vanish.
 */
export type KeyedProposedMeal = ProposedMeal & { _key: number };

/** A proposed alcohol session plus the same stable client-side identity. */
export type KeyedProposedAlcohol = ProposedAlcohol & { _key: number };

// Monotonic source of the `_key` above — unique for the store's lifetime, so
// keys never collide even across separate proposal turns.
let nextMealKey = 0;

export type UserTurn = { role: "user"; content: string };
export type AssistantProposalTurn = {
  role: "assistant";
  kind: "proposal";
  content: string;
  meals: KeyedProposedMeal[];
  alcoholSessions: KeyedProposedAlcohol[];
  usage: UsageSummary;
  /**
   * One "✓ Logged <name> — <kcal> kcal" line per meal logged from this turn's
   * cards. Logging a card splices it out of `meals` (so it disappears) and
   * pushes a confirmation here so the chat shows the log worked. Explicit
   * Dismiss removes a card WITHOUT adding a summary.
   */
  loggedSummaries: string[];
  searchNote?: string;
};
export type AssistantQuestionTurn = {
  role: "assistant";
  kind: "question";
  content: string;
  usage: UsageSummary;
  searchNote?: string;
};
export type Turn = UserTurn | AssistantProposalTurn | AssistantQuestionTurn;

/**
 * The most recent `HH:MM` time established anywhere in the conversation — the
 * last proposed meal (stored OR estimated) that carried an `eaten_at`. The model
 * captures a stated time ("for lunch" → 12:30) inconsistently across turns, so a
 * later card can come back with `eaten_at` omitted and would otherwise default
 * to *now*. Carrying the established time forward keeps a single logical meal on
 * one clock across the whole exchange — including when the stated-time turn only
 * produced stored-library matches ("big mac for lunch" → a later "and an apple"
 * estimate inherits 12:30). Returns null when no time has been established yet
 * (then the card falls back to now/noon as before).
 */
export function lastEstablishedTime(turns: Turn[]): string | null {
  let found: string | null = null;
  for (const turn of turns) {
    if (turn.role !== "assistant" || turn.kind !== "proposal") continue;
    for (const meal of turn.meals) {
      if (!meal.eaten_at) continue;
      const m = /T(\d{2}:\d{2})/.exec(meal.eaten_at);
      if (m?.[1]) found = m[1];
    }
  }
  return found;
}

/**
 * The `YYYY-MM-DD` date of the most recent meal that carried an `eaten_at` —
 * the companion to {@link lastEstablishedTime}. A re-estimate that inherits an
 * earlier turn's time must also inherit its DATE, so a meal stated before local
 * midnight but logged just after isn't re-stamped onto the next day. Null when
 * no date has been established (the card then composes on the viewed day).
 */
export function lastEstablishedDate(turns: Turn[]): string | null {
  let found: string | null = null;
  for (const turn of turns) {
    if (turn.role !== "assistant" || turn.kind !== "proposal") continue;
    for (const meal of turn.meals) {
      if (!meal.eaten_at) continue;
      const m = /^(\d{4}-\d{2}-\d{2})T/.exec(meal.eaten_at);
      if (m?.[1]) found = m[1];
    }
  }
  return found;
}

/** Terse one-line summary of a proposal, used as the assistant's history content. */
function summarizeProposal(meals: ProposedMeal[], alcohol: ProposedAlcohol[]): string {
  const parts = meals.map((m) =>
    m.source === "estimated" ? `${m.name} ${Math.round(m.kcal)} kcal` : `${m.name} (stored)`,
  );
  for (const a of alcohol) {
    parts.push(`${a.drinks_count} drinks ${Math.round(a.est_kcal)} kcal`);
  }
  if (parts.length === 0) return "No items proposed.";
  return `Proposed: ${parts.join("; ")}`;
}

/**
 * Pull the human-facing `message` out of the API's error envelope
 * (`{ error: { code, message } }`) carried in an HTTP error's raw `body` string.
 * Returns null when the body isn't that shape (e.g. an HTML 500 page), so the
 * caller can fall back to a generic message.
 */
function parseServerMessage(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "object" &&
      (parsed as { error: unknown }).error !== null
    ) {
      const err = (parsed as { error: { message?: unknown } }).error;
      if (typeof err.message === "string" && err.message.length > 0) return err.message;
    }
  } catch {
    // not JSON — fall through to null
  }
  return null;
}

/**
 * A user-facing message for a failed send. The ApiClient throws plain `ApiError`
 * objects (a `kind`-tagged union with no `.message`); the rest of the app (and
 * tests) may surface `Error` instances. Reduce both to a short string — the chat
 * UI never needs the structured cause, just something to show the user.
 */
function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    if (e.kind === "http") {
      // Surface the server's own message when present (the API sends a friendly
      // one for the usage-cap 429 etc. in an { error: { code, message } }
      // envelope); fall back to the bare status if the body isn't that shape.
      const serverMessage = parseServerMessage(e.body);
      return serverMessage ?? `The assistant returned an error (${e.status}).`;
    }
    return "Couldn't reach the assistant — try again.";
  }
  if (e instanceof Error && e.message) return e.message;
  return "Couldn't reach the assistant — try again.";
}

export const useMealChatStore = defineStore("mealChat", {
  state: () => ({
    turns: [] as Turn[],
    pending: false,
    error: null as string | null,
  }),
  actions: {
    async send(client: ApiClient, message: string): Promise<void> {
      const trimmed = message.trim();
      if (trimmed === "" || this.pending) return;
      this.error = null;
      // History is the prior turns (oldest first); the newest user message is
      // sent as `message`, NOT folded into history.
      const history = this.turns.map((t) => ({ role: t.role, content: t.content }));
      this.turns.push({ role: "user", content: trimmed });
      this.pending = true;
      try {
        const body = MealChatRequestSchema.parse({ message: trimmed, history });
        const res = await client.post("/v1/llm/meal-chat", body, MealChatResponseSchema);
        if (res.kind === "proposal") {
          this.turns.push({
            role: "assistant",
            kind: "proposal",
            content: summarizeProposal(res.meals, res.alcohol_sessions),
            // Stamp each meal with a stable key so cards survive a splice by
            // identity, not position (see KeyedProposedMeal).
            meals: res.meals.map((m) => ({ ...m, _key: nextMealKey++ })),
            alcoholSessions: res.alcohol_sessions.map((a) => ({ ...a, _key: nextMealKey++ })),
            usage: res.usage,
            loggedSummaries: [],
            searchNote: res.searchNote,
          });
        } else {
          this.turns.push({
            role: "assistant",
            kind: "question",
            content: res.question,
            usage: res.usage,
            searchNote: res.searchNote,
          });
        }
      } catch (e) {
        this.error = errorMessage(e);
      } finally {
        this.pending = false;
      }
    },
    dismissMeal(turnIndex: number, mealIndex: number): void {
      const turn = this.turns[turnIndex];
      if (turn && turn.role === "assistant" && turn.kind === "proposal") {
        turn.meals.splice(mealIndex, 1);
      }
    },
    /**
     * Like dismiss (splices the meal out), but also records a confirmation
     * summary so the logged card is replaced by a "✓ Logged …" row instead of
     * vanishing silently. Used only on log-SUCCESS; explicit Dismiss stays on
     * `dismissMeal`.
     */
    markLogged(turnIndex: number, mealIndex: number, summary: string): void {
      const turn = this.turns[turnIndex];
      if (turn && turn.role === "assistant" && turn.kind === "proposal") {
        turn.meals.splice(mealIndex, 1);
        turn.loggedSummaries.push(summary);
      }
    },
    dismissAlcohol(turnIndex: number, alcoholIndex: number): void {
      const turn = this.turns[turnIndex];
      if (turn && turn.role === "assistant" && turn.kind === "proposal") {
        turn.alcoholSessions.splice(alcoholIndex, 1);
      }
    },
    markAlcoholLogged(turnIndex: number, alcoholIndex: number, summary: string): void {
      const turn = this.turns[turnIndex];
      if (turn && turn.role === "assistant" && turn.kind === "proposal") {
        turn.alcoholSessions.splice(alcoholIndex, 1);
        turn.loggedSummaries.push(summary);
      }
    },
    reset(): void {
      this.turns = [];
      this.error = null;
      this.pending = false;
    },
  },
});
