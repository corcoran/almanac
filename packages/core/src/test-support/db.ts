import type { Connection } from "../db/connection.js";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";

export function freshDb(): Connection {
  const db = openDb(":memory:");
  runMigrations(db);
  return db;
}

export function seedUser(
  db: Connection,
  overrides: Partial<{
    name: string;
    dob: string | null;
    height_cm: number | null;
    sex: "male" | "female" | null;
  }> = {},
): number {
  const row = {
    name: overrides.name ?? "Jeff",
    dob: overrides.dob ?? "1990-01-01",
    height_cm: overrides.height_cm ?? 180,
    sex: overrides.sex ?? "male",
  };
  const r = db
    .prepare("INSERT INTO users (name, dob, height_cm, sex) VALUES (?, ?, ?, ?)")
    .run(row.name, row.dob, row.height_cm, row.sex);
  return Number(r.lastInsertRowid);
}
