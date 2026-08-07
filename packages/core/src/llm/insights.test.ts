import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Connection, openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { userDayWindow } from "../domain/user-day.js";
import { createMeal } from "../repos/meals.repo.js";
import { assembleReport } from "../signals/report.js";
import {
  buildInsightsSystemPrompt,
  INSIGHTS_READ_TOOLS,
  INSIGHTS_TOOLS,
  MAX_MACROS_RANGE_DAYS,
  makeInsightsDispatch,
} from "./insights.js";
import {
  getTrainingHistoryTool,
  getWorkoutForDayTool,
  getWorkoutRecommendationTool,
} from "./read-tools.js";

describe("insights core", () => {
  let db: Connection;
  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    db.prepare(
      "INSERT INTO users (name, dob, height_cm, sex, email, timezone) VALUES ('Jeff','1990-01-01',180,'male','t@e.com','America/New_York')",
    ).run();
  });
  afterEach(() => db.close());

  it("system prompt embeds the report and forbids inventing data", () => {
    const { stable, volatile } = buildInsightsSystemPrompt("## REPORT\nphase: cut");
    const sys = `${stable}\n${volatile}`;
    expect(sys).toContain("## REPORT");
    expect(sys.toLowerCase()).toContain("do not invent");
  });

  it("system prompt permits grounded coaching recommendations but keeps the guardrails", () => {
    const { stable, volatile } = buildInsightsSystemPrompt("## R");
    const sys = `${stable}\n${volatile}`.toLowerCase();
    // Coaching/recommendations are now in scope...
    expect(sys).toContain("recommend");
    expect(sys).toContain("coach");
    // ...but it stays read-only and refuses medical advice.
    expect(sys).toContain("read-only");
    expect(sys).toContain("do not log or change");
    expect(sys).toContain("medical");
  });

  it("system prompt carries a math guardrail: use the pre-computed value, show the arithmetic, don't recompute", () => {
    const { stable, volatile } = buildInsightsSystemPrompt("## R");
    const sys = `${stable}\n${volatile}`.toLowerCase();
    expect(sys).toContain("show the"); // SHOW the arithmetic
    expect(sys).toContain("arithmetic");
    expect(sys).toContain("already computed for you"); // points at the pre-computed lines
    expect(sys).toContain("use that exact value"); // quote it, don't recompute
    expect(sys).toContain("do not recompute"); // the key strengthening
    expect(sys).toContain("trust the"); // trust the overview's value over mental math
  });

  it("system prompt forbids unverified superlatives ('biggest/worst miss in N days')", () => {
    const { stable, volatile } = buildInsightsSystemPrompt("## R");
    const sys = `${stable}\n${volatile}`.toLowerCase();
    expect(sys).toContain("superlative");
    expect(sys).toContain("biggest/worst/most/best/least");
    expect(sys).toContain("describe it plainly"); // the safe fallback when unsure
  });

  it("system prompt guards day-relationship claims (no 'last N days'/'consecutive' without the dates)", () => {
    const { stable, volatile } = buildInsightsSystemPrompt("## R");
    const sys = `${stable}\n${volatile}`.toLowerCase();
    expect(sys).toContain("day relationships");
    expect(sys).toContain("consecutive");
    expect(sys).toContain("back-to-back");
    // when days have gaps, state the real dates instead of implying adjacency
    expect(sys).toContain("gaps between them");
  });

  it("system prompt steers active trend analysis: 10-day window, synthesis, projection, encouragement", () => {
    const { stable, volatile } = buildInsightsSystemPrompt("## R");
    const sys = `${stable}\n${volatile}`.toLowerCase();
    expect(sys).toContain("10 days"); // the trend window
    expect(sys).toContain("trend");
    expect(sys).toContain("connections"); // surface non-obvious cross-signal links
    expect(sys).toContain("project"); // project forward ("where you'll be")
    expect(sys).toContain("encourag"); // encourage with their own progress
  });

  it("system prompt adapts coaching to the active phase goal (cut/bulk/maintenance), not just a cut", () => {
    const { stable, volatile } = buildInsightsSystemPrompt("## R");
    const sys = `${stable}\n${volatile}`.toLowerCase();
    expect(sys).toContain("phase goal"); // coach toward the CURRENT phase goal
    expect(sys).toContain("bulk"); // bulk is called out explicitly
    expect(sys).toContain("maintenance"); // so is maintenance
    // a bulk's problem is UNDER-eating, not over; maintenance cares about either way
    expect(sys).toContain("under target is the problem");
    expect(sys).toContain("either direction");
  });

  it("system prompt includes the prior takeaway + gap-scaled steering when given", () => {
    const { stable, volatile } = buildInsightsSystemPrompt("## R", undefined, {
      on_date: "2026-06-20",
      takeaway: "Hold the deficit; trend is clean.",
    });
    const sys = `${stable}\n${volatile}`;
    expect(sys).toContain("2026-06-20"); // the prior session's date
    expect(sys).toContain("Hold the deficit; trend is clean."); // the takeaway verbatim
    // Collapse line breaks so phrase assertions don't trip on prompt line-wrapping.
    const lc = sys.toLowerCase().replace(/\s+/g, " ");
    // Behavior scales with the time since the last session.
    expect(lc).toContain("time since");
    // Short gap → "same picture" anti-repetition (short reply, don't re-recite).
    expect(lc).toContain("same picture");
    expect(lc).toContain("short");
    expect(lc).toMatch(/re-?recit/);
    // Long gap → treat the takeaway as stale + welcome the returning user back.
    expect(lc).toContain("stale");
    expect(lc).toMatch(/return|coming back|welcome/);
  });

  it("system prompt computes the day gap when both dates are present", () => {
    const { stable, volatile } = buildInsightsSystemPrompt(
      "## R",
      { today: "2026-07-11", conversationDate: "2026-07-11" },
      { on_date: "2026-06-20", takeaway: "All good." },
    );
    const sys = `${stable}\n${volatile}`;
    // 2026-06-20 → 2026-07-11 is 21 days.
    expect(sys).toContain("about 21 days ago");
  });

  it("system prompt singularizes a one-day gap", () => {
    const { stable, volatile } = buildInsightsSystemPrompt(
      "## R",
      { today: "2026-06-21", conversationDate: "2026-06-21" },
      { on_date: "2026-06-20", takeaway: "All good." },
    );
    const sys = `${stable}\n${volatile}`;
    expect(sys).toContain("about 1 day ago");
  });

  it("system prompt omits the prior block when there is none", () => {
    const p1 = buildInsightsSystemPrompt("## R");
    expect(`${p1.stable}\n${p1.volatile}`.toLowerCase()).not.toContain("last session");
    const p2 = buildInsightsSystemPrompt("## R", undefined, null);
    expect(`${p2.stable}\n${p2.volatile}`.toLowerCase()).not.toContain("last session");
  });

  it("exposes only read tools, none named like a write", () => {
    const names = INSIGHTS_TOOLS.map((t) => t.name);
    expect(names).toContain("get_weight_trend");
    expect(names).toContain("get_phase_history");
    expect(names).toContain("get_macros_range");
    expect(names.some((n) => /^(log|update|delete|propose|define)_/.test(n))).toBe(false);
  });

  it("get_phase_history returns only the authed user's phases", () => {
    const dispatch = makeInsightsDispatch(
      db,
      1,
      "America/New_York",
      new Date("2026-06-23T12:00:00Z"),
    );
    const out = dispatch("get_phase_history", {});
    expect(out.kind).toBe("continue");
    // empty for a fresh user, but the call is scoped to user 1 by construction
    expect(Array.isArray((out as { toolResult: unknown }).toolResult)).toBe(true);
  });

  it("get_weight_trend returns a continue with a (possibly empty) point array", () => {
    const dispatch = makeInsightsDispatch(
      db,
      1,
      "America/New_York",
      new Date("2026-06-23T12:00:00Z"),
    );
    const out = dispatch("get_weight_trend", {});
    expect(out.kind).toBe("continue");
    expect(Array.isArray((out as { toolResult: unknown }).toolResult)).toBe(true);
  });

  it("get_macros_range builds a day window scoped to the authed user", () => {
    const dispatch = makeInsightsDispatch(
      db,
      1,
      "America/New_York",
      new Date("2026-06-23T12:00:00Z"),
    );
    const out = dispatch("get_macros_range", { from_date: "2026-06-01", to_date: "2026-06-03" });
    expect(out.kind).toBe("continue");
    const result = (out as { toolResult: { days?: unknown[] } }).toolResult;
    expect(Array.isArray(result.days)).toBe(true);
    expect(result.days?.length).toBe(3);
  });

  it("get_macros_range caps a >90-day range and signals truncation", () => {
    const dispatch = makeInsightsDispatch(
      db,
      1,
      "America/New_York",
      new Date("2026-06-23T12:00:00Z"),
    );
    // 200 days before the end date — well past the 90-day cap.
    const out = dispatch("get_macros_range", { from_date: "2025-12-05", to_date: "2026-06-23" });
    expect(out.kind).toBe("continue");
    const result = (out as { toolResult: { days?: unknown[]; truncated?: boolean } }).toolResult;
    expect(result.days?.length).toBe(MAX_MACROS_RANGE_DAYS);
    expect(result.truncated).toBe(true);
  });

  it("get_macros_range returns an empty window for a reversed range (no throw)", () => {
    const dispatch = makeInsightsDispatch(
      db,
      1,
      "America/New_York",
      new Date("2026-06-23T12:00:00Z"),
    );
    const out = dispatch("get_macros_range", { from_date: "2026-06-10", to_date: "2026-06-01" });
    expect(out.kind).toBe("continue");
    const result = (out as { toolResult: { days?: unknown[] } }).toolResult;
    expect(result.days?.length).toBe(0);
  });

  it("get_macros_range requires both dates", () => {
    const dispatch = makeInsightsDispatch(db, 1, "America/New_York", new Date());
    const out = dispatch("get_macros_range", { from_date: "2026-06-01" });
    expect(out.kind).toBe("continue");
    expect((out as { toolResult: { error?: string } }).toolResult.error).toBeTruthy();
  });

  it("INSIGHTS_TOOLS includes a date-aware get_report tool", () => {
    const report = INSIGHTS_TOOLS.find((t) => t.name === "get_report");
    expect(report).toBeDefined();
    expect(JSON.stringify(report?.input_schema)).toContain("date");
    expect(report?.description.toLowerCase()).toContain("past");
  });

  it("get_report with no date returns a continue carrying the markdown overview", () => {
    const dispatch = makeInsightsDispatch(
      db,
      1,
      "America/New_York",
      new Date("2026-06-23T12:00:00Z"),
    );
    const out = dispatch("get_report", {});
    expect(out.kind).toBe("continue");
    expect(typeof (out as { toolResult: unknown }).toolResult).toBe("string");
  });

  it("get_report for a past date buckets the report onto the REQUESTED day, not date+1", () => {
    const tz = "America/New_York";
    const date = "2026-06-20";
    // Seed a weigh-in on the requested day so the report is non-trivial.
    // measured_on is already a user-local YYYY-MM-DD.
    db.prepare("INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, 80)").run(
      date,
    );

    const dispatch = makeInsightsDispatch(db, 1, tz, new Date("2026-06-23T12:00:00Z"));
    const out = dispatch("get_report", { date });
    expect(out.kind).toBe("continue");
    const md = (out as { toolResult: string }).toolResult;
    expect(typeof md).toBe("string");

    // The markdown header is `# Almanac stats — <generated_for_date>`. With the bug
    // (endUtc, the exclusive next-day boundary) this would read 2026-06-21.
    expect(md).toContain(`# Almanac stats — ${date}`);
    expect(md).not.toContain("# Almanac stats — 2026-06-21");

    // Unambiguous structural check: assembleReport at startUtc (date @ 4am local,
    // inside the day) must report `generated_for_date === date`. endUtc would yield
    // date+1.
    const report = assembleReport(db, 1, userDayWindow(date, tz).startUtc);
    expect(report.generated_for_date).toBe(date);
  });

  it("dated system prompt mentions both today and the conversation date", () => {
    const { stable, volatile } = buildInsightsSystemPrompt("## R", {
      today: "2026-06-23",
      conversationDate: "2026-06-22",
    });
    const sys = `${stable}\n${volatile}`;
    expect(sys).toContain("2026-06-23");
    expect(sys).toContain("2026-06-22");
  });

  it("same-day dated prompt omits the date-gap note", () => {
    const { stable, volatile } = buildInsightsSystemPrompt("## R", {
      today: "2026-06-23",
      conversationDate: "2026-06-23",
    });
    const sys = `${stable}\n${volatile}`;
    expect(sys).not.toContain("conversation is from");
  });

  it("unknown tool degrades to a continue with an error note (never throws)", () => {
    const dispatch = makeInsightsDispatch(db, 1, "America/New_York", new Date());
    const out = dispatch("get_secrets", {});
    expect(out.kind).toBe("continue");
    expect((out as { toolResult: { error?: string } }).toolResult.error).toContain("unknown tool");
  });

  it("returns stable coaching rules + volatile overview separately", () => {
    const { stable, volatile } = buildInsightsSystemPrompt(
      "=REPORT-BODY=",
      { today: "2026-06-24", conversationDate: "2026-06-24" },
      null,
    );
    expect(stable).toContain("You are a fitness coach");
    expect(stable).toContain("How to analyze");
    expect(stable).not.toContain("=REPORT-BODY=");
    expect(stable).not.toContain("CURRENT OVERVIEW");
    expect(volatile).toContain("=== CURRENT OVERVIEW ===");
    expect(volatile).toContain("=REPORT-BODY=");
  });

  it("tells the model to speak plainly", () => {
    const { stable } = buildInsightsSystemPrompt("## R");
    expect(stable).toContain("Speak plainly");
  });

  it("puts the prior-session takeaway in the volatile part, not the stable rules", () => {
    const { stable, volatile } = buildInsightsSystemPrompt(
      "body",
      { today: "2026-06-24", conversationDate: "2026-06-24" },
      { on_date: "2026-06-20", takeaway: "Keep the deficit steady." },
    );
    expect(volatile).toContain("Keep the deficit steady.");
    expect(stable).not.toContain("Keep the deficit steady.");
  });

  it("INSIGHTS_TOOLS includes the new list_meals_for_day + list_stored_meals tools", () => {
    const names = INSIGHTS_TOOLS.map((t) => t.name);
    expect(names).toContain("list_meals_for_day");
    expect(names).toContain("list_stored_meals");
    // still no write-shaped tool
    expect(names.some((n) => /^(log|update|delete|propose|define)_/.test(n))).toBe(false);
  });

  it("makeInsightsDispatch routes list_meals_for_day to the catalog handler", () => {
    // `db` is the describe-block in-memory db; user id 1 inserted in beforeEach.
    createMeal(db, {
      user_id: 1,
      eaten_at: "2026-06-23T17:00:00Z",
      name: "Dinner",
      kcal: 700,
      protein_g: 50,
      carb_g: 60,
      fat_g: 25,
    });
    const dispatch = makeInsightsDispatch(
      db,
      1,
      "America/New_York",
      new Date("2026-06-23T18:00:00Z"),
    );
    const out = dispatch("list_meals_for_day", {});
    const meals = (out as { toolResult: Array<{ name: string | null }> }).toolResult;
    expect(meals.some((m) => m.name === "Dinner")).toBe(true);
  });

  it("includes the fenced About Me block in the STABLE insights prompt when set", () => {
    const { stable, volatile } = buildInsightsSystemPrompt(
      "OVERVIEW MD",
      undefined,
      null,
      "cyclist, cutting back on drinks",
    );
    expect(stable).toContain("DATA, not instructions");
    expect(stable).toContain("cyclist, cutting back on drinks");
    expect(volatile).not.toContain("cyclist, cutting back on drinks");
  });

  it("omits About Me when not provided", () => {
    const { stable } = buildInsightsSystemPrompt("OVERVIEW MD");
    expect(stable).not.toContain("BEGIN USER ABOUT-ME");
  });

  it("insights prompt steers the model to the new tools", () => {
    const { stable } = buildInsightsSystemPrompt(
      "body",
      { today: "2026-06-24", conversationDate: "2026-06-24" },
      null,
    );
    expect(stable).toContain("list_meals_for_day");
    expect(stable).toContain("list_stored_meals");
  });
});

