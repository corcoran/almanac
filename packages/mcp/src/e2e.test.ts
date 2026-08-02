import type { AddressInfo } from "node:net";
import { buildApp } from "@almanac/api/server";
import { seedUser } from "@almanac/core/bootstrap";
import { closeAndStartPhase, mintToken } from "@almanac/core/repos";
import { at } from "@almanac/core/test-support";
import { currentUserDate } from "@almanac/core/types";
import { describe, expect, it } from "vitest";
import { ApiClient } from "./client.js";
import { buildMcpServer } from "./server.js";
import { connectTestClient } from "./test-support/mcp-harness.js";

/**
 * Test convenience: seed a user AND an active maintenance phase. Production
 * `seedUser` deliberately doesn't create a phase (Gap 29) but most e2e flows
 * need one to exercise downstream signals.
 */
function seedUserAndDefaultPhase(
  db: import("@almanac/core/db").Connection,
  input: Parameters<typeof seedUser>[1],
): { user_id: number } {
  const { user_id } = seedUser(db, input);
  closeAndStartPhase(db, {
    user_id,
    name: "Initial maintenance",
    intent: "maintenance",
    // TDEE-refactor fields: maintenance with deficit_kcal = 0 (within band).
    phase_type: "maintenance",
    tdee_at_phase_start: 2400,
    tdee_source: "user_asserted",
    deficit_kcal: 0,
    daily_kcal_target: 2400,
    base_protein_g: 140,
    base_carb_g: 270,
    base_fat_g: 80,
    started_on: new Date().toISOString().slice(0, 10),
  });
  return { user_id };
}

