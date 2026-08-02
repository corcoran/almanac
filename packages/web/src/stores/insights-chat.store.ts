import {
  InsightsChatRequestSchema,
  InsightsChatResponseSchema,
  InsightsDaysResponseSchema,
  InsightsHistoryResponseSchema,
  type WebSource,
} from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { isApiError } from "../api/errors.js";

/**
 * A single chat turn. Insights answers are plain text, so there is no
 * proposal/question variant the way meal-chat has — both roles carry a string.
 */
export type Turn = { role: "user" | "assistant"; content: string; sources?: WebSource[] };

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
      const serverMessage = parseServerMessage(e.body);
      return serverMessage ?? `The assistant returned an error (${e.status}).`;
    }
    return "Couldn't reach the assistant — try again.";
  }
  if (e instanceof Error && e.message) return e.message;
  return "Couldn't reach the assistant — try again.";
}

export const useInsightsChatStore = defineStore("insightsChat", {
  state: () => ({
    turns: [] as Turn[],
    pending: false,
    error: null as string | null,
    viewedDate: null as string | null,
    days: [] as string[],
    loaded: false,
    loading: false,
  }),
  actions: {
    /**
     * Hydrate the chat from the server-persisted transcript for `date` (or today
     * when omitted) plus the list of days that have a conversation. Re-renders
     * with zero tokens — there is NO AI call here; the panel decides separately
     * whether to fire the auto-insight (only on a brand-new empty day).
     */
    async load(client: ApiClient, date?: string): Promise<void> {
      // Drop a second load while one is in flight: rapid day-stepping or a
      // reopen-during-hydration would otherwise race two hydrations and let the
      // slower one clobber the newer view.
      if (this.loading) return;
      this.loading = true;
      this.error = null;
      try {
        const path = date
          ? `/v1/llm/insights-chat/history?date=${date}`
          : "/v1/llm/insights-chat/history";
        const h = await client.get(path, InsightsHistoryResponseSchema);
        this.turns = h.turns.map((t) => ({
          role: t.role,
          content: t.content,
          ...(t.sources ? { sources: t.sources } : {}),
        }));
        this.viewedDate = h.on_date;
        const d = await client.get("/v1/llm/insights-chat/days", InsightsDaysResponseSchema);
        this.days = d.days;
        this.loaded = true;
      } catch (e) {
        this.error = errorMessage(e);
      } finally {
        this.loading = false;
      }
    },
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
        const body = InsightsChatRequestSchema.parse({
          message: trimmed,
          history,
          on_date: this.viewedDate ?? undefined,
        });
        const res = await client.post("/v1/llm/insights-chat", body, InsightsChatResponseSchema);
        this.turns.push({
          role: "assistant",
          content: res.text,
          ...(res.usage.sources.length > 0 ? { sources: res.usage.sources } : {}),
        });
        // A reply on a viewed day that wasn't yet in the day list means this is
        // the day's first persisted conversation — surface it in the stepper.
        if (this.viewedDate !== null && !this.days.includes(this.viewedDate)) {
          this.days.unshift(this.viewedDate);
        }
      } catch (e) {
        this.error = errorMessage(e);
      } finally {
        this.pending = false;
      }
    },
    /**
     * Step the viewed day by `dir` (−1 = older, +1 = newer) and load it.
     * `days` is newest-first, so going older (−1) moves to a HIGHER index —
     * hence `idx - dir`.
     */
    async stepDay(client: ApiClient, dir: number): Promise<void> {
      // Bail before computing the target so a rapid second click during an
      // in-flight load can't step from a stale viewedDate.
      if (this.loading) return;
      const idx = this.days.indexOf(this.viewedDate ?? "");
      // `days` is newest-first. dir<0 is "older" (higher index), dir>0 is "newer".
      // Special case: a FRESH today (no conversation yet) isn't in `days`, so
      // idx === -1. From there, stepping back (dir<0) must reach the newest PAST
      // day (days[0]); there's no newer day to step forward to.
      let next: number;
      if (idx === -1) {
        if (dir >= 0) return; // nothing newer than a fresh today
        next = 0; // step back into the archive
      } else {
        next = idx - dir;
      }
      if (next < 0 || next >= this.days.length) return;
      const target = this.days[next];
      if (target) await this.load(client, target);
    },
    /** Reset the day's conversation server-side, then reload today (now empty). */
    async newChat(client: ApiClient): Promise<void> {
      // Guard the delete+reload so a double-click can't double-delete.
      if (this.loading) return;
      await client.delete("/v1/llm/insights-chat/history", z.undefined());
      await this.load(client);
    },
    reset(): void {
      this.turns = [];
      this.error = null;
    },
  },
});
