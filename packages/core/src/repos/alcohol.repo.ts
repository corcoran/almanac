import type { Connection } from "../db/connection.js";
import type { AlcoholSession } from "../domain/body.js";

const ALCOHOL_COLUMNS =
  "id, user_id, started_at, ended_at, drinks_count, est_kcal, notes, created_at";

// Plain event repo: no UNIQUE on the table, so `started_at` IS in the
// allowlist — many sessions per day are allowed and mutating the start
// timestamp cannot collide.
const UPDATABLE_ALCOHOL_COLUMNS = [
  "started_at",
  "ended_at",
  "drinks_count",
  "est_kcal",
  "notes",
] as const satisfies readonly (keyof AlcoholSession)[];

export type CreateAlcoholSessionInput = {
  user_id: number;
  started_at: string;
  ended_at?: string | null;
  drinks_count: number;
  est_kcal: number;
  notes?: string | null;
};

export type AlcoholSessionUpdate = Partial<
  Pick<AlcoholSession, (typeof UPDATABLE_ALCOHOL_COLUMNS)[number]>
>;

export type ListAlcoholSessionsOptions = {
  /** Inclusive lower bound on `started_at`. ISO 8601. */
  from?: string;
  /**
   * Exclusive upper bound on `started_at`. ISO 8601.
   * Matches the spec §6.1 `?before=<iso>` cursor convention.
   */
  to?: string;
  /**
   * Page size. Falsy or negative values fall back to the default (50).
   * Hard-capped at 200 to bound DB work; values above 200 silently clamp.
   */
  limit?: number;
};

/**
 * Inserts an alcohol session. There is no UNIQUE constraint on
 * `alcohol_sessions`, so repeat calls for the same user on the same date
 * create independent rows — many sessions per day are allowed. Returns
 * the freshly-inserted row.
 */
export function createAlcoholSession(
  db: Connection,
  input: CreateAlcoholSessionInput,
): AlcoholSession {
  return db
    .prepare(
      `INSERT INTO alcohol_sessions (user_id, started_at, ended_at, drinks_count, est_kcal, notes)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING ${ALCOHOL_COLUMNS}`,
    )
    .get(
      input.user_id,
      input.started_at,
      input.ended_at ?? null,
      input.drinks_count,
      input.est_kcal,
      input.notes ?? null,
    ) as AlcoholSession;
}

export function findAlcoholSessionById(
  db: Connection,
  userId: number,
  id: number,
): AlcoholSession | null {
  const row = db
    .prepare(`SELECT ${ALCOHOL_COLUMNS} FROM alcohol_sessions WHERE id = ? AND user_id = ?`)
    .get(id, userId) as AlcoholSession | undefined;
  return row ?? null;
}

export function listAlcoholSessions(
  db: Connection,
  userId: number,
  opts: ListAlcoholSessionsOptions = {},
): AlcoholSession[] {
  const where: string[] = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (opts.from !== undefined) {
    where.push("started_at >= ?");
    params.push(opts.from);
  }
  if (opts.to !== undefined) {
    where.push("started_at < ?");
    params.push(opts.to);
  }
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 200) : 50;
  return db
    .prepare(
      `SELECT ${ALCOHOL_COLUMNS}
       FROM alcohol_sessions
       WHERE ${where.join(" AND ")}
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(...params, limit) as AlcoholSession[];
}

export function updateAlcoholSession(
  db: Connection,
  userId: number,
  id: number,
  patch: AlcoholSessionUpdate,
): AlcoholSession | null {
  const keys = Object.keys(patch).filter((k): k is (typeof UPDATABLE_ALCOHOL_COLUMNS)[number] =>
    (UPDATABLE_ALCOHOL_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return findAlcoholSessionById(db, userId, id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  db.prepare(`UPDATE alcohol_sessions SET ${set} WHERE id = ? AND user_id = ?`).run(
    ...values,
    id,
    userId,
  );
  return findAlcoholSessionById(db, userId, id);
}

export function deleteAlcoholSession(db: Connection, userId: number, id: number): void {
  db.prepare("DELETE FROM alcohol_sessions WHERE id = ? AND user_id = ?").run(id, userId);
}
