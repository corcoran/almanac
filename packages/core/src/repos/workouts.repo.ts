import type { Connection } from "../db/connection.js";
import type { ExerciseInstance, Workout, Set as WorkoutSet } from "../domain/workouts.js";

const WORKOUT_COLUMNS =
  "id, user_id, template_id, started_at, duration_min, rpe, est_kcal, notes, created_at";

const EXERCISE_INSTANCE_COLUMNS =
  "id, workout_id, exercise_id, display_order, planned_sets, notes, skipped_at";

const SET_COLUMNS = "id, exercise_instance_id, set_number, reps, weight_kg, notes";

const UPDATABLE_WORKOUT_COLUMNS = [
  "template_id",
  "started_at",
  "duration_min",
  "rpe",
  "est_kcal",
  "notes",
] as const satisfies readonly (keyof Workout)[];

const UPDATABLE_SET_COLUMNS = [
  "reps",
  "weight_kg",
  "notes",
] as const satisfies readonly (keyof WorkoutSet)[];

export type CompactSets = { count: number; reps: number; weight_kg?: number | null };
export type SetInput = { reps: number; weight_kg?: number | null; notes?: string | null };

export type ExerciseInstanceInput = {
  exercise_id: number;
  display_order: number;
  planned_sets: number;
  notes?: string | null;
  sets: SetInput[] | CompactSets;
  /** ISO timestamp; present when the user skipped this exercise via a template `skip` deviation. */
  skipped_at?: string | null;
};

export type CreateWorkoutInput = {
  user_id: number;
  template_id?: number | null;
  started_at: string;
  duration_min?: number | null;
  rpe: number;
  est_kcal?: number | null;
  notes?: string | null;
  exercises: ExerciseInstanceInput[];
};

export type WorkoutUpdate = Partial<Pick<Workout, (typeof UPDATABLE_WORKOUT_COLUMNS)[number]>>;

export type SetUpdate = Partial<Pick<WorkoutSet, (typeof UPDATABLE_SET_COLUMNS)[number]>>;

export type WorkoutsRangeQuery = {
  /** Inclusive lower bound on `started_at`. ISO 8601. */
  from?: string;
  /** Exclusive upper bound on `started_at`. ISO 8601 (matches §6.1 ?before= cursor). */
  to?: string;
  template_id?: number;
  /** Falsy or negative falls back to default 50. Hard-capped at 200. */
  limit?: number;
};

// Compact `{count, reps, weight_kg}` form expands to N identical sets.
// Per-set arrays pass through unchanged. `notes` is per-set only.
function expandSets(sets: SetInput[] | CompactSets): SetInput[] {
  if (Array.isArray(sets)) return sets;
  return Array.from({ length: sets.count }, () => ({
    reps: sets.reps,
    weight_kg: sets.weight_kg ?? null,
  }));
}

/**
 * Atomic three-level nested write: workout + exercise_instances + sets, all
 * inside one transaction. The parent workout row uses `INSERT ... RETURNING`
 * so the new id comes back without a re-fetch. Child rows use plain INSERT
 * (their ids are written via better-sqlite3's `lastInsertRowid` from each
 * statement run, scoped to the connection — single-threaded, no race).
 *
 * A failure mid-transaction (e.g. FK violation on a child INSERT) rolls back
 * the entire write, including the parent. After the writes complete, the
 * function performs a single composite `findWorkoutById` *inside* the
 * transaction to return the assembled tree — this is the documented
 * composite-read exception to the no-re-fetch rule (see task header).
 */
