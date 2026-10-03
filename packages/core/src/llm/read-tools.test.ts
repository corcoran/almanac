import { describe, expect, it } from "vitest";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { createAlcoholSession } from "../repos/alcohol.repo.js";
import { createCardioSession } from "../repos/cardio.repo.js";
import { createGroup } from "../repos/exercise-groups.repo.js";
import { createExercise } from "../repos/exercises.repo.js";
import { createMeal } from "../repos/meals.repo.js";
import { createSleepLog } from "../repos/sleep.repo.js";
import { createOrUpdateStepLog } from "../repos/step-logs.repo.js";
import { createStoredMeal } from "../repos/stored-meals.repo.js";
import { createUntrackedPeriod } from "../repos/untracked-periods.repo.js";
import { createTemplate } from "../repos/workout-templates.repo.js";
import { createWorkout } from "../repos/workouts.repo.js";
import { defined } from "../test-support/index.js";
import {
  buildReadDispatch,
  getAccomplishmentsTool,
  getAlcoholRecentTool,
  getCardioRecentTool,
  getDayStatusTool,
  getMacrosRangeTool,
  getPhaseHistoryTool,
  getRecentWorkoutsTool,
  getReportTool,
  getSleepRecentTool,
  getStepsRecentTool,
  getTdeeTool,
  getTrainingHistoryTool,
  getUserProfileTool,
  getWeightTrendTool,
  getWorkoutForDayTool,
  getWorkoutRecommendationTool,
  listMealsForDayTool,
  listStoredMealsTool,
  listUntrackedPeriodsTool,
  listWorkoutTemplatesTool,
  MAX_MACROS_RANGE_DAYS,
  type ReadTool,
} from "./read-tools.js";

function freshDb() {
  const db = openDb(":memory:");
  runMigrations(db);
  return db;
}

const echoTool: ReadTool = {
  definition: {
    name: "echo",
    description: "echoes",
    input_schema: { type: "object", properties: {} },
  },
  handler: (ctx) => (input) => ({
    kind: "continue",
    toolResult: { userId: ctx.userId, got: input },
  }),
};
const pingTool: ReadTool = {
  definition: {
    name: "ping",
    description: "pong",
    input_schema: { type: "object", properties: {} },
  },
  handler: () => () => ({ kind: "continue", toolResult: "pong" }),
};

describe("buildReadDispatch", () => {
  it("returns the definitions of the selected tools", () => {
    const db = freshDb();
    const { definitions } = buildReadDispatch([echoTool, pingTool], {
      db,
      userId: 1,
      tz: "America/New_York",
      now: new Date("2026-06-24T12:00:00Z"),
    });
    expect(definitions.map((d) => d.name)).toEqual(["echo", "ping"]);
  });

  it("routes a call to the matching handler, scoped to ctx.userId", () => {
    const db = freshDb();
    const { dispatch } = buildReadDispatch([echoTool, pingTool], {
      db,
      userId: 42,
      tz: "America/New_York",
      now: new Date("2026-06-24T12:00:00Z"),
    });
    const out = dispatch("echo", { hello: "world" });
    expect(out.kind).toBe("continue");
    expect((out as { toolResult: { userId: number; got: unknown } }).toolResult).toEqual({
      userId: 42,
      got: { hello: "world" },
    });
  });

  it("returns an unknown-tool error for a name not in the set", () => {
    const db = freshDb();
    const { dispatch } = buildReadDispatch([pingTool], {
      db,
      userId: 1,
      tz: "America/New_York",
      now: new Date("2026-06-24T12:00:00Z"),
    });
    const out = dispatch("nope", {});
    expect((out as { toolResult: { error?: string } }).toolResult.error).toBe("unknown tool: nope");
  });

  it("catches a throwing handler and returns a continue error (never throws out)", () => {
    const db = freshDb();
    const boom: ReadTool = {
      definition: {
        name: "boom",
        description: "throws",
        input_schema: { type: "object", properties: {} },
      },
      handler: () => () => {
        throw new Error("kaboom");
      },
    };
    const { dispatch } = buildReadDispatch([boom], {
      db,
      userId: 1,
      tz: "America/New_York",
      now: new Date("2026-06-24T12:00:00Z"),
    });
    const out = dispatch("boom", {});
    expect(out.kind).toBe("continue");
    expect((out as { toolResult: { error?: string } }).toolResult.error).toContain("kaboom");
  });

  it("composes an empty tool set: no definitions, every call is unknown-tool", () => {
    const db = freshDb();
    const { definitions, dispatch } = buildReadDispatch([], {
      db,
      userId: 1,
      tz: "America/New_York",
      now: new Date("2026-06-24T12:00:00Z"),
    });
    expect(definitions).toEqual([]);
    const out = dispatch("anything", {});
    expect(out.kind).toBe("continue");
    expect((out as { toolResult: { error?: string } }).toolResult.error).toBe(
      "unknown tool: anything",
    );
  });
});

