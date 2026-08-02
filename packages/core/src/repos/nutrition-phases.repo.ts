import type { Connection } from "../db/connection.js";
import type { NutritionPhase, PhaseIntent, PhaseType, TdeeSource } from "../domain/nutrition.js";

const PHASE_COLUMNS =
  "id, user_id, name, intent, phase_type, tdee_at_phase_start, tdee_source, deficit_kcal, " +
  "daily_kcal_target, base_protein_g, base_carb_g, base_fat_g, " +
  "started_on, planned_end_on, ended_on, notes, created_at";

// `started_on`, `planned_end_on` and `ended_on` are all in the allowlist by
// design: corrections to phase boundaries are a real use case (e.g. "I told
// you July 1 but actually June 30"). The route layer is responsible for
// revalidating non-overlap when dates change (spec §6.4). The repo treats
// these as ordinary scalar updates.
const UPDATABLE_PHASE_COLUMNS = [
  "name",
  "intent",
  "phase_type",
  "tdee_at_phase_start",
  "tdee_source",
  "deficit_kcal",
  "daily_kcal_target",
  "base_protein_g",
  "base_carb_g",
  "base_fat_g",
  "started_on",
  "planned_end_on",
  "ended_on",
  "notes",
] as const satisfies readonly (keyof NutritionPhase)[];

export type StartPhaseInput = {
  user_id: number;
  name: string;
  intent: PhaseIntent;
  phase_type: PhaseType;
  tdee_at_phase_start: number;
  tdee_source: TdeeSource;
  deficit_kcal: number;
  daily_kcal_target: number;
  base_protein_g: number;
  base_carb_g: number;
  base_fat_g: number;
  started_on: string;
  planned_end_on?: string | null;
  notes?: string | null;
};

export type PhaseUpdate = Partial<Pick<NutritionPhase, (typeof UPDATABLE_PHASE_COLUMNS)[number]>>;

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Atomically closes the user's currently-active phase (if any) and opens a
 * new one starting on `started_on`. The previously-active phase's `ended_on`
 * is set to the day before `started_on`. Maintains the invariant that at most
 * one phase per user has `ended_on IS NULL`.
 */
export function closeAndStartPhase(db: Connection, input: StartPhaseInput): NutritionPhase {
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE nutrition_phases
         SET ended_on = ?
       WHERE user_id = ? AND ended_on IS NULL`,
    ).run(dayBefore(input.started_on), input.user_id);
    return db
      .prepare(
        `INSERT INTO nutrition_phases
          (user_id, name, intent, phase_type, tdee_at_phase_start, tdee_source, deficit_kcal,
           daily_kcal_target, base_protein_g, base_carb_g, base_fat_g,
           started_on, planned_end_on, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${PHASE_COLUMNS}`,
      )
      .get(
        input.user_id,
        input.name,
        input.intent,
        input.phase_type,
        input.tdee_at_phase_start,
        input.tdee_source,
        input.deficit_kcal,
        input.daily_kcal_target,
        input.base_protein_g,
        input.base_carb_g,
        input.base_fat_g,
        input.started_on,
        input.planned_end_on ?? null,
        input.notes ?? null,
      ) as NutritionPhase;
  });
  return tx();
}

export function findPhaseById(db: Connection, userId: number, id: number): NutritionPhase | null {
  const row = db
    .prepare(`SELECT ${PHASE_COLUMNS} FROM nutrition_phases WHERE id = ? AND user_id = ?`)
    .get(id, userId) as NutritionPhase | undefined;
  return row ?? null;
}

/**
 * Returns the user's currently-active phase (the unique row with `ended_on IS NULL`),
 * or `null` if no phase exists yet.
 */
export function findActivePhase(db: Connection, userId: number): NutritionPhase | null {
  const row = db
    .prepare(
      `SELECT ${PHASE_COLUMNS}
       FROM nutrition_phases
       WHERE user_id = ? AND ended_on IS NULL`,
    )
    .get(userId) as NutritionPhase | undefined;
  return row ?? null;
}

/**
 * Returns the phase containing the given date — i.e., where
 * `started_on <= date <= ended_on` (or `ended_on IS NULL`). Returns `null` if
 * the date predates all of the user's phases.
 */
export function findPhaseOnDate(
  db: Connection,
  userId: number,
  date: string,
): NutritionPhase | null {
  const row = db
    .prepare(
      `SELECT ${PHASE_COLUMNS}
       FROM nutrition_phases
       WHERE user_id = ?
         AND started_on <= ?
         AND (ended_on IS NULL OR ended_on >= ?)`,
    )
    .get(userId, date, date) as NutritionPhase | undefined;
  return row ?? null;
}

export function listPhases(db: Connection, userId: number): NutritionPhase[] {
  return db
    .prepare(
      `SELECT ${PHASE_COLUMNS}
       FROM nutrition_phases
       WHERE user_id = ?
       ORDER BY started_on DESC`,
    )
    .all(userId) as NutritionPhase[];
}

/**
 * Phases whose `ended_on` is non-null and on/after `floorDate` (YYYY-MM-DD),
 * scoped to the user, newest-ended first. Used by the phase-completion win
 * detector to bound its scan; `ended_on` is stored user-local YYYY-MM-DD so a
 * plain string compare is correct (no UTC bucketing).
 */
export function listRecentlyEndedPhases(
  db: Connection,
  userId: number,
  floorDate: string,
): NutritionPhase[] {
  return db
    .prepare(
      `SELECT ${PHASE_COLUMNS}
       FROM nutrition_phases
       WHERE user_id = ? AND ended_on IS NOT NULL AND ended_on >= ?
       ORDER BY ended_on DESC`,
    )
    .all(userId, floorDate) as NutritionPhase[];
}

export function updatePhase(
  db: Connection,
  userId: number,
  id: number,
  patch: PhaseUpdate,
): NutritionPhase | null {
  const keys = Object.keys(patch).filter((k): k is (typeof UPDATABLE_PHASE_COLUMNS)[number] =>
    (UPDATABLE_PHASE_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return findPhaseById(db, userId, id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  db.prepare(`UPDATE nutrition_phases SET ${set} WHERE id = ? AND user_id = ?`).run(
    ...values,
    id,
    userId,
  );
  return findPhaseById(db, userId, id);
}

export function deletePhase(db: Connection, userId: number, id: number): void {
  db.prepare("DELETE FROM nutrition_phases WHERE id = ? AND user_id = ?").run(id, userId);
}
