import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import PhaseFormModal from "./PhaseFormModal.vue";

type EstimateOverrides = Partial<{
  tdee: number;
  basis: "profile_baseline" | "measured_intake";
  source: string;
  has_weight: boolean;
  suggested_macros: { protein_g: number; carb_g: number; fat_g: number } | null;
}>;

type UserOverrides = Partial<{
  id: number;
  name: string;
  dob: string | null;
  height_cm: number | null;
  sex: "male" | "female" | null;
  email: string | null;
  preferred_unit_system: "metric" | "imperial";
  timezone: string;
  activity_level: string | null;
  created_at: string;
}>;

function userPayload(overrides: UserOverrides = {}) {
  return {
    id: 1,
    name: "Jeff",
    dob: null,
    height_cm: null,
    sex: null,
    email: "jeff@example.com",
    preferred_unit_system: "metric",
    timezone: "America/Toronto",
    activity_level: null,
    created_at: "2026-01-01T12:00:00Z",
    ...overrides,
  };
}

function stubClient(estimate: EstimateOverrides = {}, user: UserOverrides = {}) {
  const estimateResult = {
    tdee: 2450,
    basis: "profile_baseline",
    source: "formula",
    has_weight: false,
    suggested_macros: null,
    ...estimate,
  };
  const userResult = userPayload(user);
  // The stub's `get` serves BOTH /v1/phase-estimate AND /v1/users/me — branch
  // on the URL path so the modal's parallel mount-fetch gets the right payload.
  const get = vi
    .fn()
    .mockImplementation((url: string) =>
      url.includes("/users/me") ? Promise.resolve(userResult) : Promise.resolve(estimateResult),
    );
  const post = vi.fn().mockResolvedValue({});
  const patch = vi.fn().mockResolvedValue({});
  return { get, post, patch } as unknown as never;
}

function makePhase(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    user_id: 1,
    name: "Spring cut",
    intent: "cut" as const,
    phase_type: "cut" as "cut" | "bulk" | "maintenance" | null,
    tdee_at_phase_start: 2400,
    tdee_source: "measured" as "formula" | "measured" | "user_asserted" | null,
    deficit_kcal: -500,
    daily_kcal_target: 1900,
    base_protein_g: 160,
    base_carb_g: 180,
    base_fat_g: 55,
    started_on: "2026-05-01",
    planned_end_on: null as string | null,
    ended_on: null as string | null,
    notes: null as string | null,
    created_at: "2026-05-01T12:00:00Z",
    ...overrides,
  };
}