describe("migrated insights read tools", () => {
  function seededDb() {
    const db = freshDb();
    db.prepare(
      "INSERT INTO users (name, email, timezone) VALUES ('Jeff','j@e.com','America/New_York')",
    ).run();
    return db;
  }
  const CTX = (db: ReturnType<typeof freshDb>) => ({
    db,
    userId: 1,
    tz: "America/New_York",
    now: new Date("2026-06-23T18:00:00Z"),
  });

  it("get_report returns rendered markdown for today (no date)", () => {
    const db = seededDb();
    const { dispatch } = buildReadDispatch([getReportTool], CTX(db));
    const out = dispatch("get_report", {});
    expect(out.kind).toBe("continue");
    expect(typeof (out as { toolResult: unknown }).toolResult).toBe("string");
  });

  it("get_report rejects a malformed date", () => {
    const db = seededDb();
    const { dispatch } = buildReadDispatch([getReportTool], CTX(db));
    const out = dispatch("get_report", { date: "June 1" });
    expect((out as { toolResult: { error?: string } }).toolResult.error).toBeTruthy();
  });

  it("get_phase_history returns an array scoped to the user", () => {
    const db = seededDb();
    const { dispatch } = buildReadDispatch([getPhaseHistoryTool], CTX(db));
    const out = dispatch("get_phase_history", {});
    expect(Array.isArray((out as { toolResult: unknown }).toolResult)).toBe(true);
  });

  it("get_weight_trend returns a point array", () => {
    const db = seededDb();
    const { dispatch } = buildReadDispatch([getWeightTrendTool], CTX(db));
    const out = dispatch("get_weight_trend", {});
    expect(Array.isArray((out as { toolResult: unknown }).toolResult)).toBe(true);
  });

  it("get_macros_range builds a day window and the cap is 90", () => {
    const db = seededDb();
    const { dispatch } = buildReadDispatch([getMacrosRangeTool], CTX(db));
    const out = dispatch("get_macros_range", { from_date: "2026-06-01", to_date: "2026-06-03" });
    const result = (out as { toolResult: { days?: unknown[] } }).toolResult;
    expect(result.days?.length).toBe(3);
    expect(MAX_MACROS_RANGE_DAYS).toBe(90);
  });

  it("get_macros_range marks days with no meals logged", () => {
    const db = seededDb();
    createMeal(db, {
      user_id: 1,
      eaten_at: "2026-06-01T13:00:00Z",
      name: "Oatmeal",
      kcal: 300,
      protein_g: 12,
      carb_g: 50,
      fat_g: 6,
    });
    const { dispatch } = buildReadDispatch([getMacrosRangeTool], CTX(db));
    const out = dispatch("get_macros_range", { from_date: "2026-06-01", to_date: "2026-06-02" });
    const days = (out as { toolResult: { days: Array<{ date: string; meals_logged: boolean }> } })
      .toolResult.days;
    expect(days.find((d) => d.date === "2026-06-01")?.meals_logged).toBe(true);
    expect(days.find((d) => d.date === "2026-06-02")?.meals_logged).toBe(false);
  });
});

