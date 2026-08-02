import { UntrackedPeriodResponseSchema } from "@almanac/core/schemas";
import { defineStore } from "pinia";
import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import { type ApiError, isApiError } from "../api/errors.js";

export type UntrackedPeriod = z.infer<typeof UntrackedPeriodResponseSchema>;

const ListSchema = z.array(UntrackedPeriodResponseSchema);

/** Discriminated result for create/remove so callers branch on outcome
 *  without try/catch. `overlap` is the 422 the create route sends when the
 *  new range collides with an existing period. */
export type WriteResult =
  | { ok: true }
  | { ok: false; kind: "overlap"; message: string }
  | { ok: false; kind: "other"; message: string };

type Status = "idle" | "loading" | "ready" | "error";

function messageFor(e: unknown): string {
  if (isApiError(e) && e.kind === "http") return `Request failed (${e.status}).`;
  if (isApiError(e) && e.kind === "network") return "Network error. Please try again.";
  return "Something went wrong. Please try again.";
}

/**
 * Flat list of the user's untracked (time-off) periods. Unlike the calendar
 * stores this is not keyed by month — the modal loads the whole recent list
 * once when opened. Create/remove mutate the list optimistically on success
 * and return a typed WriteResult; the caller (MonthCalendar) reloads the
 * calendar stores so the shaded bands refresh.
 */
export const useUntrackedPeriodsStore = defineStore("untracked-periods", {
  state: () => ({
    list: [] as UntrackedPeriod[],
    status: "idle" as Status,
    error: null as ApiError | null,
  }),
  actions: {
    async load(client: ApiClient): Promise<void> {
      this.status = "loading";
      this.error = null;
      try {
        this.list = await client.get("/v1/untracked-periods", ListSchema);
        this.status = "ready";
      } catch (e) {
        if (isApiError(e)) {
          this.error = e;
          this.status = "error";
          return;
        }
        throw e;
      }
    },

    async create(
      client: ApiClient,
      input: { started_on: string; ended_on: string; reason: UntrackedPeriod["reason"] },
    ): Promise<WriteResult> {
      try {
        const created = await client.post(
          "/v1/untracked-periods",
          input,
          UntrackedPeriodResponseSchema,
        );
        this.list = [created, ...this.list];
        return { ok: true };
      } catch (e) {
        if (isApiError(e) && e.kind === "http" && e.status === 422) {
          // ApiError.http carries only the raw body string (structure erased), so
          // we sniff for the overlap envelope's discriminator rather than re-parsing.
          // The overlap 422 has a top-level error:"period_overlap"; a generic
          // validation 422 nests error.code, so the substring scan won't collide.
          const isOverlap = e.body.includes("period_overlap");
          return {
            ok: false,
            kind: isOverlap ? "overlap" : "other",
            message: isOverlap
              ? "This overlaps an existing time-off period."
              : "Those dates aren't valid.",
          };
        }
        return { ok: false, kind: "other", message: messageFor(e) };
      }
    },

    async remove(client: ApiClient, id: number): Promise<WriteResult> {
      try {
        await client.delete(`/v1/untracked-periods/${id}`, z.undefined());
        this.list = this.list.filter((p) => p.id !== id);
        return { ok: true };
      } catch (e) {
        return { ok: false, kind: "other", message: messageFor(e) };
      }
    },
  },
});
