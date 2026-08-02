import { rmSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./server.js";

const ONE_SHOT_KEY = "net_recompute_2026_06_robust_slope";

describe("boot net recompute (one-time daily_net re-snapshot)", () => {
  let app: FastifyInstance | undefined;
  let dbPath: string | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    if (dbPath) {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      dbPath = undefined;
    }
  });

  it("recomputes poisoned daily_net snapshots once on the next boot", async () => {
    dbPath = `/tmp/boot-net-test-${process.pid}-${Date.now()}.sqlite`;

    // --- First boot: seed, post a meal (writes daily_net), then poison it. ---
    app = buildApp({ dbPath, trustProxyHeaders: true });
    app.db.prepare("INSERT INTO users (name, email) VALUES ('Jeff', 'test@example.com')").run();
    app.db
      .prepare(
        `INSERT INTO nutrition_phases
          (user_id, name, intent, phase_type, tdee_at_phase_start, tdee_source, deficit_kcal,
           daily_kcal_target, base_protein_g, base_carb_g, base_fat_g, started_on)
         VALUES (1, 'cut', 'cut', 'cut', 2400, 'user_asserted', -500, 1900, 180, 170, 60, '2026-05-01')`,
      )
      .run();
    await app.ready();

    const post = await app.inject({
      method: "POST",
      url: "/api/v1/meals",
      headers: { "x-forwarded-email": "test@example.com", "content-type": "application/json" },
      payload: {
        eaten_at: "2026-05-12T08:00:00Z",
        kcal: 350,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
      },
    });
    expect(post.statusCode).toBe(201);

    const row = app.db
      .prepare("SELECT on_date, tdee_used FROM daily_net WHERE user_id = 1")
      .get() as { on_date: string; tdee_used: number } | undefined;
    expect(row).toBeDefined();
    const onDate = row?.on_date;
    expect(typeof onDate).toBe("string");

    // Poison the snapshot to a clearly-wrong sentinel and clear the run-once
    // marker so the recompute is eligible to fire on the next boot.
    app.db.prepare("UPDATE daily_net SET tdee_used = 99999 WHERE user_id = 1").run();
    app.db.prepare("DELETE FROM one_shot_tasks WHERE key = ?").run(ONE_SHOT_KEY);

    await app.close();
    app = undefined;

    // --- Second boot on the same file: its boot runs the one-time recompute. ---
    app = buildApp({ dbPath, trustProxyHeaders: true });
    await app.ready();

    const after = app.db
      .prepare("SELECT tdee_used FROM daily_net WHERE user_id = 1 AND on_date = ?")
      .get(onDate) as { tdee_used: number } | undefined;
    expect(after).toBeDefined();
    expect(after?.tdee_used).not.toBe(99999);

    const marker = app.db
      .prepare("SELECT 1 AS present FROM one_shot_tasks WHERE key = ?")
      .get(ONE_SHOT_KEY) as { present: number } | undefined;
    expect(marker?.present).toBe(1);
  });
});
