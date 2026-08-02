import { describe, expect, test, vi } from "vitest";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { runOnce } from "./run-once.js";

function freshDb() {
  const db = openDb(":memory:");
  runMigrations(db);
  return db;
}

describe("runOnce", () => {
  test("runs fn the first time and records the key", () => {
    const db = freshDb();
    const fn = vi.fn();
    runOnce(db, "task_a", fn);
    expect(fn).toHaveBeenCalledTimes(1);
    const row = db.prepare("SELECT key FROM one_shot_tasks WHERE key = ?").get("task_a");
    expect(row).toBeDefined();
  });

  test("does not run fn a second time", () => {
    const db = freshDb();
    const fn = vi.fn();
    runOnce(db, "task_a", fn);
    runOnce(db, "task_a", fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("a different key runs independently", () => {
    const db = freshDb();
    const a = vi.fn();
    const b = vi.fn();
    runOnce(db, "task_a", a);
    runOnce(db, "task_b", b);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  test("if fn throws, the key is NOT recorded (so it retries next boot)", () => {
    const db = freshDb();
    const boom = vi.fn(() => {
      throw new Error("boom");
    });
    expect(() => runOnce(db, "task_a", boom)).toThrow("boom");
    const row = db.prepare("SELECT key FROM one_shot_tasks WHERE key = ?").get("task_a");
    expect(row).toBeUndefined();
  });
});
