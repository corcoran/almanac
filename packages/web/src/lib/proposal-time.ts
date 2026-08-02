import { composeEatenAt } from "./eaten-at.js";

const hhmmFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Extract the `HH:MM` from a naive-local ISO string, or null if absent/malformed. */
function timeOf(capturedAt: string | undefined): string | null {
  if (capturedAt) {
    const m = /T(\d{2}:\d{2})/.exec(capturedAt);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Extract the `YYYY-MM-DD` from a naive-local ISO string, or null if absent/malformed. */
function dateOf(capturedAt: string | undefined): string | null {
  if (capturedAt) {
    const m = /^(\d{4}-\d{2}-\d{2})T/.exec(capturedAt);
    if (m?.[1]) return m[1];
  }
  return null;
}

export type ProposalTimeInput = {
  /**
   * The naive-local ISO timestamp the model captured for THIS item, if any
   * (a meal's `eaten_at` or an alcohol session's `started_at`). Undefined when
   * the model stated no time.
   */
  capturedAt: string | undefined;
  /** `HH:MM` established earlier in the conversation (a prior card's time). */
  fallbackTime?: string;
  /** `YYYY-MM-DD` established earlier in the conversation (the date companion). */
  fallbackDate?: string;
  /** The day the chat is composing on (`YYYY-MM-DD`). */
  viewedDate: string;
  /** The real current day (`YYYY-MM-DD`); when it equals viewedDate, "now" is live. */
  realToday: string;
};

export type ProposalTime = {
  /** Where the seeded time came from — drives the card's "from your message / from earlier / defaults to now" hint. */
  timeSource: "message" | "earlier" | "now";
  /** The `HH:MM` to seed the editable time field with. */
  seedTime: string;
  /** Compose the naive-local timestamp to log, given the (possibly-edited) `HH:MM`. */
  composeAt: (editedTime: string) => string;
};

/**
 * The shared time-composition logic for meal + alcohol proposal cards. Both cards
 * seed an editable time and compose a naive-local timestamp to log; the ONLY
 * difference between them is which field carries the model-captured timestamp
 * (meal `eaten_at` vs alcohol `started_at`), so callers pass that as `capturedAt`.
 *
 * Kept as a pure function (not a composable) so it's trivially testable and has no
 * reactivity of its own — each card owns its `timeDraft` ref and calls `composeAt`
 * on log. Centralizing this guards the user-local-day rollover rule (a fix here
 * applies to BOTH cards instead of silently drifting between them).
 */
export function proposalTime(input: ProposalTimeInput): ProposalTime {
  const ownTime = timeOf(input.capturedAt);
  const ownDate = dateOf(input.capturedAt);

  const timeSource: ProposalTime["timeSource"] = ownTime
    ? "message"
    : input.fallbackTime
      ? "earlier"
      : "now";

  const seedTime =
    ownTime ??
    input.fallbackTime ??
    (input.viewedDate === input.realToday ? hhmmFmt.format(new Date()) : "12:00");

  function composeAt(editedTime: string): string {
    // Prefer THIS item's captured date, then a date established earlier in the
    // conversation, before falling back to the viewed day. Honoring an explicit
    // date avoids the 4am-rollover re-bucketing, so pin the time onto it directly.
    const date = ownDate ?? input.fallbackDate;
    if (date) {
      const hhmm = /^\d{2}:\d{2}$/.test(editedTime) ? editedTime : "12:00";
      return `${date}T${hhmm}:00`;
    }
    return composeEatenAt(editedTime, input.viewedDate);
  }

  return { timeSource, seedTime, composeAt };
}
