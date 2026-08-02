import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PhaseHeader from "./PhaseHeader.vue";

// --- Fixtures ---------------------------------------------------------------
// Post-refactor PhaseSummary: includes the four TDEE-refactor fields (phase_type,
// tdee_at_phase_start, tdee_source, deficit_kcal, daily_kcal_target). See
// `PhaseSummarySchema` in packages/core/src/schemas/signals.ts.

const examplePhase = {
  id: 1,
  user_id: 1,
  name: "Spring Lean",
  intent: "cut" as const,
  phase_type: "cut" as const,
  tdee_at_phase_start: 2370,
  tdee_source: "user_asserted" as const,
  deficit_kcal: -470,
  daily_kcal_target: 1900,
  base_protein_g: 180,
  base_carb_g: 200,
  base_fat_g: 70,
  started_on: "2026-04-27",
  planned_end_on: null,
  ended_on: null,
  notes: null,
  created_at: "2026-04-27T08:00:00Z",
  days_in: 24,
  days_remaining: null,
};

// `today` block now carries the structured target/maintenance/intake/observed.
// PhaseHeader only reads `today.target` for the row macros, so we keep the
// rest of the fixture minimal (matching ObservedSchema and MacrosSchema).
const exampleToday = {
  kcal_in: 0,
  protein_g_in: 0,
  carb_g_in: 0,
  fat_g_in: 0,
  meals_logged_today: false,
  target: { kcal: 1900, protein_g: 180, carb_g: 200, fat_g: 70 },
  maintenance: { kcal: 2370 },
  intake: { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 },
  observed: {
    cardio_kcal: 0,
    workout_kcal: 0,
    steps_kcal: 0,
    vs_target: 0,
    vs_maintenance: 0,
    status: "on_track" as const,
  },
  body_weight_kg: null,
  most_recent_weight: null,
  sleep: null,
  steps: null,
  workouts: [],
  cardio: [],
  alcohol: [],
  energy_balance: {
    food_in: 0,
    alcohol_in: 0,
    total_in: 0,
    tdee_baseline: 2370,
    cardio_out: 0,
    workout_out: 0,
    steps_out: 0,
    net: 0,
  },
};

const baseProps = {
  phase: examplePhase,
  today: exampleToday,
  profileComplete: true,
};

