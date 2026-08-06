import { addDaysIso, currentUserDate } from "@almanac/core/types";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../server.js";

/**
 * Tests for /api/v1/nutrition-phases.
 *
 * Post-TDEE-refactor the POST body shape changes:
 *  - `phase_type` ('cut' | 'bulk' | 'maintenance') is now required.
 *  - Caller supplies EITHER `deficit_kcal` OR `daily_kcal_target` (the route
 *    derives the other from the resolved TDEE).
 *  - `tdee_override` (with `tdee_source: 'user_asserted'`) is the only way to
 *    bypass computeTDEE — and is REQUIRED for a user who hasn't logged any
 *    body weight yet (the 422 `tdee_unavailable` branch). See the spec for
 *    the structured error envelope.
 *  - The phase-type/deficit sign-and-magnitude invariant returns 400 on
 *    violation (e.g. cut with deficit_kcal=+200).
 */
describe("/api/v1/nutrition-phases", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  function setup() {
    const a = buildApp({ dbPath: ":memory:", trustProxyHeaders: true });
    a.db
      .prepare(
        "INSERT INTO users (name, dob, height_cm, sex, email) VALUES ('Jeff', '1990-01-01', 180, 'male', 'test@example.com')",
      )
      .run();
    return a;
  }
  const auth = { "x-forwarded-email": "test@example.com", "content-type": "application/json" };

  // Canonical valid cut body — tdee_override avoids the 422 tdee_unavailable
  // branch, deficit_kcal is a healthy -500 against a 2400 TDEE (>5% band).
  const validCutBody = {
    name: "Cut",
    intent: "cut" as const,
    phase_type: "cut" as const,
    tdee_override: 2400,
    deficit_kcal: -500,
    base_protein_g: 180,
    base_carb_g: 170,
    base_fat_g: 60,
    started_on: "2026-05-01",
  };

  it("POST opens a first phase (no active to close) with tdee_override", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: validCutBody,
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.name).toBe("Cut");
    expect(body.ended_on).toBeNull();
    // New TDEE refactor fields are persisted.
    expect(body.phase_type).toBe("cut");
    expect(body.tdee_at_phase_start).toBe(2400);
    expect(body.tdee_source).toBe("user_asserted");
    expect(body.deficit_kcal).toBe(-500);
    // Derived target = tdee_override + deficit_kcal = 2400 + (-500) = 1900
    expect(body.daily_kcal_target).toBe(1900);
  });

  it("POST derives deficit_kcal from daily_kcal_target when only target is provided", async () => {
    app = setup();
    const { deficit_kcal: _omit, ...rest } = validCutBody;
    void _omit;
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: { ...rest, daily_kcal_target: 1900 },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    // 1900 − 2400 = -500
    expect(body.deficit_kcal).toBe(-500);
    expect(body.daily_kcal_target).toBe(1900);
  });

  it("POST a second phase closes the existing one (close-and-start)", async () => {
    app = setup();
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: { ...validCutBody, started_on: "2026-04-01" },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: {
        name: "Maintenance",
        intent: "maintenance",
        phase_type: "maintenance",
        tdee_override: 2400,
        deficit_kcal: 0,
        base_protein_g: 180,
        base_carb_g: 250,
        base_fat_g: 80,
        started_on: "2026-05-01",
      },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().id).not.toBe(first.json().id);
    // Old phase now has ended_on = day before 2026-05-01 = 2026-04-30
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/nutrition-phases",
      headers: auth,
    });
    const phases = list.json();
    expect(phases.length).toBe(2);
    const oldPhase = phases.find((p: { id: number }) => p.id === first.json().id);
    expect(oldPhase.ended_on).toBe("2026-04-30");
  });

  it("GET /active returns the currently-active phase", async () => {
    app = setup();
    await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: validCutBody,
    });
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/nutrition-phases/active",
      headers: auth,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().name).toBe("Cut");
    expect(r.json().ended_on).toBeNull();
  });

  it("GET /active 404 when no phases exist", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/nutrition-phases/active",
      headers: auth,
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("not_found");
  });

  it("GET /:id 404 when missing", async () => {
    app = setup();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/nutrition-phases/999",
      headers: auth,
    });
    expect(r.statusCode).toBe(404);
  });

  it("PATCH /:id updates fields", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: validCutBody,
    });
    const id = c.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/nutrition-phases/${id}`,
      headers: auth,
      payload: { daily_kcal_target: 1850 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().daily_kcal_target).toBe(1850);
  });

  it("DELETE /:id removes the row", async () => {
    app = setup();
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: validCutBody,
    });
    const id = c.json().id;
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/nutrition-phases/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({
      method: "GET",
      url: `/api/v1/nutrition-phases/${id}`,
      headers: auth,
    });
    expect(get.statusCode).toBe(404);
  });

  it("422 on bad input (missing started_on)", async () => {
    app = setup();
    const { started_on: _o, ...partial } = validCutBody;
    void _o;
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: partial,
    });
    expect(r.statusCode).toBe(422);
  });

  it("422 when neither deficit_kcal nor daily_kcal_target is provided", async () => {
    app = setup();
    const { deficit_kcal: _o, ...partial } = validCutBody;
    void _o;
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: partial,
    });
    expect(r.statusCode).toBe(422);
  });

  // ---- TDEE resolution branches ------------------------------------------

  it("422 tdee_unavailable when no override and no body weight ever logged", async () => {
    app = setup();
    const { tdee_override: _t, ...partial } = validCutBody;
    void _t;
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: partial,
    });
    expect(r.statusCode).toBe(422);
    const body = r.json();
    // Structured envelope per spec — NOT the platform-standard {error:{code,...}}.
    expect(body.error).toBe("tdee_unavailable");
    expect(body.reason).toBe("weight_required");
    expect(body.required_action).toBe("log_weight");
    expect(body.hints.missing_profile_fields).toEqual(["weight_kg"]);
    expect(typeof body.hints.suggestion).toBe("string");
    // The suggestion must point at log_weight, not route around the block via
    // tdee_override (which would persist tdee_source: "user_asserted" for a
    // number the server computed itself).
    expect(body.hints.suggestion).not.toContain("tdee_override");
    expect(body.hints.suggestion).toContain("log_weight");
  });

  it("succeeds with computed TDEE (no override) once body weight is logged", async () => {
    app = setup();
    // Seeding a body weight makes computeTDEE produce a profile_baseline
    // estimate (Mifflin × activity multiplier). The handler accepts it and
    // snapshots with the returned source (`formula` for profile_baseline).
    //
    // The route only considers weigh-ins in [asOf-60, asOf] where asOf =
    // today-1 (see resolveTdeeFromDb). Seed RELATIVE to today (30 days back,
    // safely mid-window) rather than a hard-coded date — a fixed past date
    // silently ages out of the window as the wall clock advances and the
    // route then 422s `tdee_unavailable`. tz defaults to UTC for this user.
    const asOf = addDaysIso(currentUserDate(new Date(), "UTC"), -1);
    const weighInOn = addDaysIso(asOf, -30);
    app.db
      .prepare("INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, 82.0)")
      .run(weighInOn);
    // Provide daily_kcal_target only — the route derives deficit_kcal from
    // the computed TDEE. Use a target safely below maintenance for the cut.
    const { tdee_override: _t, deficit_kcal: _d, ...partial } = validCutBody;
    void _t;
    void _d;
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: { ...partial, daily_kcal_target: 1700 },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.tdee_source).toBe("formula");
    expect(body.tdee_at_phase_start).toBeGreaterThan(0);
    expect(body.daily_kcal_target).toBe(1700);
    // deficit_kcal = 1700 − tdee_at_phase_start (signed)
    expect(body.deficit_kcal).toBe(1700 - body.tdee_at_phase_start);
  });

  it("accepts a weigh-in dated TODAY as satisfying the weight gate", async () => {
    // Regression (the onboarding dead-end): the weight gate used to read the
    // back-calc window [asOf-60, asOf] with asOf = today-1, so a weigh-in dated
    // TODAY fell outside it and could not lift the gate. Both real callers stamp
    // today — the web modal posts measured_on = started_on (defaults to today),
    // and an MCP agent asked for "your current weight" passes today. The user
    // logged a weight, hit 422 `weight_required`, logged again, and looped
    // forever. The existence check is now scoped to "any weigh-in on or before
    // today", while the back-calc still stops at yesterday.
    app = setup();
    const today = currentUserDate(new Date(), "UTC");
    app.db
      .prepare("INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, 82.0)")
      .run(today);
    const { tdee_override: _t, deficit_kcal: _d, ...partial } = validCutBody;
    void _t;
    void _d;
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: { ...partial, daily_kcal_target: 1700 },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    // Server-computed, NOT user_asserted — the whole point of dropping the
    // tdee_override workaround the old envelope used to recommend.
    expect(body.tdee_source).toBe("formula");
    expect(body.tdee_at_phase_start).toBeGreaterThan(0);
  });

  it("anchors Mifflin to a today-only weigh-in instead of the default body", async () => {
    // With the ONLY weigh-in dated today, the back-calc window (which stops at
    // yesterday) is empty. The Mifflin anchor must still come from that weigh-in
    // rather than computeTDEE's fabricated 80kg fallback — otherwise the gate
    // would pass but snapshot a TDEE for a body the user doesn't have.
    const today = currentUserDate(new Date(), "UTC");
    const tdeeFor = async (weightKg: number): Promise<number> => {
      if (app) await app.close();
      app = setup();
      app.db
        .prepare("INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, ?)")
        .run(today, weightKg);
      const { tdee_override: _t, deficit_kcal: _d, ...partial } = validCutBody;
      void _t;
      void _d;
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/nutrition-phases",
        headers: auth,
        payload: { ...partial, daily_kcal_target: 1500 },
      });
      expect(r.statusCode).toBe(201);
      return r.json().tdee_at_phase_start as number;
    };
    // A 60kg and a 110kg user must not snapshot the same TDEE. If the anchor
    // fell back to the 80kg default these would be identical.
    expect(await tdeeFor(60)).not.toBe(await tdeeFor(110));
  });

  it("reports no missing profile fields once a weigh-in exists (envelope self-consistency)", async () => {
    // The refusal branch and getMissingProfileFields must agree. Previously the
    // hint list was existence-scoped while the refusal was window-scoped, so a
    // today-only weigh-in produced the self-contradicting envelope
    // `reason: "weight_required"` + `missing_profile_fields: []`. With the two
    // predicates unified, a user who reaches the refusal ALWAYS has weight_kg
    // listed, and a user with a weigh-in never reaches the refusal at all.
    app = setup();
    const today = currentUserDate(new Date(), "UTC");
    app.db
      .prepare("INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, 82.0)")
      .run(today);
    const { tdee_override: _t, deficit_kcal: _d, ...partial } = validCutBody;
    void _t;
    void _d;
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: { ...partial, daily_kcal_target: 1700 },
    });
    expect(r.statusCode).not.toBe(422);
  });

  // ---- Phase invariant violations ----------------------------------------

  it("400 when cut has positive deficit_kcal (wrong sign)", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: { ...validCutBody, deficit_kcal: 200 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("validation_failed");
    expect(r.json().error.message).toMatch(/cut requires deficit_kcal/);
  });

  it("400 when cut deficit is too shallow (within 5% band)", async () => {
    app = setup();
    // 5% of 2400 = 120. -50 is well inside the band → reject for cut.
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: { ...validCutBody, deficit_kcal: -50 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toMatch(/cut requires deficit_kcal/);
  });

  it("400 when bulk has negative deficit_kcal", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: {
        ...validCutBody,
        intent: "bulk",
        phase_type: "bulk",
        deficit_kcal: -300,
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toMatch(/bulk requires deficit_kcal/);
  });

  it("400 when maintenance has |deficit| above 5% of TDEE", async () => {
    app = setup();
    // 5% of 2400 = 120. -200 exceeds the band → reject for maintenance.
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: {
        ...validCutBody,
        intent: "maintenance",
        phase_type: "maintenance",
        deficit_kcal: -200,
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toMatch(/maintenance requires/);
  });

  it("maintenance phase succeeds with deficit_kcal = 0", async () => {
    app = setup();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: {
        ...validCutBody,
        intent: "maintenance",
        phase_type: "maintenance",
        deficit_kcal: 0,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.phase_type).toBe("maintenance");
    expect(body.deficit_kcal).toBe(0);
    expect(body.daily_kcal_target).toBe(2400);
  });

  it("400 when both deficit_kcal and daily_kcal_target are inconsistent", async () => {
    app = setup();
    // tdee_override: 2400, deficit_kcal: -500 should yield 1900. Providing 1700 is inconsistent.
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: {
        name: "Cut",
        intent: "cut",
        phase_type: "cut",
        tdee_override: 2400,
        deficit_kcal: -500,
        daily_kcal_target: 1700,
        base_protein_g: 180,
        base_carb_g: 170,
        base_fat_g: 60,
        started_on: "2026-05-01",
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("validation_failed");
    expect(r.json().error.message).toMatch(/Inconsistent inputs/);
    expect(r.json().error.message).toMatch(/2400.*-500.*1900.*1700/);
  });

  it("401 without bearer token", async () => {
    app = setup();
    const r = await app.inject({ method: "GET", url: "/api/v1/nutrition-phases" });
    expect(r.statusCode).toBe(401);
  });

  describe("GET /api/v1/phase-estimate", () => {
    it("returns has_weight=false + a profile_baseline estimate when no weight is logged", async () => {
      app = setup();
      const r = await app.inject({
        method: "GET",
        url: "/api/v1/phase-estimate?activity=moderate",
        headers: auth,
      });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.has_weight).toBe(false);
      expect(body.basis).toBe("profile_baseline");
      expect(typeof body.tdee).toBe("number");
      // No target/phase_type given -> no macro suggestion.
      expect(body.suggested_macros).toBeNull();
    });

    it("returns a macro suggestion when target_kcal + phase_type are supplied", async () => {
      app = setup();
      // Log one body weight so has_weight flips true (still profile_baseline -
      // measured_intake needs ~14 weigh-ins, not needed for this assertion).
      // Seed RELATIVE to today: phase-estimate only counts weigh-ins in
      // [asOf-60, asOf] (asOf = today-1), so a hard-coded past date silently
      // ages out of the window and has_weight flips back to false. Same
      // clock-drift class as the sibling "succeeds with computed TDEE" test.
      const asOf = addDaysIso(currentUserDate(new Date(), "UTC"), -1);
      const weighInOn = addDaysIso(asOf, -30);
      app.db
        .prepare("INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, 80.0)")
        .run(weighInOn);
      const r = await app.inject({
        method: "GET",
        url: "/api/v1/phase-estimate?target_kcal=1900&phase_type=cut",
        headers: auth,
      });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.has_weight).toBe(true);
      expect(body.suggested_macros).not.toBeNull();
      // 80kg * 2.4 g/kg = 192g protein on a cut.
      expect(body.suggested_macros.protein_g).toBe(192);
    });

    it("returns null macros when no weight is logged, even with target+phase_type", async () => {
      // Protein anchors to bodyweight, so a suggestion would be fabricated
      // from a default body. The endpoint must not pretend to know macros
      // before a real weigh-in exists.
      app = setup();
      const r = await app.inject({
        method: "GET",
        url: "/api/v1/phase-estimate?target_kcal=1900&phase_type=cut",
        headers: auth,
      });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.has_weight).toBe(false);
      expect(body.suggested_macros).toBeNull();
    });

    it("uses a previewed weight_kg to compute macros before a weigh-in is logged", async () => {
      // The cold-start create form passes the typed (not-yet-logged) weight so
      // the user sees a macro suggestion immediately.
      app = setup();
      const r = await app.inject({
        method: "GET",
        url: "/api/v1/phase-estimate?target_kcal=1900&phase_type=cut&weight_kg=80",
        headers: auth,
      });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.has_weight).toBe(true);
      expect(body.suggested_macros).not.toBeNull();
      // 80 kg * 2.4 g/kg (cut) = 192 g protein.
      expect(body.suggested_macros.protein_g).toBe(192);
    });

    // ---- preview vs. server agreement (the invariant-check divergence) ------
    //
    // The web enables Save against /v1/phase-estimate, but the invariant check
    // runs against resolveTdeeFromDb. If those two disagree, a maintenance phase
    // sitting just inside the +/-5% band against the preview lands OUTSIDE it
    // against the server, producing a 400 on a form that showed a valid state.
    // The pair below pins exactly when they agree and when they don't.

    it("agrees with the phase-created TDEE once the profile is saved and a weigh-in exists", async () => {
      // This is the web modal's real ordering: PATCH the profile, POST the
      // weigh-in, THEN POST the phase. By phase time every value the preview
      // used is persisted, so both sides read identical inputs and a
      // maintenance phase targeting exactly the previewed TDEE succeeds.
      app = setup();
      const today = currentUserDate(new Date(), "UTC");
      app.db
        .prepare("INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, 80.0)")
        .run(today);
      app.db.prepare("UPDATE users SET activity_level = 'moderate' WHERE id = 1").run();

      const est = await app.inject({
        method: "GET",
        url: "/api/v1/phase-estimate?activity=moderate&phase_type=maintenance",
        headers: auth,
      });
      const previewTdee = est.json().tdee as number;

      const r = await app.inject({
        method: "POST",
        url: "/api/v1/nutrition-phases",
        headers: auth,
        payload: {
          name: "Maintain",
          intent: "maintenance",
          phase_type: "maintenance",
          daily_kcal_target: previewTdee,
          base_protein_g: 160,
          base_carb_g: 180,
          base_fat_g: 55,
          started_on: today,
        },
      });
      expect(r.statusCode).toBe(201);
      // Exact agreement — not merely "within the band". deficit_kcal = 0 proves
      // the server resolved the very number the preview displayed.
      expect(r.json().tdee_at_phase_start).toBe(previewTdee);
      expect(r.json().deficit_kcal).toBe(0);
    });

    it("diverges from the preview when previewed profile fields were never saved", async () => {
      // The reachable failure mode: /v1/phase-estimate honors typed height/sex/
      // dob/activity, but resolveTdeeFromDb reads ONLY the stored profile. If a
      // caller previews profile values and then creates a phase WITHOUT
      // persisting them, the two numbers differ and the invariant check can
      // reject a target the preview endorsed.
      //
      // The web modal does not hit this — buildProfilePatch persists exactly the
      // fields estimateUrl previews, and it PATCHes before the phase POST (see
      // the sibling test above). This documents the contract that ordering
      // depends on: any future caller that previews a profile field MUST save it
      // before creating the phase.
      app = setup();
      const today = currentUserDate(new Date(), "UTC");
      app.db
        .prepare("INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, 80.0)")
        .run(today);
      // activity_level stays NULL server-side, so resolveTdeeFromDb falls back
      // to seedActivityMultiplier (1.4) while the preview honors the typed
      // "very_active" (1.9). That ~36% multiplier gap dwarfs the 5% band — it is
      // the largest single driver of preview/server divergence, which is exactly
      // why the modal PATCHes activity_level before creating the phase.
      const est = await app.inject({
        method: "GET",
        url: "/api/v1/phase-estimate?activity=very_active&phase_type=maintenance",
        headers: auth,
      });
      const previewTdee = est.json().tdee as number;

      const r = await app.inject({
        method: "POST",
        url: "/api/v1/nutrition-phases",
        headers: auth,
        payload: {
          name: "Maintain",
          intent: "maintenance",
          phase_type: "maintenance",
          daily_kcal_target: previewTdee,
          base_protein_g: 160,
          base_carb_g: 180,
          base_fat_g: 55,
          started_on: today,
        },
      });
      // Previewed 1.9 vs stored-null 1.4 puts the target outside the band.
      expect(r.statusCode).toBe(400);
      expect(r.json().error.message).toMatch(/maintenance requires/);
      // Pin the direction: the preview was the HIGHER number, so a user who
      // accepted it would be told their own maintenance target is invalid.
      expect(previewTdee).toBeGreaterThan(2448);
    });

    it("previews height/sex/dob into the TDEE estimate without persisting them", async () => {
      // Mifflin TDEE depends on height, sex, and age — previewing them must move
      // the estimate (and must NOT write to the profile).
      app = setup();
      const base = await app.inject({
        method: "GET",
        url: "/api/v1/phase-estimate?weight_kg=80&height_cm=150&sex=female&dob=1990-01-01",
        headers: auth,
      });
      const taller = await app.inject({
        method: "GET",
        url: "/api/v1/phase-estimate?weight_kg=80&height_cm=190&sex=male&dob=1990-01-01",
        headers: auth,
      });
      // Taller + male → higher BMR → higher TDEE than shorter + female.
      expect(taller.json().tdee).toBeGreaterThan(base.json().tdee);
      // Preview did not persist: the stored profile is unchanged.
      const me = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: auth });
      expect(me.json().height_cm).toBe(180); // the setup() value, not 150/190
      expect(me.json().sex).toBe("male");
    });

    it("previews a different activity level without persisting it", async () => {
      app = setup();
      app.db
        .prepare(
          "INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, '2026-05-01', 80.0)",
        )
        .run();
      const sed = await app.inject({
        method: "GET",
        url: "/api/v1/phase-estimate?activity=sedentary",
        headers: auth,
      });
      const act = await app.inject({
        method: "GET",
        url: "/api/v1/phase-estimate?activity=very_active",
        headers: auth,
      });
      // Different multipliers -> different TDEE; sedentary < very_active.
      expect(sed.json().tdee).toBeLessThan(act.json().tdee);
      // Neither call persisted activity_level: a plain GET still computes from null (default multiplier).
      const me = await app.inject({ method: "GET", url: "/api/v1/users/me", headers: auth });
      expect(me.json().activity_level).toBeNull();
    });

    it("excludes the in-progress day: a meal logged TODAY does not move the estimate", async () => {
      // Regression: the estimate's back-calc window must END on the last
      // COMPLETED day (asOf = today − 1), so today's partial intake can't
      // distort the snapshotted TDEE. Seed enough history to reach the
      // measured_intake basis (where intake actually feeds the back-calc),
      // capture the estimate, then add a meal dated TODAY and assert the
      // estimate is byte-identical.
      app = setup();
      const isoDaysAgo = (n: number): string => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - n);
        return d.toISOString().slice(0, 10);
      };

      // ≥14 daily weigh-ins ending YESTERDAY (a slow taper → a measurable
      // weight slope) + a meal on each of those days (≥7 meal-days for the
      // back-calc guard). Day 0 (today) is deliberately left empty here.
      for (let n = 15; n >= 1; n--) {
        const day = isoDaysAgo(n);
        app.db
          .prepare("INSERT INTO body_weights (user_id, measured_on, weight_kg) VALUES (1, ?, ?)")
          .run(day, 80 - n * 0.05);
        app.db
          .prepare(
            "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, ?, 2200, 180, 200, 70)",
          )
          .run(`${day}T12:00:00Z`);
      }

      const before = await app.inject({
        method: "GET",
        url: "/api/v1/phase-estimate?activity=moderate",
        headers: auth,
      });
      expect(before.statusCode).toBe(200);
      const beforeBody = before.json();
      // Confirm we actually reached the intake-driven path — otherwise the
      // assertion below would be vacuous (Mifflin baseline ignores intake).
      expect(beforeBody.basis).toBe("measured_intake");

      // A meal logged TODAY (the in-progress day, = asOf + 1) — a big one, so
      // any leak into the window would visibly move the back-calc.
      app.db
        .prepare(
          "INSERT INTO meals (user_id, eaten_at, kcal, protein_g, carb_g, fat_g) VALUES (1, ?, 5000, 300, 400, 150)",
        )
        .run(`${isoDaysAgo(0)}T12:00:00Z`);

      const after = await app.inject({
        method: "GET",
        url: "/api/v1/phase-estimate?activity=moderate",
        headers: auth,
      });
      expect(after.statusCode).toBe(200);
      const afterBody = after.json();
      // Today's intake is outside the [asOf−window+1, asOf] window → unchanged.
      expect(afterBody.tdee).toBe(beforeBody.tdee);
      expect(afterBody.basis).toBe(beforeBody.basis);
    });
  });

  it("mints exactly one phase_complete row when a qualifying cut is ended via PATCH", async () => {
    app = setup();

    const isoDaysAgo = (n: number): string => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const startedOn = isoDaysAgo(40);
    const endedOn = isoDaysAgo(5); // within the 60-day scan window
    const midOn = isoDaysAgo(20);

    // 1. Start a cut phase.
    const startRes = await app.inject({
      method: "POST",
      url: "/api/v1/nutrition-phases",
      headers: auth,
      payload: { ...validCutBody, started_on: startedOn },
    });
    expect(startRes.statusCode).toBe(201);
    const phaseId = startRes.json().id as number;

    // 2. Log a downward weight trend across the phase window (>= 2 readings).
    for (const [on, kg] of [
      [startedOn, 84],
      [midOn, 82],
      [endedOn, 80],
    ] as const) {
      const w = await app.inject({
        method: "POST",
        url: "/api/v1/body-weights",
        headers: auth,
        payload: { measured_on: on, weight_kg: kg },
      });
      expect(w.statusCode).toBe(201);
    }

    // 3. End the phase via PATCH ended_on (what end_phase calls under the hood).
    const endRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/nutrition-phases/${phaseId}`,
      headers: auth,
      payload: { ended_on: endedOn },
    });
    expect(endRes.statusCode).toBe(200);

    // 4. Exactly one phase_complete row exists for this user.
    const userId = (
      app.db.prepare("SELECT id FROM users WHERE email = 'test@example.com'").get() as {
        id: number;
      }
    ).id;
    const rows = app.db
      .prepare("SELECT * FROM accomplishments WHERE user_id = ? AND code = 'phase_complete'")
      .all(userId);
    expect(rows.length).toBe(1);
  });
});
