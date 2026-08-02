import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database, { type Database as Db } from "better-sqlite3";

export type Connection = Db;

export function openDb(path: string): Connection {
  // better-sqlite3 won't create the parent directory; ensure it exists
  // before opening. `:memory:` and other ":..." magic paths have no parent.
  if (!path.startsWith(":")) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  return db;
}
