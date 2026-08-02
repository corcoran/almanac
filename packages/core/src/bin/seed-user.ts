#!/usr/bin/env node
import { seedUser } from "../bootstrap/seed-user.js";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function main() {
  const dbPath = process.env.ALMANAC_DB_PATH ?? "./data/almanac.sqlite";
  const db = openDb(dbPath);
  runMigrations(db);

  const name = arg("name");
  if (!name) {
    console.error(
      "usage: seed-user --name <name> [--dob YYYY-MM-DD] [--height-cm N] [--sex male|female]",
    );
    process.exit(2);
  }
  const sex = arg("sex");
  if (sex !== null && sex !== "male" && sex !== "female") {
    console.error("--sex must be 'male' or 'female'");
    process.exit(2);
  }
  const heightStr = arg("height-cm");
  const height = heightStr === null ? null : Number(heightStr);
  if (height !== null && (Number.isNaN(height) || height <= 0)) {
    console.error("--height-cm must be a positive number");
    process.exit(2);
  }

  try {
    const { user_id } = seedUser(db, {
      name,
      dob: arg("dob"),
      height_cm: height,
      sex,
    });
    console.log(JSON.stringify({ ok: true, user_id }));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

main();
