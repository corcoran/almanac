import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import NudgeSummary from "./NudgeSummary.vue";

type Action = {
  code:
    | "complete_profile"
    | "log_initial_weight"
    | "start_nutrition_phase"
    | "create_workout_templates"
    | "log_yesterday_sleep"
    | "log_yesterday_steps"
    | "low_intake_today"
    | "no_workout_streak"
    | "stale_weight_log"
    | "stale_sleep_log"
    | "unlogged_steps";
  tier: "onboarding" | "previous_day" | "today";
  title: string;
  detail: string;
  suggested_tool: string;
  severity?: "info" | "warn" | "concern";
};

function resp(over: { headline: Action | null; actions: Action[]; all_clear: boolean }) {
  return {
    as_of: "2026-06-05",
    onboarding_complete: true,
    ...over,
  };
}

function action(over: Partial<Action> & { title: string }): Action {
  return {
    code: "stale_weight_log",
    tier: "today",
    detail: "detail text",
    suggested_tool: "log_weight",
    severity: "warn",
    ...over,
  };
}

describe("NudgeSummary", () => {
  it("renders nothing when data is null", () => {
    const wrapper = mount(NudgeSummary, { props: { data: null } });
    expect(wrapper.find('[data-test="nudge-summary"]').exists()).toBe(false);
  });

  it("renders 'Ready to train' when all clear", () => {
    const wrapper = mount(NudgeSummary, {
      props: { data: resp({ headline: null, actions: [], all_clear: true }) },
    });
    expect(wrapper.text()).toContain("Ready to train");
    expect(wrapper.find('[data-test="nudge-expand"]').exists()).toBe(false);
  });

  it("falls back to all-clear when actions empty but all_clear false (defensive)", () => {
    const wrapper = mount(NudgeSummary, {
      props: { data: resp({ headline: null, actions: [], all_clear: false }) },
    });
    expect(wrapper.text()).toContain("Ready to train");
  });

  it("renders the headline with no expand for a single action", () => {
    const a = action({ title: "Log your weight — 4 days stale" });
    const wrapper = mount(NudgeSummary, {
      props: { data: resp({ headline: a, actions: [a], all_clear: false }) },
    });
    expect(wrapper.text()).toContain("Log your weight — 4 days stale");
    expect(wrapper.find('[data-test="nudge-expand"]').exists()).toBe(false);
  });

  it("renders headline + '+N more' and toggles the expanded list", async () => {
    const a1 = action({ title: "Weigh-in 9 days stale", severity: "concern" });
    const a2 = action({ title: "Intake low — 28% of your average", severity: "warn" });
    const wrapper = mount(NudgeSummary, {
      props: { data: resp({ headline: a1, actions: [a1, a2], all_clear: false }) },
    });
    expect(wrapper.text()).toContain("Weigh-in 9 days stale");
    expect(wrapper.text()).toContain("+1 more");
    const body = wrapper.find('[data-test="nudge-body"]');
    expect(body.exists()).toBe(false);
    await wrapper.find('[data-test="nudge-expand"]').trigger("click");
    const openBody = wrapper.find('[data-test="nudge-body"]');
    expect(openBody.exists()).toBe(true);
    expect(openBody.text()).toContain("Intake low — 28% of your average");
    expect(openBody.text()).not.toContain("Weigh-in 9 days stale");
  });

  it("maps severity to a data-severity attribute on the headline icon", () => {
    const a = action({ title: "x", severity: "concern" });
    const wrapper = mount(NudgeSummary, {
      props: { data: resp({ headline: a, actions: [a], all_clear: false }) },
    });
    expect(wrapper.find('[data-test="nudge-icon"]').attributes("data-severity")).toBe("concern");
  });

  it("uses a neutral severity when the action has no severity (onboarding tier)", () => {
    const a = action({
      title: "Complete your profile",
      code: "complete_profile",
      tier: "onboarding",
      severity: undefined,
    });
    const wrapper = mount(NudgeSummary, {
      props: { data: resp({ headline: a, actions: [a], all_clear: false }) },
    });
    expect(wrapper.find('[data-test="nudge-icon"]').attributes("data-severity")).toBe("none");
  });

  it("expands via keyboard (Enter) on the headline row", async () => {
    const a1 = action({ title: "Weigh-in 9 days stale", severity: "concern" });
    const a2 = action({ title: "Intake low — 28% of your average", severity: "warn" });
    const wrapper = mount(NudgeSummary, {
      props: { data: resp({ headline: a1, actions: [a1, a2], all_clear: false }) },
    });
    expect(wrapper.find('[data-test="nudge-body"]').exists()).toBe(false);
    await wrapper.find('[data-test="nudge-expand"]').trigger("keydown.enter");
    expect(wrapper.find('[data-test="nudge-body"]').exists()).toBe(true);
  });

  it("shows '+2 more' and two rows for three actions", async () => {
    const a1 = action({ title: "First", severity: "concern" });
    const a2 = action({ title: "Second", severity: "warn" });
    const a3 = action({ title: "Third", severity: "warn" });
    const wrapper = mount(NudgeSummary, {
      props: { data: resp({ headline: a1, actions: [a1, a2, a3], all_clear: false }) },
    });
    expect(wrapper.text()).toContain("+2 more");
    await wrapper.find('[data-test="nudge-expand"]').trigger("click");
    const rows = wrapper.findAll('[data-test="nudge-body"] li');
    expect(rows.length).toBe(2);
    expect(wrapper.find('[data-test="nudge-body"]').text()).toContain("Second");
    expect(wrapper.find('[data-test="nudge-body"]').text()).toContain("Third");
    expect(wrapper.find('[data-test="nudge-body"]').text()).not.toContain("First");
  });
});