describe("PhaseFormModal cold-start fields (create)", () => {
  it("shows current-weight AND activity-level when no weight and profile_baseline basis", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient(),
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "profile_baseline" as const,
      },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="phase-form-modal"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="current-weight"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="activity-level"]').exists()).toBe(true);
  });

  it("hides current-weight and activity-level when has weight and measured_intake basis", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient({ has_weight: true, basis: "measured_intake" }),
        mode: "create" as const,
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="current-weight"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="activity-level"]').exists()).toBe(false);
  });

  it("hides the activity selector in EDIT mode even on profile_baseline basis", async () => {
    // Activity only drives the cold-start estimate (create fetches it); in edit
    // mode the user overrides the snapshotted tdee directly, so the selector
    // would be misleading.
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient(),
        mode: "edit" as const,
        phase: makePhase(),
        hasWeight: true,
        tdeeBasis: "profile_baseline" as const,
        loggedDays: 0,
      },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="activity-level"]').exists()).toBe(false);
  });

  it("pre-fills the tdee input from the estimate fetch", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient({ tdee: 2450 }),
        mode: "create" as const,
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    expect((wrapper.find('[data-test="tdee"]').element as HTMLInputElement).value).toBe("2450");
  });

  it("updates the displayed TDEE when the activity level changes", async () => {
    // The estimate endpoint returns a different TDEE per activity; selecting a
    // new activity must move the (estimate-sourced, un-edited) TDEE field.
    const byActivity: Record<string, number> = {
      sedentary: 2100,
      moderate: 2700,
      very_active: 3300,
    };
    const get = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/users/me")) return Promise.resolve(userPayload());
      const activity = new URL(`http://x${url}`).searchParams.get("activity") ?? "moderate";
      return Promise.resolve({
        tdee: byActivity[activity] ?? 2700,
        basis: "profile_baseline",
        source: "formula",
        has_weight: false,
        suggested_macros: null,
      });
    });
    const client = { get, post: vi.fn(), patch: vi.fn() } as unknown as never;
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "profile_baseline" as const,
      },
    });
    await flushPromises();
    expect((wrapper.find('[data-test="tdee"]').element as HTMLInputElement).value).toBe("2700");
    await wrapper.find('[data-test="activity-level"]').setValue("very_active");
    await flushPromises();
    expect((wrapper.find('[data-test="tdee"]').element as HTMLInputElement).value).toBe("3300");
  });

  it("does NOT overwrite a user-typed TDEE when activity changes", async () => {
    const get = vi.fn().mockImplementation((url: string) =>
      url.includes("/users/me")
        ? Promise.resolve(userPayload())
        : Promise.resolve({
            tdee: 2700,
            basis: "profile_baseline",
            source: "formula",
            has_weight: false,
            suggested_macros: null,
          }),
    );
    const client = { get, post: vi.fn(), patch: vi.fn() } as unknown as never;
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "profile_baseline" as const,
      },
    });
    await flushPromises();
    // User overrides the TDEE, THEN changes activity — their value must survive.
    await wrapper.find('[data-test="tdee"]').setValue("2500");
    await wrapper.find('[data-test="activity-level"]').setValue("sedentary");
    await flushPromises();
    expect((wrapper.find('[data-test="tdee"]').element as HTMLInputElement).value).toBe("2500");
  });

  it("refreshes suggested macros when the target changes (weight present)", async () => {
    // With a weight, the estimate returns macros scaled to the target; typing a
    // new target should refresh the un-edited macro fields.
    const get = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/users/me")) {
        return Promise.resolve(userPayload({ height_cm: 180, sex: "male", dob: "1990-01-01" }));
      }
      const target = Number(new URL(`http://x${url}`).searchParams.get("target_kcal") ?? "0");
      // Protein scales trivially with target so the test can assert a change.
      return Promise.resolve({
        tdee: 2700,
        basis: "measured_intake",
        source: "measured",
        has_weight: true,
        suggested_macros: { protein_g: Math.round(target / 10), carb_g: 200, fat_g: 60 },
      });
    });
    const client = { get, post: vi.fn(), patch: vi.fn() } as unknown as never;
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="target-kcal"]').setValue("1900");
    await flushPromises();
    expect((wrapper.find('[data-test="protein"]').element as HTMLInputElement).value).toBe("190");
    await wrapper.find('[data-test="target-kcal"]').setValue("2400");
    await flushPromises();
    expect((wrapper.find('[data-test="protein"]').element as HTMLInputElement).value).toBe("240");
  });

  it("populates macros in cold start once a weight is typed (weight_kg preview)", async () => {
    // No DB weigh-in (cold start). The estimate returns macros only when the
    // form previews a weight via weight_kg — typing the weight should trigger it.
    const get = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/users/me")) return Promise.resolve(userPayload());
      const hasWeightParam = url.includes("weight_kg=");
      return Promise.resolve({
        tdee: 2700,
        basis: "profile_baseline",
        source: "formula",
        has_weight: hasWeightParam,
        suggested_macros: hasWeightParam ? { protein_g: 144, carb_g: 212, fat_g: 53 } : null,
      });
    });
    const client = { get, post: vi.fn(), patch: vi.fn() } as unknown as never;
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "profile_baseline" as const,
      },
    });
    await flushPromises();
    // Before weight: no macros.
    expect((wrapper.find('[data-test="protein"]').element as HTMLInputElement).value).toBe("");
    await wrapper.find('[data-test="target-kcal"]').setValue("1900");
    await wrapper.find('[data-test="current-weight"]').setValue("80");
    await flushPromises();
    // After weight: macros populate from the weight-anchored suggestion.
    expect((wrapper.find('[data-test="protein"]').element as HTMLInputElement).value).toBe("144");
  });

  it("re-fetches the estimate (updating TDEE) when a typed height changes", async () => {
    // Height is a Mifflin input, so entering it must move the live estimate.
    // The stub returns a TDEE keyed off the height_cm query param.
    const get = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/users/me")) return Promise.resolve(userPayload()); // height null → field shown
      const h = Number(new URL(`http://x${url}`).searchParams.get("height_cm") ?? "0");
      // Fabricate a TDEE that rises with height so the test can assert a change.
      return Promise.resolve({
        tdee: 2000 + h,
        basis: "profile_baseline",
        source: "formula",
        has_weight: false,
        suggested_macros: null,
      });
    });
    const client = { get, post: vi.fn(), patch: vi.fn() } as unknown as never;
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "profile_baseline" as const,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="profile-height-cm"]').setValue("170");
    await flushPromises();
    expect((wrapper.find('[data-test="tdee"]').element as HTMLInputElement).value).toBe("2170");
    await wrapper.find('[data-test="profile-height-cm"]').setValue("190");
    await flushPromises();
    expect((wrapper.find('[data-test="tdee"]').element as HTMLInputElement).value).toBe("2190");
  });

  it("does NOT overwrite user-edited macros when the target changes", async () => {
    const get = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/users/me")) {
        return Promise.resolve(userPayload({ height_cm: 180, sex: "male", dob: "1990-01-01" }));
      }
      return Promise.resolve({
        tdee: 2700,
        basis: "measured_intake",
        source: "measured",
        has_weight: true,
        suggested_macros: { protein_g: 160, carb_g: 200, fat_g: 60 },
      });
    });
    const client = { get, post: vi.fn(), patch: vi.fn() } as unknown as never;
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="protein"]').setValue("175"); // user edit
    await wrapper.find('[data-test="target-kcal"]').setValue("2400");
    await flushPromises();
    expect((wrapper.find('[data-test="protein"]').element as HTMLInputElement).value).toBe("175");
  });
});

