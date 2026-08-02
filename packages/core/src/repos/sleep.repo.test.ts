import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import {
  createSleepLog,
  deleteSleepLog,
  findSleepLogById,
  listSleepLogs,
  updateSleepLog,
} from "./sleep.repo.js";

describe("sleep.repo", () => {
  it("createSleepLog returns the new row with all fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const s = createSleepLog(db, {
      user_id: userId,
      slept_on: "2026-05-12",
      hours: 7.5,
      quality: 4,
    });
    expect(s.id).toBeGreaterThan(0);
    expect(s.hours).toBe(7.5);
    expect(s.quality).toBe(4);
    expect(s.user_id).toBe(userId);
    expect(s.slept_on).toBe("2026-05-12");
  });

  it("findSleepLogById returns null when missing", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(findSleepLogById(db, userId, 999)).toBeNull();
  });

  it("listSleepLogs orders by slept_on DESC", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createSleepLog(db, { user_id: userId, slept_on: "2026-05-10", hours: 8 });
    createSleepLog(db, { user_id: userId, slept_on: "2026-05-12", hours: 7 });
    createSleepLog(db, { user_id: userId, slept_on: "2026-05-11", hours: 7.5 });
    const list = listSleepLogs(db, userId);
    expect(list.map((b) => b.slept_on)).toEqual(["2026-05-12", "2026-05-11", "2026-05-10"]);
  });

  it("listSleepLogs filters by from/to range on slept_on", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createSleepLog(db, { user_id: userId, slept_on: "2026-05-10", hours: 8 });
    createSleepLog(db, { user_id: userId, slept_on: "2026-05-12", hours: 7 });
    const inRange = listSleepLogs(db, userId, {
      from: "2026-05-11",
      to: "2026-05-13",
    });
    expect(inRange.length).toBe(1);
    expect(inRange[0]?.slept_on).toBe("2026-05-12");
  });

  it("listSleepLogs respects limit", () => {
    const db = freshDb();
    const userId = seedUser(db);
    for (let i = 1; i <= 5; i++) {
      createSleepLog(db, {
        user_id: userId,
        slept_on: `2026-05-0${i}`,
        hours: 7 + i * 0.1,
      });
    }
    expect(listSleepLogs(db, userId, { limit: 2 }).length).toBe(2);
  });

  it("listSleepLogs filters by user_id", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    createSleepLog(db, { user_id: userA, slept_on: "2026-05-12", hours: 8 });
    createSleepLog(db, { user_id: userB, slept_on: "2026-05-12", hours: 6 });
    const aList = listSleepLogs(db, userA);
    expect(aList.length).toBe(1);
    expect(aList[0]?.user_id).toBe(userA);
  });

  it("updateSleepLog mutates only provided fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const s = createSleepLog(db, {
      user_id: userId,
      slept_on: "2026-05-12",
      hours: 7.5,
      quality: 4,
      notes: "restful",
    });
    updateSleepLog(db, userId, s.id, { hours: 8.2 });
    const after = findSleepLogById(db, userId, s.id);
    expect(after?.hours).toBe(8.2);
    expect(after?.quality).toBe(4);
    expect(after?.notes).toBe("restful");
  });

  it("updateSleepLog on a nonexistent id returns null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(updateSleepLog(db, userId, 999, { hours: 8 })).toBeNull();
  });

  it("updateSleepLog with empty patch returns the current row (re-fetch)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const s = createSleepLog(db, {
      user_id: userId,
      slept_on: "2026-05-12",
      hours: 7.5,
    });
    const result = updateSleepLog(db, userId, s.id, {});
    expect(result?.hours).toBe(7.5);
  });

  it("updateSleepLog silently ignores keys outside the allowlist (including slept_on)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const s = createSleepLog(db, {
      user_id: userId,
      slept_on: "2026-05-12",
      hours: 7.5,
    });
    updateSleepLog(db, userId, s.id, {
      hours: 8,
      // None of these should reach SQL:
      id: 999,
      user_id: 999,
      slept_on: "2026-05-15",
    } as never);
    const after = findSleepLogById(db, userId, s.id);
    expect(after?.id).toBe(s.id);
    expect(after?.user_id).toBe(userId);
    expect(after?.slept_on).toBe("2026-05-12"); // slept_on did NOT change
    expect(after?.hours).toBe(8); // legitimate update applied
  });

  it("deleteSleepLog removes the row", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const s = createSleepLog(db, {
      user_id: userId,
      slept_on: "2026-05-12",
      hours: 7.5,
    });
    deleteSleepLog(db, userId, s.id);
    expect(findSleepLogById(db, userId, s.id)).toBeNull();
  });

  // --- Ownership scoping (IDOR fix): by-id ops must be scoped to the owner ---

  it("findSleepLogById does not return another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const s = createSleepLog(db, { user_id: userA, slept_on: "2026-05-12", hours: 7.5 });
    expect(findSleepLogById(db, userA, s.id)?.id).toBe(s.id);
    expect(findSleepLogById(db, userB, s.id)).toBeNull();
  });

  it("updateSleepLog cannot mutate another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const s = createSleepLog(db, { user_id: userA, slept_on: "2026-05-12", hours: 7.5 });
    expect(updateSleepLog(db, userB, s.id, { hours: 1 })).toBeNull();
    expect(findSleepLogById(db, userA, s.id)?.hours).toBe(7.5);
  });

  it("deleteSleepLog cannot delete another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const s = createSleepLog(db, { user_id: userA, slept_on: "2026-05-12", hours: 7.5 });
    deleteSleepLog(db, userB, s.id);
    expect(findSleepLogById(db, userA, s.id)?.id).toBe(s.id);
  });

  it("listSleepLogs from is inclusive — a row exactly on the boundary is included", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createSleepLog(db, { user_id: userId, slept_on: "2026-05-12", hours: 7.5 });
    const result = listSleepLogs(db, userId, { from: "2026-05-12" });
    expect(result.length).toBe(1);
  });

  it("listSleepLogs to is exclusive — a row exactly on the boundary is excluded", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createSleepLog(db, { user_id: userId, slept_on: "2026-05-12", hours: 7.5 });
    const result = listSleepLogs(db, userId, { to: "2026-05-12" });
    expect(result.length).toBe(0);
  });

  it("listSleepLogs clamps limit at 200 even when caller requests more", () => {
    const db = freshDb();
    const userId = seedUser(db);
    for (let i = 1; i <= 3; i++) {
      createSleepLog(db, {
        user_id: userId,
        slept_on: `2026-05-0${i}`,
        hours: 7.5,
      });
    }
    expect(listSleepLogs(db, userId, { limit: 1000 }).length).toBe(3);
  });

  it("listSleepLogs falsy or negative limit falls back to default 50", () => {
    const db = freshDb();
    const userId = seedUser(db);
    // Create 75 distinct slept_on dates so default cap (50) is observable.
    for (let i = 0; i < 75; i++) {
      const month = String(1 + Math.floor(i / 28)).padStart(2, "0");
      const day = String(1 + (i % 28)).padStart(2, "0");
      createSleepLog(db, {
        user_id: userId,
        slept_on: `2026-${month}-${day}`,
        hours: 7.5,
      });
    }
    expect(listSleepLogs(db, userId, { limit: 0 }).length).toBe(50);
    expect(listSleepLogs(db, userId, { limit: -5 }).length).toBe(50);
    expect(listSleepLogs(db, userId).length).toBe(50);
  });

  it("createSleepLog with quality and notes omitted persists both as null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const s = createSleepLog(db, {
      user_id: userId,
      slept_on: "2026-05-12",
      hours: 7.5,
    });
    expect(s.quality).toBeNull();
    expect(s.notes).toBeNull();
  });

  it("updateSleepLog can null out quality via { quality: null }", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const s = createSleepLog(db, {
      user_id: userId,
      slept_on: "2026-05-12",
      hours: 7.5,
      quality: 4,
    });
    updateSleepLog(db, userId, s.id, { quality: null });
    const after = findSleepLogById(db, userId, s.id);
    expect(after?.quality).toBeNull();
    expect(after?.hours).toBe(7.5);
  });

  it("createSleepLog is an upsert by (user_id, slept_on): second call updates the same row", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const first = createSleepLog(db, {
      user_id: userId,
      slept_on: "2026-05-12",
      hours: 7.5,
      quality: 3,
      notes: "ok",
    });
    const second = createSleepLog(db, {
      user_id: userId,
      slept_on: "2026-05-12",
      hours: 8.2,
      quality: 5,
      notes: "great",
    });
    // Same id — it's the same row.
    expect(second.id).toBe(first.id);
    expect(second.hours).toBe(8.2);
    expect(second.quality).toBe(5);
    expect(second.notes).toBe("great");
    // Exactly one row exists for this user.
    expect(listSleepLogs(db, userId).length).toBe(1);
  });
});
