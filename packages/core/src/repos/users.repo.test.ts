import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import { defined } from "../test-support/index.js";
import { findUserById, updateUser } from "./users.repo.js";

describe("users.repo", () => {
  it("findUserById returns the seeded user", () => {
    const db = freshDb();
    const id = seedUser(db, { name: "Jeff" });
    const u = findUserById(db, id);
    expect(u?.name).toBe("Jeff");
    expect(u?.preferred_unit_system).toBe("metric");
  });

  it("updateUser mutates only provided fields", () => {
    const db = freshDb();
    const id = seedUser(db);
    updateUser(db, id, { height_cm: 182.5 });
    const u = findUserById(db, id);
    expect(u?.height_cm).toBe(182.5);
    expect(u?.name).toBe("Jeff");
  });

  it("findUserById returns null when missing", () => {
    const db = freshDb();
    expect(findUserById(db, 999)).toBeNull();
  });

  it("updateUser on a nonexistent id returns null", () => {
    const db = freshDb();
    expect(updateUser(db, 999, { name: "Nope" })).toBeNull();
  });

  it("updateUser preserves created_at", () => {
    const db = freshDb();
    const id = seedUser(db);
    const before = defined(findUserById(db, id), "user").created_at;
    updateUser(db, id, { name: "Renamed" });
    const after = defined(findUserById(db, id), "user").created_at;
    expect(after).toBe(before);
  });

  it("updateUser can set a nullable column to null", () => {
    const db = freshDb();
    const id = seedUser(db, { height_cm: 180 });
    updateUser(db, id, { height_cm: null });
    expect(findUserById(db, id)?.height_cm).toBeNull();
  });

  it("updateUser with empty patch returns the current row (re-fetch)", () => {
    const db = freshDb();
    const id = seedUser(db, { name: "Jeff" });
    const result = updateUser(db, id, {});
    expect(result?.name).toBe("Jeff");
  });

  it("updateUser silently ignores keys outside the allowlist", () => {
    const db = freshDb();
    const id = seedUser(db);
    // Cast to bypass TS — simulates a non-strict Zod schema upstream.
    updateUser(db, id, { name: "Renamed", id: 999, created_at: "x" } as never);
    const u = findUserById(db, id);
    expect(u?.id).toBe(id); // id was NOT changed
    expect(u?.name).toBe("Renamed"); // legitimate update still applied
  });

  it("updateUser persists `timezone` and findUserById returns it", () => {
    const db = freshDb();
    const id = seedUser(db);
    updateUser(db, id, { timezone: "America/Toronto" });
    const u = findUserById(db, id);
    expect(u?.timezone).toBe("America/Toronto");
  });

  it("findUserById returns the default 'UTC' timezone for a freshly-created user", () => {
    const db = freshDb();
    const id = seedUser(db);
    expect(findUserById(db, id)?.timezone).toBe("UTC");
  });

  it("updates and reads back activity_level", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const updated = updateUser(db, userId, { activity_level: "active" });
    expect(updated?.activity_level).toBe("active");
    expect(findUserById(db, userId)?.activity_level).toBe("active");
  });

  it("defaults activity_level to null for a freshly seeded user", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(findUserById(db, userId)?.activity_level).toBeNull();
  });

  it("updates and reads back about_me", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const updated = updateUser(db, userId, { about_me: "cyclist, cutting back on drinks" });
    expect(updated?.about_me).toBe("cyclist, cutting back on drinks");
    expect(findUserById(db, userId)?.about_me).toBe("cyclist, cutting back on drinks");
  });

  it("clears about_me when set to null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    updateUser(db, userId, { about_me: "something" });
    const cleared = updateUser(db, userId, { about_me: null });
    expect(cleared?.about_me).toBeNull();
  });
});

describe("users.repo admin columns", () => {
  it("findUserById returns is_admin and llm_daily_token_limit", () => {
    const db = freshDb();
    db.prepare(
      "INSERT INTO users (id, name, email, is_admin, llm_daily_token_limit) VALUES (1, 'Jeff', 'j@x.com', 1, 50000)",
    ).run();
    const user = findUserById(db, 1);
    expect(user?.is_admin).toBe(1);
    expect(user?.llm_daily_token_limit).toBe(50000);
  });

  it("findUserById returns null llm_daily_token_limit when unset", () => {
    const db = freshDb();
    db.prepare("INSERT INTO users (id, name, email) VALUES (2, 'Sam', 's@x.com')").run();
    const user = findUserById(db, 2);
    expect(user?.is_admin).toBe(0);
    expect(user?.llm_daily_token_limit).toBeNull();
  });

  it("updateUser can set llm_daily_token_limit and is_admin", () => {
    const db = freshDb();
    db.prepare("INSERT INTO users (id, name, email) VALUES (3, 'Lee', 'l@x.com')").run();
    const updated = updateUser(db, 3, { llm_daily_token_limit: 25000, is_admin: 1 });
    expect(updated?.llm_daily_token_limit).toBe(25000);
    expect(updated?.is_admin).toBe(1);
  });
});
