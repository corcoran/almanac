import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WinsSummary from "./WinsSummary.vue";

type Win = {
  code:
    | "weigh_in_streak"
    | "workout_consistency"
    | "target_adherence_streak"
    | "weight_milestone"
    | "tdee_measured"
    | "strength_pr"
    | "phase_complete"
    | "phase_halfway"
    | "workout_total"
    | "volume_total"
    | "meal_total"
    | "weigh_in_total";
  earned_on: string;
  value: number;
  message: string;
  details: Record<string, unknown>;
  prior_best: { earned_on: string; value: number } | null;
};

const win: Win = {
  code: "weigh_in_streak",
  earned_on: "2026-05-21",
  value: 14,
  message: "14-day weigh-in streak",
  details: { streak_days: 14 },
  prior_best: { earned_on: "2026-05-01", value: 10 },
};

describe("WinsSummary", () => {
  it("renders nothing when there are no wins", () => {
    const wrapper = mount(WinsSummary, {
      props: { data: { accomplishments: [] }, today: "2026-05-21" },
    });
    expect(wrapper.find('[data-test="wins-summary"]').exists()).toBe(false);
  });

  it("renders nothing when data is null", () => {
    const wrapper = mount(WinsSummary, { props: { data: null, today: "2026-05-21" } });
    expect(wrapper.find('[data-test="wins-summary"]').exists()).toBe(false);
  });

  it("renders a win row with its message and prior-best sub-line", () => {
    const wrapper = mount(WinsSummary, {
      props: { data: { accomplishments: [win] }, today: "2026-05-21" },
    });
    expect(wrapper.find('[data-test="wins-summary"]').exists()).toBe(true);
    const text = wrapper.text();
    expect(text).toContain("14-day weigh-in streak");
    expect(text).toContain("prev best 10");
  });

  it("renders a distinct icon for a lifetime-total win", () => {
    const lifetimeWin: Win = {
      code: "workout_total",
      earned_on: "2026-06-08",
      value: 100,
      message: "100 workouts logged",
      details: {},
      prior_best: null,
    };
    const wrapper = mount(WinsSummary, { props: { data: { accomplishments: [lifetimeWin] } } });
    expect(wrapper.text()).toContain("🏆");
  });

  it("renders a strength_pr win with the 💪 icon and PR message", () => {
    const pr: Win = {
      code: "strength_pr",
      earned_on: "2026-06-08",
      value: 96.5,
      message: "New PR: Bench Press e1RM 96.5 kg",
      details: { exercise_id: 3, exercise_name: "Bench Press" },
      prior_best: { earned_on: "2026-06-03", value: 93.5 },
    };
    const wrapper = mount(WinsSummary, {
      props: { data: { accomplishments: [pr] }, today: "2026-06-08" },
    });
    const text = wrapper.text();
    expect(text).toContain("💪");
    expect(text).toContain("New PR: Bench Press e1RM 96.5 kg");
  });

  it("labels prior_best with kg for a weight-bearing code (metric default)", () => {
    const pr: Win = {
      code: "strength_pr",
      earned_on: "2026-06-08",
      value: 96.5,
      message: "New PR: Bench Press e1RM 96.5 kg",
      details: { exercise_id: 3, exercise_name: "Bench Press" },
      prior_best: { earned_on: "2026-06-03", value: 93.5 },
    };
    const wrapper = mount(WinsSummary, {
      props: { data: { accomplishments: [pr] }, today: "2026-06-08" },
    });
    // strength_pr prior_best floors to nearest 5: 93.5 kg → 90 kg
    expect(wrapper.text()).toContain("prev best 90 kg");
  });

  it("converts prior_best to lb for a weight-bearing code when imperial", () => {
    const pr: Win = {
      code: "strength_pr",
      earned_on: "2026-06-08",
      value: 96.5,
      message: "New PR: Bench Press e1RM 212.7 lb",
      details: { exercise_id: 3, exercise_name: "Bench Press" },
      prior_best: { earned_on: "2026-06-03", value: 93.5 },
    };
    const wrapper = mount(WinsSummary, {
      props: { data: { accomplishments: [pr] }, today: "2026-06-08", unitSystem: "imperial" },
    });
    // strength_pr prior_best floors to nearest 5: 93.5 kg → 206.13 lb → floor5 = 205 lb
    expect(wrapper.text()).toContain("prev best 205 lb");
  });

  it("does NOT add a unit to prior_best for a non-weight code (streak) when imperial", () => {
    const wrapper = mount(WinsSummary, {
      props: { data: { accomplishments: [win] }, today: "2026-05-21", unitSystem: "imperial" },
    });
    const text = wrapper.text();
    expect(text).toContain("prev best 10");
    expect(text).not.toContain("prev best 10 lb");
    expect(text).not.toContain("prev best 10 kg");
  });

  it("shows a relative-time label for the earned date", () => {
    const w: Win = {
      code: "weigh_in_streak",
      earned_on: "2026-06-05",
      value: 7,
      message: "7-day weigh-in streak",
      details: {},
      prior_best: null,
    };
    const wrapper = mount(WinsSummary, {
      props: { data: { accomplishments: [w] }, today: "2026-06-08" },
    });
    expect(wrapper.text()).toContain("3 days ago");
  });

  it("labels a same-day win as 'today'", () => {
    const w: Win = {
      code: "weigh_in_streak",
      earned_on: "2026-06-08",
      value: 7,
      message: "7-day weigh-in streak",
      details: {},
      prior_best: null,
    };
    const wrapper = mount(WinsSummary, {
      props: { data: { accomplishments: [w] }, today: "2026-06-08" },
    });
    expect(wrapper.text()).toContain("today");
  });

  it("renders distinct icons for phase_complete and phase_halfway", () => {
    const wrapper = mount(WinsSummary, {
      props: {
        data: {
          accomplishments: [
            {
              code: "phase_complete",
              earned_on: "2026-06-08",
              value: -4.2,
              message: "Cut complete: -4.2 kg over 10 weeks",
              details: {},
              prior_best: null,
            },
            {
              code: "phase_halfway",
              earned_on: "2026-06-08",
              value: 10,
              message: "Halfway through your cut — 10/20 days",
              details: {},
              prior_best: null,
            },
          ],
        },
      },
    });
    const text = wrapper.text();
    expect(text).toContain("🏁");
    expect(text).toContain("⏳");
    expect(text).toContain("Cut complete");
  });
});
