import type { Connection } from "../db/connection.js";
import type { WebSource } from "../schemas/llm.js";

export type ChatTurn = {
  id?: number;
  helpful?: boolean;
  role: "user" | "assistant";
  content: string;
  sources?: WebSource[];
  /** The tool calls behind an assistant reply; `[]` when it used none, absent on user turns. */
  lookups?: string[];
};

/** A day's conversation, ordered. User+day scoped. */
export function listTurnsForDay(db: Connection, userId: number, onDate: string): ChatTurn[] {
  const rows = db
    .prepare(
      `SELECT id, role, content, sources, lookups, helpful FROM insights_chat_turns
       WHERE user_id = ? AND on_date = ? ORDER BY seq ASC`,
    )
    .all(userId, onDate) as Array<{
    id: number;
    helpful: number;
    role: "user" | "assistant";
    content: string;
    sources: string | null;
    lookups: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    helpful: r.helpful === 1,
    role: r.role,
    content: r.content,
    ...(r.sources ? { sources: JSON.parse(r.sources) as WebSource[] } : {}),
    ...(r.lookups !== null ? { lookups: JSON.parse(r.lookups) as string[] } : {}),
  }));
}

/** Append turns in order, continuing seq from the day's current max (-1 → starts at 0). */
export function appendTurns(
  db: Connection,
  userId: number,
  onDate: string,
  turns: ChatTurn[],
  createdAt: string,
): number[] {
  const row = db
    .prepare(
      "SELECT COALESCE(MAX(seq), -1) AS maxSeq FROM insights_chat_turns WHERE user_id = ? AND on_date = ?",
    )
    .get(userId, onDate) as { maxSeq: number };
  let seq = row.maxSeq + 1;
  const insert = db.prepare(
    `INSERT INTO insights_chat_turns (user_id, on_date, seq, role, content, sources, lookups, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((items: ChatTurn[]) => {
    const ids: number[] = [];
    for (const t of items) {
      const sourcesJson = t.sources && t.sources.length > 0 ? JSON.stringify(t.sources) : null;
      const lookupsJson =
        t.role === "assistant" && t.lookups !== undefined ? JSON.stringify(t.lookups) : null;
      const res = insert.run(
        userId,
        onDate,
        seq,
        t.role,
        t.content,
        sourcesJson,
        lookupsJson,
        createdAt,
      );
      ids.push(Number(res.lastInsertRowid));
      seq += 1;
    }
    return ids;
  });
  return tx(turns);
}

/** Distinct user-local dates that have a conversation, newest-first. */
export function listDaysWithTurns(db: Connection, userId: number): string[] {
  return (
    db
      .prepare(
        "SELECT DISTINCT on_date FROM insights_chat_turns WHERE user_id = ? ORDER BY on_date DESC",
      )
      .all(userId) as Array<{ on_date: string }>
  ).map((r) => r.on_date);
}

/**
 * The user's most recent conversation BEFORE `beforeDate`, as its closing
 * assistant takeaway. Used to give the coach cross-day continuity: it compares
 * "what I told you on {on_date}" against today's data and calls out what's
 * changed (or says the picture is the same). Returns the most recent prior day
 * that has an ASSISTANT turn — skipping gaps (yesterday, or 3 days back) — or
 * null when there's no prior conversation. User-scoped.
 */
export function findPriorDayTakeaway(
  db: Connection,
  userId: number,
  beforeDate: string,
): { on_date: string; takeaway: string } | null {
  const row = db
    .prepare(
      `SELECT on_date, content FROM insights_chat_turns
       WHERE user_id = ? AND on_date < ? AND role = 'assistant'
       ORDER BY on_date DESC, seq DESC
       LIMIT 1`,
    )
    .get(userId, beforeDate) as { on_date: string; content: string } | undefined;
  return row ? { on_date: row.on_date, takeaway: row.content } : null;
}

/**
 * Delete one day's conversation (the "New chat" reset). User+day scoped. Points
 * stay; their turn_id is nulled explicitly because foreign keys may be off.
 */
export function clearDay(db: Connection, userId: number, onDate: string): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE insights_points SET turn_id = NULL WHERE user_id = ? AND turn_id IN (
         SELECT id FROM insights_chat_turns WHERE user_id = ? AND on_date = ?)`,
    ).run(userId, userId, onDate);
    db.prepare("DELETE FROM insights_chat_turns WHERE user_id = ? AND on_date = ?").run(
      userId,
      onDate,
    );
  })();
}

