import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AchievementHistory from "./AchievementHistory.vue";

const HISTORY = {
  accomplishments: [
    {
      code: "weight_milestone",
      earned_on: "2026-06-06",
      value: 8,
      message: "Down 8 kg from phase start",
      details: {},
      prior_best: { earned_on: "2026-05-28", value: 7 },
    },
    {
      code: "weigh_in_streak",
      earned_on: "2026-05-30",
      value: 14,
      message: "14-day weigh-in streak",
      details: {},
      prior_best: null,
    },
  ],
  aggregates: {
    total: 2,
    by_type: {
      weigh_in_streak: 1,
      workout_consistency: 0,
      target_adherence_streak: 0,
      weight_milestone: 1,
      tdee_measured: 0,
      strength_pr: 0,
      phase_complete: 0,
      phase_halfway: 0,
    },
    best_by_type: {
      weigh_in_streak: { value: 14, earned_on: "2026-05-30" },
      workout_consistency: null,
      target_adherence_streak: null,
      weight_milestone: { value: 8, earned_on: "2026-06-06" },
      tdee_measured: null,
      strength_pr: null,
      phase_complete: null,
      phase_halfway: null,
    },
  },
};

function makeClient(payload = HISTORY) {
  return { get: vi.fn().mockResolvedValue(payload) } as never;
}

describe("AchievementHistory", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("groups wins by month, newest first, with a summary strip", async () => {
    const wrapper = mount(AchievementHistory, { props: { client: makeClient() } });
    await flushPromises();
    const headers = wrapper.findAll('[data-test="month-header"]').map((h) => h.text());
    expect(headers).toEqual(["June 2026", "May 2026"]);
    expect(wrapper.find('[data-test="agg-total"]').text()).toContain("2");
    expect(wrapper.text()).toContain("prev best 7");
  });

  it("emits close when the close button is clicked", async () => {
    const wrapper = mount(AchievementHistory, { props: { client: makeClient() } });
    await flushPromises();
    await wrapper.find('[data-test="history-close"]').trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("emits close on Escape key", async () => {
    const wrapper = mount(AchievementHistory, {
      props: { client: makeClient() },
      attachTo: document.body,
    });
    await flushPromises();
    await wrapper.find('[data-test="history-panel"]').trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });

  it("is a labelled modal dialog", async () => {
    const wrapper = mount(AchievementHistory, { props: { client: makeClient() } });
    await flushPromises();
    const panel = wrapper.find('[data-test="history-panel"]');
    expect(panel.attributes("role")).toBe("dialog");
    expect(panel.attributes("aria-modal")).toBe("true");
    expect(panel.attributes("aria-labelledby")).toBe("achievement-history-title");
  });

  it("shows an empty state when there are no wins", async () => {
    const wrapper = mount(AchievementHistory, {
      props: { client: makeClient({ accomplishments: [], aggregates: HISTORY.aggregates }) },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("No wins yet");
  });

  it("labels the prior_best and 'most down' tile in kg by default (metric)", async () => {
    const wrapper = mount(AchievementHistory, { props: { client: makeClient() } });
    await flushPromises();
    // weight_milestone prior_best value 7 kg → labeled kg.
    expect(wrapper.text()).toContain("prev best 7 kg");
    // 'most down' aggregate tile shows the weight_milestone best (8) in kg.
    expect(wrapper.text()).toContain("8kg");
  });

  it("converts prior_best and 'most down' tile to lb for an imperial user", async () => {
    const wrapper = mount(AchievementHistory, {
      props: { client: makeClient(), unitSystem: "imperial" },
    });
    await flushPromises();
    // 7 kg * 2.20462262 = 15.43… → 15.4 lb
    expect(wrapper.text()).toContain("prev best 15.4 lb");
    // 8 kg * 2.20462262 = 17.63… → 17.6 lb
    expect(wrapper.text()).toContain("17.6lb");
    expect(wrapper.text()).not.toContain("8kg");
  });
});
