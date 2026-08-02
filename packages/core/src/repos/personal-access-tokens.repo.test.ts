import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import {
  bumpLastUsed,
  findActiveUserIdByToken,
  listActiveForUser,
  mintToken,
  revokeToken,
} from "./personal-access-tokens.repo.js";

describe("personal-access-tokens.repo", () => {
  it("createToken stores a sha256 hash, never the cleartext", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const { token, record } = mintToken(db, { user_id: userId, name: "laptop" });

    // cleartext is returned to caller, but never persisted as-is
    const row = db
      .prepare("SELECT token_hash FROM personal_access_tokens WHERE id = ?")
      .get(record.id) as { token_hash: string };
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"));

    // Sanity: the returned record exposes the prefix but not the hash field
    expect(record.prefix.length).toBe(8);
    expect(record.user_id).toBe(userId);
    expect(record.name).toBe("laptop");
    expect(record.revoked_at).toBeNull();
  });

  it("findActiveUserIdByToken returns user_id on match", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const { token } = mintToken(db, { user_id: userId, name: "cli" });
    expect(findActiveUserIdByToken(db, token)).toBe(userId);
  });

  it("findActiveUserIdByToken returns null on revoked token", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const { token, record } = mintToken(db, { user_id: userId, name: "old" });
    expect(revokeToken(db, record.id, userId)).toBe(true);
    expect(findActiveUserIdByToken(db, token)).toBeNull();
  });

  it("findActiveUserIdByToken returns null on unknown token", () => {
    const db = freshDb();
    seedUser(db);
    expect(findActiveUserIdByToken(db, "alm_nonexistent_token_value")).toBeNull();
  });

  it("listActiveForUser excludes revoked rows", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const a = mintToken(db, { user_id: userId, name: "alpha" });
    mintToken(db, { user_id: userId, name: "beta" });
    revokeToken(db, a.record.id, userId);

    const active = listActiveForUser(db, userId);
    expect(active.length).toBe(2 - 1);
    expect(active.map((r) => r.name)).toEqual(["beta"]);
  });

  it("revokeToken sets revoked_at; second call returns false (no rows changed)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const { record } = mintToken(db, { user_id: userId, name: "x" });

    expect(revokeToken(db, record.id, userId)).toBe(true);

    const row = db
      .prepare("SELECT revoked_at FROM personal_access_tokens WHERE id = ?")
      .get(record.id) as { revoked_at: string | null };
    expect(row.revoked_at).not.toBeNull();

    expect(revokeToken(db, record.id, userId)).toBe(false);
  });

  it("bumpLastUsed updates the timestamp", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const { token, record } = mintToken(db, { user_id: userId, name: "laptop" });
    expect(record.last_used_at).toBeNull();

    bumpLastUsed(db, token);

    const row = db
      .prepare("SELECT last_used_at FROM personal_access_tokens WHERE id = ?")
      .get(record.id) as { last_used_at: string | null };
    expect(row.last_used_at).not.toBeNull();
    expect(row.last_used_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("ON DELETE CASCADE removes tokens when user is deleted", () => {
    const db = freshDb();
    const userId = seedUser(db);
    mintToken(db, { user_id: userId, name: "a" });
    mintToken(db, { user_id: userId, name: "b" });

    expect(listActiveForUser(db, userId).length).toBe(2);

    db.prepare("DELETE FROM users WHERE id = ?").run(userId);

    const remaining = db
      .prepare("SELECT COUNT(*) as n FROM personal_access_tokens WHERE user_id = ?")
      .get(userId) as { n: number };
    expect(remaining.n).toBe(0);
  });
});
