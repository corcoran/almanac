import { at } from "@almanac/core/test-support";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Divergence } from "../../lib/divergence-diff.js";
import EndSessionDialog from "./EndSessionDialog.vue";

const sampleDivergences: Divergence[] = [
  {
    kind: "set_changes",
    exercise_id: 10,
    exercise_name: "Bench press",
    new_default_reps: 5,
    new_default_weight_kg: 100,
  },
  {
    kind: "added_sets",
    exercise_id: 11,
    exercise_name: "Overhead press",
    old_planned_sets: 3,
    new_planned_sets: 4,
  },
  {
    kind: "added_exercise",
    exercise_id: 20,
    name: "Cable curl",
    group_id: 2,
    display_order: 4,
    planned_sets: 3,
    default_reps: 12,
    default_weight_kg: 15,
  },
];

// Mount-time clock is pinned so the seeded duration is deterministic:
// startedAt is FROZEN_NOW minus SEED_MINUTES, so the input pre-fills with
// exactly SEED_MINUTES. Individual tests can override startedAt to exercise
// edge cases (overnight tab, clock skew, etc.).
const FROZEN_NOW = new Date("2026-05-24T18:00:00.000Z");
const SEED_MINUTES = 47;
const DEFAULT_STARTED_AT = new Date(FROZEN_NOW.getTime() - SEED_MINUTES * 60_000).toISOString();

