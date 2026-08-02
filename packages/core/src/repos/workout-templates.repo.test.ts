import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import { createGroup } from "./exercise-groups.repo.js";
import { createExercise } from "./exercises.repo.js";
import {
  archiveTemplate,
  createTemplate,
  findTemplateById,
  listTemplates,
  replaceTemplateItems,
  unarchiveTemplate,
  updateTemplate,
} from "./workout-templates.repo.js";

describe("workout-templates.repo", () => {
  function setup() {
    const db = freshDb();
    const userId = seedUser(db);
    const g = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
    const e1 = createExercise(db, { user_id: userId, group_id: g.id, name: "Push-up" });
    const e2 = createExercise(db, {
      user_id: userId,
      group_id: g.id,
      name: "Incline Press",
    });
    return { db, userId, e1, e2 };
  }

  it("creates a template with nested items, ordered by display_order regardless of insertion order", () => {
    const { db, userId, e1, e2 } = setup();
    const t = createTemplate(db, {
      user_id: userId,
      name: "PUSH",
      items: [
        // Insert e2 (display_order 2) FIRST, then e1 (display_order 1).
        // The SELECT's ORDER BY must put e1 first in the returned items array.
        {
          exercise_id: e2.id,
          display_order: 2,
          default_sets: 3,
          default_reps: 10,
          default_weight_kg: 20.4,
        },
        { exercise_id: e1.id, display_order: 1, default_sets: 3, default_reps: 12 },
      ],
    });
    const full = findTemplateById(db, userId, t.id);
    expect(full?.items?.length).toBe(2);
    // Strict ordering — a regression that drops ORDER BY would put e2 first.
    expect(full?.items?.map((i) => i.exercise_id)).toEqual([e1.id, e2.id]);
    expect(full?.items?.[0]?.default_reps).toBe(12);
    expect(full?.items?.[1]?.default_weight_kg).toBe(20.4);
  });

  it("replaceTemplateItems is atomic", () => {
    const { db, userId, e1, e2 } = setup();
    const t = createTemplate(db, {
      user_id: userId,
      name: "PUSH",
      items: [{ exercise_id: e1.id, display_order: 1, default_sets: 3, default_reps: 12 }],
    });
    replaceTemplateItems(db, t.id, [
      { exercise_id: e2.id, display_order: 1, default_sets: 4, default_reps: 8 },
    ]);
    const full = findTemplateById(db, userId, t.id);
    expect(full?.items?.map((i) => i.exercise_id)).toEqual([e2.id]);
    expect(full?.items?.[0]?.default_sets).toBe(4);
  });

  it("createTemplate with empty items array creates a template with no items", () => {
    const { db, userId } = setup();
    const t = createTemplate(db, {
      user_id: userId,
      name: "EMPTY",
      items: [],
    });
    expect(t.items).toEqual([]);
    expect(findTemplateById(db, userId, t.id)?.items).toEqual([]);
  });

  it("replaceTemplateItems with empty array clears all items", () => {
    const { db, userId, e1 } = setup();
    const t = createTemplate(db, {
      user_id: userId,
      name: "PUSH",
      items: [{ exercise_id: e1.id, display_order: 1, default_sets: 3, default_reps: 12 }],
    });
    replaceTemplateItems(db, t.id, []);
    expect(findTemplateById(db, userId, t.id)?.items).toEqual([]);
  });

  it("listTemplates returns each template with its items inline, grouped correctly", () => {
    const { db, userId, e1, e2 } = setup();
    createTemplate(db, {
      user_id: userId,
      name: "PUSH",
      items: [
        { exercise_id: e1.id, display_order: 0, default_sets: 3, default_reps: 10 },
        { exercise_id: e2.id, display_order: 1, default_sets: 4, default_reps: 8 },
      ],
    });
    createTemplate(db, {
      user_id: userId,
      name: "PULL",
      items: [{ exercise_id: e1.id, display_order: 0, default_sets: 5, default_reps: 5 }],
    });
    const all = listTemplates(db, userId);
    // ORDER BY name → PULL, PUSH
    expect(all.map((t) => t.name)).toEqual(["PULL", "PUSH"]);
    const pull = all.find((t) => t.name === "PULL");
    const push = all.find((t) => t.name === "PUSH");
    // Items should not cross-contaminate between templates.
    expect(pull?.items?.length).toBe(1);
    expect(pull?.items?.[0]?.default_sets).toBe(5);
    expect(push?.items?.length).toBe(2);
    expect(push?.items?.map((i) => i.display_order)).toEqual([0, 1]);
  });

  it("listTemplates returns an empty items array for templates with no items", () => {
    const { db, userId } = setup();
    createTemplate(db, { user_id: userId, name: "EMPTY", items: [] });
    const [tpl] = listTemplates(db, userId);
    expect(tpl?.items).toEqual([]);
  });

  it("listTemplates excludes archived by default", () => {
    const { db, userId, e1 } = setup();
    const a = createTemplate(db, {
      user_id: userId,
      name: "PUSH",
      items: [{ exercise_id: e1.id, display_order: 1, default_sets: 3 }],
    });
    createTemplate(db, {
      user_id: userId,
      name: "PULL",
      items: [{ exercise_id: e1.id, display_order: 1, default_sets: 3 }],
    });
    archiveTemplate(db, userId, a.id);
    expect(listTemplates(db, userId).map((t) => t.name)).toEqual(["PULL"]);
  });

  it("allows reusing a template name after archiving the original", () => {
    const { db, userId, e1 } = setup();
    const first = createTemplate(db, {
      user_id: userId,
      name: "PUSH",
      items: [{ exercise_id: e1.id, display_order: 1, default_sets: 3 }],
    });
    archiveTemplate(db, userId, first.id);
    const second = createTemplate(db, {
      user_id: userId,
      name: "PUSH",
      items: [{ exercise_id: e1.id, display_order: 1, default_sets: 3 }],
    });
    expect(second.id).not.toBe(first.id);
    expect(second.archived_at).toBeNull();
  });

  it("unarchive collision throws when an active row has the same name", () => {
    const { db, userId, e1 } = setup();
    const first = createTemplate(db, {
      user_id: userId,
      name: "PUSH",
      items: [{ exercise_id: e1.id, display_order: 1, default_sets: 3 }],
    });
    archiveTemplate(db, userId, first.id);
    createTemplate(db, {
      user_id: userId,
      name: "PUSH",
      items: [{ exercise_id: e1.id, display_order: 1, default_sets: 3 }],
    });
    expect(() => unarchiveTemplate(db, userId, first.id)).toThrow(/UNIQUE constraint failed/);
  });

  it("unarchiveTemplate clears archived_at", () => {
    const { db, userId, e1 } = setup();
    const t = createTemplate(db, {
      user_id: userId,
      name: "PUSH",
      items: [{ exercise_id: e1.id, display_order: 1, default_sets: 3 }],
    });
    archiveTemplate(db, userId, t.id);
    expect(findTemplateById(db, userId, t.id)?.archived_at).not.toBeNull();
    unarchiveTemplate(db, userId, t.id);
    expect(findTemplateById(db, userId, t.id)?.archived_at).toBeNull();
  });

  it("archiveTemplate on a nonexistent id is a silent no-op", () => {
    const { db, userId } = setup();
    expect(() => archiveTemplate(db, userId, 999)).not.toThrow();
  });

  it("unarchiveTemplate on a nonexistent id is a silent no-op", () => {
    const { db, userId } = setup();
    expect(() => unarchiveTemplate(db, userId, 999)).not.toThrow();
  });

  it("findTemplateById returns null when missing", () => {
    const { db, userId } = setup();
    expect(findTemplateById(db, userId, 999)).toBeNull();
  });

  it("updateTemplate on a nonexistent id returns null", () => {
    const { db, userId } = setup();
    expect(updateTemplate(db, userId, 999, { name: "Nope" })).toBeNull();
  });

  it("updateTemplate with empty patch returns the current row (re-fetch)", () => {
    const { db, userId, e1 } = setup();
    const t = createTemplate(db, {
      user_id: userId,
      name: "PUSH",
      items: [{ exercise_id: e1.id, display_order: 1, default_sets: 3 }],
    });
    const result = updateTemplate(db, userId, t.id, {});
    expect(result?.name).toBe("PUSH");
  });

  it("updateTemplate silently ignores keys outside the allowlist", () => {
    const { db, userId, e1 } = setup();
    const t = createTemplate(db, {
      user_id: userId,
      name: "PUSH",
      items: [{ exercise_id: e1.id, display_order: 1, default_sets: 3 }],
    });
    updateTemplate(db, userId, t.id, { name: "Renamed", id: 999, user_id: 999 } as never);
    const after = findTemplateById(db, userId, t.id);
    expect(after?.id).toBe(t.id);
    expect(after?.user_id).toBe(userId);
    expect(after?.name).toBe("Renamed");
  });

  it("findTemplateById does not return another user's template", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const gA = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    const eA = createExercise(db, { user_id: userA, group_id: gA.id, name: "X" });
    const t = createTemplate(db, {
      user_id: userA,
      name: "PUSH",
      items: [{ exercise_id: eA.id, display_order: 1, default_sets: 3 }],
    });
    expect(findTemplateById(db, userB, t.id)).toBeNull();
    expect(findTemplateById(db, userA, t.id)?.id).toBe(t.id);
  });

  it("updateTemplate cannot mutate another user's template", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const gA = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    const eA = createExercise(db, { user_id: userA, group_id: gA.id, name: "X" });
    const t = createTemplate(db, {
      user_id: userA,
      name: "PUSH",
      items: [{ exercise_id: eA.id, display_order: 1, default_sets: 3 }],
    });
    expect(updateTemplate(db, userB, t.id, { name: "Hacked" })).toBeNull();
    expect(findTemplateById(db, userA, t.id)?.name).toBe("PUSH");
  });

  it("archiveTemplate cannot archive another user's template", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const gA = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    const eA = createExercise(db, { user_id: userA, group_id: gA.id, name: "X" });
    const t = createTemplate(db, {
      user_id: userA,
      name: "PUSH",
      items: [{ exercise_id: eA.id, display_order: 1, default_sets: 3 }],
    });
    archiveTemplate(db, userB, t.id);
    expect(findTemplateById(db, userA, t.id)?.archived_at).toBeNull();
  });

  it("unarchiveTemplate cannot unarchive another user's template", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const gA = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    const eA = createExercise(db, { user_id: userA, group_id: gA.id, name: "X" });
    const t = createTemplate(db, {
      user_id: userA,
      name: "PUSH",
      items: [{ exercise_id: eA.id, display_order: 1, default_sets: 3 }],
    });
    archiveTemplate(db, userA, t.id);
    unarchiveTemplate(db, userB, t.id);
    expect(findTemplateById(db, userA, t.id)?.archived_at).not.toBeNull();
  });

  it("listTemplates filters by user_id", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const gA = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    const gB = createGroup(db, { user_id: userB, name: "Chest", display_order: 1 });
    const eA = createExercise(db, { user_id: userA, group_id: gA.id, name: "X" });
    const eB = createExercise(db, { user_id: userB, group_id: gB.id, name: "Y" });
    createTemplate(db, {
      user_id: userA,
      name: "PUSH",
      items: [{ exercise_id: eA.id, display_order: 1, default_sets: 3 }],
    });
    createTemplate(db, {
      user_id: userB,
      name: "PUSH",
      items: [{ exercise_id: eB.id, display_order: 1, default_sets: 3 }],
    });
    const aList = listTemplates(db, userA);
    expect(aList.length).toBe(1);
    expect(aList[0]?.user_id).toBe(userA);
  });
});
