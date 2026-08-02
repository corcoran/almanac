import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import {
  createUntrackedPeriod,
  deleteUntrackedPeriod,
  findUntrackedPeriodById,
  getUntrackedDays,
  listUntrackedPeriods,
} from "./untracked-periods.repo.js";

describe("untracked-periods.repo", () => {
  it("createUntrackedPeriod stores and returns the row", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const p = createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-01",
      ended_on: "2026-05-07",
      reason: "vacation",
      notes: "Italy",
    });
    expect(p.id).toBeGreaterThan(0);
    expect(p.started_on).toBe("2026-05-01");
    expect(p.ended_on).toBe("2026-05-07");
    expect(p.reason).toBe("vacation");
    expect(p.notes).toBe("Italy");
    expect(p.created_at).toBeTruthy();
  });

  it("listUntrackedPeriods filters by from/to and orders started_on DESC", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-04-01",
      ended_on: "2026-04-03",
      reason: "sick",
    });
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-10",
      ended_on: "2026-05-12",
      reason: "deload",
    });
    const all = listUntrackedPeriods(db, userId, {});
    expect(all.map((p) => p.started_on)).toEqual(["2026-05-10", "2026-04-01"]);
    // A `to` that predates the May period excludes it (overlap semantics).
    const aprilOnly = listUntrackedPeriods(db, userId, { from: "2026-03-01", to: "2026-04-30" });
    expect(aprilOnly.map((p) => p.started_on)).toEqual(["2026-04-01"]);
  });

  it("deleteUntrackedPeriod removes the row", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const p = createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-01",
      ended_on: "2026-05-02",
      reason: "vacation",
    });
    deleteUntrackedPeriod(db, userId, p.id);
    expect(listUntrackedPeriods(db, userId, {})).toEqual([]);
  });

  it("getUntrackedDays expands a single period inclusive of both ends", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-05",
      ended_on: "2026-05-07",
      reason: "vacation",
    });
    const days = getUntrackedDays(db, userId, "2026-05-01", "2026-05-31");
    expect([...days].sort()).toEqual(["2026-05-05", "2026-05-06", "2026-05-07"]);
  });

  it("getUntrackedDays handles a single-day period", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-05",
      ended_on: "2026-05-05",
      reason: "sick",
    });
    const days = getUntrackedDays(db, userId, "2026-05-01", "2026-05-31");
    expect([...days]).toEqual(["2026-05-05"]);
  });

  it("getUntrackedDays clips periods to the query range", () => {
    const db = freshDb();
    const userId = seedUser(db);
    // Period straddles the lower bound: 04-28..05-03, query starts 05-01.
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-04-28",
      ended_on: "2026-05-03",
      reason: "vacation",
    });
    const days = getUntrackedDays(db, userId, "2026-05-01", "2026-05-10");
    expect([...days].sort()).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
  });

  it("getUntrackedDays merges overlapping/adjacent periods via the Set", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-05",
      ended_on: "2026-05-07",
      reason: "vacation",
    });
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-06",
      ended_on: "2026-05-08",
      reason: "deload",
    });
    const days = getUntrackedDays(db, userId, "2026-05-01", "2026-05-31");
    expect([...days].sort()).toEqual(["2026-05-05", "2026-05-06", "2026-05-07", "2026-05-08"]);
  });

  it("getUntrackedDays returns an empty set when nothing overlaps", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-03-01",
      ended_on: "2026-03-05",
      reason: "vacation",
    });
    const days = getUntrackedDays(db, userId, "2026-05-01", "2026-05-31");
    expect(days.size).toBe(0);
  });

  it("findUntrackedPeriodById returns the row when it exists", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const p = createUntrackedPeriod(db, {
      user_id: userId,
      started_on: "2026-05-01",
      ended_on: "2026-05-02",
      reason: "sick",
    });
    const found = findUntrackedPeriodById(db, p.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(p.id);
  });

  it("findUntrackedPeriodById returns null for a nonexistent id", () => {
    const db = freshDb();
    expect(findUntrackedPeriodById(db, 99999)).toBeNull();
  });
});
