import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import {
  createBodyWeight,
  deleteBodyWeight,
  findBodyWeightById,
  listBodyWeights,
  updateBodyWeight,
} from "./body-weights.repo.js";

describe("body-weights.repo", () => {
  it("createBodyWeight returns the new row with all fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const bw = createBodyWeight(db, {
      user_id: userId,
      measured_on: "2026-05-12",
      weight_kg: 80.5,
    });
    expect(bw.id).toBeGreaterThan(0);
    expect(bw.weight_kg).toBe(80.5);
    expect(bw.user_id).toBe(userId);
    expect(bw.measured_on).toBe("2026-05-12");
  });

  it("findBodyWeightById returns null when missing", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(findBodyWeightById(db, userId, 999)).toBeNull();
  });

  it("listBodyWeights orders by measured_on DESC", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createBodyWeight(db, { user_id: userId, measured_on: "2026-05-10", weight_kg: 81 });
    createBodyWeight(db, { user_id: userId, measured_on: "2026-05-12", weight_kg: 80 });
    createBodyWeight(db, { user_id: userId, measured_on: "2026-05-11", weight_kg: 80.5 });
    const list = listBodyWeights(db, userId);
    expect(list.map((b) => b.measured_on)).toEqual(["2026-05-12", "2026-05-11", "2026-05-10"]);
  });

  it("listBodyWeights filters by from/to range on measured_on", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createBodyWeight(db, { user_id: userId, measured_on: "2026-05-10", weight_kg: 81 });
    createBodyWeight(db, { user_id: userId, measured_on: "2026-05-12", weight_kg: 80 });
    const inRange = listBodyWeights(db, userId, {
      from: "2026-05-11",
      to: "2026-05-13",
    });
    expect(inRange.length).toBe(1);
    expect(inRange[0]?.measured_on).toBe("2026-05-12");
  });

  it("listBodyWeights respects limit", () => {
    const db = freshDb();
    const userId = seedUser(db);
    for (let i = 1; i <= 5; i++) {
      createBodyWeight(db, {
        user_id: userId,
        measured_on: `2026-05-0${i}`,
        weight_kg: 80 + i,
      });
    }
    expect(listBodyWeights(db, userId, { limit: 2 }).length).toBe(2);
  });

  it("listBodyWeights filters by user_id", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    createBodyWeight(db, { user_id: userA, measured_on: "2026-05-12", weight_kg: 80 });
    createBodyWeight(db, { user_id: userB, measured_on: "2026-05-12", weight_kg: 75 });
    const aList = listBodyWeights(db, userA);
    expect(aList.length).toBe(1);
    expect(aList[0]?.user_id).toBe(userA);
  });

  it("updateBodyWeight mutates only provided fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const bw = createBodyWeight(db, {
      user_id: userId,
      measured_on: "2026-05-12",
      weight_kg: 80.5,
      notes: "morning",
    });
    updateBodyWeight(db, userId, bw.id, { weight_kg: 81.2 });
    const after = findBodyWeightById(db, userId, bw.id);
    expect(after?.weight_kg).toBe(81.2);
    expect(after?.notes).toBe("morning");
  });

  it("updateBodyWeight on a nonexistent id returns null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(updateBodyWeight(db, userId, 999, { weight_kg: 80 })).toBeNull();
  });

  it("updateBodyWeight with empty patch returns the current row (re-fetch)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const bw = createBodyWeight(db, {
      user_id: userId,
      measured_on: "2026-05-12",
      weight_kg: 80,
    });
    const result = updateBodyWeight(db, userId, bw.id, {});
    expect(result?.weight_kg).toBe(80);
  });

  it("updateBodyWeight silently ignores keys outside the allowlist (including measured_on)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const bw = createBodyWeight(db, {
      user_id: userId,
      measured_on: "2026-05-12",
      weight_kg: 80,
    });
    updateBodyWeight(db, userId, bw.id, {
      weight_kg: 81,
      // None of these should reach SQL:
      id: 999,
      user_id: 999,
      measured_on: "2026-05-15",
    } as never);
    const after = findBodyWeightById(db, userId, bw.id);
    expect(after?.id).toBe(bw.id);
    expect(after?.user_id).toBe(userId);
    expect(after?.measured_on).toBe("2026-05-12"); // measured_on did NOT change
    expect(after?.weight_kg).toBe(81); // legitimate update applied
  });

  it("deleteBodyWeight removes the row", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const bw = createBodyWeight(db, {
      user_id: userId,
      measured_on: "2026-05-12",
      weight_kg: 80,
    });
    deleteBodyWeight(db, userId, bw.id);
    expect(findBodyWeightById(db, userId, bw.id)).toBeNull();
  });

  // --- Ownership scoping (IDOR fix): by-id ops must be scoped to the owner ---

  it("findBodyWeightById does not return another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const bw = createBodyWeight(db, { user_id: userA, measured_on: "2026-05-12", weight_kg: 80 });
    expect(findBodyWeightById(db, userA, bw.id)?.id).toBe(bw.id);
    expect(findBodyWeightById(db, userB, bw.id)).toBeNull();
  });

  it("updateBodyWeight cannot mutate another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const bw = createBodyWeight(db, { user_id: userA, measured_on: "2026-05-12", weight_kg: 80 });
    expect(updateBodyWeight(db, userB, bw.id, { weight_kg: 999 })).toBeNull();
    expect(findBodyWeightById(db, userA, bw.id)?.weight_kg).toBe(80);
  });

  it("deleteBodyWeight cannot delete another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const bw = createBodyWeight(db, { user_id: userA, measured_on: "2026-05-12", weight_kg: 80 });
    deleteBodyWeight(db, userB, bw.id);
    expect(findBodyWeightById(db, userA, bw.id)?.id).toBe(bw.id);
  });

  it("listBodyWeights from is inclusive — a row exactly on the boundary is included", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createBodyWeight(db, { user_id: userId, measured_on: "2026-05-12", weight_kg: 80 });
    const result = listBodyWeights(db, userId, { from: "2026-05-12" });
    expect(result.length).toBe(1);
  });

  it("listBodyWeights to is exclusive — a row exactly on the boundary is excluded", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createBodyWeight(db, { user_id: userId, measured_on: "2026-05-12", weight_kg: 80 });
    const result = listBodyWeights(db, userId, { to: "2026-05-12" });
    expect(result.length).toBe(0);
  });

  it("listBodyWeights clamps limit at 200 even when caller requests more", () => {
    const db = freshDb();
    const userId = seedUser(db);
    for (let i = 1; i <= 3; i++) {
      createBodyWeight(db, {
        user_id: userId,
        measured_on: `2026-05-0${i}`,
        weight_kg: 80,
      });
    }
    expect(listBodyWeights(db, userId, { limit: 1000 }).length).toBe(3);
  });

  it("listBodyWeights falsy or negative limit falls back to default 50", () => {
    const db = freshDb();
    const userId = seedUser(db);
    // Create 75 distinct measured_on dates so default cap (50) is observable.
    for (let i = 0; i < 75; i++) {
      const month = String(1 + Math.floor(i / 28)).padStart(2, "0");
      const day = String(1 + (i % 28)).padStart(2, "0");
      createBodyWeight(db, {
        user_id: userId,
        measured_on: `2026-${month}-${day}`,
        weight_kg: 80,
      });
    }
    expect(listBodyWeights(db, userId, { limit: 0 }).length).toBe(50);
    expect(listBodyWeights(db, userId, { limit: -5 }).length).toBe(50);
    expect(listBodyWeights(db, userId).length).toBe(50);
  });

  it("createBodyWeight with notes omitted persists notes as null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const bw = createBodyWeight(db, {
      user_id: userId,
      measured_on: "2026-05-12",
      weight_kg: 80,
    });
    expect(bw.notes).toBeNull();
  });

  it("updateBodyWeight can null out notes via { notes: null }", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const bw = createBodyWeight(db, {
      user_id: userId,
      measured_on: "2026-05-12",
      weight_kg: 80,
      notes: "morning",
    });
    updateBodyWeight(db, userId, bw.id, { notes: null });
    const after = findBodyWeightById(db, userId, bw.id);
    expect(after?.notes).toBeNull();
    expect(after?.weight_kg).toBe(80);
  });

  it("createBodyWeight is an upsert by (user_id, measured_on): second call updates the same row", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const first = createBodyWeight(db, {
      user_id: userId,
      measured_on: "2026-05-12",
      weight_kg: 80.5,
      notes: "morning",
    });
    const second = createBodyWeight(db, {
      user_id: userId,
      measured_on: "2026-05-12",
      weight_kg: 80.7,
      notes: "afternoon",
    });
    // Same id — it's the same row.
    expect(second.id).toBe(first.id);
    expect(second.weight_kg).toBe(80.7);
    expect(second.notes).toBe("afternoon");
    // Exactly one row exists for this user.
    expect(listBodyWeights(db, userId).length).toBe(1);
  });
});
