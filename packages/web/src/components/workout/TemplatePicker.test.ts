import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { TemplateLastSessionEntry } from "../../stores/template-last-sessions.js";
import TemplatePicker from "./TemplatePicker.vue";

const templates = [
  { id: 1, name: "PUSH A" },
  { id: 2, name: "PULL A" },
  { id: 3, name: "LEGS A" },
];

// Default prop bag — chevron suppressed everywhere (lastSessionDates[id]
// === null hides it). Individual tests override what they care about.
const baseProps = {
  templates,
  recommendedId: null as number | null,
  lastSessionTemplateId: null as number | null,
  lastSessionDates: { 1: null, 2: null, 3: null } as Record<number, string | null>,
  expandedTemplateId: null as number | null,
  lastSessionEntries: {} as Record<number, TemplateLastSessionEntry>,
  unitSystem: "metric" as const,
};

describe("TemplatePicker", () => {
  it("renders all templates", () => {
    const wrapper = mount(TemplatePicker, { props: baseProps });
    expect(wrapper.findAll('[data-test="template-row"]')).toHaveLength(3);
  });

  it("marks the recommended template with the recommended badge", () => {
    const wrapper = mount(TemplatePicker, {
      props: { ...baseProps, recommendedId: 2 },
    });
    const recommendedRow = wrapper.find('[data-test="template-row"][data-recommended="true"]');
    expect(recommendedRow.exists()).toBe(true);
    expect(recommendedRow.text()).toContain("PULL A");
    expect(recommendedRow.text().toLowerCase()).toContain("recommended");
  });

  it("does not mark any row as recommended when recommendedId is null", () => {
    const wrapper = mount(TemplatePicker, { props: baseProps });
    const recommendedRows = wrapper.findAll('[data-test="template-row"][data-recommended="true"]');
    expect(recommendedRows).toHaveLength(0);
  });

  it("marks the last-session template with the 'last session' badge", () => {
    const wrapper = mount(TemplatePicker, {
      props: { ...baseProps, lastSessionTemplateId: 3 },
    });
    const rows = wrapper.findAll('[data-test="template-row"]');
    // Only the row whose id matches lastSessionTemplateId should carry
    // the badge — other rows must stay clean.
    const matched = rows.find((r) => r.text().includes("LEGS A"));
    expect(matched).toBeDefined();
    expect(matched?.text().toLowerCase()).toContain("last session");
    const others = rows.filter((r) => !r.text().includes("LEGS A"));
    for (const other of others) {
      expect(other.text().toLowerCase()).not.toContain("last session");
    }
  });

  it("suppresses the 'last session' badge when the row is also the recommended one", () => {
    const wrapper = mount(TemplatePicker, {
      // Same id for both — the recommended badge must win on overlap and
      // the "last session" badge must not also render.
      props: { ...baseProps, recommendedId: 2, lastSessionTemplateId: 2 },
    });
    const recommendedRow = wrapper.find('[data-test="template-row"][data-recommended="true"]');
    expect(recommendedRow.exists()).toBe(true);
    expect(recommendedRow.text().toLowerCase()).toContain("recommended");
    expect(recommendedRow.text().toLowerCase()).not.toContain("last session");
  });

  it("emits select(id) when a row is clicked", async () => {
    const wrapper = mount(TemplatePicker, {
      props: { ...baseProps, recommendedId: 2 },
    });
    const rows = wrapper.findAll('[data-test="template-row"]');
    const firstRow = rows[0];
    if (!firstRow) throw new Error("expected at least one template row");
    // The row's clickable surface is the `.row` div, not the <li> wrapper.
    await firstRow.find(".row").trigger("click");
    expect(wrapper.emitted("select")).toEqual([[1]]);
  });

  // Build an ISO date `daysAgo` days before now. Used to get predictable
  // relative-date labels regardless of when the test runs.
  function isoDaysAgo(daysAgo: number): string {
    return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  }

  it("renders a chevron only for templates whose lastSessionDates entry is not null", () => {
    const wrapper = mount(TemplatePicker, {
      props: {
        ...baseProps,
        // PUSH A has a date, PULL A has no history (null hides chevron),
        // LEGS A hasn't been fetched yet ("?" still shows chevron without
        // a date label).
        lastSessionDates: {
          1: isoDaysAgo(2),
          2: null,
          3: "?",
        },
      },
    });
    const chevrons = wrapper.findAll('[data-test="last-session-chevron"]');
    expect(chevrons).toHaveLength(2);
  });

  it("shows a relative date label for templates with a known last session", () => {
    const wrapper = mount(TemplatePicker, {
      props: {
        ...baseProps,
        lastSessionDates: {
          1: isoDaysAgo(2),
          2: null,
          3: null,
        },
      },
    });
    const chevron = wrapper.find('[data-test="last-session-chevron"]');
    expect(chevron.text()).toContain("2 days ago");
  });

  it("sets a full date+time tooltip on the row for real dates", () => {
    const wrapper = mount(TemplatePicker, {
      props: {
        ...baseProps,
        lastSessionDates: {
          1: isoDaysAgo(2),
          2: null,
          3: null,
        },
      },
    });
    // Tooltip lives on the row container so hovering the name, the badge,
    // or the chevron all surface the same native tooltip.
    const row = wrapper.find(".row");
    const title = row.attributes("title");
    expect(title).toBeDefined();
    // Tooltip is the long-form date with year + "at" + time.
    expect(title).toMatch(/\d{4}/);
    expect(title).toMatch(/at/);
  });

  it("omits the tooltip when the last session date is still the '?' sentinel", () => {
    const wrapper = mount(TemplatePicker, {
      props: {
        ...baseProps,
        lastSessionDates: {
          1: "?",
          2: null,
          3: null,
        },
      },
    });
    const chevron = wrapper.find('[data-test="last-session-chevron"]');
    expect(chevron.exists()).toBe(true);
    // Vue renders an undefined `:title` as no attribute at all — both the
    // chevron and the row container should be tooltip-free.
    expect(chevron.attributes("title")).toBeUndefined();
    const row = wrapper.find(".row");
    expect(row.attributes("title")).toBeUndefined();
  });

  it("emits toggleLastSession(id) but NOT select on chevron click", async () => {
    const wrapper = mount(TemplatePicker, {
      props: {
        ...baseProps,
        lastSessionDates: {
          1: isoDaysAgo(2),
          2: null,
          3: null,
        },
      },
    });
    const chevron = wrapper.find('[data-test="last-session-chevron"]');
    expect(chevron.exists()).toBe(true);
    await chevron.trigger("click");
    expect(wrapper.emitted("toggleLastSession")).toEqual([[1]]);
    // Chevron click must NOT bubble into the row's select handler.
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("renders the LastSessionPanel only for the expanded template", () => {
    const readyEntry: TemplateLastSessionEntry = {
      status: "ready",
      data: {
        workout_id: 100,
        started_at: isoDaysAgo(2),
        rpe: 7,
        exercises: [
          {
            exercise_id: 1,
            exercise_name: "Bench Press",
            skipped: false,
            sets: [{ reps: 8, weight_kg: 80 }],
          },
        ],
      },
    };
    const wrapper = mount(TemplatePicker, {
      props: {
        ...baseProps,
        lastSessionDates: {
          1: isoDaysAgo(2),
          2: isoDaysAgo(4),
          3: null,
        },
        expandedTemplateId: 1,
        lastSessionEntries: { 1: readyEntry },
      },
    });
    const panels = wrapper.findAll('[data-test="last-session-panel"]');
    expect(panels).toHaveLength(1);
    expect(panels[0]?.text()).toContain("Bench Press");
  });
});
