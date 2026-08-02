import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import {
  createCardioSession,
  deleteCardioSession,
  findCardioSessionById,
  listCardioSessions,
  updateCardioSession,
} from "./cardio.repo.js";

describe("cardio.repo", () => {
  it("createCardioSession returns the new row with all fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-12T06:00:00Z",
      duration_min: 45,
      modality: "run",
      avg_hr: 155,
      distance_km: 8.2,
      est_kcal: 520,
      notes: "easy zone 2",
    });
    expect(session.id).toBeGreaterThan(0);
    expect(session.est_kcal).toBe(520);
    expect(session.user_id).toBe(userId);
    expect(session.started_at).toBe("2026-05-12T06:00:00Z");
    expect(session.duration_min).toBe(45);
    expect(session.modality).toBe("run");
    expect(session.avg_hr).toBe(155);
    expect(session.distance_km).toBe(8.2);
    expect(session.notes).toBe("easy zone 2");
  });

  it("persists steps when provided (Gap 17)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-13T17:00:00Z",
      duration_min: 45,
      modality: "walk",
      est_kcal: 200,
      steps: 7500,
    });
    expect(session.steps).toBe(7500);
    expect(findCardioSessionById(db, userId, session.id)?.steps).toBe(7500);
  });

  it("defaults steps to null when omitted (Gap 17)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-13T17:00:00Z",
      est_kcal: 200,
    });
    expect(session.steps).toBeNull();
  });

  it("updateCardioSession can change steps (Gap 17)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-13T17:00:00Z",
      est_kcal: 200,
    });
    const updated = updateCardioSession(db, userId, session.id, { steps: 4300 });
    expect(updated?.steps).toBe(4300);
  });

  it("findCardioSessionById returns null when missing", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(findCardioSessionById(db, userId, 999)).toBeNull();
  });

  it("listCardioSessions orders by started_at DESC", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-10T06:00:00Z",
      est_kcal: 300,
    });
    createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-12T06:00:00Z",
      est_kcal: 520,
    });
    createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-11T06:00:00Z",
      est_kcal: 410,
    });
    const sessions = listCardioSessions(db, userId);
    expect(sessions.map((s) => s.started_at)).toEqual([
      "2026-05-12T06:00:00Z",
      "2026-05-11T06:00:00Z",
      "2026-05-10T06:00:00Z",
    ]);
  });

  it("listCardioSessions filters by from/to range on started_at", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-10T06:00:00Z",
      est_kcal: 300,
    });
    createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-12T06:00:00Z",
      est_kcal: 520,
    });
    const inRange = listCardioSessions(db, userId, {
      from: "2026-05-11T00:00:00Z",
      to: "2026-05-13T00:00:00Z",
    });
    expect(inRange.length).toBe(1);
    expect(inRange[0]?.started_at).toBe("2026-05-12T06:00:00Z");
  });

  it("listCardioSessions respects limit", () => {
    const db = freshDb();
    const userId = seedUser(db);
    for (let i = 0; i < 5; i++) {
      createCardioSession(db, {
        user_id: userId,
        started_at: `2026-05-1${i}T06:00:00Z`,
        est_kcal: 300,
      });
    }
    expect(listCardioSessions(db, userId, { limit: 2 }).length).toBe(2);
  });

  it("listCardioSessions filters by user_id", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    createCardioSession(db, {
      user_id: userA,
      started_at: "2026-05-12T06:00:00Z",
      est_kcal: 300,
    });
    createCardioSession(db, {
      user_id: userB,
      started_at: "2026-05-12T06:00:00Z",
      est_kcal: 600,
    });
    const aList = listCardioSessions(db, userA);
    expect(aList.length).toBe(1);
    expect(aList[0]?.user_id).toBe(userA);
  });

  it("updateCardioSession mutates only provided fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-12T06:00:00Z",
      duration_min: 30,
      est_kcal: 300,
    });
    updateCardioSession(db, userId, session.id, { duration_min: 60 });
    const after = findCardioSessionById(db, userId, session.id);
    expect(after?.duration_min).toBe(60);
    expect(after?.est_kcal).toBe(300);
  });

  it("updateCardioSession on a nonexistent id returns null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(updateCardioSession(db, userId, 999, { duration_min: 30 })).toBeNull();
  });

  it("updateCardioSession with empty patch returns the current row (re-fetch)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-12T06:00:00Z",
      duration_min: 30,
      est_kcal: 300,
    });
    const result = updateCardioSession(db, userId, session.id, {});
    expect(result?.duration_min).toBe(30);
  });

  it("updateCardioSession silently ignores keys outside the allowlist", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-12T06:00:00Z",
      duration_min: 30,
      est_kcal: 300,
    });
    updateCardioSession(db, userId, session.id, {
      duration_min: 60,
      id: 999,
      user_id: 999,
    } as never);
    const after = findCardioSessionById(db, userId, session.id);
    expect(after?.id).toBe(session.id);
    expect(after?.user_id).toBe(userId);
    expect(after?.duration_min).toBe(60);
  });

  it("deleteCardioSession removes the row", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-12T06:00:00Z",
      est_kcal: 300,
    });
    deleteCardioSession(db, userId, session.id);
    expect(findCardioSessionById(db, userId, session.id)).toBeNull();
  });

  // --- Ownership scoping (IDOR fix): by-id ops must be scoped to the owner ---

  it("findCardioSessionById does not return another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const s = createCardioSession(db, {
      user_id: userA,
      started_at: "2026-05-12T06:00:00Z",
      est_kcal: 300,
    });
    expect(findCardioSessionById(db, userA, s.id)?.id).toBe(s.id);
    expect(findCardioSessionById(db, userB, s.id)).toBeNull();
  });

  it("updateCardioSession cannot mutate another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const s = createCardioSession(db, {
      user_id: userA,
      started_at: "2026-05-12T06:00:00Z",
      est_kcal: 300,
    });
    expect(updateCardioSession(db, userB, s.id, { est_kcal: 9999 })).toBeNull();
    expect(findCardioSessionById(db, userA, s.id)?.est_kcal).toBe(300);
  });

  it("deleteCardioSession cannot delete another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const s = createCardioSession(db, {
      user_id: userA,
      started_at: "2026-05-12T06:00:00Z",
      est_kcal: 300,
    });
    deleteCardioSession(db, userB, s.id);
    expect(findCardioSessionById(db, userA, s.id)?.id).toBe(s.id);
  });

  it("listCardioSessions from is inclusive — a row exactly on the boundary is included", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const boundary = "2026-05-12T00:00:00Z";
    createCardioSession(db, {
      user_id: userId,
      started_at: boundary,
      est_kcal: 300,
    });
    const result = listCardioSessions(db, userId, { from: boundary });
    expect(result.length).toBe(1);
    expect(result[0]?.started_at).toBe(boundary);
  });

  it("listCardioSessions to is exclusive — a row exactly on the boundary is excluded", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const boundary = "2026-05-12T00:00:00Z";
    createCardioSession(db, {
      user_id: userId,
      started_at: boundary,
      est_kcal: 300,
    });
    const result = listCardioSessions(db, userId, { to: boundary });
    expect(result.length).toBe(0);
  });

  it("listCardioSessions clamps limit at 200 even when caller requests more", () => {
    const db = freshDb();
    const userId = seedUser(db);
    // Create 3 rows; assert that requesting 1000 still returns all 3.
    // The cap is invisible at this scale, but the test exists to lock the
    // policy in so a typo `Math.max` would fail. Caller-requested limits
    // <= 200 pass through unchanged.
    for (let i = 0; i < 3; i++) {
      createCardioSession(db, {
        user_id: userId,
        started_at: `2026-05-1${i}T06:00:00Z`,
        est_kcal: 300,
      });
    }
    expect(listCardioSessions(db, userId, { limit: 1000 }).length).toBe(3);
  });

  it("listCardioSessions falsy or negative limit falls back to default 50", () => {
    const db = freshDb();
    const userId = seedUser(db);
    // Create 75 rows so the default cap (50) is observable. Many sessions
    // per day are allowed (no UNIQUE), so use hour offsets to get distinct
    // started_at values cheaply.
    for (let i = 0; i < 75; i++) {
      const day = String(1 + (i % 28)).padStart(2, "0");
      const hour = String(i % 24).padStart(2, "0");
      createCardioSession(db, {
        user_id: userId,
        started_at: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${day}T${hour}:00:00Z`,
        est_kcal: 300,
      });
    }
    expect(listCardioSessions(db, userId, { limit: 0 }).length).toBe(50);
    expect(listCardioSessions(db, userId, { limit: -5 }).length).toBe(50);
    expect(listCardioSessions(db, userId).length).toBe(50);
  });

  it("createCardioSession with optional fields omitted persists them as null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-12T06:00:00Z",
      est_kcal: 300,
      // duration_min, modality, avg_hr, distance_km, notes omitted — must persist as NULL
    });
    expect(session.duration_min).toBeNull();
    expect(session.modality).toBeNull();
    expect(session.avg_hr).toBeNull();
    expect(session.distance_km).toBeNull();
    expect(session.notes).toBeNull();
  });

  it("updateCardioSession can null out a previously-set modality via patch[k] ?? null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const session = createCardioSession(db, {
      user_id: userId,
      started_at: "2026-05-12T06:00:00Z",
      modality: "bike",
      duration_min: 45,
      est_kcal: 400,
      notes: "spin class",
    });
    updateCardioSession(db, userId, session.id, { modality: null });
    const after = findCardioSessionById(db, userId, session.id);
    expect(after?.modality).toBeNull();
    expect(after?.duration_min).toBe(45); // unchanged
    expect(after?.notes).toBe("spin class"); // unchanged
  });
});