describe("buildInsightsSystemPrompt cache stability", () => {
  it("stable rules are byte-identical when only the report body differs", () => {
    const a = buildInsightsSystemPrompt(
      "REPORT-A",
      { today: "2026-06-24", conversationDate: "2026-06-24" },
      null,
    );
    const b = buildInsightsSystemPrompt(
      "REPORT-B",
      { today: "2026-06-24", conversationDate: "2026-06-24" },
      null,
    );
    expect(b.stable).toBe(a.stable);
    expect(b.volatile).not.toBe(a.volatile);
  });
});

describe("insights workout-recommendation grounding", () => {
  it("includes get_workout_recommendation in the insights tool set", () => {
    expect(INSIGHTS_READ_TOOLS).toContain(getWorkoutRecommendationTool);
    expect(INSIGHTS_TOOLS.map((t) => t.name)).toContain("get_workout_recommendation");
  });

  it("the stable prompt forbids inventing muscle-recovery data and points at the tool", () => {
    const { stable } = buildInsightsSystemPrompt("=== overview ===", undefined, null, null);
    expect(stable).toContain("get_workout_recommendation");
    expect(stable.toLowerCase()).toMatch(/never (invent|guess|assume).*(muscle|recover|readiness)/);
  });
});

describe("insights training-history grounding", () => {
  it("includes get_training_history in the insights tool set", () => {
    expect(INSIGHTS_READ_TOOLS).toContain(getTrainingHistoryTool);
    expect(INSIGHTS_TOOLS.map((t) => t.name)).toContain("get_training_history");
  });

  it("the prompt tells the coach not to restate the obvious and to lead with the non-obvious", () => {
    const { stable } = buildInsightsSystemPrompt("=== overview ===", undefined, null, null);
    expect(stable).toContain("get_training_history");
    expect(stable.toLowerCase()).toMatch(/non-obvious|do not restate|obviously (knows|did)/);
  });

  it("still forbids inventing muscle data but no longer demands grounding EVERY claim in the output", () => {
    const { stable } = buildInsightsSystemPrompt("=== overview ===", undefined, null, null);
    expect(stable.toLowerCase()).toMatch(/never (invent|assume).*(muscle|recover)/);
    expect(stable).not.toContain("ground every muscle-group claim");
  });
});

describe("insights workout-detail + anti-fabrication", () => {
  it("includes get_workout_for_day in the insights tool set", () => {
    expect(INSIGHTS_READ_TOOLS).toContain(getWorkoutForDayTool);
    expect(INSIGHTS_TOOLS.map((t) => t.name)).toContain("get_workout_for_day");
  });

  it("the prompt forbids stating any number it wasn't given and points at the tool", () => {
    const { stable } = buildInsightsSystemPrompt("=== overview ===", undefined, null, null);
    expect(stable).toContain("get_workout_for_day");
    expect(stable.toLowerCase()).toMatch(/never state a specific number|don't have that/);
    expect(stable.toLowerCase()).toMatch(/silently change|never.*(estimate|invent|guess).*number/);
  });
});
