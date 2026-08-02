import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Connection, openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import {
  appendTurns,
  clearDay,
  findPriorDayTakeaway,
  listDaysWithTurns,
  listTurnsForDay,
} from "./insights-chat.repo.js";

describe("insights-chat.repo", () => {
  let db: Connection;
  beforeEach(() => {
    db = openDb(":memory:");
    runMigrations(db);
    db.prepare(
      "INSERT INTO users (name, dob, height_cm, sex, email) VALUES ('A','1990-01-01',180,'male','a@e.com')",
    ).run();
    db.prepare(
      "INSERT INTO users (name, dob, height_cm, sex, email) VALUES ('B','1990-01-01',180,'male','b@e.com')",
    ).run();
  });
  afterEach(() => db.close());

  it("appendTurns continues seq across calls; listTurnsForDay returns them ordered", () => {
    appendTurns(
      db,
      1,
      "2026-06-22",
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      "2026-06-22T15:00:00.000Z",
    );
    appendTurns(
      db,
      1,
      "2026-06-22",
      [
        { role: "user", content: "more" },
        { role: "assistant", content: "sure" },
      ],
      "2026-06-22T15:05:00.000Z",
    );
    const turns = listTurnsForDay(db, 1, "2026-06-22");
    expect(turns.map((t) => t.content)).toEqual(["hi", "hello", "more", "sure"]);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("round-trips sources on an assistant turn", () => {
    appendTurns(
      db,
      1,
      "2026-06-24",
      [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: "a",
          sources: [{ url: "https://x.com/a", title: "A", domain: "x.com" }],
        },
      ],
      "2026-06-24T12:00:00Z",
    );

    const turns = listTurnsForDay(db, 1, "2026-06-24");
    expect(turns[0]?.sources).toBeUndefined(); // user turn: no sources
    expect(turns[1]?.sources).toEqual([{ url: "https://x.com/a", title: "A", domain: "x.com" }]);
  });

  it("persists NULL sources as undefined on read", () => {
    appendTurns(db, 1, "2026-06-24", [{ role: "assistant", content: "a" }], "2026-06-24T12:00:00Z");
    const turns = listTurnsForDay(db, 1, "2026-06-24");
    expect(turns[0]?.sources).toBeUndefined();
  });

  it("isolates sources per turn within one append (no leak onto null turns)", () => {
    appendTurns(
      db,
      1,
      "2026-06-24",
      [
        { role: "user", content: "q1" },
        {
          role: "assistant",
          content: "a1",
          sources: [{ url: "https://a.com/1", title: "A", domain: "a.com" }],
        },
        { role: "user", content: "q2" },
        { role: "assistant", content: "a2" },
        {
          role: "assistant",
          content: "a3",
          sources: [{ url: "https://b.com/2", title: "B", domain: "b.com" }],
        },
      ],
      "2026-06-24T12:00:00Z",
    );

    const turns = listTurnsForDay(db, 1, "2026-06-24");
    expect(turns[0]?.sources).toBeUndefined();
    expect(turns[1]?.sources).toEqual([{ url: "https://a.com/1", title: "A", domain: "a.com" }]);
    expect(turns[2]?.sources).toBeUndefined();
    expect(turns[3]?.sources).toBeUndefined();
    expect(turns[4]?.sources).toEqual([{ url: "https://b.com/2", title: "B", domain: "b.com" }]);
  });

  it("listTurnsForDay is scoped to user + day", () => {
    appendTurns(db, 1, "2026-06-22", [{ role: "user", content: "u1" }], "2026-06-22T15:00:00.000Z");
    appendTurns(db, 2, "2026-06-22", [{ role: "user", content: "u2" }], "2026-06-22T15:00:00.000Z");
    expect(listTurnsForDay(db, 1, "2026-06-22").map((t) => t.content)).toEqual(["u1"]);
    expect(listTurnsForDay(db, 1, "2026-06-23")).toEqual([]);
  });

  it("listDaysWithTurns returns distinct user dates newest-first", () => {
    appendTurns(db, 1, "2026-06-20", [{ role: "user", content: "x" }], "2026-06-20T15:00:00.000Z");
    appendTurns(db, 1, "2026-06-22", [{ role: "user", content: "y" }], "2026-06-22T15:00:00.000Z");
    appendTurns(db, 2, "2026-06-21", [{ role: "user", content: "z" }], "2026-06-21T15:00:00.000Z");
    expect(listDaysWithTurns(db, 1)).toEqual(["2026-06-22", "2026-06-20"]);
  });

  it("clearDay removes only that user+day", () => {
    appendTurns(db, 1, "2026-06-22", [{ role: "user", content: "a" }], "2026-06-22T15:00:00.000Z");
    appendTurns(db, 1, "2026-06-23", [{ role: "user", content: "b" }], "2026-06-23T15:00:00.000Z");
    clearDay(db, 1, "2026-06-22");
    expect(listTurnsForDay(db, 1, "2026-06-22")).toEqual([]);
    expect(listTurnsForDay(db, 1, "2026-06-23").map((t) => t.content)).toEqual(["b"]);
  });

  describe("findPriorDayTakeaway", () => {
    it("returns the last assistant turn of the most recent prior day, with its date", () => {
      appendTurns(
        db,
        1,
        "2026-06-20",
        [
          { role: "user", content: "q1" },
          { role: "assistant", content: "take A" },
        ],
        "2026-06-20T15:00:00.000Z",
      );
      appendTurns(
        db,
        1,
        "2026-06-22",
        [
          { role: "user", content: "q2" },
          { role: "assistant", content: "first" },
          { role: "user", content: "q3" },
          { role: "assistant", content: "take B (latest of the day)" },
        ],
        "2026-06-22T15:00:00.000Z",
      );
      // Looking before 2026-06-24 → most recent prior day is 06-22, its LAST assistant turn.
      expect(findPriorDayTakeaway(db, 1, "2026-06-24")).toEqual({
        on_date: "2026-06-22",
        takeaway: "take B (latest of the day)",
      });
    });

    it("skips gaps — the most recent prior day need not be yesterday", () => {
      appendTurns(
        db,
        1,
        "2026-06-18",
        [{ role: "assistant", content: "three days back" }],
        "2026-06-18T15:00:00.000Z",
      );
      // Nothing on 06-19/06-20; before 06-21 → reaches back to 06-18.
      expect(findPriorDayTakeaway(db, 1, "2026-06-21")?.on_date).toBe("2026-06-18");
    });

    it("ignores the current/viewed day itself (strictly before)", () => {
      appendTurns(
        db,
        1,
        "2026-06-22",
        [{ role: "assistant", content: "today only" }],
        "2026-06-22T15:00:00.000Z",
      );
      // Only today has turns → no PRIOR day.
      expect(findPriorDayTakeaway(db, 1, "2026-06-22")).toBeNull();
    });

    it("is null when there is no prior conversation, and is user-scoped", () => {
      expect(findPriorDayTakeaway(db, 1, "2026-06-24")).toBeNull();
      // Another user's prior day must not leak.
      appendTurns(
        db,
        2,
        "2026-06-20",
        [{ role: "assistant", content: "user B" }],
        "2026-06-20T15:00:00.000Z",
      );
      expect(findPriorDayTakeaway(db, 1, "2026-06-24")).toBeNull();
    });
  });
});
