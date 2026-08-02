import { at, defined } from "@almanac/core/test-support";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { ApiClient } from "../../api/client.js";
import type { TemplateBaseline } from "../../lib/active-workout-types.js";
import { useCalendarStore } from "../../stores/calendar.js";
import { useMacrosRangeStore } from "../../stores/macros-range.js";
import { useRecentWorkoutsStore } from "../../stores/recent-workouts.js";
import { useTemplateLastSessionsStore } from "../../stores/template-last-sessions.js";
import { useTemplatesStore } from "../../stores/templates.js";
import { useTodayStore } from "../../stores/today.js";
import { useWorkoutStore } from "../../stores/workout.js";
import ActiveView from "./ActiveView.vue";

const TEST_STARTED_AT = "2026-05-19T13:00:00";

const baseline: TemplateBaseline = {
  template_id: 1,
  template_name: "PUSH A",
  exercises: [
    {
      exercise_id: 10,
      name: "Bench Press",
      group_id: 1,
      display_order: 1,
      planned_sets: 3,
      default_reps: 8,
      default_weight_kg: 80,
    },
  ],
};

function makeClient(): ApiClient {
  const fetchImpl = vi.fn(async () => new Response("not mocked", { status: 500 }));
  return new ApiClient({ baseUrl: "/api", fetchImpl });
}

// Stub the heavy child components — this test only cares about the banner.
const childStubs = {
  SessionHeader: true,
  ExerciseCard: true,
  AddExerciseButton: true,
  SessionFooter: true,
  EndSessionDialog: true,
};

describe("ActiveView — pending_template_patch banner", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("renders the green banner when pending_template_patch is set", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);
    defined(store.active, "store.active").pending_template_patch = { workout_id: 42 };

    const wrapper = mount(ActiveView, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
    });

    const banner = wrapper.find('[data-test="pending-template-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("Workout saved.");
    expect(banner.attributes("role")).toBe("status");
  });

  it("does not render the banner in the normal session state", () => {
    const store = useWorkoutStore();
    store.startSession(baseline, TEST_STARTED_AT);

    const wrapper = mount(ActiveView, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
    });

    expect(wrapper.find('[data-test="pending-template-banner"]').exists()).toBe(false);
  });
});

