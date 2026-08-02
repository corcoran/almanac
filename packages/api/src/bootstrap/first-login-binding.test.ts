import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";
import { bindFirstLoginEmail } from "./first-login-binding.js";

describe("bindFirstLoginEmail", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  /**
   * Build a fresh in-memory app. Tests seed users themselves so each case
   * exercises a specific precondition (id=1 missing, id=1 with null email,
   * id=1 already bound, etc.).
   */
  function setup() {
    return buildApp({ dbPath: ":memory:", trustProxyHeaders: false });
  }

  type UserRow = { id: number; email: string | null };

  it("sets users.email WHERE id=1 AND email IS NULL when env var present", () => {
    app = setup();
    app.db.prepare("INSERT INTO users (id, name) VALUES (1, 'Jeff')").run();

    const bound = bindFirstLoginEmail(app.db, "jeff@example.com");
    expect(bound).toBe(true);

    const row = app.db.prepare("SELECT id, email FROM users WHERE id = 1").get() as UserRow;
    expect(row.email).toBe("jeff@example.com");
  });

  it("is a no-op when env var is empty string", () => {
    app = setup();
    app.db.prepare("INSERT INTO users (id, name) VALUES (1, 'Jeff')").run();

    const bound = bindFirstLoginEmail(app.db, "");
    expect(bound).toBe(false);

    const row = app.db.prepare("SELECT id, email FROM users WHERE id = 1").get() as UserRow;
    expect(row.email).toBeNull();
  });

  it("is a no-op when env var is undefined", () => {
    app = setup();
    app.db.prepare("INSERT INTO users (id, name) VALUES (1, 'Jeff')").run();

    const bound = bindFirstLoginEmail(app.db, undefined);
    expect(bound).toBe(false);

    const row = app.db.prepare("SELECT id, email FROM users WHERE id = 1").get() as UserRow;
    expect(row.email).toBeNull();
  });

  it("is a no-op when users.id=1 already has an email (second-run safety)", () => {
    app = setup();
    app.db
      .prepare("INSERT INTO users (id, name, email) VALUES (1, 'Jeff', 'existing@example.com')")
      .run();

    const bound = bindFirstLoginEmail(app.db, "different@example.com");
    expect(bound).toBe(false);

    const row = app.db.prepare("SELECT id, email FROM users WHERE id = 1").get() as UserRow;
    expect(row.email).toBe("existing@example.com");
  });

  it("is a no-op when users.id=1 does not exist (fresh DB)", () => {
    app = setup();
    // No INSERT — users table is empty.
    const before = app.db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    expect(before.c).toBe(0);

    const bound = bindFirstLoginEmail(app.db, "jeff@example.com");
    expect(bound).toBe(false);

    const after = app.db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    expect(after.c).toBe(0);
  });

  it("does not affect other users (only touches id=1)", () => {
    app = setup();
    app.db.prepare("INSERT INTO users (id, name) VALUES (1, 'Jeff')").run();
    app.db.prepare("INSERT INTO users (id, name) VALUES (2, 'Other')").run();

    const bound = bindFirstLoginEmail(app.db, "jeff@example.com");
    expect(bound).toBe(true);

    const u1 = app.db.prepare("SELECT id, email FROM users WHERE id = 1").get() as UserRow;
    const u2 = app.db.prepare("SELECT id, email FROM users WHERE id = 2").get() as UserRow;
    expect(u1.email).toBe("jeff@example.com");
    expect(u2.email).toBeNull();
  });
});