export type PointKind = "told" | "learned";

export type InsightsPoint = {
  kind: PointKind;
  topic: string;
  gist: string;
  created_at: string;
  /** User-local day of the conversation the point was made in. */
  on_date: string;
  helpful: boolean;
};

export function insertPoints(
  db: Connection,
  userId: number,
  turnId: number,
  onDate: string,
  points: Array<{ topic: string; gist: string; kind?: PointKind }>,
  createdAt: string,
  helpful = false,
): void {
  const stmt = db.prepare(
    `INSERT INTO insights_points (user_id, turn_id, on_date, topic, gist, helpful, created_at, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const p of points) {
      stmt.run(
        userId,
        turnId,
        onDate,
        p.topic,
        p.gist,
        helpful ? 1 : 0,
        createdAt,
        p.kind ?? "told",
      );
    }
  })();
}

/** Points made since `sinceIso`: helpful ones first, then newest. User-scoped. */
export function listRecentPoints(
  db: Connection,
  userId: number,
  sinceIso: string,
  limit: number,
): InsightsPoint[] {
  const rows = db
    .prepare(
      `SELECT topic, gist, created_at, on_date, helpful, kind
       FROM insights_points
       WHERE user_id = ? AND created_at >= ?
       ORDER BY helpful DESC, created_at DESC, id ASC
       LIMIT ?`,
    )
    .all(userId, sinceIso, limit) as Array<{
    topic: string;
    gist: string;
    created_at: string;
    on_date: string;
    helpful: number;
    kind: PointKind;
  }>;
  return rows.map((r) => ({
    kind: r.kind,
    topic: r.topic,
    gist: r.gist,
    created_at: r.created_at,
    on_date: r.on_date,
    helpful: r.helpful === 1,
  }));
}

export function setTurnHelpful(
  db: Connection,
  userId: number,
  turnId: number,
  helpful: boolean,
): "ok" | "not_found" | "not_assistant" {
  const row = db
    .prepare("SELECT role FROM insights_chat_turns WHERE id = ? AND user_id = ?")
    .get(turnId, userId) as { role: string } | undefined;
  if (!row) return "not_found";
  if (row.role !== "assistant") return "not_assistant";
  const flag = helpful ? 1 : 0;
  db.transaction(() => {
    db.prepare("UPDATE insights_chat_turns SET helpful = ? WHERE id = ? AND user_id = ?").run(
      flag,
      turnId,
      userId,
    );
    db.prepare("UPDATE insights_points SET helpful = ? WHERE turn_id = ? AND user_id = ?").run(
      flag,
      turnId,
      userId,
    );
  })();
  return "ok";
}

export function countPointsForTurn(db: Connection, userId: number, turnId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM insights_points WHERE turn_id = ? AND user_id = ?")
    .get(turnId, userId) as { n: number };
  return row.n;
}

/** An assistant turn plus the user message just before it in the same day. User-scoped. */
export function getTurnForHelpful(
  db: Connection,
  userId: number,
  turnId: number,
): { content: string; on_date: string; prior_user_message: string | null } | null {
  const turn = db
    .prepare(
      `SELECT content, on_date, seq FROM insights_chat_turns
       WHERE id = ? AND user_id = ? AND role = 'assistant'`,
    )
    .get(turnId, userId) as { content: string; on_date: string; seq: number } | undefined;
  if (!turn) return null;
  const prior = db
    .prepare(
      `SELECT content FROM insights_chat_turns
       WHERE user_id = ? AND on_date = ? AND seq < ? AND role = 'user'
       ORDER BY seq DESC LIMIT 1`,
    )
    .get(userId, turn.on_date, turn.seq) as { content: string } | undefined;
  return {
    content: turn.content,
    on_date: turn.on_date,
    prior_user_message: prior?.content ?? null,
  };
}
