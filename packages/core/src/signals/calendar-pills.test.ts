import { describe, expect, it } from "vitest";
import { defined } from "../test-support/index.js";
import { computeCalendarPills } from "./calendar-pills.js";

const TZ = "America/New_York";

function workout(id: number, template_id: number, template_name: string, started_at: string) {
  return { id, template_id, template_name, started_at };
}

describe("computeCalendarPills", () => {
  it("returns empty for a month with no workouts and no recent history", () => {
    const result = computeCalendarPills({
      workouts: [],
      month: "2026-05",
      timezone: TZ,
      now: new Date("2026-05-21T15:00:00Z"),
    });
    expect(result.month).toBe("2026-05");
    expect(result.tally).toEqual({ total: 0, by_template: {} });
    expect(result.past_sessions).toEqual([]);
    expect(result.pill_segments).toEqual([]);
  });

  it("buckets past sessions in the requested month into past_sessions + tally", () => {
    const result = computeCalendarPills({
      workouts: [
        workout(1, 10, "PUSH A", "2026-05-04T22:00:00Z"),
        workout(2, 11, "PULL A", "2026-05-06T22:00:00Z"),
        workout(3, 10, "PUSH A", "2026-05-10T22:00:00Z"),
        workout(4, 12, "LEGS A", "2026-04-30T22:00:00Z"), // out of month — excluded
      ],
      month: "2026-05",
      timezone: TZ,
      now: new Date("2026-05-21T15:00:00Z"),
    });
    expect(result.tally.total).toBe(3);
    expect(result.tally.by_template).toEqual({ "PUSH A": 2, "PULL A": 1 });
    expect(result.past_sessions).toHaveLength(3);
    expect(result.past_sessions[0]?.workout_id).toBe(1);
    expect(result.past_sessions[2]?.workout_id).toBe(3);
  });

  it("buckets a pre-4am workout into the previous user-day (DAY_START_HOUR rollover)", () => {
    // 2026-05-15T06:00Z = 02:00 EDT (America/New_York, UTC-4 in May). That's
    // before the 4am day-start, so it belongs to the user-day May 14 — NOT the
    // wall-clock date May 15. This mirrors how the 6-day summary buckets, so a
    // 2am workout doesn't show on different days across surfaces.
    const result = computeCalendarPills({
      workouts: [workout(1, 10, "PUSH A", "2026-05-15T06:00:00Z")],
      month: "2026-05",
      timezone: TZ,
      now: new Date("2026-05-20T15:00:00Z"),
    });
    expect(result.past_sessions).toHaveLength(1);
    expect(result.past_sessions[0]?.date).toBe("2026-05-14");
    expect(result.past_sessions[0]?.workout_id).toBe(1);
  });

  it("emits pill segments forward for a template hit recently (today=too_soon)", () => {
    // PUSH A done May 20 18:00 EDT (Wed). Now: May 21 11:00 EDT — 17h since,
    // today's phase = too_soon. Pill walk emits forward day-by-day.
    const result = computeCalendarPills({
      workouts: [workout(1, 10, "PUSH A", "2026-05-20T22:00:00Z")],
      month: "2026-05",
      timezone: TZ,
      now: new Date("2026-05-21T15:00:00Z"),
    });
    const push = result.pill_segments.find((p) => p.template_name === "PUSH A");
    expect(push).toBeDefined();
    expect(defined(push, "push").last_hit_at).toBe("2026-05-20T22:00:00.000Z");
    // First segment is the next user-local day (May 21).
    expect(defined(push, "push").segments[0]?.date).toBe("2026-05-21");
    expect(defined(push, "push").segments[0]?.phase).toBe("too_soon");
    // Walk should reach into prime then in_window before truncating.
    const phases = defined(push, "push").segments.map((s) => s.phase);
    expect(phases).toContain("acceptable");
    expect(phases).toContain("prime");
    expect(phases).toContain("in_window");
  });

  it("truncates pill at fading — no segment past the 7-day cutoff", () => {
    // Workout May 14 18:00 EDT. Walk yields:
    //   May 15 (14h too_soon) … May 21 (158h in_window) … May 22 (182h fading → break).
    // Last segment should be May 21; no May 22+ segment.
    const result = computeCalendarPills({
      workouts: [workout(1, 10, "PUSH A", "2026-05-14T22:00:00Z")],
      month: "2026-05",
      timezone: TZ,
      now: new Date("2026-05-15T15:00:00Z"),
    });
    const push = result.pill_segments.find((p) => p.template_name === "PUSH A");
    expect(push).toBeDefined();
    const dates = defined(push, "push").segments.map((s) => s.date);
    expect(dates).toContain("2026-05-21");
    // No segments at or past May 22 (fading territory).
    expect(dates.every((d) => d <= "2026-05-21")).toBe(true);
    // No fading/detrained slipped through.
    for (const s of defined(push, "push").segments) {
      expect(["too_soon", "acceptable", "prime", "in_window"]).toContain(s.phase);
    }
  });

  it("marks the first prime day with is_proposed when it's today-or-future", () => {
    // PUSH A done May 14 18:00 EDT. First prime day in the walk is May 18
    // (86h since). Now: May 17 11:00 EDT → May 18 > May 17, so ★ on May 18.
    const result = computeCalendarPills({
      workouts: [workout(1, 10, "PUSH A", "2026-05-14T22:00:00Z")],
      month: "2026-05",
      timezone: TZ,
      now: new Date("2026-05-17T15:00:00Z"),
    });
    const push = result.pill_segments.find((p) => p.template_name === "PUSH A");
    expect(push).toBeDefined();
    const proposed = defined(push, "push").segments.filter((s) => s.is_proposed);
    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.date).toBe("2026-05-18");
    expect(proposed[0]?.phase).toBe("prime");
  });

  it("does NOT mark is_proposed when the first prime day is already in the past", () => {
    // PUSH A done May 14 18:00 EDT. First prime is May 18.
    // Now: May 19 11:00 EDT (~113h) — still in 'prime' window, so pill still
    // renders, but first prime (May 18) is in the past so no ★.
    const result = computeCalendarPills({
      workouts: [workout(1, 10, "PUSH A", "2026-05-14T22:00:00Z")],
      month: "2026-05",
      timezone: TZ,
      now: new Date("2026-05-19T15:00:00Z"),
    });
    const push = result.pill_segments.find((p) => p.template_name === "PUSH A");
    expect(push).toBeDefined();
    expect(defined(push, "push").segments.every((s) => !s.is_proposed)).toBe(true);
    // Sanity: prime day May 18 is still there with is_proposed=false.
    const may18 = defined(push, "push").segments.find((s) => s.date === "2026-05-18");
    expect(may18?.phase).toBe("prime");
    expect(may18?.is_proposed).toBe(false);
  });

  it("★ does NOT fall through to subsequent prime days", () => {
    // Same fixture as the previous: first prime May 18 (past). May 19 is
    // ALSO in prime band but should NOT receive ★.
    const result = computeCalendarPills({
      workouts: [workout(1, 10, "PUSH A", "2026-05-14T22:00:00Z")],
      month: "2026-05",
      timezone: TZ,
      now: new Date("2026-05-19T15:00:00Z"),
    });
    const push = result.pill_segments.find((p) => p.template_name === "PUSH A");
    expect(push).toBeDefined();
    const may19 = defined(push, "push").segments.find((s) => s.date === "2026-05-19");
    // May 19 may be classified prime (110h since) — but is_proposed must be false.
    expect(may19?.phase).toBe("prime");
    expect(may19?.is_proposed).toBe(false);
  });

  it("Q9b: entire window past (today is fading) → no pill_segments entry", () => {
    // PUSH A done May 1 — now May 21, ~480h since → detrained. No pill.
    const result = computeCalendarPills({
      workouts: [
        workout(1, 10, "PUSH A", "2026-05-01T22:00:00Z"),
        // Add an unrelated in-month past session so past_sessions isn't empty.
        workout(2, 11, "PULL A", "2026-05-20T22:00:00Z"),
      ],
      month: "2026-05",
      timezone: TZ,
      now: new Date("2026-05-21T15:00:00Z"),
    });
    expect(result.pill_segments.find((p) => p.template_name === "PUSH A")).toBeUndefined();
    // The past-session chip for PUSH A IS still in past_sessions per spec §2 Q9b.
    expect(result.past_sessions.some((p) => p.template_name === "PUSH A")).toBe(true);
    // PULL A still gets a pill — it was hit yesterday.
    expect(result.pill_segments.find((p) => p.template_name === "PULL A")).toBeDefined();
  });

  it("renders multiple templates with overlapping pill windows", () => {
    // Three templates each hit within the last few days. All three should appear.
    const result = computeCalendarPills({
      workouts: [
        workout(1, 10, "PUSH A", "2026-05-19T22:00:00Z"),
        workout(2, 11, "PULL A", "2026-05-18T22:00:00Z"),
        workout(3, 12, "LEGS A", "2026-05-17T22:00:00Z"),
      ],
      month: "2026-05",
      timezone: TZ,
      now: new Date("2026-05-21T15:00:00Z"),
    });
    expect(result.pill_segments).toHaveLength(3);
    const names = result.pill_segments.map((p) => p.template_name);
    expect(names).toEqual(["LEGS A", "PULL A", "PUSH A"]); // sorted alpha
    for (const p of result.pill_segments) {
      expect(p.segments.length).toBeGreaterThan(0);
    }
  });

  it("past month → pill_segments empty even when current workouts would emit pills", () => {
    // Querying April — even though there's a recent PUSH A in May that would
    // normally produce a pill, past months never emit forward pills (§7.4).
    const result = computeCalendarPills({
      workouts: [
        workout(1, 10, "PUSH A", "2026-04-15T22:00:00Z"),
        workout(2, 10, "PUSH A", "2026-05-20T22:00:00Z"),
      ],
      month: "2026-04",
      timezone: TZ,
      now: new Date("2026-05-21T15:00:00Z"),
    });
    expect(result.pill_segments).toEqual([]);
    // But the in-month past session still chips:
    expect(result.past_sessions).toHaveLength(1);
    expect(result.past_sessions[0]?.date).toBe("2026-04-15");
  });

  it("future month returns empty pill_segments + past_sessions + tally", () => {
    // Request July when today is May. The 14-day walk exhausts before
    // reaching July (next prime is ~3-5 days out, in_window stops at 7d).
    const result = computeCalendarPills({
      workouts: [workout(1, 10, "PUSH A", "2026-05-19T22:00:00Z")],
      month: "2026-07",
      timezone: TZ,
      now: new Date("2026-05-21T15:00:00Z"),
    });
    expect(result.month).toBe("2026-07");
    expect(result.past_sessions).toEqual([]);
    expect(result.tally.total).toBe(0);
    expect(result.pill_segments).toEqual([]);
  });

  it("template hit BEFORE the requested month — pill still extends INTO it", () => {
    // PUSH A done Apr 29 18:00 EDT. Walking, first segment IN May:
    //   Apr 30 (14h too_soon — outside May, not emitted)
    //   May 1  (38h too_soon — emitted)
    //   May 2  (62h acceptable)
    //   May 3  (86h prime — first prime in walk; ≥ today May 1 → ★)
    //   May 4  (110h prime)
    //   May 5  (134h in_window)
    //   May 6  (158h in_window)
    //   May 7  (182h fading → break)
    const result = computeCalendarPills({
      workouts: [workout(1, 10, "PUSH A", "2026-04-29T22:00:00Z")],
      month: "2026-05",
      timezone: TZ,
      now: new Date("2026-05-01T15:00:00Z"),
    });
    const push = result.pill_segments.find((p) => p.template_name === "PUSH A");
    expect(push).toBeDefined();
    expect(defined(push, "push").segments[0]?.date).toBe("2026-05-01");
    // last_hit_at preserves the original ISO timestamp from April.
    expect(defined(push, "push").last_hit_at).toBe("2026-04-29T22:00:00.000Z");
    const proposed = defined(push, "push").segments.filter((s) => s.is_proposed);
    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.date).toBe("2026-05-03");
    expect(proposed[0]?.phase).toBe("prime");
  });
});