describe("PhaseFormModal new-phase hint (edit)", () => {
  it("shows new-phase-hint after editing target-kcal when loggedDays >= 3", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient(),
        mode: "edit" as const,
        phase: makePhase(),
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
        loggedDays: 5,
      },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="new-phase-hint"]').exists()).toBe(false);
    await wrapper.find('[data-test="target-kcal"]').setValue("1850");
    expect(wrapper.find('[data-test="new-phase-hint"]').exists()).toBe(true);
  });

  it("shows new-phase-hint after switching phase type when loggedDays >= 3", async () => {
    // A cut->bulk/maintain switch re-scores logged days against a different
    // band, so it must trip the same "changing course" hint as a target edit.
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient(),
        mode: "edit" as const,
        phase: makePhase(), // defaults to phase_type "cut"
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
        loggedDays: 5,
      },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="new-phase-hint"]').exists()).toBe(false);
    await wrapper.find('[data-test="phase-type"]').setValue("bulk");
    expect(wrapper.find('[data-test="new-phase-hint"]').exists()).toBe(true);
  });

  it("does NOT show new-phase-hint when loggedDays < 3", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient(),
        mode: "edit" as const,
        phase: makePhase(),
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
        loggedDays: 1,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="target-kcal"]').setValue("1850");
    expect(wrapper.find('[data-test="new-phase-hint"]').exists()).toBe(false);
  });

  it("emits request-create-from-current when the hint link is clicked", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient(),
        mode: "edit" as const,
        phase: makePhase(),
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
        loggedDays: 5,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="target-kcal"]').setValue("1850");
    await wrapper.find('[data-test="new-phase-hint"] button').trigger("click");
    expect(wrapper.emitted("request-create-from-current")).toHaveLength(1);
  });

  it("pre-fills all fields from props.phase in edit mode", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient(),
        mode: "edit" as const,
        phase: makePhase(),
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
        loggedDays: 5,
      },
    });
    await flushPromises();
    expect((wrapper.find('[data-test="phase-name"]').element as HTMLInputElement).value).toBe(
      "Spring cut",
    );
    expect((wrapper.find('[data-test="target-kcal"]').element as HTMLInputElement).value).toBe(
      "1900",
    );
    expect((wrapper.find('[data-test="tdee"]').element as HTMLInputElement).value).toBe("2400");
    expect((wrapper.find('[data-test="protein"]').element as HTMLInputElement).value).toBe("160");
  });
});