export function createWorkout(db: Connection, input: CreateWorkoutInput): Workout {
  const tx = db.transaction(() => {
    const workout = db
      .prepare(
        `INSERT INTO workouts
          (user_id, template_id, started_at, duration_min, rpe, est_kcal, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING ${WORKOUT_COLUMNS}`,
      )
      .get(
        input.user_id,
        input.template_id ?? null,
        input.started_at,
        input.duration_min ?? null,
        input.rpe,
        input.est_kcal ?? null,
        input.notes ?? null,
      ) as Workout;

    const eiStmt = db.prepare(
      `INSERT INTO exercise_instances
        (workout_id, exercise_id, display_order, planned_sets, notes, skipped_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const setStmt = db.prepare(
      `INSERT INTO sets
        (exercise_instance_id, set_number, reps, weight_kg, notes)
       VALUES (?, ?, ?, ?, ?)`,
    );

    for (const ei of input.exercises) {
      const eiR = eiStmt.run(
        workout.id,
        ei.exercise_id,
        ei.display_order,
        ei.planned_sets,
        ei.notes ?? null,
        ei.skipped_at ?? null,
      );
      const eiId = Number(eiR.lastInsertRowid);
      const expanded = expandSets(ei.sets);
      let n = 1;
      for (const s of expanded) {
        setStmt.run(eiId, n++, s.reps, s.weight_kg ?? null, s.notes ?? null);
      }
    }
    // Composite re-read inside the same transaction. Returns the full tree.
    return findWorkoutById(db, workout.id) as Workout;
  });
  return tx();
}

/**
 * Returns the workout row with nested `exercises[]` (each with nested `sets[]`)
 * fully populated. Returns `null` if the workout id doesn't exist.
 *
 * Used by `createWorkout` (inside its transaction) and `listWorkoutsWithDetail`.
 */
export function findWorkoutById(db: Connection, id: number): Workout | null {
  const w = db.prepare(`SELECT ${WORKOUT_COLUMNS} FROM workouts WHERE id = ?`).get(id) as
    | Workout
    | undefined;
  if (!w) return null;
  const instances = db
    .prepare(
      `SELECT ${EXERCISE_INSTANCE_COLUMNS}
       FROM exercise_instances
       WHERE workout_id = ?
       ORDER BY display_order`,
    )
    .all(id) as ExerciseInstance[];
  const setStmt = db.prepare(
    `SELECT ${SET_COLUMNS}
     FROM sets WHERE exercise_instance_id = ? ORDER BY set_number`,
  );
  for (const ei of instances) {
    ei.sets = setStmt.all(ei.id) as WorkoutSet[];
  }
  return { ...w, exercises: instances };
}

export function listWorkoutsInRange(
  db: Connection,
  userId: number,
  q: WorkoutsRangeQuery,
): Workout[] {
  const where: string[] = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (q.from !== undefined) {
    where.push("started_at >= ?");
    params.push(q.from);
  }
  if (q.to !== undefined) {
    where.push("started_at < ?");
    params.push(q.to);
  }
  if (q.template_id !== undefined) {
    where.push("template_id = ?");
    params.push(q.template_id);
  }
  const limit = q.limit && q.limit > 0 ? Math.min(q.limit, 200) : 50;
  return db
    .prepare(
      `SELECT ${WORKOUT_COLUMNS}
       FROM workouts
       WHERE ${where.join(" AND ")}
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(...params, limit) as Workout[];
}

export type WorkoutWithTemplateName = Workout & { template_name: string | null };

/**
 * Variant of listWorkoutsInRange that LEFT JOINs workout_templates to
 * include each workout's template_name (or null if no template was
 * attached). Used by signals (e.g. calendar-pills) that need the
 * human-readable name without a second round-trip.
 *
 * Mirrors listWorkoutsInRange's filter logic (from/to/template_id/limit)
 * exactly; only the projection differs. Kept as a separate helper so
 * existing consumers of listWorkoutsInRange — which depend on the
 * tighter `Workout` return shape — don't observe a widened type.
 */
export function listWorkoutsInRangeWithTemplateName(
  db: Connection,
  userId: number,
  q: WorkoutsRangeQuery,
): WorkoutWithTemplateName[] {
  const where: string[] = ["w.user_id = ?"];
  const params: unknown[] = [userId];
  if (q.from !== undefined) {
    where.push("w.started_at >= ?");
    params.push(q.from);
  }
  if (q.to !== undefined) {
    where.push("w.started_at < ?");
    params.push(q.to);
  }
  if (q.template_id !== undefined) {
    where.push("w.template_id = ?");
    params.push(q.template_id);
  }
  const limit = q.limit && q.limit > 0 ? Math.min(q.limit, 200) : 50;
  const projectedColumns = WORKOUT_COLUMNS.split(",")
    .map((c) => `w.${c.trim()}`)
    .join(", ");
  return db
    .prepare(
      `SELECT ${projectedColumns}, t.name AS template_name
       FROM workouts w
       LEFT JOIN workout_templates t ON t.id = w.template_id
       WHERE ${where.join(" AND ")}
       ORDER BY w.started_at DESC
       LIMIT ?`,
    )
    .all(...params, limit) as WorkoutWithTemplateName[];
}

/**
 * Workouts with nested instances + sets, in range. Used by signal functions
 * that need the full tree per workout (e.g. `computeStimStates`).
 *
 * This makes one query per workout to assemble the tree. At v1 data scale
 * (≤ 200 rows by default), the extra cost is single-digit ms.
 */
export function listWorkoutsWithDetail(
  db: Connection,
  userId: number,
  q: WorkoutsRangeQuery,
): Workout[] {
  const summaries = listWorkoutsInRange(db, userId, q);
  return summaries.map((w) => findWorkoutById(db, w.id) as Workout);
}

// --- Template deviations ---------------------------------------------------

export type DeviationSkip = { op: "skip"; exercise_id: number };
export type DeviationOverride = {
  op: "override_sets";
  exercise_id: number;
  sets: SetInput[] | CompactSets;
  planned_sets?: number;
};
export type DeviationAdd = {
  op: "add";
  exercise_id: number;
  display_order?: number; // optional — auto-assigned to (max + 1) when omitted
  planned_sets: number;
  sets: SetInput[] | CompactSets;
};
export type Deviation = DeviationSkip | DeviationOverride | DeviationAdd;

export type ResolvedItem = {
  exercise_id: number;
  display_order: number;
  planned_sets: number;
  sets: SetInput[];
  /**
   * Non-null when this resolved row came from a `skip` deviation. Carried
   * through to the `exercise_instances.skipped_at` column so the workout is
   * self-describing about adherence (skipped vs bombed vs completed).
   *
   * Always present (string | null) — no optional/undefined — so callers
   * never need `?? null` translation when mapping into `createWorkout`.
   */
  skipped_at: string | null;
};

/**
 * Resolve a template + deviations into the concrete exercise list for a workout.
 *
 * Validation invariants (throw on violation — caller maps to HTTP 422):
 *   - `skip { exercise_id }` must reference an exercise present in the template.
 *   - `override_sets { exercise_id }` must reference an exercise present in the template.
 *   - `add { exercise_id }` must NOT reference an exercise already in the template.
 *
 * Auto-assignment:
 *   - `add { display_order }` is optional; when omitted, the new item lands at
 *     (current max resolved display_order) + 1.
 */
export function applyTemplateWithDeviations(
  db: Connection,
  templateId: number,
  deviations: Deviation[],
  startedAt: string,
): ResolvedItem[] {
  const items = db
    .prepare(
      `SELECT exercise_id, display_order, default_sets, default_reps, default_weight_kg
       FROM workout_template_items
       WHERE template_id = ?
       ORDER BY display_order`,
    )
    .all(templateId) as Array<{
    exercise_id: number;
    display_order: number;
    default_sets: number;
    default_reps: number | null;
    default_weight_kg: number | null;
  }>;
  const templateExerciseIds = new Set(items.map((i) => i.exercise_id));

  const skipped = new Set<number>();
  const overrides = new Map<number, DeviationOverride>();
  const additions: DeviationAdd[] = [];
  for (const d of deviations) {
    if (d.op === "skip") {
      if (!templateExerciseIds.has(d.exercise_id)) {
        throw new Error(`Cannot skip exercise_id=${d.exercise_id}: not in template ${templateId}`);
      }
      skipped.add(d.exercise_id);
    } else if (d.op === "override_sets") {
      if (!templateExerciseIds.has(d.exercise_id)) {
        throw new Error(
          `Cannot override exercise_id=${d.exercise_id}: not in template ${templateId}; use 'add' instead`,
        );
      }
      overrides.set(d.exercise_id, d);
    } else {
      if (templateExerciseIds.has(d.exercise_id)) {
        throw new Error(
          `Cannot add exercise_id=${d.exercise_id}: already in template ${templateId}; use 'override_sets' instead`,
        );
      }
      additions.push(d);
    }
  }

  const resolved: ResolvedItem[] = [];
  for (const item of items) {
    if (skipped.has(item.exercise_id)) {
      // Persist the skip as a real exercise_instances row (sets=[], skipped_at set)
      // so the workout is self-describing about adherence. Distinct from
      // "bombed" (sets=[], skipped_at=null), which means tried-and-failed.
      resolved.push({
        exercise_id: item.exercise_id,
        display_order: item.display_order,
        // planned_sets is the template default — preserves "what they would have done"
        // so adherence/volume-deficit analysis can see the gap.
        planned_sets: item.default_sets,
        sets: [],
        // Anchor the skip to the workout's started_at, not log-time. Retro-logged
        // workouts (started_at hours/days in the past) would otherwise lie about
        // when the skip "happened".
        skipped_at: startedAt,
      });
      continue;
    }
    const override = overrides.get(item.exercise_id);
    if (override) {
      resolved.push({
        exercise_id: item.exercise_id,
        display_order: item.display_order,
        planned_sets: override.planned_sets ?? item.default_sets,
        sets: expandSets(override.sets),
        skipped_at: null,
      });
    } else {
      const sets: SetInput[] = Array.from({ length: item.default_sets }, () => ({
        reps: item.default_reps ?? 0,
        weight_kg: item.default_weight_kg ?? null,
      }));
      resolved.push({
        exercise_id: item.exercise_id,
        display_order: item.display_order,
        planned_sets: item.default_sets,
        sets,
        skipped_at: null,
      });
    }
  }
  for (const add of additions) {
    const order =
      add.display_order ??
      resolved.reduce((m, r) => (r.display_order > m ? r.display_order : m), 0) + 1;
    resolved.push({
      exercise_id: add.exercise_id,
      display_order: order,
      planned_sets: add.planned_sets,
      sets: expandSets(add.sets),
      skipped_at: null,
    });
  }
  resolved.sort((a, b) => a.display_order - b.display_order);
  return resolved;
}

// --- Mutation helpers (used by API correction endpoints) ------------------

/**
 * Ownership-scoped composite read for the external (route/signals) surface.
 * Returns the workout only if it belongs to `userId`, else null. Internal
 * callers that already proved ownership use the unscoped `findWorkoutById`.
 */
export function findWorkoutByIdForUser(db: Connection, userId: number, id: number): Workout | null {
  const owns = db.prepare("SELECT 1 FROM workouts WHERE id = ? AND user_id = ?").get(id, userId);
  if (!owns) return null;
  return findWorkoutById(db, id);
}

export function updateWorkout(
  db: Connection,
  userId: number,
  id: number,
  patch: WorkoutUpdate,
): Workout | null {
  const keys = Object.keys(patch).filter((k): k is (typeof UPDATABLE_WORKOUT_COLUMNS)[number] =>
    (UPDATABLE_WORKOUT_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return findWorkoutByIdForUser(db, userId, id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  db.prepare(`UPDATE workouts SET ${set} WHERE id = ? AND user_id = ?`).run(...values, id, userId);
  return findWorkoutByIdForUser(db, userId, id);
}

export function deleteWorkout(db: Connection, userId: number, id: number): void {
  db.prepare("DELETE FROM workouts WHERE id = ? AND user_id = ?").run(id, userId);
}

/**
 * Appends a new exercise_instance to an existing workout, with its sets.
 * Atomic: parent + children inserted in one transaction. Returns the
 * exercise_instance with its `sets[]` populated.
 */
export function addExerciseInstance(
  db: Connection,
  workoutId: number,
  input: ExerciseInstanceInput,
): ExerciseInstance {
  const tx = db.transaction(() => {
    // `addExerciseInstance` is the "on-the-fly add" path — the inverse of
    // skipping — so we hardcode `skipped_at` to NULL here. Any caller that
    // tries to pass a `skipped_at` on this path is making a category error.
    const ei = db
      .prepare(
        `INSERT INTO exercise_instances
          (workout_id, exercise_id, display_order, planned_sets, notes, skipped_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         RETURNING ${EXERCISE_INSTANCE_COLUMNS}`,
      )
      .get(
        workoutId,
        input.exercise_id,
        input.display_order,
        input.planned_sets,
        input.notes ?? null,
      ) as ExerciseInstance;
    const setStmt = db.prepare(
      `INSERT INTO sets (exercise_instance_id, set_number, reps, weight_kg, notes)
       VALUES (?, ?, ?, ?, ?)`,
    );
    let n = 1;
    for (const s of expandSets(input.sets)) {
      setStmt.run(ei.id, n++, s.reps, s.weight_kg ?? null, s.notes ?? null);
    }
    // Re-fetch to get the children populated.
    return findExerciseInstance(db, ei.id) as ExerciseInstance;
  });
  return tx();
}

export function findExerciseInstance(db: Connection, id: number): ExerciseInstance | null {
  const row = db
    .prepare(`SELECT ${EXERCISE_INSTANCE_COLUMNS} FROM exercise_instances WHERE id = ?`)
    .get(id) as ExerciseInstance | undefined;
  if (!row) return null;
  row.sets = db
    .prepare(
      `SELECT ${SET_COLUMNS}
       FROM sets WHERE exercise_instance_id = ? ORDER BY set_number`,
    )
    .all(id) as WorkoutSet[];
  return row;
}

/**
 * Ownership predicate for a `sets` row. A set has no `user_id` of its own; it
 * belongs to whoever owns the parent workout, reached via
 * `sets.exercise_instance_id → exercise_instances.workout_id → workouts.user_id`.
 * Used as a correlated EXISTS so update/delete are no-ops across users.
 */
const SET_OWNED_BY_USER = `EXISTS (
  SELECT 1 FROM exercise_instances ei
  JOIN workouts w ON w.id = ei.workout_id
  WHERE ei.id = sets.exercise_instance_id AND w.user_id = ?
)`;

export function updateSet(
  db: Connection,
  userId: number,
  id: number,
  patch: SetUpdate,
): WorkoutSet | null {
  const keys = Object.keys(patch).filter((k): k is (typeof UPDATABLE_SET_COLUMNS)[number] =>
    (UPDATABLE_SET_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return findSetByIdForUser(db, userId, id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  db.prepare(`UPDATE sets SET ${set} WHERE id = ? AND ${SET_OWNED_BY_USER}`).run(
    ...values,
    id,
    userId,
  );
  return findSetByIdForUser(db, userId, id);
}

export function findSetById(db: Connection, id: number): WorkoutSet | null {
  const row = db.prepare(`SELECT ${SET_COLUMNS} FROM sets WHERE id = ?`).get(id) as
    | WorkoutSet
    | undefined;
  return row ?? null;
}

/** Ownership-scoped set read for the route surface (owner-only, else null). */
export function findSetByIdForUser(db: Connection, userId: number, id: number): WorkoutSet | null {
  const row = db
    .prepare(`SELECT ${SET_COLUMNS} FROM sets WHERE id = ? AND ${SET_OWNED_BY_USER}`)
    .get(id, userId) as WorkoutSet | undefined;
  return row ?? null;
}

export function deleteSet(db: Connection, userId: number, id: number): void {
  db.prepare(`DELETE FROM sets WHERE id = ? AND ${SET_OWNED_BY_USER}`).run(id, userId);
}