describe("MCP <-> API end-to-end", () => {
  it("runs a realistic conversation flow over a real Fastify + MCP server", async () => {
    // ----- boot the API on an ephemeral port with an in-memory SQLite db --
    // trustProxyHeaders is left on for parity with deployed behavior, but the
    // MCP→API path only sends `Authorization: Bearer <PAT>` now — the header
    // is unused. The PAT is the canonical auth surface.
    const app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    const { user_id } = seedUserAndDefaultPhase(app.db, {
      name: "Jeff",
      dob: "1990-01-01",
      height_cm: 180,
      sex: "male",
    });
    app.db.prepare("UPDATE users SET email = 'test@example.com' WHERE id = 1").run();
    // Mint a real PAT off the seeded user; MCP threads this bearer through
    // to the API on every call (this is the post-Task-5 contract).
    const { token } = mintToken(app.db, { user_id, name: "e2e-test" });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // ----- build the MCP server pointed at the API ----------------------
      const api = new ApiClient({ baseUrl });
      const mcp = buildMcpServer({ api }, () => token);
      const client = await connectTestClient(mcp);

      // ----- 1. List tools and resources ----------------------------------
      const tools = (await client.listTools()) as {
        tools: Array<{ name: string }>;
      };
      expect(tools.tools).toHaveLength(77);
      const toolNames = tools.tools.map((t) => t.name);
      expect(toolNames).toContain("log_meal");
      expect(toolNames).toContain("define_exercise");
      expect(toolNames).toContain("get_today_context");
      expect(toolNames).toContain("get_calendar");
      expect(toolNames).toContain("get_user_profile");
      expect(toolNames).toContain("update_exercise");
      expect(toolNames).toContain("ping");
      expect(toolNames).toContain("get_day_status");
      expect(toolNames).toContain("delete_workout");
      expect(toolNames).toContain("end_phase");
      expect(toolNames).toContain("get_capabilities");

      const resources = (await client.listResources()) as {
        resources: Array<{ uri: string }>;
      };
      expect(resources.resources).toHaveLength(5);

      // ----- 2. Define an exercise group ---------------------------------
      const groupResult = (await client.callTool({
        name: "define_exercise_group",
        arguments: { name: "Push" },
      })) as { content: Array<{ type: string; text: string }> };
      const groupBody = JSON.parse(at(groupResult.content, 0).text) as {
        exercise_group: { id: number; name: string };
      };
      expect(groupBody.exercise_group.name).toBe("Push");
      const groupId = groupBody.exercise_group.id;

      const groupRow = app.db
        .prepare("SELECT name FROM exercise_groups WHERE id = ?")
        .get(groupId) as { name: string };
      expect(groupRow.name).toBe("Push");

      // ----- 3. Define an exercise ----------------------------------------
      const exResult = (await client.callTool({
        name: "define_exercise",
        arguments: { group_id: groupId, name: "Bench press" },
      })) as { content: Array<{ type: string; text: string }> };
      const exBody = JSON.parse(at(exResult.content, 0).text) as {
        exercise: { id: number; name: string };
      };
      expect(exBody.exercise.name).toBe("Bench press");

      // ----- 4. Log a meal -----------------------------------------------
      const mealPayload = {
        eaten_at: new Date().toISOString(),
        kcal: 350,
        protein_g: 25,
        carb_g: 30,
        fat_g: 15,
      };
      const mealResult = (await client.callTool({
        name: "log_meal",
        arguments: mealPayload,
      })) as { content: Array<{ type: string; text: string }> };
      const mealBody = JSON.parse(at(mealResult.content, 0).text) as {
        id: number;
        day: string;
        summary: string;
        day_totals: { kcal: number };
        // Post-TDEE-refactor: day_target carries the new structured block.
        day_target: { target: { kcal: number } };
      };
      expect(mealBody.summary).toContain("350");
      expect(mealBody.day_totals.kcal).toBe(350);
      expect(mealBody.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const mealCountAfterFirst = (
        app.db.prepare("SELECT COUNT(*) AS c FROM meals").get() as { c: number }
      ).c;
      expect(mealCountAfterFirst).toBe(1);

      // ----- 5. Read almanac://today --------------------------------------
      const todayResult = (await client.readResource({
        uri: "almanac://today",
      })) as { contents: Array<{ uri: string; mimeType: string; text: string }> };
      expect(at(todayResult.contents, 0).uri).toBe("almanac://today");
      expect(at(todayResult.contents, 0).mimeType).toBe("application/json");
      const today = JSON.parse(at(todayResult.contents, 0).text) as {
        today: { kcal_in: number };
      };
      expect(today.today.kcal_in).toBe(350);

      // ----- 6. Idempotent replay -- same payload, same key, no new row ----
      const replayResult = (await client.callTool({
        name: "log_meal",
        arguments: mealPayload,
      })) as { content: Array<{ type: string; text: string }> };
      const replayBody = JSON.parse(at(replayResult.content, 0).text) as { id: number };
      expect(replayBody.id).toBe(mealBody.id);
      const mealCountAfterReplay = (
        app.db.prepare("SELECT COUNT(*) AS c FROM meals").get() as { c: number }
      ).c;
      expect(mealCountAfterReplay).toBe(1);

      // ----- 7. Bad payload -> isError envelope, not a thrown exception ----
      const badResult = (await client.callTool({
        name: "log_meal",
        arguments: { eaten_at: "today 8am", kcal: "not-a-number" },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
      expect(badResult.isError).toBe(true);
      expect(at(badResult.content, 0).text).toMatch(/[Ii]nput validation error/);

      // ----- 8. Unknown tool -> isError envelope, not a thrown exception ---
      const unknownResult = (await client.callTool({
        name: "no_such_tool",
        arguments: {},
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
      expect(unknownResult.isError).toBe(true);
      expect(at(unknownResult.content, 0).text).toMatch(/no_such_tool.*not found/);
    } finally {
      await app.close();
    }
  });

  it("exercises the priority 1-12 surface: timezone, list_*, naked-local, macros, log_workout shortcut", async () => {
    const app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    const { user_id } = seedUserAndDefaultPhase(app.db, {
      name: "Jeff",
      dob: "1990-01-01",
      height_cm: 180,
      sex: "male",
    });
    app.db.prepare("UPDATE users SET email = 'test@example.com' WHERE id = 1").run();
    const { token } = mintToken(app.db, { user_id, name: "e2e-test" });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const api = new ApiClient({ baseUrl });
      const mcp = buildMcpServer({ api }, () => token);
      const client = await connectTestClient(mcp);

      const call = async (name: string, args: unknown) => {
        const res = (await client.callTool({
          name,
          arguments: args as Record<string, unknown>,
        })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
        if (res.isError) throw new Error(`tool ${name} failed: ${at(res.content, 0).text}`);
        return JSON.parse(at(res.content, 0).text);
      };

      // 1. Set timezone so naked-local times resolve in America/Toronto.
      await call("update_user_profile", { timezone: "America/Toronto" });
      const userRow = app.db.prepare("SELECT timezone FROM users WHERE id = 1").get() as {
        timezone: string;
      };
      expect(userRow.timezone).toBe("America/Toronto");

      // 2. Define + list exercise groups.
      const initialGroups = (await call("list_exercise_groups", {})) as {
        exercise_groups: unknown[];
      };
      expect(initialGroups.exercise_groups).toHaveLength(0);
      const groupBody = (await call("define_exercise_group", { name: "Chest" })) as {
        exercise_group: { id: number };
      };
      const groupId = groupBody.exercise_group.id;
      const afterGroups = (await call("list_exercise_groups", {})) as {
        exercise_groups: Array<{ name: string }>;
      };
      expect(afterGroups.exercise_groups).toHaveLength(1);
      expect(at(afterGroups.exercise_groups, 0).name).toBe("Chest");

      // 3. Define + list exercises.
      const exBody = (await call("define_exercise", {
        group_id: groupId,
        name: "Bench press",
      })) as { exercise: { id: number } };
      const exId = exBody.exercise.id;
      const exList = (await call("list_exercises", { group_id: groupId })) as {
        exercises: Array<{ id: number }>;
      };
      expect(exList.exercises).toHaveLength(1);
      expect(at(exList.exercises, 0).id).toBe(exId);

      // 4. Define + list templates (items returned inline).
      const tplBody = (await call("define_workout_template", {
        name: "PUSH",
        items: [
          {
            exercise_id: exId,
            display_order: 0,
            default_sets: 3,
            default_reps: 8,
            default_weight_kg: 60,
          },
        ],
      })) as { workout_template: { id: number } };
      const tplId = tplBody.workout_template.id;
      const tplList = (await call("list_workout_templates", {})) as {
        workout_templates: Array<{ id: number; name: string; items: unknown[] }>;
      };
      expect(tplList.workout_templates).toHaveLength(1);
      expect(at(tplList.workout_templates, 0).items).toHaveLength(1);

      // 5. Log a meal naked-local at 22:30 Toronto on May 8 — UTC instant lands
      // at 02:30Z May 9, but DAY_START=4 + Toronto tz buckets it back to May 8.
      const mealBody = (await call("log_meal", {
        eaten_at: "2026-05-08T22:30:00",
        name: "dinner",
        kcal: 800,
        protein_g: 50,
        carb_g: 70,
        fat_g: 25,
      })) as { day: string; day_totals: { kcal: number } };
      expect(mealBody.day).toBe("2026-05-08");
      expect(mealBody.day_totals.kcal).toBe(800);

      // 6. get_macros_for_date for May 8 — the meal should appear there with
      // its full P/C/F breakdown (not just protein), both in the structured
      // totals and the glanceable summary line.
      const macrosBody = (await call("get_macros_for_date", {
        date: "2026-05-08",
      })) as {
        date: string;
        day_totals: { kcal: number; protein_g: number; carb_g: number; fat_g: number };
        summary: string;
      };
      expect(macrosBody.date).toBe("2026-05-08");
      expect(macrosBody.day_totals.kcal).toBe(800);
      expect(macrosBody.day_totals.protein_g).toBe(50);
      expect(macrosBody.day_totals.carb_g).toBe(70);
      expect(macrosBody.day_totals.fat_g).toBe(25);
      expect(macrosBody.summary).toContain("50p / 70c / 25f");

      // 7. Log a workout from the template with no deviations (the shortcut).
      const workoutBody = (await call("log_workout", {
        template_id: tplId,
        started_at: "2026-05-13T18:00:00",
        rpe: 7,
      })) as { id: number; summary: string };
      expect(workoutBody.id).toBeGreaterThan(0);
      // summary is "Logged workout — RPE 7, 1/1 exercises." for a 1-exercise template, no skips.
      expect(workoutBody.summary).toContain("1/1");

      // 8. get_today_context: verify new shapes on tdee / weight_change / stim.
      const ctx = (await call("get_today_context", {})) as {
        user: { timezone: string };
        trend_weight: {
          weight_change: {
            value_kg: number;
            over_days: number;
            confidence: string;
          } | null;
        };
        tdee: { kcal: number; basis: string; confidence: string };
        stim_states: Array<{ level: number; trainable_capacity: string }>;
      };
      expect(ctx.user.timezone).toBe("America/Toronto");
      if (ctx.trend_weight.weight_change !== null) {
        expect(ctx.trend_weight.weight_change).toHaveProperty("value_kg");
        expect(ctx.trend_weight.weight_change).toHaveProperty("over_days");
        expect(["early", "established"]).toContain(ctx.trend_weight.weight_change.confidence);
      }
      expect(ctx.tdee.kcal).toBeGreaterThan(0);
      expect(["profile_baseline", "measured_intake"]).toContain(ctx.tdee.basis);
      expect(["early", "established"]).toContain(ctx.tdee.confidence);
      for (const stim of ctx.stim_states) {
        expect(["depleted", "recovering", "fresh"]).toContain(stim.trainable_capacity);
        expect(stim.level).toBeGreaterThanOrEqual(0);
        expect(stim.level).toBeLessThanOrEqual(100);
      }

      // 9. get_macros_range over a single day returns the same totals.
      const rangeBody = (await call("get_macros_range", {
        from_date: "2026-05-08",
        to_date: "2026-05-08",
      })) as {
        days: Array<{ date: string; day_totals: { kcal: number } }>;
      };
      expect(rangeBody.days).toHaveLength(1);
      expect(at(rangeBody.days, 0).date).toBe("2026-05-08");
      expect(at(rangeBody.days, 0).day_totals.kcal).toBe(800);
    } finally {
      await app.close();
    }
  });

  it("exercises the round-2 surface against a pre-seeded user: aggregates, cardio steps, sleep night_of, planned_end_on, recommend-template (PAT-authed)", async () => {
    // Post-Task-5: with PAT-based auth, the user must exist BEFORE the bearer
    // can be minted. Seed a bare user (no phase) so the test can still
    // exercise update_user_profile / bootstrap_user conflict + the rest of
    // the round-2 surface.
    const app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    const { user_id } = seedUser(app.db, {
      name: "Jeff",
      dob: "1990-01-01",
      height_cm: 180,
      sex: "male",
    });
    app.db.prepare("UPDATE users SET email = 'test@example.com' WHERE id = 1").run();
    const { token } = mintToken(app.db, { user_id, name: "e2e-test" });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const api = new ApiClient({ baseUrl });
      const mcp = buildMcpServer({ api }, () => token);
      const client = await connectTestClient(mcp);
      const call = async (name: string, args: unknown) => {
        const res = (await client.callTool({
          name,
          arguments: args as Record<string, unknown>,
        })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
        if (res.isError) throw new Error(`tool ${name} failed: ${at(res.content, 0).text}`);
        return JSON.parse(at(res.content, 0).text);
      };

      // 1. Patch the seeded user with timezone (other profile fields are
      //    already set by seedUser). Pre-seeded user + minted PAT —
      //    auto-provision via X-Forwarded-Email is exercised in the API
      //    package's auth tests, not here.
      const patched = (await call("update_user_profile", {
        name: "Jeff",
        dob: "1990-01-01",
        height_cm: 180,
        sex: "male",
        timezone: "America/Toronto",
      })) as { user: { id: number; name: string; timezone: string } };
      expect(patched.user.id).toBe(1);
      expect(patched.user.timezone).toBe("America/Toronto");

      // 2. Calling bootstrap_user returns 409 — the seeded user already
      //    exists, so Gap 27 (refuse second-user creation) fires. The
      //    high-level McpServer tool wrapper catches the thrown ApiHttpError
      //    and surfaces it as an isError envelope (the API error text is
      //    preserved verbatim).
      const conflictResult = (await client.callTool({
        name: "bootstrap_user",
        arguments: { name: "Other" },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
      expect(conflictResult.isError).toBe(true);
      expect(at(conflictResult.content, 0).text).toMatch(/409|conflict/i);

      // 3. start_nutrition_phase with planned_end_on (Gap 25).
      // Use the user's tz to compute `today` so it matches what getTodayContext
      // sees server-side — UTC-slicing here would diverge by a day when UTC has
      // rolled over but the user's local date hasn't.
      const today = currentUserDate(new Date(), "America/Toronto");
      const planned = new Date(`${today}T00:00:00Z`);
      planned.setUTCDate(planned.getUTCDate() + 30);
      const plannedIso = planned.toISOString().slice(0, 10);
      await call("start_nutrition_phase", {
        name: "Cut",
        intent: "cut",
        // Post-TDEE-refactor shape: phase_type + tdee_override + deficit_kcal.
        phase_type: "cut",
        tdee_override: 2400,
        deficit_kcal: -500, // 5% of 2400 = 120 → -500 well beyond the band, valid cut.
        base_protein_g: 180,
        base_carb_g: 170,
        base_fat_g: 60,
        started_on: today,
        planned_end_on: plannedIso,
      });

      // Yesterday (a completed day) in the user's tz — used for both the cardio
      // and sleep logs below.
      const yesterday = new Date(`${today}T00:00:00Z`);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yIso = yesterday.toISOString().slice(0, 10);

      // 4. log_cardio with steps (Gap 17). Logged on a COMPLETED day
      // (yesterday) so it lands in the week-to-date window — getTodayContext's
      // week-to-date aggregates exclude the in-progress day (today). 5pm UTC is
      // unambiguously that user-day for America/Toronto (well clear of the 4am
      // rollover).
      await call("log_cardio", {
        started_at: `${yIso}T17:00:00Z`,
        modality: "walk",
        duration_min: 45,
        steps: 7500,
        est_kcal: 200,
      });

      // 5. log_sleep via night_of alias (Gap 18 + 30).
      const sleepResult = (await call("log_sleep", {
        night_of: yIso,
        hours: 7.5,
        quality: 4,
      })) as { summary: string };
      // Summary must echo BOTH dates.
      expect(sleepResult.summary).toContain("night of");
      expect(sleepResult.summary).toContain(yIso);

      // 6. Define a group + exercise + template for recommend_template.
      const group = (await call("define_exercise_group", {
        name: "Push",
        display_order: 0,
      })) as { exercise_group: { id: number } };
      const exercise = (await call("define_exercise", {
        group_id: group.exercise_group.id,
        name: "Bench",
      })) as { exercise: { id: number } };
      await call("define_workout_template", {
        name: "PUSH",
        items: [
          {
            exercise_id: exercise.exercise.id,
            default_sets: 3,
            default_reps: 10,
            display_order: 0,
          },
        ],
      });

      // 7. get_recommended_template returns the only template (Gap 24).
      const recs = (await call("get_recommended_template", { top_n: 1 })) as {
        recommendations: Array<{ template_id: number; template_name: string }>;
      };
      expect(recs.recommendations).toHaveLength(1);
      expect(recs.recommendations[0]?.template_name).toBe("PUSH");

      // 8. get_today_context surfaces the new fields (Gaps 19, 21, 23, 28).
      const ctx = (await call("get_today_context", {})) as {
        today: {
          most_recent_weight: { value_kg: number; on_date: string } | null;
        };
        phase: { days_in: number; days_remaining: number | null };
        week_to_date: {
          avg_kcal_in: { value: number; window_days: number; days_with_data: number };
          cardio_kcal: { value: number; window_days: number; days_with_data: number };
          alcohol_kcal: { value: number; window_days: number; days_with_data: number };
        };
      };
      expect(ctx.today.most_recent_weight).toBeNull(); // no weights logged
      expect(ctx.phase.days_in).toBe(0); // just started today
      expect(ctx.phase.days_remaining).toBe(30);
      // Aggregate wrappers shape (Gap 23).
      expect(ctx.week_to_date.avg_kcal_in).toHaveProperty("value");
      expect(ctx.week_to_date.avg_kcal_in).toHaveProperty("window_days", 7);
      expect(ctx.week_to_date.avg_kcal_in).toHaveProperty("days_with_data");
      // New cardio + alcohol fields exist (Gap 19).
      expect(ctx.week_to_date.cardio_kcal.value).toBe(200);
      expect(ctx.week_to_date.alcohol_kcal.value).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("multi-user: two MCP servers with different PATs resolve to different users; revoke isolates", async () => {
    // Regression guard for the post-static-gate-check world: the MCP layer no
    // longer compares incoming bearers to a single static value, so two MCP
    // servers wired with different PATs MUST resolve to their own users
    // independently. Also exercises the API-side revoke path — Alice's
    // revoked PAT must 401 while Bob's still works.
    const app = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });

    // Seed Alice (user_id=1, already exists in default seed shape).
    const { user_id: aliceId } = seedUserAndDefaultPhase(app.db, {
      name: "Alice",
      dob: "1990-01-01",
      height_cm: 170,
      sex: "female",
    });
    app.db.prepare("UPDATE users SET email = 'alice@example.com' WHERE id = ?").run(aliceId);

    // Seed Bob (will get user_id=2). seedUser doesn't auto-add a phase for
    // a second user — we add one manually so today-context works for both.
    app.db
      .prepare(
        "INSERT INTO users (name, dob, height_cm, sex, email) VALUES ('Bob', '1988-06-15', 180, 'male', 'bob@example.com')",
      )
      .run();
    const bobId = (
      app.db.prepare("SELECT id FROM users WHERE email = 'bob@example.com'").get() as { id: number }
    ).id;
    closeAndStartPhase(app.db, {
      user_id: bobId,
      name: "Bob's maintenance",
      intent: "maintenance",
      phase_type: "maintenance",
      tdee_at_phase_start: 2600,
      tdee_source: "user_asserted",
      deficit_kcal: 0,
      daily_kcal_target: 2600,
      base_protein_g: 160,
      base_carb_g: 290,
      base_fat_g: 85,
      started_on: new Date().toISOString().slice(0, 10),
    });

    // Mint a PAT for each.
    const { token: aliceToken, record: aliceTokenRecord } = mintToken(app.db, {
      user_id: aliceId,
      name: "alice-mcp",
    });
    const { token: bobToken } = mintToken(app.db, { user_id: bobId, name: "bob-mcp" });
    expect(aliceToken).not.toBe(bobToken); // sanity: PATs are unique

    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const api = new ApiClient({ baseUrl });

      // Build TWO MCP servers — each one closes over a different PAT,
      // simulating two concurrent MCP connections from two friends.
      const aliceMcp = buildMcpServer({ api }, () => aliceToken);
      const bobMcp = buildMcpServer({ api }, () => bobToken);
      const aliceClient = await connectTestClient(aliceMcp);
      const bobClient = await connectTestClient(bobMcp);

      // ----- 1. Each MCP resolves to its own user via whoami ---------------
      const aliceWhoami = (await aliceClient.callTool({
        name: "get_user_profile",
        arguments: {},
      })) as { content: Array<{ type: string; text: string }> };
      const aliceWhoamiBody = JSON.parse(at(aliceWhoami.content, 0).text) as {
        user: { id: number; name: string; email: string };
      };
      expect(aliceWhoamiBody.user.id).toBe(aliceId);
      expect(aliceWhoamiBody.user.name).toBe("Alice");
      expect(aliceWhoamiBody.user.email).toBe("alice@example.com");

      const bobWhoami = (await bobClient.callTool({
        name: "get_user_profile",
        arguments: {},
      })) as { content: Array<{ type: string; text: string }> };
      const bobWhoamiBody = JSON.parse(at(bobWhoami.content, 0).text) as {
        user: { id: number; name: string; email: string };
      };
      expect(bobWhoamiBody.user.id).toBe(bobId);
      expect(bobWhoamiBody.user.name).toBe("Bob");
      expect(bobWhoamiBody.user.email).toBe("bob@example.com");

      // ----- 2. Cross-tenant isolation on get_today_context ---------------
      // Each MCP's today-context resolves to its OWN user's phase.
      const aliceCtx = (await aliceClient.callTool({
        name: "get_today_context",
        arguments: {},
      })) as { content: Array<{ type: string; text: string }> };
      const aliceCtxBody = JSON.parse(at(aliceCtx.content, 0).text) as {
        user: { id: number };
        phase: { name: string } | null;
      };
      expect(aliceCtxBody.user.id).toBe(aliceId);
      expect(aliceCtxBody.phase?.name).toBe("Initial maintenance");

      const bobCtx = (await bobClient.callTool({
        name: "get_today_context",
        arguments: {},
      })) as { content: Array<{ type: string; text: string }> };
      const bobCtxBody = JSON.parse(at(bobCtx.content, 0).text) as {
        user: { id: number };
        phase: { name: string } | null;
      };
      expect(bobCtxBody.user.id).toBe(bobId);
      expect(bobCtxBody.phase?.name).toBe("Bob's maintenance");

      // ----- 3. Revoke Alice's PAT; her MCP starts failing, Bob's stays good
      // (Revoke goes directly via the repo; the SettingsPanel UI path would
      // do the same thing.)
      const { revokeToken } = await import("@almanac/core/repos");
      const revoked = revokeToken(app.db, aliceTokenRecord.id, aliceId);
      expect(revoked).toBe(true);

      // Alice's MCP call now fails at the API layer (401 → ApiHttpError).
      // The high-level McpServer tool wrapper catches the thrown error and
      // returns an isError envelope carrying the API error text — so the
      // call resolves with isError:true rather than rejecting.
      const aliceAfterRevoke = (await aliceClient.callTool({
        name: "get_user_profile",
        arguments: {},
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
      expect(aliceAfterRevoke.isError).toBe(true);
      expect(at(aliceAfterRevoke.content, 0).text).toMatch(/401|unauthorized|invalid/i);

      // Bob's MCP keeps working — his PAT is untouched.
      const bobAfterRevoke = (await bobClient.callTool({
        name: "get_user_profile",
        arguments: {},
      })) as { content: Array<{ type: string; text: string }> };
      const bobAfterBody = JSON.parse(at(bobAfterRevoke.content, 0).text) as {
        user: { id: number };
      };
      expect(bobAfterBody.user.id).toBe(bobId);
    } finally {
      await app.close();
    }
  });
});
