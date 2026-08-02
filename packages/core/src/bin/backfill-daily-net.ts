#!/usr/bin/env node
import { backfillDailyNet } from "../bootstrap/backfill-daily-net.js";
import { openDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";

function main() {
  const dbPath = process.env.ALMANAC_DB_PATH ?? "./data/almanac.sqlite";
  const db = openDb(dbPath);
  runMigrations(db);
  try {
    const summary = backfillDailyNet(db);
    console.log(JSON.stringify({ ok: true, ...summary }));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

main();