describe("EndSessionDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("'Save all' emits confirm with saveChoice 'all' and seeded duration_min", async () => {
    const wrapper = mount(EndSessionDialog, {
      props: { divergences: sampleDivergences, startedAt: DEFAULT_STARTED_AT },
    });
    await wrapper.find('[data-test="save-all"]').trigger("click");
    expect(wrapper.emitted("confirm")).toEqual([
      [{ saveChoice: "all", duration_min: SEED_MINUTES }],
    ]);
  });

  it("'Pick which to save' reveals checkboxes; selecting a subset emits selected with right ids", async () => {
    const wrapper = mount(EndSessionDialog, {
      props: { divergences: sampleDivergences, startedAt: DEFAULT_STARTED_AT },
    });
    await wrapper.find('[data-test="pick-which"]').trigger("click");

    const checks = wrapper.findAll('[data-test="divergence-check"]');
    expect(checks).toHaveLength(3);

    // Tick the first two (exercise_ids 10 and 11).
    await at(checks, 0).setValue(true);
    await at(checks, 1).setValue(true);

    await wrapper.find('[data-test="save-selected"]').trigger("click");
    expect(wrapper.emitted("confirm")).toEqual([
      [
        {
          saveChoice: "selected",
          selected_ids: [10, 11],
          duration_min: SEED_MINUTES,
        },
      ],
    ]);
  });

  it("'Don't save' emits confirm with saveChoice 'none' and seeded duration_min", async () => {
    const wrapper = mount(EndSessionDialog, {
      props: { divergences: sampleDivergences, startedAt: DEFAULT_STARTED_AT },
    });
    await wrapper.find('[data-test="save-none"]').trigger("click");
    expect(wrapper.emitted("confirm")).toEqual([
      [{ saveChoice: "none", duration_min: SEED_MINUTES }],
    ]);
  });

  it("'Cancel' emits cancel", async () => {
    const wrapper = mount(EndSessionDialog, {
      props: { divergences: sampleDivergences, startedAt: DEFAULT_STARTED_AT },
    });
    await wrapper.find('[data-test="cancel"]').trigger("click");
    expect(wrapper.emitted("cancel")).toEqual([[]]);
  });

  it("empty divergences shows the End-workout confirmation and emits 'none' with duration_min", async () => {
    const wrapper = mount(EndSessionDialog, {
      props: { divergences: [], startedAt: DEFAULT_STARTED_AT },
    });
    // Reads as a general "End workout" confirmation, not a template-centric
    // "submit" prompt — the duration field is the point here.
    expect(wrapper.text().toLowerCase()).toContain("end workout");
    expect(wrapper.find('[data-test="submit-empty"]').text()).toContain("End workout");
    await wrapper.find('[data-test="submit-empty"]').trigger("click");
    expect(wrapper.emitted("confirm")).toEqual([
      [{ saveChoice: "none", duration_min: SEED_MINUTES }],
    ]);
  });

  it("renders with role=dialog and aria-modal=true", () => {
    const wrapper = mount(EndSessionDialog, {
      props: { divergences: [], startedAt: DEFAULT_STARTED_AT },
    });
    const root = wrapper.find('[data-test="end-session-dialog"]');
    expect(root.attributes("role")).toBe("dialog");
    expect(root.attributes("aria-modal")).toBe("true");
    // aria-labelledby points at the title element's id.
    const labelledBy = root.attributes("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(wrapper.find(`#${labelledBy}`).exists()).toBe(true);
  });

  it("Escape key emits cancel", async () => {
    const wrapper = mount(EndSessionDialog, {
      props: { divergences: [], startedAt: DEFAULT_STARTED_AT },
      attachTo: document.body,
    });
    await wrapper.find('[data-test="end-session-dialog"]').trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("cancel")).toBeTruthy();
    wrapper.unmount();
  });

  // ---- duration_min specific ----

  it("pre-fills the duration input with elapsed minutes from startedAt", () => {
    const wrapper = mount(EndSessionDialog, {
      props: { divergences: [], startedAt: DEFAULT_STARTED_AT },
    });
    const input = wrapper.find<HTMLInputElement>('[data-test="duration-min-input"]');
    expect(input.exists()).toBe(true);
    expect(input.element.value).toBe(String(SEED_MINUTES));
  });

  it("seeds at least 1 minute even when started_at is in the same minute as now", () => {
    // Edge case: user starts a session and immediately ends it. Math.round
    // would give 0, but duration_min on the server is positive-int-only
    // (CreateWorkoutBodySchema), so we must clamp to a minimum of 1.
    const wrapper = mount(EndSessionDialog, {
      props: { divergences: [], startedAt: FROZEN_NOW.toISOString() },
    });
    const input = wrapper.find<HTMLInputElement>('[data-test="duration-min-input"]');
    expect(input.element.value).toBe("1");
  });

  it("emits the user-edited duration on confirm, not the seeded value", async () => {
    const wrapper = mount(EndSessionDialog, {
      props: { divergences: [], startedAt: DEFAULT_STARTED_AT },
    });
    const input = wrapper.find<HTMLInputElement>('[data-test="duration-min-input"]');
    // Simulate the user correcting the value (e.g. left the tab open
    // overnight and the seeded number was absurd).
    await input.setValue("60");
    await wrapper.find('[data-test="submit-empty"]').trigger("click");
    expect(wrapper.emitted("confirm")).toEqual([[{ saveChoice: "none", duration_min: 60 }]]);
  });

  // ---- formatKind / human labels ----

  it("renders human-readable labels for all three divergence kinds", () => {
    const wrapper = mount(EndSessionDialog, {
      props: { divergences: sampleDivergences, startedAt: DEFAULT_STARTED_AT },
    });
    const kindSpans = wrapper.findAll(".div-kind");
    const texts = kindSpans.map((s) => s.text());
    expect(texts).toContain("updated");
    expect(texts).toContain("more sets");
    expect(texts).toContain("new exercise");
  });

  it("does not expose raw enum strings in the rendered output", () => {
    const wrapper = mount(EndSessionDialog, {
      props: { divergences: sampleDivergences, startedAt: DEFAULT_STARTED_AT },
    });
    const html = wrapper.html();
    expect(html).not.toContain("set_changes");
    expect(html).not.toContain("added_sets");
    expect(html).not.toContain("added_exercise");
  });

  it("shows divergence weights in kg with a unit label by default (metric)", () => {
    const wrapper = mount(EndSessionDialog, {
      props: { divergences: sampleDivergences, startedAt: DEFAULT_STARTED_AT },
    });
    const text = wrapper.text();
    // set_changes weight 100 kg, added_exercise weight 15 kg — both labeled.
    expect(text).toContain("100 kg");
    expect(text).toContain("15 kg");
  });

  it("converts divergence weights to lb for an imperial user", () => {
    const wrapper = mount(EndSessionDialog, {
      props: {
        divergences: sampleDivergences,
        startedAt: DEFAULT_STARTED_AT,
        unitSystem: "imperial",
      },
    });
    const text = wrapper.text();
    // 100 kg * 2.20462262 = 220.46… → 220.5 lb; 15 kg → 33.069… → 33.1 lb.
    expect(text).toContain("220.5 lb");
    expect(text).toContain("33.1 lb");
    // No raw kg leaking through for imperial.
    expect(text).not.toContain("100 kg");
    expect(text).not.toContain("15 kg");
  });
});
