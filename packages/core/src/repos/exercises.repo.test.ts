import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import { createGroup } from "./exercise-groups.repo.js";
import {
  archiveExercise,
  createExercise,
  findExerciseById,
  listExercises,
  unarchiveExercise,
  updateExercise,
} from "./exercises.repo.js";

function setup() {
  const db = freshDb();
  const userId = seedUser(db);
  const group = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
  return { db, userId, groupId: group.id };
}

describe("exercises.repo", () => {
  it("creates an exercise and finds by id", () => {
    const { db, userId, groupId } = setup();
    const ex = createExercise(db, {
      user_id: userId,
      group_id: groupId,
      name: "Incline DB Press (30 deg)",
    });
    expect(ex.id).toBeGreaterThan(0);
    expect(ex.name).toBe("Incline DB Press (30 deg)");
    expect(findExerciseById(db, userId, ex.id)?.name).toBe("Incline DB Press (30 deg)");
  });

  it("enforces unique name per user among active rows", () => {
    const { db, userId, groupId } = setup();
    createExercise(db, { user_id: userId, group_id: groupId, name: "Push-up" });
    expect(() =>
      createExercise(db, { user_id: userId, group_id: groupId, name: "Push-up" }),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("allows reusing a name after the original is archived", () => {
    const { db, userId, groupId } = setup();
    const first = createExercise(db, { user_id: userId, group_id: groupId, name: "Push-up" });
    archiveExercise(db, userId, first.id);
    // Should now succeed because the partial UNIQUE index only covers active rows.
    const second = createExercise(db, { user_id: userId, group_id: groupId, name: "Push-up" });
    expect(second.id).not.toBe(first.id);
    expect(second.archived_at).toBeNull();
  });

  it("unarchive of one row when another active row has the same name throws", () => {
    const { db, userId, groupId } = setup();
    const first = createExercise(db, { user_id: userId, group_id: groupId, name: "Push-up" });
    archiveExercise(db, userId, first.id);
    createExercise(db, { user_id: userId, group_id: groupId, name: "Push-up" });
    expect(() => unarchiveExercise(db, userId, first.id)).toThrow(/UNIQUE constraint failed/);
  });

  it("lists non-archived exercises only by default; filters by group", () => {
    const { db, userId, groupId } = setup();
    const a = createExercise(db, { user_id: userId, group_id: groupId, name: "A" });
    createExercise(db, { user_id: userId, group_id: groupId, name: "B" });
    archiveExercise(db, userId, a.id);
    const active = listExercises(db, userId, { groupId });
    expect(active.map((e) => e.name)).toEqual(["B"]);
    const all = listExercises(db, userId, { groupId, includeArchived: true });
    expect(all.map((e) => e.name).sort()).toEqual(["A", "B"]);
  });

  it("updates notes via updateExercise", () => {
    const { db, userId, groupId } = setup();
    const ex = createExercise(db, { user_id: userId, group_id: groupId, name: "X" });
    updateExercise(db, userId, ex.id, { notes: "tempo 4-5s" });
    expect(findExerciseById(db, userId, ex.id)?.notes).toBe("tempo 4-5s");
  });

  it("archiveExercise sets archived_at; row remains findable by id", () => {
    const { db, userId, groupId } = setup();
    const ex = createExercise(db, { user_id: userId, group_id: groupId, name: "Y" });
    archiveExercise(db, userId, ex.id);
    const row = findExerciseById(db, userId, ex.id);
    expect(row?.archived_at).not.toBeNull();
  });

  it("unarchiveExercise clears archived_at", () => {
    const { db, userId, groupId } = setup();
    const ex = createExercise(db, { user_id: userId, group_id: groupId, name: "U" });
    archiveExercise(db, userId, ex.id);
    expect(findExerciseById(db, userId, ex.id)?.archived_at).not.toBeNull();
    unarchiveExercise(db, userId, ex.id);
    expect(findExerciseById(db, userId, ex.id)?.archived_at).toBeNull();
  });

  it("archiveExercise on a nonexistent id is a silent no-op", () => {
    const { db, userId } = setup();
    expect(() => archiveExercise(db, userId, 999)).not.toThrow();
  });

  it("unarchiveExercise on a nonexistent id is a silent no-op", () => {
    const { db, userId } = setup();
    expect(() => unarchiveExercise(db, userId, 999)).not.toThrow();
  });

  it("findExerciseById returns null when missing", () => {
    const { db, userId } = setup();
    expect(findExerciseById(db, userId, 999)).toBeNull();
  });

  it("updateExercise on a nonexistent id returns null", () => {
    const { db, userId } = setup();
    expect(updateExercise(db, userId, 999, { name: "Nope" })).toBeNull();
  });

  it("updateExercise with empty patch returns the current row (re-fetch)", () => {
    const { db, userId, groupId } = setup();
    const ex = createExercise(db, { user_id: userId, group_id: groupId, name: "Z" });
    const result = updateExercise(db, userId, ex.id, {});
    expect(result?.name).toBe("Z");
  });

  it("updateExercise silently ignores keys outside the allowlist", () => {
    const { db, userId, groupId } = setup();
    const ex = createExercise(db, { user_id: userId, group_id: groupId, name: "W" });
    updateExercise(db, userId, ex.id, { notes: "ok", id: 999, user_id: 999 } as never);
    const after = findExerciseById(db, userId, ex.id);
    expect(after?.id).toBe(ex.id);
    expect(after?.user_id).toBe(userId);
    expect(after?.notes).toBe("ok");
  });

  it("findExerciseById does not return another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const groupA = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    const ex = createExercise(db, { user_id: userA, group_id: groupA.id, name: "Push-up" });
    expect(findExerciseById(db, userB, ex.id)).toBeNull();
    expect(findExerciseById(db, userA, ex.id)?.id).toBe(ex.id);
  });

  it("updateExercise cannot mutate another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const groupA = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    const ex = createExercise(db, { user_id: userA, group_id: groupA.id, name: "Push-up" });
    expect(updateExercise(db, userB, ex.id, { notes: "hacked" })).toBeNull();
    expect(findExerciseById(db, userA, ex.id)?.notes ?? null).toBeNull();
  });

  it("archiveExercise cannot archive another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const groupA = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    const ex = createExercise(db, { user_id: userA, group_id: groupA.id, name: "Push-up" });
    archiveExercise(db, userB, ex.id);
    expect(findExerciseById(db, userA, ex.id)?.archived_at).toBeNull();
  });

  it("unarchiveExercise cannot unarchive another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const groupA = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    const ex = createExercise(db, { user_id: userA, group_id: groupA.id, name: "Push-up" });
    archiveExercise(db, userA, ex.id);
    unarchiveExercise(db, userB, ex.id);
    expect(findExerciseById(db, userA, ex.id)?.archived_at).not.toBeNull();
  });

  it("listExercises filters by user_id", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const groupA = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    const groupB = createGroup(db, { user_id: userB, name: "Chest", display_order: 1 });
    createExercise(db, { user_id: userA, group_id: groupA.id, name: "Push-up" });
    createExercise(db, { user_id: userB, group_id: groupB.id, name: "Push-up" });
    const aList = listExercises(db, userA);
    expect(aList.length).toBe(1);
    expect(aList[0]?.user_id).toBe(userA);
  });
});