describe("PhaseFormModal band validation", () => {
  it("shows band-error and disables submit when a cut target equals tdee", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient(),
        mode: "create" as const,
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="tdee"]').setValue("2400");
    await wrapper.find('[data-test="target-kcal"]').setValue("2400");
    expect(wrapper.find('[data-test="band-error"]').exists()).toBe(true);
    expect((wrapper.find('[data-test="submit"]').element as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("PhaseFormModal submit (create)", () => {
  it("posts a weigh-in then the phase when no weight, then emits saved + close", async () => {
    // Fully-set-up profile so no extra "Your details" fields gate the submit.
    const client = stubClient({}, { height_cm: 180, sex: "male", dob: "1990-01-01" });
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="current-weight"]').setValue("80");
    await wrapper.find('[data-test="phase-name"]').setValue("Cut A");
    await wrapper.find('[data-test="tdee"]').setValue("2400");
    await wrapper.find('[data-test="target-kcal"]').setValue("1900");
    await wrapper.find('[data-test="protein"]').setValue("160");
    await wrapper.find('[data-test="carb"]').setValue("180");
    await wrapper.find('[data-test="fat"]').setValue("55");
    await wrapper.find('[data-test="submit"]').trigger("click");
    await flushPromises();

    const c = client as unknown as {
      post: ReturnType<typeof vi.fn>;
    };
    const bodyWeightCall = c.post.mock.calls.find((args) => args[0] === "/v1/body-weights");
    const phaseCall = c.post.mock.calls.find((args) => args[0] === "/v1/nutrition-phases");
    expect(bodyWeightCall).toBeDefined();
    expect(bodyWeightCall?.[1]).toMatchObject({ weight_kg: 80 });
    expect(phaseCall).toBeDefined();
    expect(phaseCall?.[1]).toMatchObject({
      name: "Cut A",
      phase_type: "cut",
      intent: "cut",
      daily_kcal_target: 1900,
    });
    expect(wrapper.emitted("saved")).toHaveLength(1);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("omits tdee_override when the user accepts the server's estimate", async () => {
    // Regression: the modal sent tdee_override unconditionally, so every
    // web-created phase recorded tdee_source: "user_asserted" for a number
    // the server had computed. Omitting it lets the server stamp "formula".
    //
    // tdeeBasis is "profile_baseline", not "measured_intake": this is the
    // cold-start branch (hasWeight: false), and a measured basis would imply
    // weigh-ins already exist. The combination also matters mechanically —
    // buildProfilePatch only sets activity_level on a profile_baseline phase,
    // so a measured basis skipped the cold-start path this test is named for.
    const client = stubClient({}, { height_cm: 180, sex: "male", dob: "1990-01-01" });
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "profile_baseline" as const,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="current-weight"]').setValue("80");
    await wrapper.find('[data-test="phase-name"]').setValue("Cut A");
    await wrapper.find('[data-test="target-kcal"]').setValue("1900");
    await wrapper.find('[data-test="protein"]').setValue("160");
    await wrapper.find('[data-test="carb"]').setValue("180");
    await wrapper.find('[data-test="fat"]').setValue("55");
    await wrapper.find('[data-test="submit"]').trigger("click");
    await flushPromises();

    const c = client as unknown as { post: ReturnType<typeof vi.fn> };
    const phaseCall = c.post.mock.calls.find((args) => args[0] === "/v1/nutrition-phases");
    expect(phaseCall).toBeDefined();
    const payload = phaseCall?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("tdee_override");
    // The target still goes over the wire — the route derives deficit_kcal.
    expect(payload.daily_kcal_target).toBe(1900);
  });

  it("persists the chosen activity_level to the user profile on a cold-start create", async () => {
    // Regression: the activity selector seeded the TDEE estimate but was never
    // saved to the user, so Settings showed "Not set" after onboarding through
    // the phase form. The create-mode profile PATCH must now carry activity_level
    // on a profile_baseline (cold-start) phase.
    const client = stubClient({}, { height_cm: 180, sex: "male", dob: "1990-01-01" });
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "profile_baseline" as const,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="activity-level"]').setValue("very_active");
    await wrapper.find('[data-test="current-weight"]').setValue("80");
    await wrapper.find('[data-test="phase-name"]').setValue("Cut A");
    await wrapper.find('[data-test="tdee"]').setValue("2400");
    await wrapper.find('[data-test="target-kcal"]').setValue("1900");
    await wrapper.find('[data-test="protein"]').setValue("160");
    await wrapper.find('[data-test="carb"]').setValue("180");
    await wrapper.find('[data-test="fat"]').setValue("55");
    await wrapper.find('[data-test="submit"]').trigger("click");
    await flushPromises();

    const c = client as unknown as { patch: ReturnType<typeof vi.fn> };
    const profilePatch = c.patch.mock.calls.find((args) => args[0] === "/v1/users/me");
    expect(profilePatch).toBeDefined();
    expect(profilePatch?.[1]).toMatchObject({ activity_level: "very_active" });
  });

  it("saves activity_level BEFORE creating the phase so the server agrees with the preview", async () => {
    // Ordering guard for the invariant-check divergence. /v1/phase-estimate
    // honors the typed activity level (very_active = 1.9x), but the phase route
    // reads the STORED profile — a null activity_level there falls back to
    // seedActivityMultiplier (1.4x). That gap exceeds the +/-5% maintenance
    // band, so if the phase POST beat the profile PATCH the server would reject
    // a maintenance target the form had just shown as valid. The API-side test
    // "diverges from the preview when previewed profile fields were never saved"
    // pins the failure; this pins the ordering that prevents it.
    const client = stubClient({}, { height_cm: 180, sex: "male", dob: "1990-01-01" });
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "profile_baseline" as const,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="phase-type"]').setValue("maintenance");
    await wrapper.find('[data-test="activity-level"]').setValue("very_active");
    await wrapper.find('[data-test="current-weight"]').setValue("80");
    await wrapper.find('[data-test="phase-name"]').setValue("Maintain");
    await wrapper.find('[data-test="tdee"]').setValue("2400");
    await wrapper.find('[data-test="target-kcal"]').setValue("2400");
    await wrapper.find('[data-test="protein"]').setValue("160");
    await wrapper.find('[data-test="carb"]').setValue("180");
    await wrapper.find('[data-test="fat"]').setValue("55");
    await wrapper.find('[data-test="submit"]').trigger("click");
    await flushPromises();

    const c = client as unknown as {
      patch: ReturnType<typeof vi.fn>;
      post: ReturnType<typeof vi.fn>;
    };
    const patchOrder =
      c.patch.mock.invocationCallOrder[
        c.patch.mock.calls.findIndex((args) => args[0] === "/v1/users/me")
      ];
    const phaseOrder =
      c.post.mock.invocationCallOrder[
        c.post.mock.calls.findIndex((args) => args[0] === "/v1/nutrition-phases")
      ];
    expect(patchOrder).toBeDefined();
    expect(phaseOrder).toBeDefined();
    if (patchOrder !== undefined && phaseOrder !== undefined) {
      expect(patchOrder).toBeLessThan(phaseOrder);
    }
  });
});

describe("PhaseFormModal profile fields (create)", () => {
  it("renders height/sex/dob fields when those profile fields are null, and a unit toggle", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient({}, { height_cm: null, sex: null, dob: null }),
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "profile_baseline" as const,
      },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="profile-details"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="profile-height-cm"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="profile-sex"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="profile-dob"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="unit-toggle"]').exists()).toBe(true);
  });

  it("disables submit until the shown profile fields are filled", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient({}, { height_cm: null, sex: null, dob: null }),
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    // Fill everything EXCEPT the profile fields → still disabled.
    await wrapper.find('[data-test="current-weight"]').setValue("80");
    await wrapper.find('[data-test="phase-name"]').setValue("Cut A");
    await wrapper.find('[data-test="tdee"]').setValue("2400");
    await wrapper.find('[data-test="target-kcal"]').setValue("1900");
    expect((wrapper.find('[data-test="submit"]').element as HTMLButtonElement).disabled).toBe(true);
    // Fill the profile fields → enabled.
    await wrapper.find('[data-test="profile-height-cm"]').setValue("180");
    await wrapper.find('[data-test="profile-sex"]').setValue("male");
    await wrapper.find('[data-test="profile-dob"]').setValue("1990-01-01");
    expect((wrapper.find('[data-test="submit"]').element as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("renders NO profile fields when the user is fully set up", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient(
          { has_weight: true, basis: "measured_intake" },
          { height_cm: 180, sex: "male", dob: "1990-01-01" },
        ),
        mode: "create" as const,
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="profile-details"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="profile-height-cm"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="profile-sex"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="profile-dob"]').exists()).toBe(false);
  });

  it("switching the unit toggle to imperial shows ft/in height inputs", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient({}, { height_cm: null, preferred_unit_system: "metric" }),
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    // Metric default → single cm input.
    expect(wrapper.find('[data-test="profile-height-cm"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="profile-height-ft"]').exists()).toBe(false);
    await wrapper.find('[data-test="unit-toggle"]').setValue("imperial");
    expect(wrapper.find('[data-test="profile-height-ft"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="profile-height-in"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="profile-height-cm"]').exists()).toBe(false);
  });

  it("defaults the unit toggle to the fetched preferred_unit_system (imperial)", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient({}, { height_cm: null, preferred_unit_system: "imperial" }),
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    expect((wrapper.find('[data-test="unit-toggle"]').element as HTMLSelectElement).value).toBe(
      "imperial",
    );
    expect(wrapper.find('[data-test="profile-height-ft"]').exists()).toBe(true);
  });

  it("does NOT render profile fields or the unit toggle in edit mode", async () => {
    const wrapper = mount(PhaseFormModal, {
      props: {
        client: stubClient({}, { height_cm: null, sex: null, dob: null }),
        mode: "edit" as const,
        phase: makePhase(),
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
        loggedDays: 5,
      },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="profile-details"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="unit-toggle"]').exists()).toBe(false);
  });

  it("PATCHes /v1/users/me with the supplied profile fields before posting the phase", async () => {
    const client = stubClient({}, { height_cm: null, sex: null, dob: null });
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: false,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="current-weight"]').setValue("80");
    await wrapper.find('[data-test="phase-name"]').setValue("Cut A");
    await wrapper.find('[data-test="tdee"]').setValue("2400");
    await wrapper.find('[data-test="target-kcal"]').setValue("1900");
    await wrapper.find('[data-test="profile-height-cm"]').setValue("180");
    await wrapper.find('[data-test="profile-sex"]').setValue("male");
    await wrapper.find('[data-test="profile-dob"]').setValue("1990-01-01");
    await wrapper.find('[data-test="submit"]').trigger("click");
    await flushPromises();

    const c = client as unknown as {
      post: ReturnType<typeof vi.fn>;
      patch: ReturnType<typeof vi.fn>;
    };
    const patchCall = c.patch.mock.calls.find((args) => args[0] === "/v1/users/me");
    expect(patchCall).toBeDefined();
    expect(patchCall?.[1]).toMatchObject({
      height_cm: 180,
      sex: "male",
      dob: "1990-01-01",
    });
    // Profile PATCH must precede the phase POST (correct context first).
    const phaseCall = c.post.mock.calls.find((args) => args[0] === "/v1/nutrition-phases");
    expect(phaseCall).toBeDefined();
    const patchOrder = c.patch.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    const phasePostIdx = c.post.mock.calls.findIndex((args) => args[0] === "/v1/nutrition-phases");
    const phaseOrder = c.post.mock.invocationCallOrder[phasePostIdx] ?? -1;
    expect(patchOrder).toBeLessThan(phaseOrder);
  });

  it("combines ft/in into height_cm in the PATCH when imperial", async () => {
    const client = stubClient(
      {},
      { height_cm: null, sex: "male", dob: "1990-01-01", preferred_unit_system: "imperial" },
    );
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="phase-name"]').setValue("Cut A");
    await wrapper.find('[data-test="tdee"]').setValue("2400");
    await wrapper.find('[data-test="target-kcal"]').setValue("1900");
    await wrapper.find('[data-test="profile-height-ft"]').setValue("5");
    await wrapper.find('[data-test="profile-height-in"]').setValue("11");
    await wrapper.find('[data-test="submit"]').trigger("click");
    await flushPromises();

    const c = client as unknown as { patch: ReturnType<typeof vi.fn> };
    const patchCall = c.patch.mock.calls.find((args) => args[0] === "/v1/users/me");
    expect(patchCall).toBeDefined();
    // 5'11" = 71 in × 2.54 = 180.34 → rounded 180 cm.
    expect(patchCall?.[1]).toMatchObject({ height_cm: 180 });
    // Only height was missing → no sex/dob in the patch.
    expect(patchCall?.[1]).not.toHaveProperty("sex");
    expect(patchCall?.[1]).not.toHaveProperty("dob");
  });

  it("keeps a user-typed TDEE override after the post-profile-PATCH re-fetch", async () => {
    // The re-fetch (triggered because a profile field was missing) returns a
    // different TDEE; a hand-entered override must NOT be clobbered by it.
    const client = stubClient(
      { tdee: 9999 }, // estimate would set 9999 if it clobbered
      { height_cm: null, sex: "male", dob: "1990-01-01" },
    );
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="phase-name"]').setValue("Cut A");
    await wrapper.find('[data-test="target-kcal"]').setValue("1900");
    await wrapper.find('[data-test="profile-height-cm"]').setValue("180");
    // User types their own TDEE (overriding the estimate-filled value).
    await wrapper.find('[data-test="tdee"]').setValue("2300");
    await wrapper.find('[data-test="submit"]').trigger("click");
    await flushPromises();

    const c = client as unknown as { post: ReturnType<typeof vi.fn> };
    const phaseCall = c.post.mock.calls.find((args) => args[0] === "/v1/nutrition-phases");
    expect(phaseCall).toBeDefined();
    // The phase snapshot must use the user's 2300, not the re-fetched 9999.
    expect(phaseCall?.[1]).toMatchObject({ tdee_override: 2300 });
  });

  it("blocks submit when an imperial height resolves to 0 (ft=0/in=0)", async () => {
    const client = stubClient(
      {},
      { height_cm: null, sex: "male", dob: "1990-01-01", preferred_unit_system: "imperial" },
    );
    const wrapper = mount(PhaseFormModal, {
      props: {
        client,
        mode: "create" as const,
        hasWeight: true,
        tdeeBasis: "measured_intake" as const,
      },
    });
    await flushPromises();
    await wrapper.find('[data-test="phase-name"]').setValue("Cut A");
    await wrapper.find('[data-test="tdee"]').setValue("2400");
    await wrapper.find('[data-test="target-kcal"]').setValue("1900");
    await wrapper.find('[data-test="profile-height-ft"]').setValue("0");
    await wrapper.find('[data-test="profile-height-in"]').setValue("0");
    // Submit stays disabled (height resolves to 0, which the server rejects).
    expect((wrapper.find('[data-test="submit"]').element as HTMLButtonElement).disabled).toBe(true);
  });
});