describe("list_meals_for_day", () => {
  function seededDb() {
    const db = freshDb();
    db.prepare(
      "INSERT INTO users (name, email, timezone) VALUES ('Jeff','j@e.com','America/New_York')",
    ).run();
    return db;
  }
  const CTX = (db: ReturnType<typeof freshDb>) => ({
    db,
    userId: 1,
    tz: "America/New_York",
    now: new Date("2026-06-23T18:00:00Z"),
  });

  it("returns today's meals when no date is given", () => {
    const db = seededDb();
    createMeal(db, {
      user_id: 1,
      eaten_at: "2026-06-23T13:00:00Z",
      name: "Oatmeal",
      kcal: 300,
      protein_g: 12,
      carb_g: 50,
      fat_g: 6,
    });
    createMeal(db, {
      user_id: 1,
      eaten_at: "2026-06-23T17:00:00Z",
      name: "Chicken bowl",
      kcal: 680,
      protein_g: 52,
      carb_g: 74,
      fat_g: 18,
    });
    const { dispatch } = buildReadDispatch([listMealsForDayTool], CTX(db));
    const out = dispatch("list_meals_for_day", {});
    const meals = (out as { toolResult: Array<{ name: string | null; kcal: number }> }).toolResult;
    expect(meals.some((m) => m.name === "Oatmeal" && m.kcal === 300)).toBe(true);
    expect(meals.some((m) => m.name === "Chicken bowl")).toBe(true);
  });

  it("accepts an explicit past date", () => {
    const db = seededDb();
    createMeal(db, {
      user_id: 1,
      eaten_at: "2026-06-20T16:00:00Z",
      name: "Past lunch",
      kcal: 500,
      protein_g: 30,
      carb_g: 40,
      fat_g: 15,
    });
    const { dispatch } = buildReadDispatch([listMealsForDayTool], CTX(db));
    const out = dispatch("list_meals_for_day", { date: "2026-06-20" });
    const meals = (out as { toolResult: Array<{ name: string | null }> }).toolResult;
    expect(meals.some((m) => m.name === "Past lunch")).toBe(true);
  });

  it("rejects a malformed date", () => {
    const db = seededDb();
    const { dispatch } = buildReadDispatch([listMealsForDayTool], CTX(db));
    const out = dispatch("list_meals_for_day", { date: "June 20" });
    expect((out as { toolResult: { error?: string } }).toolResult.error).toBeTruthy();
  });

  it("is scoped to the authed user", () => {
    const db = seededDb();
    db.prepare(
      "INSERT INTO users (name, email, timezone) VALUES ('Other','o@e.com','America/New_York')",
    ).run();
    const otherId = Number(
      (db.prepare("SELECT id FROM users WHERE email='o@e.com'").get() as { id: number }).id,
    );
    createMeal(db, {
      user_id: otherId,
      eaten_at: "2026-06-23T17:00:00Z",
      name: "Other's dinner",
      kcal: 999,
      protein_g: 1,
      carb_g: 1,
      fat_g: 1,
    });
    const { dispatch } = buildReadDispatch([listMealsForDayTool], CTX(db));
    const out = dispatch("list_meals_for_day", {});
    const meals = (out as { toolResult: Array<{ name: string | null }> }).toolResult;
    expect(meals.some((m) => m.name === "Other's dinner")).toBe(false);
  });
});

