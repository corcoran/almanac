import type { Connection } from "../db/connection.js";
import type { CardioSession } from "../domain/body.js";

const CARDIO_COLUMNS =
  "id, user_id, started_at, duration_min, modality, avg_hr, distance_km, steps, est_kcal, notes, created_at";

// Plain event repo: no UNIQUE on the table, so `started_at` IS in the
// allowlist — many sessions per day are allowed and mutating the start
// timestamp cannot collide.
const UPDATABLE_CARDIO_COLUMNS = [
  "started_at",
  "duration_min",
  "modality",
  "avg_hr",
  "distance_km",
  "steps",
  "est_kcal",
  "notes",
] as const satisfies readonly (keyof CardioSession)[];

export type CreateCardioSessionInput = {
  user_id: number;
  started_at: string;
  duration_min?: number | null;
  modality?: string | null;
  avg_hr?: number | null;
  distance_km?: number | null;
  steps?: number | null;
  est_kcal: number;
  notes?: string | null;
};

export type CardioSessionUpdate = Partial<
  Pick<CardioSession, (typeof UPDATABLE_CARDIO_COLUMNS)[number]>
>;

export type ListCardioSessionsOptions = {
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
 * Inserts a cardio session. There is no UNIQUE constraint on
 * `cardio_sessions`, so repeat calls for the same user on the same date
 * create independent rows — many sessions per day are allowed. Returns
 * the freshly-inserted row.
 */
export function createCardioSession(
  db: Connection,
  input: CreateCardioSessionInput,
): CardioSession {
  return db
    .prepare(
      `INSERT INTO cardio_sessions
        (user_id, started_at, duration_min, modality, avg_hr, distance_km, steps, est_kcal, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${CARDIO_COLUMNS}`,
    )
    .get(
      input.user_id,
      input.started_at,
      input.duration_min ?? null,
      input.modality ?? null,
      input.avg_hr ?? null,
      input.distance_km ?? null,
      input.steps ?? null,
      input.est_kcal,
      input.notes ?? null,
    ) as CardioSession;
}

export function findCardioSessionById(
  db: Connection,
  userId: number,
  id: number,
): CardioSession | null {
  const row = db
    .prepare(`SELECT ${CARDIO_COLUMNS} FROM cardio_sessions WHERE id = ? AND user_id = ?`)
    .get(id, userId) as CardioSession | undefined;
  return row ?? null;
}

export function listCardioSessions(
  db: Connection,
  userId: number,
  opts: ListCardioSessionsOptions = {},
): CardioSession[] {
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
      `SELECT ${CARDIO_COLUMNS}
       FROM cardio_sessions
       WHERE ${where.join(" AND ")}
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(...params, limit) as CardioSession[];
}

export function updateCardioSession(
  db: Connection,
  userId: number,
  id: number,
  patch: CardioSessionUpdate,
): CardioSession | null {
  const keys = Object.keys(patch).filter((k): k is (typeof UPDATABLE_CARDIO_COLUMNS)[number] =>
    (UPDATABLE_CARDIO_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return findCardioSessionById(db, userId, id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  db.prepare(`UPDATE cardio_sessions SET ${set} WHERE id = ? AND user_id = ?`).run(
    ...values,
    id,
    userId,
  );
  return findCardioSessionById(db, userId, id);
}

export function deleteCardioSession(db: Connection, userId: number, id: number): void {
  db.prepare("DELETE FROM cardio_sessions WHERE id = ? AND user_id = ?").run(id, userId);
}
