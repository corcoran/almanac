import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Connection, openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import {
  appendTurns,
  clearDay,
  countPointsForTurn,
  findPriorDayTakeaway,
  getTurnForHelpful,
  insertPoints,
  listDaysWithTurns,
  listRecentPoints,
  listTurnsForDay,
  setTurnHelpful,
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

  it("round-trips lookups on assistant turns, empty included; user turns have none", () => {
    appendTurns(
      db,
      1,
      "2026-06-22",
      [
        { role: "user", content: "q", lookups: ["ignored"] },
        { role: "assistant", content: "a", lookups: ["get_report", "get_meals(limit=3)"] },
        { role: "assistant", content: "b", lookups: [] },
        { role: "assistant", content: "c" },
      ],
      "2026-06-22T15:00:00.000Z",
    );
    const turns = listTurnsForDay(db, 1, "2026-06-22");
    expect(turns[0]?.lookups).toBeUndefined();
    expect(turns[1]?.lookups).toEqual(["get_report", "get_meals(limit=3)"]);
    expect(turns[2]?.lookups).toEqual([]);
    expect(turns[3]?.lookups).toBeUndefined();
    expect(turns[0] && "lookups" in turns[0]).toBe(false);
    const raw = db
      .prepare("SELECT lookups FROM insights_chat_turns WHERE user_id = 1 ORDER BY seq")
      .all() as Array<{ lookups: string | null }>;
    expect(raw.map((r) => r.lookups)).toEqual([
      null,
      '["get_report","get_meals(limit=3)"]',
      "[]",
      null,
    ]);
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

function pointsSetup() {
  const db = openDb(":memory:");
  runMigrations(db);
  const add = (email: string) =>
    Number(
      db.prepare("INSERT INTO users (name, email) VALUES ('U', ?)").run(email).lastInsertRowid,
    );
  return { db, a: add("a@x.com"), b: add("b@x.com") };
}
const T = "2026-10-01T12:00:00.000Z";
const pair = (answer: string) => [
  { role: "user" as const, content: "q" },
  { role: "assistant" as const, content: answer },
];

describe("insights points and helpful", () => {
  it("appendTurns returns ids and listTurnsForDay exposes id + helpful", () => {
    const { db, a } = pointsSetup();
    const ids = appendTurns(db, a, "2026-10-01", pair("ans"), T);
    expect(ids).toHaveLength(2);
    const turns = listTurnsForDay(db, a, "2026-10-01");
    expect(turns[1]).toMatchObject({ id: ids[1], helpful: false });
  });

  it("setTurnHelpful toggles own assistant turns only", () => {
    const { db, a, b } = pointsSetup();
    const [q, ans] = appendTurns(db, a, "2026-10-01", pair("ans"), T);
    expect(setTurnHelpful(db, a, ans ?? -1, true)).toBe("ok");
    expect(listTurnsForDay(db, a, "2026-10-01")[1]?.helpful).toBe(true);
    expect(setTurnHelpful(db, b, ans ?? -1, true)).toBe("not_found");
    expect(setTurnHelpful(db, a, q ?? -1, true)).toBe("not_assistant");
  });

  it("lists recent points helpful-first, scoped, within the window and limit", () => {
    const { db, a, b } = pointsSetup();
    const old = "2026-09-01T12:00:00.000Z";
    const [, t1] = appendTurns(db, a, "2026-09-01", pair("x"), old);
    const [, t2] = appendTurns(db, a, "2026-10-01", pair("y"), T);
    const [, tb] = appendTurns(db, b, "2026-10-01", pair("z"), T);
    insertPoints(db, a, t1 ?? -1, "2026-09-01", [{ topic: "old", gist: "g" }], old);
    insertPoints(
      db,
      a,
      t2 ?? -1,
      "2026-10-01",
      [
        { topic: "new", gist: "g" },
        { topic: "liked", gist: "g" },
      ],
      T,
    );
    insertPoints(db, b, tb ?? -1, "2026-10-01", [{ topic: "other-user", gist: "g" }], T);
    setTurnHelpful(db, a, t1 ?? -1, true);

    const all = listRecentPoints(db, a, "2026-08-01T00:00:00.000Z", 30);
    expect(all.map((p) => p.topic)).toEqual(["old", "new", "liked"]);
    expect(all[0]?.helpful).toBe(true);
    expect(all.map((p) => p.on_date)).toEqual(["2026-09-01", "2026-10-01", "2026-10-01"]);

    const windowed = listRecentPoints(db, a, "2026-09-15T00:00:00.000Z", 30);
    expect(windowed.map((p) => p.topic).sort()).toEqual(["liked", "new"]);
    expect(listRecentPoints(db, a, "2026-08-01T00:00:00.000Z", 1)).toHaveLength(1);
  });

  it("round-trips point kind (default told) and shares the cap across kinds", () => {
    const { db, a } = pointsSetup();
    const [, t] = appendTurns(db, a, "2026-10-01", pair("y"), T);
    insertPoints(db, a, t ?? -1, "2026-10-01", [{ topic: "p1", gist: "g" }], T);
    insertPoints(db, a, t ?? -1, "2026-10-01", [{ topic: "p2", gist: "g", kind: "learned" }], T);
    const all = listRecentPoints(db, a, "2026-01-01T00:00:00.000Z", 30);
    expect(all.map((p) => [p.topic, p.kind])).toEqual([
      ["p1", "told"],
      ["p2", "learned"],
    ]);
    expect(listRecentPoints(db, a, "2026-01-01T00:00:00.000Z", 1)).toHaveLength(1);
  });

  it("clearDay keeps points and their helpful flags; turn_id becomes NULL", () => {
    const { db, a } = pointsSetup();
    const [, t] = appendTurns(db, a, "2026-10-01", pair("y"), T);
    insertPoints(db, a, t ?? -1, "2026-10-01", [{ topic: "p", gist: "g" }], T);
    setTurnHelpful(db, a, t ?? -1, true);
    clearDay(db, a, "2026-10-01");
    expect(listTurnsForDay(db, a, "2026-10-01")).toEqual([]);
    const pts = listRecentPoints(db, a, "2026-01-01T00:00:00.000Z", 30);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ topic: "p", helpful: true, on_date: "2026-10-01" });
    const row = db.prepare("SELECT turn_id FROM insights_points").get() as {
      turn_id: number | null;
    };
    expect(row.turn_id).toBeNull();
  });

  it("clearDay nulls turn_id itself when foreign keys are off", () => {
    const { db, a } = pointsSetup();
    db.pragma("foreign_keys = OFF");
    const [, t] = appendTurns(db, a, "2026-10-01", pair("y"), T);
    insertPoints(db, a, t ?? -1, "2026-10-01", [{ topic: "p", gist: "g" }], T);
    clearDay(db, a, "2026-10-01");
    const row = db.prepare("SELECT turn_id FROM insights_points").get() as {
      turn_id: number | null;
    };
    expect(row.turn_id).toBeNull();
    expect(listRecentPoints(db, a, "2026-01-01T00:00:00.000Z", 30)).toHaveLength(1);
  });

  it("setTurnHelpful propagates to the turn's points and back on un-tap", () => {
    const { db, a } = pointsSetup();
    const [, t] = appendTurns(db, a, "2026-10-01", pair("y"), T);
    const [, other] = appendTurns(db, a, "2026-10-01", pair("z"), T);
    insertPoints(db, a, t ?? -1, "2026-10-01", [{ topic: "p", gist: "g" }], T);
    insertPoints(db, a, other ?? -1, "2026-10-01", [{ topic: "q", gist: "g" }], T);
    setTurnHelpful(db, a, t ?? -1, true);
    const helpfulOf = () =>
      Object.fromEntries(
        listRecentPoints(db, a, "2026-01-01T00:00:00.000Z", 30).map((p) => [p.topic, p.helpful]),
      );
    expect(helpfulOf()).toEqual({ p: true, q: false });
    setTurnHelpful(db, a, t ?? -1, false);
    expect(helpfulOf()).toEqual({ p: false, q: false });
  });

  it("insertPoints can write helpful points", () => {
    const { db, a } = pointsSetup();
    const [, t] = appendTurns(db, a, "2026-10-01", pair("y"), T);
    insertPoints(db, a, t ?? -1, "2026-10-01", [{ topic: "p", gist: "g" }], T, true);
    expect(listRecentPoints(db, a, "2026-01-01T00:00:00.000Z", 30)[0]?.helpful).toBe(true);
  });

  it("countPointsForTurn counts one turn's points, user-scoped", () => {
    const { db, a, b } = pointsSetup();
    const [, t] = appendTurns(db, a, "2026-10-01", pair("y"), T);
    expect(countPointsForTurn(db, a, t ?? -1)).toBe(0);
    insertPoints(
      db,
      a,
      t ?? -1,
      "2026-10-01",
      [
        { topic: "p", gist: "g" },
        { topic: "q", gist: "g" },
      ],
      T,
    );
    expect(countPointsForTurn(db, a, t ?? -1)).toBe(2);
    expect(countPointsForTurn(db, b, t ?? -1)).toBe(0);
  });

  it("getTurnForHelpful returns the reply with the preceding user message", () => {
    const { db, a, b } = pointsSetup();
    appendTurns(db, a, "2026-10-01", pair("first"), T);
    const [, t] = appendTurns(
      db,
      a,
      "2026-10-01",
      [
        { role: "user", content: "second q" },
        { role: "assistant", content: "second a" },
      ],
      T,
    );
    expect(getTurnForHelpful(db, a, t ?? -1)).toEqual({
      content: "second a",
      on_date: "2026-10-01",
      prior_user_message: "second q",
    });
    expect(getTurnForHelpful(db, b, t ?? -1)).toBeNull();
    const [lone] = appendTurns(db, a, "2026-10-02", [{ role: "assistant", content: "solo" }], T);
    expect(getTurnForHelpful(db, a, lone ?? -1)?.prior_user_message).toBeNull();
  });
});