describe("list_stored_meals", () => {
  function seededDb() {
    const db = freshDb();
    db.prepare(
      "INSERT INTO users (name, email, timezone) VALUES ('Jeff','j@e.com','America/New_York')",
    ).run();
    return db;
  }
  const CTX = (db: ReturnType<typeof freshDb>) => ({
    db,
    userId: 1,
    tz: "America/New_York",
    now: new Date("2026-06-23T18:00:00Z"),
  });

  it("returns the user's saved meals", () => {
    const db = seededDb();
    createStoredMeal(db, {
      user_id: 1,
      name: "Protein shake",
      kcal: 280,
      protein_g: 40,
      carb_g: 18,
      fat_g: 5,
    });
    const { dispatch } = buildReadDispatch([listStoredMealsTool], CTX(db));
    const out = dispatch("list_stored_meals", {});
    const meals = (out as { toolResult: Array<{ name: string; kcal: number }> }).toolResult;
    expect(meals.some((m) => m.name === "Protein shake" && m.kcal === 280)).toBe(true);
  });

  it("is scoped to the authed user", () => {
    const db = seededDb();
    db.prepare(
      "INSERT INTO users (name, email, timezone) VALUES ('Other','o@e.com','America/New_York')",
    ).run();
    const otherId = Number(
      (db.prepare("SELECT id FROM users WHERE email='o@e.com'").get() as { id: number }).id,
    );
    createStoredMeal(db, {
      user_id: otherId,
      name: "Other's smoothie",
      kcal: 999,
      protein_g: 1,
      carb_g: 1,
      fat_g: 1,
    });
    const { dispatch } = buildReadDispatch([listStoredMealsTool], CTX(db));
    const out = dispatch("list_stored_meals", {});
    const meals = (out as { toolResult: Array<{ name: string }> }).toolResult;
    expect(meals.some((m) => m.name === "Other's smoothie")).toBe(false);
  });
});

describe("get_workout_recommendation", () => {
  function seededDb() {
    const db = freshDb();
    db.prepare(
      "INSERT INTO users (name, email, timezone) VALUES ('Jeff','j@e.com','America/Toronto')",
    ).run();
    return db;
  }

  it("has the discoverable name and an intent-leading description", () => {
    expect(getWorkoutRecommendationTool.definition.name).toBe("get_workout_recommendation");
    const desc = getWorkoutRecommendationTool.definition.description.toLowerCase();
    expect(desc).toContain("workout");
    expect(desc).toMatch(/recover|muscle group/);
  });

  it("returns a continue with empty recommendations for a user with no templates", () => {
    const db = seededDb();
    const out = getWorkoutRecommendationTool.handler({
      db,
      userId: 1,
      tz: "America/Toronto",
      now: new Date("2026-06-28T12:00:00Z"),
    })({ top_n: 3 });
    expect(out.kind).toBe("continue");
    const result = (out as { kind: "continue"; toolResult: { recommendations: unknown[] } })
      .toolResult;
    expect(result.recommendations).toEqual([]);
  });
});

describe("get_training_history", () => {
  it("has the intent-leading name + description", () => {
    expect(getTrainingHistoryTool.definition.name).toBe("get_training_history");
    const d = getTrainingHistoryTool.definition.description.toLowerCase();
    expect(d).toMatch(/training|workout/);
    expect(d).toMatch(/rpe|deviation|progress|volume/);
  });

  it("returns a continue with a zeroed summary for a user with no workouts", () => {
    const db = freshDb();
    const out = getTrainingHistoryTool.handler({
      db,
      userId: 1,
      tz: "America/Toronto",
      now: new Date("2026-06-28T12:00:00Z"),
    })({ days: 14 });
    expect(out.kind).toBe("continue");
    expect(
      (out as { kind: "continue"; toolResult: { sessions: number } }).toolResult.sessions,
    ).toBe(0);
  });
});

