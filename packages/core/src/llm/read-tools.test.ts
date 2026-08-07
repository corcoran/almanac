import { describe, expect, it } from "vitest";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { createGroup } from "../repos/exercise-groups.repo.js";
import { createExercise } from "../repos/exercises.repo.js";
import { createMeal } from "../repos/meals.repo.js";
import { createStoredMeal } from "../repos/stored-meals.repo.js";
import { createTemplate } from "../repos/workout-templates.repo.js";
import { createWorkout } from "../repos/workouts.repo.js";
import { defined } from "../test-support/index.js";
import {
  buildReadDispatch,
  getMacrosRangeTool,
  getPhaseHistoryTool,
  getReportTool,
  getTrainingHistoryTool,
  getWeightTrendTool,
  getWorkoutForDayTool,
  getWorkoutRecommendationTool,
  listMealsForDayTool,
  listStoredMealsTool,
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
