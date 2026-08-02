import type { Connection } from "../db/connection.js";
import type { WebSource } from "../schemas/llm.js";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  sources?: WebSource[];
};

/** A day's conversation, ordered. User+day scoped. */
export function listTurnsForDay(db: Connection, userId: number, onDate: string): ChatTurn[] {
  const rows = db
    .prepare(
      `SELECT role, content, sources FROM insights_chat_turns
       WHERE user_id = ? AND on_date = ? ORDER BY seq ASC`,
    )
    .all(userId, onDate) as Array<{
    role: "user" | "assistant";
    content: string;
    sources: string | null;
  }>;
  return rows.map((r) => ({
    role: r.role,
    content: r.content,
    ...(r.sources ? { sources: JSON.parse(r.sources) as WebSource[] } : {}),
  }));
}

/** Append turns in order, continuing seq from the day's current max (-1 → starts at 0). */
export function appendTurns(
  db: Connection,
  userId: number,
  onDate: string,
  turns: ChatTurn[],
  createdAt: string,
): void {
  const row = db
    .prepare(
      "SELECT COALESCE(MAX(seq), -1) AS maxSeq FROM insights_chat_turns WHERE user_id = ? AND on_date = ?",
    )
    .get(userId, onDate) as { maxSeq: number };
  let seq = row.maxSeq + 1;
  const insert = db.prepare(
    `INSERT INTO insights_chat_turns (user_id, on_date, seq, role, content, sources, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((items: ChatTurn[]) => {
    for (const t of items) {
      const sourcesJson = t.sources && t.sources.length > 0 ? JSON.stringify(t.sources) : null;
      insert.run(userId, onDate, seq, t.role, t.content, sourcesJson, createdAt);
      seq += 1;
    }
  });
  tx(turns);
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

/** Delete one day's conversation (the "New chat" reset). User+day scoped. */
export function clearDay(db: Connection, userId: number, onDate: string): void {
  db.prepare("DELETE FROM insights_chat_turns WHERE user_id = ? AND on_date = ?").run(
    userId,
    onDate,
  );
}