describe("get_workout_for_day", () => {
  function seededDb() {
    const db = freshDb();
    db.prepare(
      "INSERT INTO users (name, email, timezone) VALUES ('Jeff','j@e.com','America/Toronto')",
    ).run();
    return db;
  }
  const CTX = (db: ReturnType<typeof freshDb>) => ({
    db,
    userId: 1,
    tz: "America/Toronto",
    now: new Date("2026-06-28T12:00:00Z"),
  });

  it("has the intent-leading name + description", () => {
    expect(getWorkoutForDayTool.definition.name).toBe("get_workout_for_day");
    const d = getWorkoutForDayTool.definition.description.toLowerCase();
    expect(d).toMatch(/workout|session/);
    expect(d).toMatch(/exercise|set|rep|rpe/);
  });

  it("returns [] for a day with no workouts", () => {
    const db = seededDb();
    const out = getWorkoutForDayTool.handler(CTX(db))({ date: "2026-06-28" });
    expect(out.kind).toBe("continue");
    expect((out as { toolResult: unknown[] }).toolResult).toEqual([]);
  });

  it("rejects a malformed date", () => {
    const db = seededDb();
    const out = getWorkoutForDayTool.handler(CTX(db))({ date: "June 26" });
    expect((out as { toolResult: { error?: string } }).toolResult.error).toBeTruthy();
  });

  it("returns the day's session with exercise NAMES, sets, rpe, duration", () => {
    const db = seededDb();
    const userId = 1;
    const chest = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
    const bench = createExercise(db, {
      user_id: userId,
      group_id: chest.id,
      name: "Bench Press",
    });
    const tpl = createTemplate(db, {
      user_id: userId,
      name: "PUSH",
      items: [{ exercise_id: bench.id, display_order: 1, default_sets: 3, default_reps: 10 }],
    });
    // 2026-06-26T15:00:00Z = 11am EDT — safely inside the America/Toronto user-day for 2026-06-26
    createWorkout(db, {
      user_id: userId,
      template_id: tpl.id,
      started_at: "2026-06-26T15:00:00Z",
      duration_min: 60,
      rpe: 8,
      exercises: [
        {
          exercise_id: bench.id,
          display_order: 1,
          planned_sets: 3,
          sets: [
            { reps: 10, weight_kg: 80 },
            { reps: 8, weight_kg: 85 },
          ],
        },
      ],
    });
    const out = getWorkoutForDayTool.handler(CTX(db))({ date: "2026-06-26" });
    const sessions = (
      out as {
        toolResult: Array<{
          template_name: string | null;
          rpe: number;
          duration_min: number | null;
          exercises: Array<{ name: string; sets: unknown[] }>;
        }>;
      }
    ).toolResult;
    expect(sessions).toHaveLength(1);
    const s = defined(sessions[0], "session");
    expect(s.rpe).toBe(8);
    expect(s.duration_min).toBe(60);
    expect(s.template_name).toBe("PUSH");
    const ex = defined(s.exercises[0], "exercise");
    expect(ex.name).toBe("Bench Press");
    expect(ex.sets.length).toBeGreaterThan(0);
  });

  it("is scoped to the authed user (does not return other users' workouts)", () => {
    const db = seededDb();
    db.prepare(
      "INSERT INTO users (name, email, timezone) VALUES ('Other','o@e.com','America/Toronto')",
    ).run();
    const otherId = Number(
      (db.prepare("SELECT id FROM users WHERE email='o@e.com'").get() as { id: number }).id,
    );
    const chest = createGroup(db, { user_id: otherId, name: "Chest", display_order: 1 });
    const bench = createExercise(db, { user_id: otherId, group_id: chest.id, name: "Other Bench" });
    const tpl = createTemplate(db, {
      user_id: otherId,
      name: "OTHER_PUSH",
      items: [{ exercise_id: bench.id, display_order: 1, default_sets: 3, default_reps: 10 }],
    });
    createWorkout(db, {
      user_id: otherId,
      template_id: tpl.id,
      started_at: "2026-06-26T15:00:00Z",
      duration_min: 45,
      rpe: 7,
      exercises: [
        {
          exercise_id: bench.id,
          display_order: 1,
          planned_sets: 3,
          sets: [{ reps: 10, weight_kg: 60 }],
        },
      ],
    });
    const out = getWorkoutForDayTool.handler(CTX(db))({ date: "2026-06-26" });
    const sessions = (out as { toolResult: unknown[] }).toolResult;
    expect(sessions).toHaveLength(0);
  });
});

