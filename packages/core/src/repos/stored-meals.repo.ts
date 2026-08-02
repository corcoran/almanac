import type { Connection } from "../db/connection.js";
import type { StoredMeal } from "../domain/nutrition.js";

const STORED_MEAL_COLUMNS =
  "id, user_id, name, kcal, protein_g, carb_g, fat_g, description, created_at";

const UPDATABLE_STORED_MEAL_COLUMNS = [
  "name",
  "kcal",
  "protein_g",
  "carb_g",
  "fat_g",
  "description",
] as const satisfies readonly (keyof StoredMeal)[];

export type CreateStoredMealInput = {
  user_id: number;
  name: string;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  description?: string | null;
};

export type StoredMealUpdate = Partial<
  Pick<StoredMeal, (typeof UPDATABLE_STORED_MEAL_COLUMNS)[number]>
>;

/**
 * Upserts a stored meal by `(user_id, name)`. Calling twice for the same user
 * with the same name updates the existing row's macros/description instead of
 * creating a second one. Returns the resulting row (same `id` on repeat calls).
 */
export function createStoredMeal(db: Connection, input: CreateStoredMealInput): StoredMeal {
  return db
    .prepare(
      `INSERT INTO stored_meals (user_id, name, kcal, protein_g, carb_g, fat_g, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, name) DO UPDATE SET
         kcal = excluded.kcal,
         protein_g = excluded.protein_g,
         carb_g = excluded.carb_g,
         fat_g = excluded.fat_g,
         description = excluded.description
       RETURNING ${STORED_MEAL_COLUMNS}`,
    )
    .get(
      input.user_id,
      input.name,
      input.kcal,
      input.protein_g,
      input.carb_g,
      input.fat_g,
      input.description ?? null,
    ) as StoredMeal;
}

export function findStoredMealById(db: Connection, userId: number, id: number): StoredMeal | null {
  const row = db
    .prepare(`SELECT ${STORED_MEAL_COLUMNS} FROM stored_meals WHERE id = ? AND user_id = ?`)
    .get(id, userId) as StoredMeal | undefined;
  return row ?? null;
}

export function findStoredMealByName(
  db: Connection,
  userId: number,
  name: string,
): StoredMeal | null {
  const row = db
    .prepare(`SELECT ${STORED_MEAL_COLUMNS} FROM stored_meals WHERE user_id = ? AND name = ?`)
    .get(userId, name) as StoredMeal | undefined;
  return row ?? null;
}

export function listStoredMeals(db: Connection, userId: number): StoredMeal[] {
  return db
    .prepare(`SELECT ${STORED_MEAL_COLUMNS} FROM stored_meals WHERE user_id = ? ORDER BY name ASC`)
    .all(userId) as StoredMeal[];
}

export function updateStoredMeal(
  db: Connection,
  userId: number,
  id: number,
  patch: StoredMealUpdate,
): StoredMeal | null {
  const keys = Object.keys(patch).filter((k): k is (typeof UPDATABLE_STORED_MEAL_COLUMNS)[number] =>
    (UPDATABLE_STORED_MEAL_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return findStoredMealById(db, userId, id);
  // Guard the by-id scope BEFORE attempting the UPDATE so a no-op (unknown id
  // or wrong user) returns null instead of silently succeeding with 0 rows.
  if (findStoredMealById(db, userId, id) === null) return null;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  // A rename colliding with an existing (user_id, name) raises the UNIQUE
  // constraint here; the route layer pre-checks and returns 409 before
  // reaching this, but the repo still enforces the invariant.
  db.prepare(`UPDATE stored_meals SET ${set} WHERE id = ? AND user_id = ?`).run(
    ...values,
    id,
    userId,
  );
  return findStoredMealById(db, userId, id);
}

export function deleteStoredMeal(db: Connection, userId: number, id: number): void {
  db.prepare("DELETE FROM stored_meals WHERE id = ? AND user_id = ?").run(id, userId);
}
