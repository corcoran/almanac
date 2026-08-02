import type { Connection } from "../db/connection.js";
import type { WorkoutTemplate, WorkoutTemplateItem } from "../domain/training.js";

const TEMPLATE_COLUMNS = "id, user_id, name, notes, archived_at, created_at";
const TEMPLATE_ITEM_COLUMNS =
  "id, template_id, exercise_id, display_order, default_sets, default_reps, default_weight_kg, notes";

const UPDATABLE_TEMPLATE_COLUMNS = [
  "name",
  "notes",
] as const satisfies readonly (keyof WorkoutTemplate)[];

export type TemplateItemInput = {
  exercise_id: number;
  display_order: number;
  default_sets: number;
  default_reps?: number | null;
  default_weight_kg?: number | null;
  notes?: string | null;
};

export type CreateTemplateInput = {
  user_id: number;
  name: string;
  notes?: string | null;
  items: TemplateItemInput[];
};

export type TemplateUpdate = Partial<
  Pick<WorkoutTemplate, (typeof UPDATABLE_TEMPLATE_COLUMNS)[number]>
>;

function insertItems(db: Connection, templateId: number, items: TemplateItemInput[]): void {
  const stmt = db.prepare(
    `INSERT INTO workout_template_items
      (template_id, exercise_id, display_order, default_sets,
       default_reps, default_weight_kg, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of items) {
    stmt.run(
      templateId,
      item.exercise_id,
      item.display_order,
      item.default_sets,
      item.default_reps ?? null,
      item.default_weight_kg ?? null,
      item.notes ?? null,
    );
  }
}

export function createTemplate(db: Connection, input: CreateTemplateInput): WorkoutTemplate {
  // Single transaction: parent INSERT...RETURNING gets the new row in one
  // statement; child items are inserted within the same transaction.
  // No findById-after-insert; the parent row comes back from RETURNING.
  const tx = db.transaction(() => {
    const parent = db
      .prepare(
        `INSERT INTO workout_templates (user_id, name, notes)
         VALUES (?, ?, ?)
         RETURNING ${TEMPLATE_COLUMNS}`,
      )
      .get(input.user_id, input.name, input.notes ?? null) as WorkoutTemplate;
    insertItems(db, parent.id, input.items);
    // Re-read items so the returned shape includes them; cheap, same connection.
    const items = db
      .prepare(
        `SELECT ${TEMPLATE_ITEM_COLUMNS}
         FROM workout_template_items
         WHERE template_id = ?
         ORDER BY display_order`,
      )
      .all(parent.id) as WorkoutTemplateItem[];
    return { ...parent, items };
  });
  return tx();
}

export function replaceTemplateItems(
  db: Connection,
  templateId: number,
  items: TemplateItemInput[],
): void {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM workout_template_items WHERE template_id = ?").run(templateId);
    insertItems(db, templateId, items);
  });
  tx();
}

/**
 * Returns the template row (with items) regardless of archive state —
 * historical workouts reference soft-deleted templates and must be able to
 * resolve them. Use `listTemplates` with default options to get only active
 * rows.
 */
export function findTemplateById(
  db: Connection,
  userId: number,
  id: number,
): WorkoutTemplate | null {
  const tpl = db
    .prepare(`SELECT ${TEMPLATE_COLUMNS} FROM workout_templates WHERE id = ? AND user_id = ?`)
    .get(id, userId) as WorkoutTemplate | undefined;
  if (!tpl) return null;
  const items = db
    .prepare(
      `SELECT ${TEMPLATE_ITEM_COLUMNS}
       FROM workout_template_items
       WHERE template_id = ?
       ORDER BY display_order`,
    )
    .all(id) as WorkoutTemplateItem[];
  return { ...tpl, items };
}

export function listTemplates(
  db: Connection,
  userId: number,
  opts: { includeArchived?: boolean } = {},
): WorkoutTemplate[] {
  const where = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (!opts.includeArchived) where.push("archived_at IS NULL");
  const templates = db
    .prepare(
      `SELECT ${TEMPLATE_COLUMNS}
       FROM workout_templates
       WHERE ${where.join(" AND ")}
       ORDER BY name`,
    )
    .all(...params) as WorkoutTemplate[];
  if (templates.length === 0) return templates;
  // Batch-fetch items for all returned templates in a single query, then group
  // by template_id. Avoids N+1 while keeping each template's items ordered by
  // display_order (same shape as findTemplateById).
  const placeholders = templates.map(() => "?").join(",");
  const items = db
    .prepare(
      `SELECT ${TEMPLATE_ITEM_COLUMNS}
       FROM workout_template_items
       WHERE template_id IN (${placeholders})
       ORDER BY template_id, display_order`,
    )
    .all(...templates.map((t) => t.id)) as WorkoutTemplateItem[];
  const itemsByTemplate = new Map<number, WorkoutTemplateItem[]>();
  for (const t of templates) itemsByTemplate.set(t.id, []);
  for (const item of items) itemsByTemplate.get(item.template_id)?.push(item);
  return templates.map((t) => ({ ...t, items: itemsByTemplate.get(t.id) ?? [] }));
}

/**
 * Sets `archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`. No-op (no error)
 * if `id` does not exist. Archived rows remain findable by id but are
 * excluded from default `listTemplates` results.
 */
export function archiveTemplate(db: Connection, userId: number, id: number): void {
  db.prepare(
    "UPDATE workout_templates SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?",
  ).run(id, userId);
}

/**
 * Clears `archived_at`. No-op (no error) if `id` does not exist or if the row
 * was not archived. The partial UNIQUE index on `(user_id, name) WHERE archived_at IS NULL`
 * will throw if unarchiving would collide with an active row of the same name.
 */
export function unarchiveTemplate(db: Connection, userId: number, id: number): void {
  db.prepare("UPDATE workout_templates SET archived_at = NULL WHERE id = ? AND user_id = ?").run(
    id,
    userId,
  );
}

/**
 * Updates scalar fields only (`name`, `notes`). To modify nested template items,
 * use `replaceTemplateItems`. Keys outside the allowlist (including `id`,
 * `user_id`, `archived_at`, `created_at`, `items`) are silently ignored.
 */
export function updateTemplate(
  db: Connection,
  userId: number,
  id: number,
  patch: TemplateUpdate,
): WorkoutTemplate | null {
  const keys = Object.keys(patch).filter((k): k is (typeof UPDATABLE_TEMPLATE_COLUMNS)[number] =>
    (UPDATABLE_TEMPLATE_COLUMNS as readonly string[]).includes(k),
  );
  if (keys.length === 0) return findTemplateById(db, userId, id);
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => patch[k] ?? null);
  db.prepare(`UPDATE workout_templates SET ${set} WHERE id = ? AND user_id = ?`).run(
    ...values,
    id,
    userId,
  );
  return findTemplateById(db, userId, id);
}
