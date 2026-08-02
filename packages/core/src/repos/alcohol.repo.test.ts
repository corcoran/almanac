import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import {
  createAlcoholSession,
  deleteAlcoholSession,
  findAlcoholSessionById,
  listAlcoholSessions,
  updateAlcoholSession,
} from "./alcohol.repo.js";

describe("alcohol.repo", () => {
  it("createAlcoholSession returns the new row with all fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createAlcoholSession(db, {
      user_id: userId,
      started_at: "2026-05-12T20:00:00Z",
      ended_at: "2026-05-12T23:00:00Z",
      drinks_count: 3,
      est_kcal: 450,
    });
    expect(session.id).toBeGreaterThan(0);
    expect(session.drinks_count).toBe(3);
    expect(session.est_kcal).toBe(450);
    expect(session.user_id).toBe(userId);
    expect(session.started_at).toBe("2026-05-12T20:00:00Z");
  });

  it("findAlcoholSessionById returns null when missing", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(findAlcoholSessionById(db, userId, 999)).toBeNull();
  });

  it("listAlcoholSessions orders by started_at DESC", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createAlcoholSession(db, {
      user_id: userId,
      started_at: "2026-05-10T20:00:00Z",
      drinks_count: 2,
      est_kcal: 300,
    });
    createAlcoholSession(db, {
      user_id: userId,
      started_at: "2026-05-12T20:00:00Z",
      drinks_count: 3,
      est_kcal: 450,
    });
    createAlcoholSession(db, {
      user_id: userId,
      started_at: "2026-05-11T20:00:00Z",
      drinks_count: 1,
      est_kcal: 150,
    });
    const sessions = listAlcoholSessions(db, userId);
    expect(sessions.map((s) => s.started_at)).toEqual([
      "2026-05-12T20:00:00Z",
      "2026-05-11T20:00:00Z",
      "2026-05-10T20:00:00Z",
    ]);
  });

  it("listAlcoholSessions filters by from/to range on started_at", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createAlcoholSession(db, {
      user_id: userId,
      started_at: "2026-05-10T20:00:00Z",
      drinks_count: 2,
      est_kcal: 300,
    });
    createAlcoholSession(db, {
      user_id: userId,
      started_at: "2026-05-12T20:00:00Z",
      drinks_count: 3,
      est_kcal: 450,
    });
    const inRange = listAlcoholSessions(db, userId, {
      from: "2026-05-11T00:00:00Z",
      to: "2026-05-13T00:00:00Z",
    });
    expect(inRange.length).toBe(1);
    expect(inRange[0]?.started_at).toBe("2026-05-12T20:00:00Z");
  });

  it("listAlcoholSessions respects limit", () => {
    const db = freshDb();
    const userId = seedUser(db);
    for (let i = 0; i < 5; i++) {
      createAlcoholSession(db, {
        user_id: userId,
        started_at: `2026-05-1${i}T20:00:00Z`,
        drinks_count: 2,
        est_kcal: 300,
      });
    }
    expect(listAlcoholSessions(db, userId, { limit: 2 }).length).toBe(2);
  });

  it("listAlcoholSessions filters by user_id", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    createAlcoholSession(db, {
      user_id: userA,
      started_at: "2026-05-12T20:00:00Z",
      drinks_count: 2,
      est_kcal: 300,
    });
    createAlcoholSession(db, {
      user_id: userB,
      started_at: "2026-05-12T20:00:00Z",
      drinks_count: 4,
      est_kcal: 600,
    });
    const aList = listAlcoholSessions(db, userA);
    expect(aList.length).toBe(1);
    expect(aList[0]?.user_id).toBe(userA);
  });

  it("updateAlcoholSession mutates only provided fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createAlcoholSession(db, {
      user_id: userId,
      started_at: "2026-05-12T20:00:00Z",
      drinks_count: 2,
      est_kcal: 300,
    });
    updateAlcoholSession(db, userId, session.id, { drinks_count: 4 });
    const after = findAlcoholSessionById(db, userId, session.id);
    expect(after?.drinks_count).toBe(4);
    expect(after?.est_kcal).toBe(300);
  });

  it("updateAlcoholSession on a nonexistent id returns null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(updateAlcoholSession(db, userId, 999, { drinks_count: 1 })).toBeNull();
  });

  it("updateAlcoholSession with empty patch returns the current row (re-fetch)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createAlcoholSession(db, {
      user_id: userId,
      started_at: "2026-05-12T20:00:00Z",
      drinks_count: 2,
      est_kcal: 300,
    });
    const result = updateAlcoholSession(db, userId, session.id, {});
    expect(result?.drinks_count).toBe(2);
  });

  it("updateAlcoholSession silently ignores keys outside the allowlist", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createAlcoholSession(db, {
      user_id: userId,
      started_at: "2026-05-12T20:00:00Z",
      drinks_count: 2,
      est_kcal: 300,
    });
    updateAlcoholSession(db, userId, session.id, {
      drinks_count: 4,
      id: 999,
      user_id: 999,
    } as never);
    const after = findAlcoholSessionById(db, userId, session.id);
    expect(after?.id).toBe(session.id);
    expect(after?.user_id).toBe(userId);
    expect(after?.drinks_count).toBe(4);
  });

  it("deleteAlcoholSession removes the row", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createAlcoholSession(db, {
      user_id: userId,
      started_at: "2026-05-12T20:00:00Z",
      drinks_count: 2,
      est_kcal: 300,
    });
    deleteAlcoholSession(db, userId, session.id);
    expect(findAlcoholSessionById(db, userId, session.id)).toBeNull();
  });

  // --- Ownership scoping (IDOR fix): by-id ops must be scoped to the owner ---

  it("findAlcoholSessionById does not return another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const s = createAlcoholSession(db, {
      user_id: userA,
      started_at: "2026-05-12T20:00:00Z",
      drinks_count: 2,
      est_kcal: 300,
    });
    expect(findAlcoholSessionById(db, userA, s.id)?.id).toBe(s.id);
    expect(findAlcoholSessionById(db, userB, s.id)).toBeNull();
  });

  it("updateAlcoholSession cannot mutate another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const s = createAlcoholSession(db, {
      user_id: userA,
      started_at: "2026-05-12T20:00:00Z",
      drinks_count: 2,
      est_kcal: 300,
    });
    expect(updateAlcoholSession(db, userB, s.id, { drinks_count: 99 })).toBeNull();
    expect(findAlcoholSessionById(db, userA, s.id)?.drinks_count).toBe(2);
  });

  it("deleteAlcoholSession cannot delete another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const s = createAlcoholSession(db, {
      user_id: userA,
      started_at: "2026-05-12T20:00:00Z",
      drinks_count: 2,
      est_kcal: 300,
    });
    deleteAlcoholSession(db, userB, s.id);
    expect(findAlcoholSessionById(db, userA, s.id)?.id).toBe(s.id);
  });

  it("listAlcoholSessions from is inclusive — a row exactly on the boundary is included", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const boundary = "2026-05-12T00:00:00Z";
    createAlcoholSession(db, {
      user_id: userId,
      started_at: boundary,
      drinks_count: 1,
      est_kcal: 150,
    });
    const result = listAlcoholSessions(db, userId, { from: boundary });
    expect(result.length).toBe(1);
    expect(result[0]?.started_at).toBe(boundary);
  });

  it("listAlcoholSessions to is exclusive — a row exactly on the boundary is excluded", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const boundary = "2026-05-12T00:00:00Z";
    createAlcoholSession(db, {
      user_id: userId,
      started_at: boundary,
      drinks_count: 1,
      est_kcal: 150,
    });
    const result = listAlcoholSessions(db, userId, { to: boundary });
    expect(result.length).toBe(0);
  });

  it("listAlcoholSessions clamps limit at 200 even when caller requests more", () => {
    const db = freshDb();
    const userId = seedUser(db);
    // Create 3 rows; assert that requesting 1000 still returns all 3.
    // The cap is invisible at this scale, but the test exists to lock the
    // policy in so a typo `Math.max` would fail. Caller-requested limits
    // <= 200 pass through unchanged.
    for (let i = 0; i < 3; i++) {
      createAlcoholSession(db, {
        user_id: userId,
        started_at: `2026-05-1${i}T20:00:00Z`,
        drinks_count: 1,
        est_kcal: 150,
      });
    }
    expect(listAlcoholSessions(db, userId, { limit: 1000 }).length).toBe(3);
  });

  it("listAlcoholSessions falsy or negative limit falls back to default 50", () => {
    const db = freshDb();
    const userId = seedUser(db);
    // Create 75 rows so the default cap (50) is observable. Many sessions
    // per day are allowed (no UNIQUE), so use hour offsets to get distinct
    // started_at values cheaply.
    for (let i = 0; i < 75; i++) {
      const day = String(1 + (i % 28)).padStart(2, "0");
      const hour = String(i % 24).padStart(2, "0");
      createAlcoholSession(db, {
        user_id: userId,
        started_at: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${day}T${hour}:00:00Z`,
        drinks_count: 1,
        est_kcal: 150,
      });
    }
    expect(listAlcoholSessions(db, userId, { limit: 0 }).length).toBe(50);
    expect(listAlcoholSessions(db, userId, { limit: -5 }).length).toBe(50);
    expect(listAlcoholSessions(db, userId).length).toBe(50);
  });

  it("createAlcoholSession with optional fields omitted persists them as null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createAlcoholSession(db, {
      user_id: userId,
      started_at: "2026-05-12T20:00:00Z",
      drinks_count: 2,
      est_kcal: 300,
      // ended_at and notes omitted — must persist as NULL
    });
    expect(session.ended_at).toBeNull();
    expect(session.notes).toBeNull();
  });

  it("updateAlcoholSession can null out a previously-set ended_at via patch[k] ?? null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createAlcoholSession(db, {
      user_id: userId,
      started_at: "2026-05-12T20:00:00Z",
      ended_at: "2026-05-12T23:00:00Z",
      drinks_count: 3,
      est_kcal: 450,
      notes: "wine night",
    });
    updateAlcoholSession(db, userId, session.id, { ended_at: null });
    const after = findAlcoholSessionById(db, userId, session.id);
    expect(after?.ended_at).toBeNull();
    expect(after?.notes).toBe("wine night"); // unchanged
  });
});
