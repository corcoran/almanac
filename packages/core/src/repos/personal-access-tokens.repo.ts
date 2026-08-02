import { createHash, randomBytes } from "node:crypto";
import type { Connection } from "../db/connection.js";

const TOKEN_BYTES = 24; // 24 bytes base62 = up to 33 chars (padded to exactly 33; see base62 helper below)
const TOKEN_PREFIX = "alm_";

export type PersonalAccessToken = {
  id: number;
  user_id: number;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type MintResult = {
  token: string; // cleartext, shown ONCE
  record: PersonalAccessToken;
};

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function base62(buf: Buffer): string {
  // Convert bytes to base62 by treating them as a big integer.
  let n = BigInt(`0x${buf.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out;
    n /= 62n;
  }
  // 24 bytes ranges up to (2^192 - 1), which in base62 is at most 33 chars.
  // padStart fills any shorter encodings with leading '0' so cleartext is
  // always exactly "alm_" + 33 = 37 chars.
  return out.padStart(33, "0");
}

function hashToken(cleartext: string): string {
  return createHash("sha256").update(cleartext).digest("hex");
}

export function mintToken(db: Connection, input: { user_id: number; name: string }): MintResult {
  const cleartext = TOKEN_PREFIX + base62(randomBytes(TOKEN_BYTES));
  const prefix = cleartext.slice(0, 8);
  const token_hash = hashToken(cleartext);
  const row = db
    .prepare(
      `INSERT INTO personal_access_tokens (user_id, name, token_hash, prefix)
       VALUES (?, ?, ?, ?)
       RETURNING id, user_id, name, prefix, last_used_at, created_at, revoked_at`,
    )
    .get(input.user_id, input.name, token_hash, prefix) as PersonalAccessToken;
  return { token: cleartext, record: row };
}

export function findActiveUserIdByToken(db: Connection, cleartext: string): number | null {
  const row = db
    .prepare(
      `SELECT user_id FROM personal_access_tokens
       WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .get(hashToken(cleartext)) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}

export function listActiveForUser(db: Connection, user_id: number): PersonalAccessToken[] {
  return db
    .prepare(
      `SELECT id, user_id, name, prefix, last_used_at, created_at, revoked_at
       FROM personal_access_tokens
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC`,
    )
    .all(user_id) as PersonalAccessToken[];
}

export function revokeToken(db: Connection, id: number, user_id: number): boolean {
  const res = db
    .prepare(
      `UPDATE personal_access_tokens
       SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .run(id, user_id);
  return res.changes > 0;
}

export function bumpLastUsed(db: Connection, cleartext: string): void {
  db.prepare(
    `UPDATE personal_access_tokens
     SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE token_hash = ? AND revoked_at IS NULL`,
  ).run(hashToken(cleartext));
}
