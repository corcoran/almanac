import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import {
  createGroup,
  deleteGroup,
  findGroupById,
  listGroups,
  updateGroup,
} from "./exercise-groups.repo.js";

describe("exercise-groups.repo", () => {
  it("creates and lists groups in display order", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createGroup(db, { user_id: userId, name: "Back", display_order: 2 });
    createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
    const groups = listGroups(db, userId);
    expect(groups.map((g) => g.name)).toEqual(["Chest", "Back"]);
  });

  it("enforces unique name per user", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
    expect(() => createGroup(db, { user_id: userId, name: "Chest", display_order: 2 })).toThrow(
      /UNIQUE constraint failed/,
    );
  });

  it("updates and deletes", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const g = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
    const updated = updateGroup(db, userId, g.id, { name: "Pecs" });
    expect(updated?.name).toBe("Pecs");
    deleteGroup(db, userId, g.id);
    expect(listGroups(db, userId)).toEqual([]);
  });

  it("findGroupById returns null when missing", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(findGroupById(db, userId, 999)).toBeNull();
  });

  it("updateGroup on a nonexistent id returns null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(updateGroup(db, userId, 999, { name: "Nope" })).toBeNull();
  });

  it("updateGroup with empty patch returns the current row (re-fetch)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const g = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
    const result = updateGroup(db, userId, g.id, {});
    expect(result?.name).toBe("Chest");
  });

  it("updateGroup silently ignores keys outside the allowlist", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const g = createGroup(db, { user_id: userId, name: "Chest", display_order: 1 });
    updateGroup(db, userId, g.id, { name: "Pecs", id: 999, user_id: 999 } as never);
    const after = findGroupById(db, userId, g.id);
    expect(after?.id).toBe(g.id);
    expect(after?.user_id).toBe(userId);
    expect(after?.name).toBe("Pecs");
  });

  it("findGroupById does not return another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const g = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    expect(findGroupById(db, userB, g.id)).toBeNull();
    expect(findGroupById(db, userA, g.id)?.id).toBe(g.id);
  });

  it("updateGroup cannot mutate another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const g = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    expect(updateGroup(db, userB, g.id, { name: "Hacked" })).toBeNull();
    expect(findGroupById(db, userA, g.id)?.name).toBe("Chest");
  });

  it("deleteGroup cannot delete another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const g = createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    deleteGroup(db, userB, g.id);
    expect(findGroupById(db, userA, g.id)?.id).toBe(g.id);
  });

  it("listGroups filters by user_id", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    createGroup(db, { user_id: userA, name: "Chest", display_order: 1 });
    createGroup(db, { user_id: userB, name: "Chest", display_order: 1 });
    const aGroups = listGroups(db, userA);
    expect(aGroups.length).toBe(1);
    expect(aGroups[0]?.user_id).toBe(userA);
  });
});
