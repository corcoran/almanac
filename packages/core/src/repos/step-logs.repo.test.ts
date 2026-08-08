import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import { createBodyWeight } from "./body-weights.repo.js";
import {
  createOrUpdateStepLog,
  deleteStepLog,
  findStepLogByDate,
  findStepLogById,
  listStepLogs,
  updateStepLog,
} from "./step-logs.repo.js";

describe("step-logs.repo", () => {
  it("creates a step log and computes est_kcal from latest body weight <= on_date", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createBodyWeight(db, { user_id: userId, measured_on: "2026-05-20", weight_kg: 80 });
    const log = createOrUpdateStepLog(db, {
      user_id: userId,
      on_date: "2026-05-24",
      steps: 10000,
    });
    expect(log.est_kcal).toBe(400); // 10000 × 0.0005 × 80
    expect(log.source).toBe("manual");
  });

  it("honors caller-supplied est_kcal verbatim", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const log = createOrUpdateStepLog(db, {
      user_id: userId,
      on_date: "2026-05-24",
      steps: 10000,
      est_kcal: 999,
    });
    expect(log.est_kcal).toBe(999);
  });

  it("falls back to DEFAULT_STEPS_KCAL_CONFIG.fallbackWeightKg when no body weight exists", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const log = createOrUpdateStepLog(db, {
      user_id: userId,
      on_date: "2026-05-24",
      steps: 10000,
    });
    // 10000 × 0.0005 × 80 (fallback) = 400
    expect(log.est_kcal).toBe(400);
  });

  it("uses the latest body weight predating on_date, not future weights", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createBodyWeight(db, { user_id: userId, measured_on: "2026-05-10", weight_kg: 60 });
    createBodyWeight(db, { user_id: userId, measured_on: "2026-05-30", weight_kg: 90 });
    // Step on 2026-05-20 should use the May 10 weight (60), not the May 30 weight (90).
    const log = createOrUpdateStepLog(db, {
      user_id: userId,
      on_date: "2026-05-20",
      steps: 10000,
    });
    expect(log.est_kcal).toBe(300); // 10000 × 0.0005 × 60
  });

  it("falls back to most-recent weight when none predate on_date", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createBodyWeight(db, { user_id: userId, measured_on: "2026-05-30", weight_kg: 90 });
    const log = createOrUpdateStepLog(db, {
      user_id: userId,
      on_date: "2026-05-20",
      steps: 10000,
    });
    expect(log.est_kcal).toBe(450); // 10000 × 0.0005 × 90
  });

  it("upserts on (user_id, on_date) — second create updates same row", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const a = createOrUpdateStepLog(db, {
      user_id: userId,
      on_date: "2026-05-24",
      steps: 5000,
    });
    const b = createOrUpdateStepLog(db, {
      user_id: userId,
      on_date: "2026-05-24",
      steps: 12000,
    });
    expect(b.id).toBe(a.id);
    expect(b.steps).toBe(12000);
  });

  it("does not itself enforce the positive-steps constraint — that's StepLogInputSchema's job", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const log = createOrUpdateStepLog(db, {
      user_id: userId,
      on_date: "2026-05-24",
      steps: 0,
    });
    expect(log.steps).toBe(0);
    expect(log.est_kcal).toBe(0);
  });

  it("findStepLogByDate returns row or null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createOrUpdateStepLog(db, { user_id: userId, on_date: "2026-05-24", steps: 1000 });
    expect(findStepLogByDate(db, userId, "2026-05-24")?.steps).toBe(1000);
    expect(findStepLogByDate(db, userId, "2026-05-25")).toBeNull();
  });

  it("listStepLogs windows by from/to and orders by on_date DESC", () => {
    const db = freshDb();
    const userId = seedUser(db);
    for (const d of ["2026-05-20", "2026-05-22", "2026-05-24"]) {
      createOrUpdateStepLog(db, { user_id: userId, on_date: d, steps: 1000 });
    }
    // listStepLogs uses exclusive upper bound (`< to`), so to include 2026-05-24
    // pass to = "2026-05-25".
    const window = listStepLogs(db, userId, {
      from: "2026-05-21",
      to: "2026-05-25",
    });
    expect(window.map((s) => s.on_date)).toEqual(["2026-05-24", "2026-05-22"]);
  });

  it("update patches steps/est_kcal/notes only — on_date is immutable", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const a = createOrUpdateStepLog(db, {
      user_id: userId,
      on_date: "2026-05-24",
      steps: 1000,
    });
    const updated = updateStepLog(db, userId, a.id, { steps: 5000, notes: "fixed" });
    expect(updated?.steps).toBe(5000);
    expect(updated?.notes).toBe("fixed");
    expect(updated?.on_date).toBe("2026-05-24");
  });

  it("update re-derives est_kcal when steps is patched without est_kcal", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createBodyWeight(db, { user_id: userId, measured_on: "2026-05-20", weight_kg: 80 });
    const a = createOrUpdateStepLog(db, {
      user_id: userId,
      on_date: "2026-05-24",
      steps: 1000,
    });
    expect(a.est_kcal).toBe(40); // 1000 × 0.0005 × 80
    const updated = updateStepLog(db, userId, a.id, { steps: 10000 });
    expect(updated?.steps).toBe(10000);
    // est_kcal should reflect the new step count, not the stale 40.
    expect(updated?.est_kcal).toBe(400);
  });

  it("update honors caller-supplied est_kcal even when steps changes", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createBodyWeight(db, { user_id: userId, measured_on: "2026-05-20", weight_kg: 80 });
    const a = createOrUpdateStepLog(db, {
      user_id: userId,
      on_date: "2026-05-24",
      steps: 1000,
    });
    const updated = updateStepLog(db, userId, a.id, { steps: 10000, est_kcal: 555 });
    expect(updated?.est_kcal).toBe(555); // not 400
  });

  it("delete removes the row", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const a = createOrUpdateStepLog(db, {
      user_id: userId,
      on_date: "2026-05-24",
      steps: 1000,
    });
    deleteStepLog(db, userId, a.id);
    expect(findStepLogById(db, userId, a.id)).toBeNull();
  });

  // --- Ownership scoping (IDOR fix): by-id ops must be scoped to the owner ---

  it("findStepLogById does not return another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const a = createOrUpdateStepLog(db, { user_id: userA, on_date: "2026-05-24", steps: 1000 });
    expect(findStepLogById(db, userA, a.id)?.id).toBe(a.id);
    expect(findStepLogById(db, userB, a.id)).toBeNull();
  });

  it("updateStepLog cannot mutate another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const a = createOrUpdateStepLog(db, { user_id: userA, on_date: "2026-05-24", steps: 1000 });
    expect(updateStepLog(db, userB, a.id, { steps: 99999 })).toBeNull();
    expect(findStepLogById(db, userA, a.id)?.steps).toBe(1000);
  });

  it("deleteStepLog cannot delete another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const a = createOrUpdateStepLog(db, { user_id: userA, on_date: "2026-05-24", steps: 1000 });
    deleteStepLog(db, userB, a.id);
    expect(findStepLogById(db, userA, a.id)?.id).toBe(a.id);
  });
});
