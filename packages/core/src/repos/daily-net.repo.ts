import type { Connection } from "../db/connection.js";

export type DailyNetRow = {
  user_id: number;
  on_date: string;
  net_kcal: number;
  intake_kcal: number;
  tdee_used: number;
  tdee_basis: "profile_baseline" | "measured_intake";
  computed_at: string;
};

const COLUMNS = "user_id, on_date, net_kcal, intake_kcal, tdee_used, tdee_basis, computed_at";

export type UpsertDailyNetInput = Omit<DailyNetRow, "computed_at">;

export function upsertDailyNet(db: Connection, input: UpsertDailyNetInput): DailyNetRow {
  return db
    .prepare(
      `INSERT INTO daily_net (user_id, on_date, net_kcal, intake_kcal, tdee_used, tdee_basis)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, on_date) DO UPDATE SET
         net_kcal = excluded.net_kcal,
         intake_kcal = excluded.intake_kcal,
         tdee_used = excluded.tdee_used,
         tdee_basis = excluded.tdee_basis,
         computed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       RETURNING ${COLUMNS}`,
    )
    .get(
      input.user_id,
      input.on_date,
      input.net_kcal,
      input.intake_kcal,
      input.tdee_used,
      input.tdee_basis,
    ) as DailyNetRow;
}

export function deleteDailyNet(db: Connection, userId: number, onDate: string): void {
  db.prepare("DELETE FROM daily_net WHERE user_id = ? AND on_date = ?").run(userId, onDate);
}

export function findDailyNet(db: Connection, userId: number, onDate: string): DailyNetRow | null {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM daily_net WHERE user_id = ? AND on_date = ?`)
    .get(userId, onDate) as DailyNetRow | undefined;
  return row ?? null;
}

export function getDailyNetRange(
  db: Connection,
  userId: number,
  fromDate: string,
  toDate: string,
): DailyNetRow[] {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM daily_net
       WHERE user_id = ? AND on_date >= ? AND on_date <= ?
       ORDER BY on_date`,
    )
    .all(userId, fromDate, toDate) as DailyNetRow[];
}