describe("parity read tools: logged data", () => {
  function seedUser(db: ReturnType<typeof freshDb>, email: string): number {
    const r = db
      .prepare(
        "INSERT INTO users (name, dob, height_cm, sex, email, timezone) VALUES ('U','1990-01-01',180,'male',?, 'America/New_York')",
      )
      .run(email);
    return Number(r.lastInsertRowid);
  }
  const NOW = new Date("2026-09-30T16:00:00Z");
  const ctxFor = (db: ReturnType<typeof freshDb>, userId: number) => ({
    db,
    userId,
    tz: "America/New_York",
    now: NOW,
  });
  const run = (tool: ReadTool, ctx: ReturnType<typeof ctxFor>, input: unknown = {}) => {
    const out = tool.handler(ctx)(input);
    if (out.kind !== "continue") throw new Error("expected continue");
    return out.toolResult as unknown;
  };
  function twoUsers() {
    const db = freshDb();
    return { db, a: seedUser(db, "a@x.com"), b: seedUser(db, "b@x.com") };
  }

  it("get_sleep_recent returns only the caller's nights, inclusive of to_date", () => {
    const { db, a, b } = twoUsers();
    createSleepLog(db, { user_id: a, slept_on: "2026-09-29", hours: 7.5 });
    createSleepLog(db, { user_id: a, slept_on: "2026-09-30", hours: 8 });
    createSleepLog(db, { user_id: b, slept_on: "2026-09-30", hours: 6 });
    const res = run(getSleepRecentTool, ctxFor(db, a), {
      from_date: "2026-09-29",
      to_date: "2026-09-30",
    }) as Array<{ slept_on: string }>;
    expect(res.map((r) => r.slept_on).sort()).toEqual(["2026-09-29", "2026-09-30"]);
  });

  it("get_sleep_recent rejects a malformed date", () => {
    const { db, a } = twoUsers();
    expect(run(getSleepRecentTool, ctxFor(db, a), { from_date: "yesterday" })).toEqual({
      error: "from_date and to_date must be YYYY-MM-DD",
    });
  });

  it("get_steps_recent returns only the caller's rows", () => {
    const { db, a, b } = twoUsers();
    createOrUpdateStepLog(db, { user_id: a, on_date: "2026-09-30", steps: 9000 });
    createOrUpdateStepLog(db, { user_id: b, on_date: "2026-09-30", steps: 4000 });
    const res = run(getStepsRecentTool, ctxFor(db, a)) as Array<{ steps: number }>;
    expect(res.map((r) => r.steps)).toEqual([9000]);
  });

  it("get_cardio_recent returns only the caller's sessions", () => {
    const { db, a, b } = twoUsers();
    createCardioSession(db, { user_id: a, started_at: "2026-09-30T12:00:00.000Z", est_kcal: 300 });
    createCardioSession(db, { user_id: b, started_at: "2026-09-30T12:00:00.000Z", est_kcal: 500 });
    const res = run(getCardioRecentTool, ctxFor(db, a)) as Array<{ est_kcal: number }>;
    expect(res.map((r) => r.est_kcal)).toEqual([300]);
  });

  it("get_alcohol_recent returns only the caller's sessions", () => {
    const { db, a, b } = twoUsers();
    createAlcoholSession(db, {
      user_id: a,
      started_at: "2026-09-30T00:30:00.000Z",
      drinks_count: 2,
      est_kcal: 300,
    });
    createAlcoholSession(db, {
      user_id: b,
      started_at: "2026-09-30T00:30:00.000Z",
      drinks_count: 5,
      est_kcal: 700,
    });
    const res = run(getAlcoholRecentTool, ctxFor(db, a)) as Array<{ drinks_count: number }>;
    expect(res.map((r) => r.drinks_count)).toEqual([2]);
  });

  it("get_recent_workouts lists only the caller's and fetches one by id", () => {
    const { db, a, b } = twoUsers();
    const g = createGroup(db, { user_id: a, name: "Back" });
    const ex = createExercise(db, { user_id: a, name: "Row", group_id: g.id });
    const gb = createGroup(db, { user_id: b, name: "Back" });
    const exb = createExercise(db, { user_id: b, name: "Row", group_id: gb.id });
    const mine = createWorkout(db, {
      user_id: a,
      started_at: "2026-09-30T12:00:00.000Z",
      rpe: 7,
      exercises: [
        {
          exercise_id: ex.id,
          display_order: 0,
          planned_sets: 1,
          sets: [{ reps: 8, weight_kg: 60 }],
        },
      ],
    });
    const theirs = createWorkout(db, {
      user_id: b,
      started_at: "2026-09-30T12:00:00.000Z",
      rpe: 8,
      exercises: [
        {
          exercise_id: exb.id,
          display_order: 0,
          planned_sets: 1,
          sets: [{ reps: 5, weight_kg: 100 }],
        },
      ],
    });
    const list = run(getRecentWorkoutsTool, ctxFor(db, a)) as Array<{ id: number }>;
    expect(list.map((w) => w.id)).toEqual([mine.id]);
    expect(run(getRecentWorkoutsTool, ctxFor(db, a), { id: mine.id })).toMatchObject({
      id: mine.id,
    });
    expect(run(getRecentWorkoutsTool, ctxFor(db, a), { id: theirs.id })).toEqual({
      error: `workout ${theirs.id} not found`,
    });
  });

  it("list_untracked_periods returns overlapping periods for the caller", () => {
    const { db, a, b } = twoUsers();
    createUntrackedPeriod(db, {
      user_id: a,
      started_on: "2026-09-10",
      ended_on: "2026-09-17",
      reason: "vacation",
    });
    createUntrackedPeriod(db, {
      user_id: b,
      started_on: "2026-09-10",
      ended_on: "2026-09-17",
      reason: "sick",
    });
    const res = run(listUntrackedPeriodsTool, ctxFor(db, a)) as Array<{ reason: string }>;
    expect(res.map((p) => p.reason)).toEqual(["vacation"]);
  });

  it("list_workout_templates inlines exercise names", () => {
    const { db, a } = twoUsers();
    const g = createGroup(db, { user_id: a, name: "Back" });
    const ex = createExercise(db, { user_id: a, name: "Barbell Row", group_id: g.id });
    createTemplate(db, {
      user_id: a,
      name: "PULL",
      items: [{ exercise_id: ex.id, display_order: 0, default_sets: 3, default_reps: 10 }],
    });
    const res = run(listWorkoutTemplatesTool, ctxFor(db, a)) as Array<{
      name: string;
      exercises: Array<{ exercise: string; sets: number }>;
    }>;
    expect(res[0]?.name).toBe("PULL");
    expect(res[0]?.exercises[0]).toMatchObject({ exercise: "Barbell Row", sets: 3 });
  });

  it("get_user_profile returns the caller's profile without email or flags", () => {
    const { db, a } = twoUsers();
    const res = run(getUserProfileTool, ctxFor(db, a)) as Record<string, unknown>;
    expect(res.dob).toBe("1990-01-01");
    expect(res).not.toHaveProperty("email");
    expect(res).not.toHaveProperty("llm_logging_enabled");
  });

  it("get_tdee returns a TDEE with a basis", () => {
    const { db, a } = twoUsers();
    const res = run(getTdeeTool, ctxFor(db, a)) as { basis?: string };
    expect(typeof res.basis).toBe("string");
  });

  it("get_day_status returns status and next best action", () => {
    const { db, a } = twoUsers();
    const res = run(getDayStatusTool, ctxFor(db, a)) as Record<string, unknown>;
    expect(res).toHaveProperty("day_status");
    expect(res).toHaveProperty("next_best_action");
  });

  it("get_accomplishments returns recent wins and history", () => {
    const { db, a } = twoUsers();
    const res = run(getAccomplishmentsTool, ctxFor(db, a)) as Record<string, unknown>;
    expect(res).toHaveProperty("recent");
    expect(res).toHaveProperty("history");
  });

  it("list_stored_meals includes 14-day usage", () => {
    const { db, a } = twoUsers();
    createStoredMeal(db, {
      user_id: a,
      name: "Shake",
      kcal: 300,
      protein_g: 40,
      carb_g: 20,
      fat_g: 5,
    });
    createMeal(db, {
      user_id: a,
      eaten_at: "2026-09-29T14:00:00.000Z",
      name: "shake",
      kcal: 300,
      protein_g: 40,
      carb_g: 20,
      fat_g: 5,
    });
    const res = run(listStoredMealsTool, ctxFor(db, a)) as Array<{
      recent_uses: number;
      last_used_at: string | null;
    }>;
    expect(res[0]?.recent_uses).toBe(1);
    expect(res[0]?.last_used_at).toBe("2026-09-29T14:00:00.000Z");
  });
});