describe("PhaseHeader", () => {
  it("renders the eyebrow with phase type and day count", () => {
    const wrapper = mount(PhaseHeader, { props: baseProps });
    expect(wrapper.text().toLowerCase()).toContain("cut");
    expect(wrapper.text()).toContain("day 24");
  });

  it("renders the title row with name and started date", () => {
    const wrapper = mount(PhaseHeader, { props: baseProps });
    expect(wrapper.text()).toContain("Spring Lean");
    expect(wrapper.text()).toMatch(/started.*Apr/);
  });

  it("omits title row when phase name is empty", () => {
    const wrapper = mount(PhaseHeader, {
      props: { ...baseProps, phase: { ...examplePhase, name: "" } },
    });
    expect(wrapper.text()).not.toContain("Spring Lean");
    expect(wrapper.text()).not.toMatch(/started/);
  });

  it("omits title row when phase name equals intent (case-insensitive)", () => {
    const wrapper = mount(PhaseHeader, {
      props: { ...baseProps, phase: { ...examplePhase, name: "Cut" } },
    });
    expect(wrapper.text()).not.toMatch(/started/);
  });

  describe("Target row", () => {
    it("renders 'Target' label (renamed from 'Base')", () => {
      const wrapper = mount(PhaseHeader, { props: baseProps });
      expect(wrapper.text()).toContain("Target");
      expect(wrapper.text()).not.toContain("Base");
    });

    it("reads kcal from today.target.kcal (not phase fields)", () => {
      // today.target.kcal is the canonical source; setting phase.daily_kcal_target
      // to something different verifies we're not falling back to the phase.
      const wrapper = mount(PhaseHeader, {
        props: {
          ...baseProps,
          phase: { ...examplePhase, daily_kcal_target: 9999 },
          today: {
            ...exampleToday,
            target: { kcal: 1900, protein_g: 180, carb_g: 200, fat_g: 70 },
          },
        },
      });
      expect(wrapper.find(".macro.kcal").text()).toContain("1900");
      expect(wrapper.find(".macro.kcal").text()).not.toContain("9999");
    });

    it("renders the four macro values from today.target", () => {
      const wrapper = mount(PhaseHeader, { props: baseProps });
      expect(wrapper.text()).toContain("1900");
      expect(wrapper.text()).toContain("180");
      expect(wrapper.text()).toContain("200");
      expect(wrapper.text()).toContain("70");
    });

    it("renders P/C/F/kcal labels and color classes", () => {
      const wrapper = mount(PhaseHeader, { props: baseProps });
      expect(wrapper.find(".macro.kcal").exists()).toBe(true);
      expect(wrapper.find(".macro.protein").exists()).toBe(true);
      expect(wrapper.find(".macro.carb").exists()).toBe(true);
      expect(wrapper.find(".macro.fat").exists()).toBe(true);
      expect(wrapper.find(".macro.protein").text()).toContain("P");
      expect(wrapper.find(".macro.carb").text()).toContain("C");
      expect(wrapper.find(".macro.fat").text()).toContain("F");
      expect(wrapper.find(".macro.kcal").text()).toContain("kcal");
    });
  });

  describe("TDEE box (calibrated)", () => {
    const calibrated = {
      kcal: 2305,
      basis: "measured_intake" as const,
      days_of_data: 30,
      components: {
        avg_kcal_in: { value: 2300, window_days: 21, days_with_data: 19 },
        trend_weight_change_kg: -0.2,
      },
    };

    it("shows the Phase TDEE box with the phase-start anchor", () => {
      const wrapper = mount(PhaseHeader, { props: { ...baseProps, tdee: calibrated } });
      const box = wrapper.find('[data-test="phase-tdee-box"]');
      expect(box.exists()).toBe(true);
      expect(box.text()).toContain("Phase TDEE");
      expect(box.text()).toContain("2370");
    });

    it("shows the Current TDEE box with the live value and no drift sub-line", () => {
      const wrapper = mount(PhaseHeader, { props: { ...baseProps, tdee: calibrated } });
      const box = wrapper.find('[data-test="tdee-box"]');
      expect(box.exists()).toBe(true);
      expect(box.text()).toContain("Current TDEE");
      expect(box.text()).toContain("2305");
      // Drift sub-line is gone entirely.
      expect(box.text()).not.toContain("from");
      expect(box.text()).not.toContain("start");
      expect(box.text()).not.toContain("↓");
    });

    it("omits the Phase TDEE box when there is no anchor (legacy phase)", () => {
      const wrapper = mount(PhaseHeader, {
        props: {
          ...baseProps,
          phase: { ...examplePhase, tdee_at_phase_start: null },
          tdee: calibrated,
        },
      });
      expect(wrapper.find('[data-test="phase-tdee-box"]').exists()).toBe(false);
      // Current TDEE + deficit still render.
      expect(wrapper.find('[data-test="tdee-box"]').exists()).toBe(true);
    });

    it("renders the deficit box with target", () => {
      const wrapper = mount(PhaseHeader, { props: { ...baseProps, tdee: calibrated } });
      const box = wrapper.find('[data-test="deficit-box"]');
      expect(box.text()).toContain("Daily deficit");
      expect(box.text()).toContain("−470");
      expect(box.text()).toContain("1900");
    });

    it("labels the box 'Daily surplus' with +value on a bulk", () => {
      const wrapper = mount(PhaseHeader, {
        props: {
          ...baseProps,
          phase: {
            ...examplePhase,
            phase_type: "bulk" as const,
            deficit_kcal: 300,
            daily_kcal_target: 2850,
          },
          today: {
            ...exampleToday,
            target: { kcal: 2850, protein_g: 180, carb_g: 300, fat_g: 80 },
          },
          tdee: calibrated,
        },
      });
      const box = wrapper.find('[data-test="deficit-box"]');
      expect(box.text()).toContain("Daily surplus");
      expect(box.text()).toContain("+300");
    });

    it("labels the box 'Daily target' / maintenance when deficit is 0", () => {
      const wrapper = mount(PhaseHeader, {
        props: {
          ...baseProps,
          phase: { ...examplePhase, phase_type: "maintenance" as const, deficit_kcal: 0 },
          tdee: calibrated,
        },
      });
      const box = wrapper.find('[data-test="deficit-box"]');
      expect(box.text().toLowerCase()).toContain("maintenance");
    });
  });

  describe("Calibration mode (profile_baseline)", () => {
    const calibrating = {
      kcal: 2370,
      basis: "profile_baseline" as const,
      days_of_data: 8,
      components: {
        avg_kcal_in: { value: 0, window_days: 0, days_with_data: 0 },
        trend_weight_change_kg: 0,
        days_remaining_to_calibrate: 6,
      },
    };

    it("shows the calibrating chip with 'N weigh-ins to go' and EST tag", () => {
      const wrapper = mount(PhaseHeader, { props: { ...baseProps, tdee: calibrating } });
      const chip = wrapper.find('[data-test="calib-chip"]');
      expect(chip.exists()).toBe(true);
      expect(chip.text().toLowerCase()).toContain("calibrating");
      expect(chip.text()).toContain("6 weigh-ins to go");
      expect(chip.text().toLowerCase()).toContain("est");
    });

    it("does NOT render the calibrated TDEE box while calibrating", () => {
      const wrapper = mount(PhaseHeader, { props: { ...baseProps, tdee: calibrating } });
      expect(wrapper.find('[data-test="tdee-box"]').exists()).toBe(false);
    });

    it("still renders the deficit box while calibrating", () => {
      const wrapper = mount(PhaseHeader, { props: { ...baseProps, tdee: calibrating } });
      expect(wrapper.find('[data-test="deficit-box"]').exists()).toBe(true);
    });

    it("shows the meal-days gate once weigh-ins are done but meals are short", () => {
      // 14 weigh-ins logged (gate 1 satisfied) but only some meal days → the
      // response carries meal_days_remaining_to_calibrate, NOT days_remaining.
      // The chip must say "N days of meals to go", never "0 weigh-ins to go".
      const mealGated = {
        kcal: 2485,
        basis: "profile_baseline" as const,
        days_of_data: 14,
        components: {
          avg_kcal_in: { value: 0, window_days: 0, days_with_data: 0 },
          trend_weight_change_kg: 0,
          meal_days_remaining_to_calibrate: 6,
        },
      };
      const wrapper = mount(PhaseHeader, { props: { ...baseProps, tdee: mealGated } });
      const chip = wrapper.find('[data-test="calib-chip"]');
      expect(chip.exists()).toBe(true);
      expect(chip.text()).toContain("6 days of meals to go");
      expect(chip.text()).not.toContain("weigh-ins to go");
    });
  });

  describe("Empty states", () => {
    it("renders the onboarding card (State A) when phase is null and profile incomplete", () => {
      const wrapper = mount(PhaseHeader, {
        props: { phase: null, today: exampleToday, profileComplete: false },
      });
      const card = wrapper.find('[data-test="onboarding-card"]');
      expect(card.exists()).toBe(true);
      expect(card.text()).toContain("Start a nutrition phase");
      expect(wrapper.find('[data-test="phase-header"]').exists()).toBe(false);
    });

    it("renders the onboarding card (State B) when phase is null but profile complete", () => {
      const wrapper = mount(PhaseHeader, {
        props: { phase: null, today: exampleToday, profileComplete: true },
      });
      expect(wrapper.find('[data-test="onboarding-card"]').text()).toContain(
        "Start your next phase",
      );
      expect(wrapper.find('[data-test="phase-header"]').exists()).toBe(false);
    });

    it("renders normal header content when phase is present", () => {
      const wrapper = mount(PhaseHeader, { props: baseProps });
      expect(wrapper.find('[data-test="phase-header"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="onboarding-card"]').exists()).toBe(false);
    });
  });

  describe("PhaseHeader — On Target box", () => {
    it("renders X / N and the avg deficit label on a cut", () => {
      const wrapper = mount(PhaseHeader, {
        props: {
          ...baseProps,
          phaseAdherence: { logged_days: 24, on_track_days: 18, avg_delta_kcal: -512 },
        },
      });
      const box = wrapper.get('[data-test="adherence-box"]');
      expect(box.text()).toContain("18 / 24");
      expect(box.text()).toContain("avg −512 / day");
    });

    it("uses + wording for a surplus (bulk) average", () => {
      const bulkPhase = { ...examplePhase, intent: "bulk" as const, phase_type: "bulk" as const };
      const wrapper = mount(PhaseHeader, {
        props: {
          ...baseProps,
          phase: bulkPhase,
          phaseAdherence: { logged_days: 10, on_track_days: 7, avg_delta_kcal: 280 },
        },
      });
      expect(wrapper.get('[data-test="adherence-box"]').text()).toContain("avg +280 / day");
    });

    it("omits the avg line when avg_delta_kcal is null", () => {
      const wrapper = mount(PhaseHeader, {
        props: {
          ...baseProps,
          phaseAdherence: { logged_days: 3, on_track_days: 2, avg_delta_kcal: null },
        },
      });
      const box = wrapper.get('[data-test="adherence-box"]');
      expect(box.text()).toContain("2 / 3");
      expect(box.text()).not.toContain("avg");
    });

    it("shows ±0 for a dead-on average on a cut (no signed −0)", () => {
      const wrapper = mount(PhaseHeader, {
        props: {
          ...baseProps,
          phaseAdherence: { logged_days: 5, on_track_days: 5, avg_delta_kcal: 0 },
        },
      });
      const box = wrapper.get('[data-test="adherence-box"]');
      expect(box.text()).toContain("avg ±0 / day");
      expect(box.text()).not.toContain("−0");
    });

    it("does not render the box when phaseAdherence is null", () => {
      const wrapper = mount(PhaseHeader, { props: { ...baseProps, phaseAdherence: null } });
      expect(wrapper.find('[data-test="adherence-box"]').exists()).toBe(false);
    });

    it("does not render the box when phaseAdherence is absent", () => {
      const wrapper = mount(PhaseHeader, { props: baseProps });
      expect(wrapper.find('[data-test="adherence-box"]').exists()).toBe(false);
    });
  });

  describe("PhaseHeader — tracked-day count in meta line", () => {
    it("shows logged days next to the phase day count", () => {
      const wrapper = mount(PhaseHeader, {
        props: {
          ...baseProps,
          phaseAdherence: { logged_days: 17, on_track_days: 12, avg_delta_kcal: -300 },
        },
      });
      expect(wrapper.get('[data-test="phase-meta"]').text()).toMatch(
        /day 24 \(17 tracked\)\s*· started/,
      );
    });

    it("shows a zero count rather than hiding it", () => {
      const wrapper = mount(PhaseHeader, {
        props: {
          ...baseProps,
          phaseAdherence: { logged_days: 0, on_track_days: 0, avg_delta_kcal: null },
        },
      });
      expect(wrapper.get('[data-test="phase-meta"]').text()).toContain("day 24 (0 tracked)");
    });

    it("keeps the plain meta line when phaseAdherence is null", () => {
      const wrapper = mount(PhaseHeader, { props: { ...baseProps, phaseAdherence: null } });
      const meta = wrapper.get('[data-test="phase-meta"]').text();
      expect(meta).not.toContain("tracked");
      expect(meta).toMatch(/day 24\s*· started/);
    });

    it("shows the tracked count even when the title row is hidden", () => {
      const wrapper = mount(PhaseHeader, {
        props: {
          ...baseProps,
          phase: { ...examplePhase, name: "" },
          phaseAdherence: { logged_days: 17, on_track_days: 12, avg_delta_kcal: -300 },
        },
      });
      const meta = wrapper.get('[data-test="phase-meta"]').text();
      expect(meta).toContain("day 24 (17 tracked)");
      expect(meta).not.toContain("started");
    });
  });

  describe("phase controls", () => {
    it("emits `edit` when the edit control is clicked", async () => {
      const wrapper = mount(PhaseHeader, { props: baseProps });
      await wrapper.get('[data-test="phase-edit"]').trigger("click");
      expect(wrapper.emitted("edit")).toHaveLength(1);
    });

    it("emits `stop` when the stop control is clicked", async () => {
      const wrapper = mount(PhaseHeader, { props: baseProps });
      await wrapper.get('[data-test="phase-stop"]').trigger("click");
      expect(wrapper.emitted("stop")).toHaveLength(1);
    });

    it("does not render the controls when there is no phase", () => {
      const wrapper = mount(PhaseHeader, {
        props: { phase: null, today: exampleToday, profileComplete: true },
      });
      expect(wrapper.find('[data-test="phase-edit"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="phase-stop"]').exists()).toBe(false);
    });
  });

  describe("phase_type vs intent display", () => {
    it("prefers phase_type when present (canonical post-refactor field)", () => {
      const wrapper = mount(PhaseHeader, {
        props: {
          ...baseProps,
          phase: {
            ...examplePhase,
            intent: "cut" as const,
            phase_type: "bulk" as const,
          },
        },
      });
      expect(wrapper.find(".pill").text()).toContain("bulk");
    });

    it("falls back to intent when phase_type is null (legacy phase)", () => {
      const wrapper = mount(PhaseHeader, {
        props: {
          ...baseProps,
          phase: {
            ...examplePhase,
            intent: "recomp" as const,
            phase_type: null,
          },
        },
      });
      expect(wrapper.find(".pill").text()).toContain("recomp");
    });
  });
});