describe("ActiveView — live completedCount", () => {
  const twoExerciseBaseline: TemplateBaseline = {
    template_id: 1,
    template_name: "PUSH A",
    exercises: [
      {
        exercise_id: 10,
        name: "Bench Press",
        group_id: 1,
        display_order: 1,
        planned_sets: 3,
        default_reps: 8,
        default_weight_kg: 80,
      },
      {
        exercise_id: 11,
        name: "Overhead Press",
        group_id: 1,
        display_order: 2,
        planned_sets: 3,
        default_reps: 8,
        default_weight_kg: 50,
      },
    ],
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("untick correctly decrements completedCount", async () => {
    const store = useWorkoutStore();
    store.startSession(twoExerciseBaseline, TEST_STARTED_AT);

    const wrapper = mount(ActiveView, {
      props: { client: makeClient() },
      global: {
        stubs: {
          ExerciseCard: true,
          AddExerciseButton: true,
          SessionFooter: true,
          EndSessionDialog: true,
        },
      },
    });

    const firstClientId = at(defined(store.active, "store.active").exercises, 0).client_id;
    store.tickSet(firstClientId, 1);
    await nextTick();
    expect(wrapper.text()).toContain("1 of 2 exercises done");

    store.untickSet(firstClientId, 1);
    await nextTick();
    expect(wrapper.text()).toContain("0 of 2 exercises done");
  });

  it("re-renders SessionHeader as sets get ticked via the UI", async () => {
    const store = useWorkoutStore();
    store.startSession(twoExerciseBaseline, TEST_STARTED_AT);

    // Mount with all child components real to mirror the user click flow.
    const wrapper = mount(ActiveView, {
      props: { client: makeClient() },
      global: {
        stubs: {
          AddExerciseButton: true,
          SessionFooter: true,
          EndSessionDialog: true,
        },
      },
    });

    expect(wrapper.text()).toContain("0 of 2 exercises done");

    // Click the first set's check button (same path as the user).
    const checks = wrapper.findAll('[data-test="set-check"]');
    expect(checks.length).toBeGreaterThan(0);
    await at(checks, 0).trigger("click");
    await nextTick();

    expect(wrapper.text()).toContain("1 of 2 exercises done");
  });

  it("re-renders SessionHeader as sets get ticked", async () => {
    const store = useWorkoutStore();
    store.startSession(twoExerciseBaseline, TEST_STARTED_AT);

    // Use the real SessionHeader so we exercise the render path, not just
    // prop bindings — the user-visible bug was on the rendered text.
    const wrapper = mount(ActiveView, {
      props: { client: makeClient() },
      global: {
        stubs: {
          ExerciseCard: true,
          AddExerciseButton: true,
          SessionFooter: true,
          EndSessionDialog: true,
        },
      },
    });

    // Initial state: 0 of 2.
    expect(wrapper.text()).toContain("0 of 2 exercises done");

    // Tick a set on the first exercise.
    const firstClientId = at(defined(store.active, "store.active").exercises, 0).client_id;
    store.tickSet(firstClientId, 1);
    await nextTick();

    expect(wrapper.text()).toContain("1 of 2 exercises done");

    // Tick a set on the second exercise — should now report 2 of 2.
    const secondClientId = at(defined(store.active, "store.active").exercises, 1).client_id;
    store.tickSet(secondClientId, 1);
    await nextTick();

    expect(wrapper.text()).toContain("2 of 2 exercises done");
  });

  it("SessionHeader cancel emit clears active session", async () => {
    const store = useWorkoutStore();
    store.startSession(twoExerciseBaseline, TEST_STARTED_AT);
    expect(store.hasActiveSession).toBe(true);

    // Use the real SessionHeader so we exercise the inline-confirm flow end-to-end.
    const wrapper = mount(ActiveView, {
      props: { client: makeClient() },
      global: {
        stubs: {
          ExerciseCard: true,
          AddExerciseButton: true,
          SessionFooter: true,
          EndSessionDialog: true,
        },
      },
    });

    await wrapper.find('[data-test="cancel-session"]').trigger("click");
    await wrapper.find('[data-test="cancel-discard"]').trigger("click");
    await nextTick();

    expect(store.hasActiveSession).toBe(false);
    expect(store.active).toBeNull();
  });

  it("re-renders SessionHeader totalCount when an exercise is added mid-session", async () => {
    const store = useWorkoutStore();
    store.startSession(twoExerciseBaseline, TEST_STARTED_AT);

    // Use the real SessionHeader so we exercise the render path — the
    // user-visible bug would be on the rendered "X of M" text.
    const wrapper = mount(ActiveView, {
      props: { client: makeClient() },
      global: {
        stubs: {
          ExerciseCard: true,
          AddExerciseButton: true,
          SessionFooter: true,
          EndSessionDialog: true,
        },
      },
    });

    // Initial state: 0 of 2.
    expect(wrapper.text()).toContain("0 of 2 exercises done");

    // Simulate "+ Add exercise" by calling the store action directly.
    store.addExercise({ exercise_id: 99, name: "Cable Crossover", group_id: 1 });
    await nextTick();

    // The "M" in "X of M" must reactively bump from 2 to 3.
    expect(wrapper.text()).toContain("0 of 3 exercises done");
  });
});

describe("ActiveView — end-session always opens the dialog", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("opens the EndSessionDialog even when the workout has no divergences", async () => {
    const workoutStore = useWorkoutStore();
    workoutStore.startSession(baseline, TEST_STARTED_AT);

    // Spy so we can prove the OLD short-circuit (calling endSession directly
    // without the dialog) no longer happens for a non-divergent workout.
    const endSessionSpy = vi
      .spyOn(workoutStore, "endSession")
      .mockResolvedValue({ status: "submitted", workout_id: 1 });

    const wrapper = mount(ActiveView, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
    });

    // No sets ticked, no edits → zero divergences. Ending the session must
    // still surface the dialog (so the user can confirm/adjust duration),
    // NOT submit straight through.
    await wrapper.findComponent({ name: "SessionFooter" }).vm.$emit("end-session");
    await nextTick();

    expect(wrapper.findComponent({ name: "EndSessionDialog" }).exists()).toBe(true);
    // The short-circuit is gone: nothing is submitted until the user confirms.
    expect(endSessionSpy).not.toHaveBeenCalled();
  });
});