describe("untracked_bands", () => {
  const BASE = {
    workouts: [] as Array<{
      id: number;
      template_id: number | null;
      template_name: string | null;
      started_at: string;
    }>,
    timezone: "America/New_York",
    now: new Date("2026-05-21T18:00:00Z"),
  };

  it("emits a band per period, clipped to the requested month", () => {
    const result = computeCalendarPills({
      ...BASE,
      month: "2026-05",
      untrackedPeriods: [
        { started_on: "2026-04-28", ended_on: "2026-05-03", reason: "vacation" },
        { started_on: "2026-05-10", ended_on: "2026-05-12", reason: "deload" },
      ],
    });
    expect(result.untracked_bands).toEqual([
      { from: "2026-05-01", to: "2026-05-03", reason: "vacation" },
      { from: "2026-05-10", to: "2026-05-12", reason: "deload" },
    ]);
  });

  it("clips a period that extends past month-end", () => {
    const result = computeCalendarPills({
      ...BASE,
      month: "2026-05",
      untrackedPeriods: [{ started_on: "2026-05-29", ended_on: "2026-06-04", reason: "sick" }],
    });
    expect(result.untracked_bands).toEqual([
      { from: "2026-05-29", to: "2026-05-31", reason: "sick" },
    ]);
  });

  it("omits periods entirely outside the month", () => {
    const result = computeCalendarPills({
      ...BASE,
      month: "2026-05",
      untrackedPeriods: [{ started_on: "2026-03-01", ended_on: "2026-03-05", reason: "vacation" }],
    });
    expect(result.untracked_bands).toEqual([]);
  });

  it("renders bands for a PAST month (unlike pills)", () => {
    const result = computeCalendarPills({
      ...BASE,
      month: "2026-04",
      untrackedPeriods: [{ started_on: "2026-04-10", ended_on: "2026-04-14", reason: "vacation" }],
    });
    expect(result.pill_segments).toEqual([]);
    expect(result.untracked_bands).toEqual([
      { from: "2026-04-10", to: "2026-04-14", reason: "vacation" },
    ]);
  });

  it("defaults to an empty array when no periods are passed", () => {
    const result = computeCalendarPills({ ...BASE, month: "2026-05", untrackedPeriods: [] });
    expect(result.untracked_bands).toEqual([]);
  });
});
