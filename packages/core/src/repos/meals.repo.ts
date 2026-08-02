import type { Connection } from "../db/connection.js";
import type { Meal } from "../domain/nutrition.js";

const MEAL_COLUMNS =
  "id, user_id, eaten_at, name, kcal, protein_g, carb_g, fat_g, notes, created_at";

const UPDATABLE_MEAL_COLUMNS = [
  "eaten_at",
  "name",
  "kcal",
  "protein_g",
  "carb_g",
  "fat_g",
  "notes",
] as const satisfies readonly (keyof Meal)[];

export type CreateMealInput = {
  user_id: number;
  eaten_at: string;
  name?: string | null;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  notes?: string | null;
};

export type MealUpdate = Partial<Pick<Meal, (typeof UPDATABLE_MEAL_COLUMNS)[number]>>;

export type ListMealsOptions = {
  /** Inclusive lower bound on `eaten_at`. ISO 8601. */
  from?: string;
  /**
   * Exclusive upper bound on `eaten_at`. ISO 8601.
   * Matches the spec §6.1 `?before=<iso>` cursor convention.
   */
  to?: string;
  /**
   * Page size. Falsy or negative values fall back to the default (50).
   * Hard-capped at 200 to bound DB work; values above 200 silently clamp.
   */
  limit?: number;
};

export function createMeal(db: Connection, input: CreateMealInput): Meal {
  return db
    .prepare(
      `INSERT INTO meals (user_id, eaten_at, name, kcal, protein_g, carb_g, fat_g, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${MEAL_COLUMNS}`,
    )
    .get(
      input.user_id,
      input.eaten_at,
      input.name ?? null,
      input.kcal,
      input.protein_g,
      input.carb_g,
      input.fat_g,
      input.notes ?? null,
    ) as Meal;
}

export function findMealById(db: Connection, userId: number, id: number): Meal | null {
  const row = db
    .prepare(`SELECT ${MEAL_COLUMNS} FROM meals WHERE id = ? AND user_id = ?`)
    .get(id, userId) as Meal | undefined;
  return row ?? null;
}

export function listMeals(db: Connection, userId: number, opts: ListMealsOptions = {}): Meal[] {
  const where: string[] = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (opts.from !== undefined) {
    where.push("eaten_at >= ?");
    params.push(opts.from);
  }
  if (opts.to !== undefined) {
    where.push("eaten_at < ?");
    params.push(opts.to);
  }
  const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 200) : 50;
  return db
    .prepare(
      `SELECT ${MEAL_COLUMNS}
       FROM meals
       WHERE ${where.join(" AND ")}
       ORDER BY eaten_at DESC
       LIMIT ?`,
    )
    .all(...params, limit) as Meal[];
}

export function updateMeal(
  db: Connection,
  userId: number,
  id: number,
  patch: MealUpdate,
): Meal | null {
  const keys = Object.keys(patch).filter((k): k is (typeof UPDATABLE_MEAL_COLUMNS)[number] =>
    (UPDATABLE_MEAL_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return findMealById(db, userId, id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  db.prepare(`UPDATE meals SET ${set} WHERE id = ? AND user_id = ?`).run(...values, id, userId);
  return findMealById(db, userId, id);
}

export function deleteMeal(db: Connection, userId: number, id: number): void {
  db.prepare("DELETE FROM meals WHERE id = ? AND user_id = ?").run(id, userId);
}
