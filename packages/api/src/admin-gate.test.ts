import { openDb } from "@almanac/core/db";
import { describe, expect, it } from "vitest";
import { requireAdmin } from "./admin-gate.js";
import { ApiError } from "./errors.js";

function reqWithUser(userId: number | undefined) {
  return { userId } as unknown as import("fastify").FastifyRequest;
}

// Minimal in-memory users table with the columns requireAdmin's findUserById reads.
function dbWith(users: Array<{ id: number; is_admin: number }>) {
  const db = openDb(":memory:");
  db.exec(
    "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, dob TEXT, height_cm REAL, sex TEXT, email TEXT, preferred_unit_system TEXT DEFAULT 'metric', timezone TEXT DEFAULT 'UTC', activity_level TEXT, llm_logging_enabled INTEGER DEFAULT 0, is_admin INTEGER DEFAULT 0, llm_daily_token_limit INTEGER, about_me TEXT, created_at TEXT DEFAULT '2026-01-01T00:00:00Z')",
  );
  for (const u of users)
    db.prepare("INSERT INTO users (id, is_admin) VALUES (?, ?)").run(u.id, u.is_admin);
  return db;
}

describe("requireAdmin", () => {
  it("returns the user when is_admin = 1", () => {
    const db = dbWith([{ id: 1, is_admin: 1 }]);
    const user = requireAdmin(db, reqWithUser(1));
    expect(user.id).toBe(1);
    expect(user.is_admin).toBe(1);
  });

  it("throws 403 when is_admin = 0", () => {
    const db = dbWith([{ id: 2, is_admin: 0 }]);
    let caught: unknown;
    try {
      requireAdmin(db, reqWithUser(2));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(403);
    expect((caught as ApiError).code).toBe("forbidden");
  });

  it("throws (401, via requireUser) when no userId on the request", () => {
    const db = dbWith([{ id: 3, is_admin: 1 }]);
    expect(() => requireAdmin(db, reqWithUser(undefined))).toThrowError(ApiError);
  });
});