describe("ActiveView — post-submit cache refresh", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("calls recentStore.reload, lastSessionsStore.reloadForTemplate, templatesStore.reload, todayStore.reload, and calendarStore.reloadForMonth after a submitted end-session", async () => {
    const workoutStore = useWorkoutStore();
    workoutStore.startSession(baseline, TEST_STARTED_AT);
    // Tick a set so the body has at least one set when submitted — not
    // strictly necessary because we're stubbing endSession, but keeps the
    // active session shape realistic.
    const firstClientId = at(
      defined(workoutStore.active, "workoutStore.active").exercises,
      0,
    ).client_id;
    workoutStore.tickSet(firstClientId, 1);

    const recentStore = useRecentWorkoutsStore();
    const lastSessionsStore = useTemplateLastSessionsStore();
    const templatesStore = useTemplatesStore();
    const todayStore = useTodayStore();
    const calendarStore = useCalendarStore();
    const macrosStore = useMacrosRangeStore();
    const recentReloadSpy = vi.spyOn(recentStore, "reload").mockResolvedValue(undefined);
    const lastSessReloadSpy = vi
      .spyOn(lastSessionsStore, "reloadForTemplate")
      .mockResolvedValue(undefined);
    const templatesReloadSpy = vi.spyOn(templatesStore, "reload").mockResolvedValue(undefined);
    const todayReloadSpy = vi.spyOn(todayStore, "reload").mockResolvedValue(undefined);
    const calendarReloadSpy = vi
      .spyOn(calendarStore, "reloadForMonth")
      .mockResolvedValue(undefined);
    const macrosReloadSpy = vi.spyOn(macrosStore, "reload").mockResolvedValue(undefined);

    // Stub the workout store's endSession so we don't have to mock the full
    // HTTP chain — the cache-refresh logic in runEnd only cares about the
    // returned status.
    vi.spyOn(workoutStore, "endSession").mockImplementation(async () => {
      // Mirror the real store: on submitted, active is cleared.
      workoutStore.active = null;
      return { status: "submitted", workout_id: 999 };
    });

    const wrapper = mount(ActiveView, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
    });

    // Emit end-session from the (stubbed) SessionFooter. The end-workout
    // dialog now ALWAYS opens (even with no divergences), so the submit
    // happens when the user confirms — drive that by emitting the dialog's
    // `confirm` with a chosen duration.
    await wrapper.findComponent({ name: "SessionFooter" }).vm.$emit("end-session");
    await nextTick();
    await wrapper
      .findComponent({ name: "EndSessionDialog" })
      .vm.$emit("confirm", { saveChoice: "none", duration_min: 42 });
    await nextTick();
    // The mocked endSession is async; let microtasks settle.
    await Promise.resolve();
    await nextTick();

    expect(recentReloadSpy).toHaveBeenCalledTimes(1);
    expect(lastSessReloadSpy).toHaveBeenCalledTimes(1);
    // template_id from the baseline (= 1), plus the lookup callback.
    expect(lastSessReloadSpy).toHaveBeenCalledWith(expect.anything(), 1, expect.any(Function));
    // Recommendation depends on history — refresh it too.
    expect(templatesReloadSpy).toHaveBeenCalledTimes(1);
    // today context (activity-adjusted kcal, week-to-date) depends on the
    // just-completed workout — refresh it too (added in e315091).
    expect(todayReloadSpy).toHaveBeenCalledTimes(1);
    // calendar's past-session chips depend on the just-completed workout —
    // refresh the current month so the chip appears without a hard reload.
    expect(calendarReloadSpy).toHaveBeenCalledTimes(1);
    // Month is YYYY-MM derived from "now"; loose match keeps the test
    // independent of the real wall-clock at runtime.
    expect(calendarReloadSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^\d{4}-\d{2}$/),
    );
    // The 6-day summary / week grid's workout-kcal + NET rows come from the
    // macros-range store, not the today payload — a completed workout adds
    // workout_kcal to today's NET, so refresh the range too (7-day window:
    // from-date and to-date are both YYYY-MM-DD).
    expect(macrosReloadSpy).toHaveBeenCalledTimes(1);
    expect(macrosReloadSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("does not refresh caches when endSession returns workout_failed", async () => {
    const workoutStore = useWorkoutStore();
    workoutStore.startSession(baseline, TEST_STARTED_AT);

    const recentStore = useRecentWorkoutsStore();
    const lastSessionsStore = useTemplateLastSessionsStore();
    const templatesStore = useTemplatesStore();
    const todayStore = useTodayStore();
    const calendarStore = useCalendarStore();
    const recentReloadSpy = vi.spyOn(recentStore, "reload").mockResolvedValue(undefined);
    const lastSessReloadSpy = vi
      .spyOn(lastSessionsStore, "reloadForTemplate")
      .mockResolvedValue(undefined);
    const templatesReloadSpy = vi.spyOn(templatesStore, "reload").mockResolvedValue(undefined);
    const todayReloadSpy = vi.spyOn(todayStore, "reload").mockResolvedValue(undefined);
    const calendarReloadSpy = vi
      .spyOn(calendarStore, "reloadForMonth")
      .mockResolvedValue(undefined);

    vi.spyOn(workoutStore, "endSession").mockImplementation(async () => ({
      status: "workout_failed",
      error: { kind: "network", cause: new Error("boom") },
    }));

    const wrapper = mount(ActiveView, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
    });

    await wrapper.findComponent({ name: "SessionFooter" }).vm.$emit("end-session");
    await nextTick();
    await wrapper
      .findComponent({ name: "EndSessionDialog" })
      .vm.$emit("confirm", { saveChoice: "none", duration_min: 42 });
    await nextTick();
    await Promise.resolve();
    await nextTick();

    // Cache refresh must NOT fire on failure — the IdleView won't be shown.
    expect(recentReloadSpy).not.toHaveBeenCalled();
    expect(lastSessReloadSpy).not.toHaveBeenCalled();
    expect(templatesReloadSpy).not.toHaveBeenCalled();
    expect(todayReloadSpy).not.toHaveBeenCalled();
    expect(calendarReloadSpy).not.toHaveBeenCalled();
  });
});
