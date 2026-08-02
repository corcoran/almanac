import { defined } from "@almanac/core/test-support";
import { describe, expect, it } from "vitest";
import { createGroup } from "../repos/exercise-groups.repo.js";
import { createExercise } from "../repos/exercises.repo.js";
import { createTemplate } from "../repos/workout-templates.repo.js";
import { freshDb, seedUser } from "../test-support/db.js";
import { recommendTemplateForUser } from "./recommend-template-for-user.js";

describe("recommendTemplateForUser", () => {
  it("returns empty recommendations when the user has no templates", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const out = recommendTemplateForUser(db, userId, new Date("2026-06-28T12:00:00Z"), {
      topN: 3,
    });
    expect(out.recommendations).toEqual([]);
  });

  it("ranks the user's templates and honors topN", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const g = createGroup(db, { user_id: userId, name: "Push", display_order: 1 });
    const e = createExercise(db, { user_id: userId, group_id: g.id, name: "Bench Press" });
    createTemplate(db, {
      user_id: userId,
      name: "PUSH A",
      items: [{ exercise_id: e.id, display_order: 1, default_sets: 3, default_reps: 8 }],
    });
    createTemplate(db, {
      user_id: userId,
      name: "PUSH B",
      items: [{ exercise_id: e.id, display_order: 1, default_sets: 4, default_reps: 6 }],
    });
    const out = recommendTemplateForUser(db, userId, new Date("2026-06-28T12:00:00Z"), {
      topN: 1,
    });
    expect(out.recommendations).toHaveLength(1);
    const top = defined(out.recommendations[0], "top rec");
    expect(typeof top.template_name).toBe("string");
    expect(top.reasoning).toHaveProperty("too_soon_groups_hit");
  });
});
