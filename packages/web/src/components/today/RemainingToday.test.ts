import type { TodayContextResponseSchema } from "@almanac/core/schemas";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import RemainingToday from "./RemainingToday.vue";

type TodayBlock = z.infer<typeof TodayContextResponseSchema>["today"];
type Observed = TodayBlock["observed"];

// Helper to merge observed overrides while preserving required fields
function mergeObserved(partial: Partial<Observed>): Observed {
  if (partial === null || partial === undefined) return null;
  return {
    cardio_kcal: 0,
    workout_kcal: 0,
    steps_kcal: 0,
    vs_target: -600,
    vs_maintenance: -770,
    status: "on_track" as const,
    ...partial,
  };
}

function makeToday(overrides: Partial<TodayBlock> = {}): TodayBlock {
  const defaultToday: TodayBlock = {
    kcal_in: 1300,
    protein_g_in: 118,
    carb_g_in: 126,
    fat_g_in: 48,
    meals_logged_today: true,
    target: {
      kcal: 1900,
      protein_g: 180,
      carb_g: 200,
      fat_g: 70,
    },
    maintenance: null,
    intake: {
      kcal: 1300,
      protein_g: 118,
      carb_g: 126,
      fat_g: 48,
    },
    observed: {
      cardio_kcal: 0,
      workout_kcal: 0,
      steps_kcal: 0,
      vs_target: -600,
      vs_maintenance: -770,
      status: "on_track",
    },
    body_weight_kg: null,
    most_recent_weight: null,
    sleep: null,
    steps: null,
    workouts: [],
    cardio: [],
    alcohol: [],
    energy_balance: {
      food_in: 1300,
      alcohol_in: 0,
      total_in: 1300,
      tdee_baseline: 2070,
      cardio_out: 0,
      workout_out: 0,
      steps_out: 0,
      net: -770, // negative net = deficit
    },
  };

  return { ...defaultToday, ...overrides };
}

describe("RemainingToday", () => {
  it("renders the calorie ring with remaining kcal (target − intake)", () => {
    const wrapper = mount(RemainingToday, { props: { today: makeToday() } });
    // 1900 - 1300 = 600
    expect(wrapper.find('[data-test="ring-number"]').text()).toBe("600");
    expect(wrapper.find('[data-test="ring-unit"]').text()).toContain("kcal left");
  });

  it("renders three macro bars with remaining grams", () => {
    const wrapper = mount(RemainingToday, { props: { today: makeToday() } });
    // P: 180-118=62, C: 200-126=74, F: 70-48=22
    const bars = wrapper.findAll('[data-test="macro-value"]');
    expect(bars).toHaveLength(3);
    const text = wrapper.text();
    expect(text).toContain("62");
    expect(text).toContain("74");
    expect(text).toContain("22");
    expect(text).toContain("g left");
  });

  it("renders empty state when target is null", () => {
    const wrapper = mount(RemainingToday, { props: { today: makeToday({ target: null }) } });
    expect(wrapper.text()).toContain("No active phase — remaining target unavailable");
    expect(wrapper.find('[data-test="ring-number"]').exists()).toBe(false);
  });

  it("shows 'g over' (positive magnitude) when a macro exceeds target", () => {
    const wrapper = mount(RemainingToday, {
      props: {
        today: makeToday({
          intake: { kcal: 2020, protein_g: 200, carb_g: 250, fat_g: 80 },
        }),
      },
    });
    const text = wrapper.text();
    // kcal: 1900-2020 = 120 over; the ring shows magnitude 120 + "over", no minus.
    expect(wrapper.find('[data-test="ring-number"]').text()).toBe("120");
    expect(wrapper.find('[data-test="ring-unit"]').text()).toContain("kcal over");
    expect(text).toContain("g over");
    expect(text).not.toContain("-120");
  });

  it("keeps remaining static when activity is logged (observed changes, ring stays)", () => {
    const before = mount(RemainingToday, {
      props: { today: makeToday({ observed: mergeObserved({ cardio_kcal: 0 }) }) },
    })
      .find('[data-test="ring-number"]')
      .text();
    const after = mount(RemainingToday, {
      props: { today: makeToday({ observed: mergeObserved({ cardio_kcal: 270 }) }) },
    })
      .find('[data-test="ring-number"]')
      .text();
    expect(before).toBe(after);
    expect(before).toBe("600");
  });

  it("no longer renders a steps row (steps moved to MovementBlock)", () => {
    const populated = mount(RemainingToday, {
      props: { today: makeToday({ steps: { id: 1, count: 8500, est_kcal: 340 } }) },
    });
    expect(populated.find('[data-test="steps-row"]').exists()).toBe(false);
    expect(populated.text()).not.toContain("8,500");

    const nullSteps = mount(RemainingToday, { props: { today: makeToday() } });
    expect(nullSteps.find('[data-test="steps-row"]').exists()).toBe(false);
  });
});
