import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import {
  closeAndStartPhase,
  deletePhase,
  findActivePhase,
  findPhaseById,
  findPhaseOnDate,
  listPhases,
  listRecentlyEndedPhases,
  updatePhase,
} from "./nutrition-phases.repo.js";

const BASE_INPUT = {
  name: "2200 recomp",
  intent: "recomp" as const,
  // Pre-refactor 'recomp' intent doesn't map cleanly to phase_type (which is
  // 'cut'|'bulk'|'maintenance'); these tests treat recomp as maintenance for
  // the v1 enum. Tests asserting cut/bulk semantics override these.
  phase_type: "maintenance" as const,
  tdee_at_phase_start: 2200,
  tdee_source: "user_asserted" as const,
  deficit_kcal: 0,
  daily_kcal_target: 2200,
  base_protein_g: 180,
  base_carb_g: 220,
  base_fat_g: 70,
};

describe("nutrition-phases.repo", () => {
  it("closeAndStartPhase starts the first phase as active", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-04-01",
    });
    expect(phase.id).toBeGreaterThan(0);
    expect(phase.name).toBe("2200 recomp");
    expect(phase.ended_on).toBeNull();
    const active = findActivePhase(db, userId);
    expect(active?.id).toBe(phase.id);
  });

  it("closeAndStartPhase atomically closes the previous active phase", () => {
    const db = freshDb();
    const userId = seedUser(db);
    closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-04-01",
    });
    closeAndStartPhase(db, {
      user_id: userId,
      name: "1900 cut",
      intent: "cut",
      phase_type: "cut",
      tdee_at_phase_start: 2400,
      tdee_source: "user_asserted",
      deficit_kcal: -500,
      daily_kcal_target: 1900,
      base_protein_g: 180,
      base_carb_g: 170,
      base_fat_g: 60,
      started_on: "2026-05-12",
    });
    const all = listPhases(db, userId);
    expect(all.length).toBe(2);
    const closed = all.find((p) => p.name === "2200 recomp");
    expect(closed?.ended_on).toBe("2026-05-11");
    const active = findActivePhase(db, userId);
    expect(active?.name).toBe("1900 cut");
  });

  it("closeAndStartPhase maintains the at-most-one-active invariant under repeated calls", () => {
    const db = freshDb();
    const userId = seedUser(db);
    closeAndStartPhase(db, { ...BASE_INPUT, user_id: userId, started_on: "2026-01-01" });
    closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-03-01",
      name: "second",
    });
    closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-05-01",
      name: "third",
    });
    const activeCount = listPhases(db, userId).filter((p) => p.ended_on === null).length;
    expect(activeCount).toBe(1);
    expect(findActivePhase(db, userId)?.name).toBe("third");
  });

  it("findActivePhase returns null when no phases exist", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(findActivePhase(db, userId)).toBeNull();
  });

  it("findPhaseById returns null when missing", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(findPhaseById(db, userId, 999)).toBeNull();
  });

  it("findPhaseOnDate returns the phase that contains the given date", () => {
    const db = freshDb();
    const userId = seedUser(db);
    closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-01-01",
      name: "recomp",
    });
    closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-03-01",
      name: "cut",
    });
    // 2026-02-15 falls inside recomp (closed on 2026-02-28); 2026-04-01 inside cut (still active).
    expect(findPhaseOnDate(db, userId, "2026-02-15")?.name).toBe("recomp");
    expect(findPhaseOnDate(db, userId, "2026-04-01")?.name).toBe("cut");
  });

  it("findPhaseOnDate inclusive boundaries — last day of closed phase resolves to closed; first day of next resolves to next", () => {
    const db = freshDb();
    const userId = seedUser(db);
    closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-01-01",
      name: "recomp",
    });
    closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-03-01",
      name: "cut",
    });
    // recomp.ended_on = dayBefore("2026-03-01") = "2026-02-28"
    expect(findPhaseOnDate(db, userId, "2026-02-28")?.name).toBe("recomp");
    expect(findPhaseOnDate(db, userId, "2026-03-01")?.name).toBe("cut");
  });

  it("findPhaseOnDate returns null for a date before any phase", () => {
    const db = freshDb();
    const userId = seedUser(db);
    closeAndStartPhase(db, { ...BASE_INPUT, user_id: userId, started_on: "2026-04-01" });
    expect(findPhaseOnDate(db, userId, "2026-01-01")).toBeNull();
  });

  it("listPhases filters by user_id", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    closeAndStartPhase(db, { ...BASE_INPUT, user_id: userA, started_on: "2026-04-01" });
    closeAndStartPhase(db, { ...BASE_INPUT, user_id: userB, started_on: "2026-04-01" });
    const aList = listPhases(db, userA);
    expect(aList.length).toBe(1);
    expect(aList[0]?.user_id).toBe(userA);
  });

  it("updatePhase mutates only provided fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-04-01",
    });
    updatePhase(db, userId, phase.id, { daily_kcal_target: 2500 });
    const after = findPhaseById(db, userId, phase.id);
    expect(after?.daily_kcal_target).toBe(2500);
    expect(after?.base_protein_g).toBe(180);
  });

  it("updatePhase on a nonexistent id returns null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(updatePhase(db, userId, 999, { daily_kcal_target: 2000 })).toBeNull();
  });

  it("updatePhase with empty patch returns the current row (re-fetch)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-04-01",
    });
    const result = updatePhase(db, userId, phase.id, {});
    expect(result?.name).toBe("2200 recomp");
  });

  it("updatePhase silently ignores keys outside the allowlist", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-04-01",
    });
    updatePhase(db, userId, phase.id, {
      daily_kcal_target: 2500,
      id: 999,
      user_id: 999,
      created_at: "1970-01-01",
    } as never);
    const after = findPhaseById(db, userId, phase.id);
    expect(after?.id).toBe(phase.id);
    expect(after?.user_id).toBe(userId);
    expect(after?.daily_kcal_target).toBe(2500);
  });

  it("updatePhase can edit started_on and ended_on (API revalidates overlap)", () => {
    // The repo permits these edits; the route layer is responsible for
    // enforcing non-overlap when dates change. See spec §6.4.
    const db = freshDb();
    const userId = seedUser(db);
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-04-01",
    });
    updatePhase(db, userId, phase.id, { started_on: "2026-04-15" });
    const after = findPhaseById(db, userId, phase.id);
    expect(after?.started_on).toBe("2026-04-15");
  });

  it("updatePhase can null out notes via { notes: null }", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-04-01",
      notes: "starting bulk",
    });
    updatePhase(db, userId, phase.id, { notes: null });
    expect(findPhaseById(db, userId, phase.id)?.notes).toBeNull();
  });

  it("persists planned_end_on when provided (Gap 25)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-05-01",
      planned_end_on: "2026-07-01",
    });
    expect(phase.planned_end_on).toBe("2026-07-01");
    expect(findPhaseById(db, userId, phase.id)?.planned_end_on).toBe("2026-07-01");
  });

  it("defaults planned_end_on to null when omitted (Gap 25)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-05-01",
    });
    expect(phase.planned_end_on).toBeNull();
  });

  it("updatePhase can set planned_end_on later (Gap 25)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-05-01",
    });
    updatePhase(db, userId, phase.id, { planned_end_on: "2026-07-01" });
    expect(findPhaseById(db, userId, phase.id)?.planned_end_on).toBe("2026-07-01");
  });

  it("round-trips new TDEE refactor fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const phase = closeAndStartPhase(db, {
      user_id: userId,
      name: "cut1",
      intent: "cut",
      phase_type: "cut",
      tdee_at_phase_start: 2370,
      tdee_source: "user_asserted",
      deficit_kcal: -470,
      daily_kcal_target: 1900,
      base_protein_g: 160,
      base_carb_g: 180,
      base_fat_g: 70,
      started_on: "2026-05-23",
    });
    // RETURNING result echoes the persisted row.
    expect(phase.phase_type).toBe("cut");
    expect(phase.tdee_at_phase_start).toBe(2370);
    expect(phase.tdee_source).toBe("user_asserted");
    expect(phase.deficit_kcal).toBe(-470);
    expect(phase.daily_kcal_target).toBe(1900);
    // And re-read via findActivePhase confirms SELECT mapping too.
    const found = findActivePhase(db, userId);
    expect(found?.phase_type).toBe("cut");
    expect(found?.tdee_at_phase_start).toBe(2370);
    expect(found?.tdee_source).toBe("user_asserted");
    expect(found?.deficit_kcal).toBe(-470);
    expect(found?.daily_kcal_target).toBe(1900);
  });

  it("updatePhase can patch new TDEE refactor fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-04-01",
    });
    updatePhase(db, userId, phase.id, {
      phase_type: "bulk",
      tdee_at_phase_start: 2500,
      tdee_source: "measured",
      deficit_kcal: 300,
    });
    const after = findPhaseById(db, userId, phase.id);
    expect(after?.phase_type).toBe("bulk");
    expect(after?.tdee_at_phase_start).toBe(2500);
    expect(after?.tdee_source).toBe("measured");
    expect(after?.deficit_kcal).toBe(300);
  });

  it("deletePhase removes the row", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userId,
      started_on: "2026-04-01",
    });
    deletePhase(db, userId, phase.id);
    expect(findPhaseById(db, userId, phase.id)).toBeNull();
  });

  // --- Ownership scoping (IDOR fix): by-id ops must be scoped to the owner ---

  it("findPhaseById does not return another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userA,
      started_on: "2026-04-01",
    });
    expect(findPhaseById(db, userA, phase.id)?.id).toBe(phase.id);
    expect(findPhaseById(db, userB, phase.id)).toBeNull();
  });

  it("updatePhase cannot mutate another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userA,
      started_on: "2026-04-01",
    });
    expect(updatePhase(db, userB, phase.id, { daily_kcal_target: 9999 })).toBeNull();
    expect(findPhaseById(db, userA, phase.id)?.daily_kcal_target).toBe(2200);
  });

  it("deletePhase cannot delete another user's row", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const phase = closeAndStartPhase(db, {
      ...BASE_INPUT,
      user_id: userA,
      started_on: "2026-04-01",
    });
    deletePhase(db, userB, phase.id);
    expect(findPhaseById(db, userA, phase.id)?.id).toBe(phase.id);
  });
});

