import { mintToken } from "@almanac/core/repos";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./server.js";

describe("Cache-Control: no-store on API responses", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  function setup() {
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    a.db.prepare("INSERT INTO users (name) VALUES ('Jeff')").run();
    return a;
  }

  it("sets no-store on a public route (health)", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("sets no-store on an authenticated GET (users/me)", async () => {
    app = setup();
    const { token } = mintToken(app.db, { user_id: 1, name: "t" });
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("sets no-store even on an error response (401 unauth)", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/users/me" });
    expect(r.statusCode).toBe(401);
    expect(r.headers["cache-control"]).toBe("no-store");
  });
});