function startPhaseFor(db: ReturnType<typeof freshDb>, userId: number, started_on: string) {
  return closeAndStartPhase(db, {
    user_id: userId,
    name: "Cut",
    intent: "cut",
    phase_type: "cut",
    tdee_at_phase_start: 2500,
    tdee_source: "user_asserted",
    deficit_kcal: -500,
    daily_kcal_target: 2000,
    base_protein_g: 180,
    base_carb_g: 200,
    base_fat_g: 60,
    started_on,
  });
}

describe("listRecentlyEndedPhases", () => {
  it("returns phases ended on/after the floor, excludes still-active and too-old", () => {
    const db = freshDb();
    const userId = seedUser(db);
    // Phase A: started 2026-01-01, auto-closed (ended) when B starts 2026-02-01.
    startPhaseFor(db, userId, "2026-01-01");
    startPhaseFor(db, userId, "2026-02-01"); // closes A on 2026-01-31, B now active
    // floor that includes A's ended_on (2026-01-31); active B has ended_on NULL.
    const ended = listRecentlyEndedPhases(db, userId, "2026-01-01");
    expect(ended.map((p) => p.started_on)).toEqual(["2026-01-01"]);

    // A floor after A's ended_on excludes it.
    expect(listRecentlyEndedPhases(db, userId, "2026-02-15")).toEqual([]);
  });

  it("scopes to the user (no cross-user leakage)", () => {
    const db = freshDb();
    const u1 = seedUser(db);
    const u2 = seedUser(db); // second distinct user (fresh id)
    startPhaseFor(db, u1, "2026-01-01");
    startPhaseFor(db, u1, "2026-02-01"); // closes u1's first phase
    expect(listRecentlyEndedPhases(db, u2, "2026-01-01")).toEqual([]);
  });
});
