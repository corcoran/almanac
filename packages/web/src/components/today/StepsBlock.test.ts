import { at } from "@almanac/core/test-support";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../../api/client.js";
import StepsBlock from "./StepsBlock.vue";

type StepsTarget = {
  on_date: string;
  log: { id: number; count: number; est_kcal: number | null } | null;
};
type Call = { method: string; path: string; body?: unknown };

const windowDates = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
const logs = [
  { id: 1, on_date: "2026-10-02", steps: 5000 },
  { id: 2, on_date: "2026-10-03", steps: 10000 },
  { id: 3, on_date: "2026-10-05", steps: 9412 },
];
const LOGGED: StepsTarget = { on_date: "2026-10-05", log: { id: 3, count: 9412, est_kcal: 312 } };
const UNLOGGED: StepsTarget = { on_date: "2026-10-05", log: null };

function makeClient(calls: Call[] = [], fail = false): ApiClient {
  return {
    post: async (path: string, body: unknown) => {
      if (fail) throw new Error("nope");
      calls.push({ method: "POST", path, body });
      return {
        id: 5,
        user_id: 1,
        on_date: "2026-10-05",
        steps: 9000,
        est_kcal: 300,
        source: "manual",
        notes: null,
        created_at: "2026-10-06T08:00:00Z",
      };
    },
    get: async () => [],
    delete: async (path: string) => {
      calls.push({ method: "DELETE", path });
      return undefined;
    },
  } as unknown as ApiClient;
}

const BASE = () => ({
  stepsTarget: LOGGED,
  logs,
  windowDates,
  client: makeClient(),
});

describe("StepsBlock", () => {
  it("has a Steps caption", () => {
    const wrapper = mount(StepsBlock, { props: BASE() });
    expect(wrapper.find('[data-test="steps-caption"]').text()).toBe("Steps");
  });

  it("labels the row 'Yesterday' and shows count + kcal", () => {
    const row = mount(StepsBlock, { props: BASE() }).find('[data-test="steps-row"]');
    expect(row.text()).toContain("Yesterday");
    expect(row.text()).toContain("9,412");
    expect(row.text()).toContain("312 kcal");
  });

  it("shows — for kcal when the estimate is cleared", () => {
    const wrapper = mount(StepsBlock, {
      props: {
        ...BASE(),
        stepsTarget: { on_date: "2026-10-05", log: { id: 3, count: 9412, est_kcal: null } },
      },
    });
    expect(wrapper.find('[data-test="steps-row"]').text()).toContain("—");
  });

  it("shows '— not logged' when the target day is unlogged", () => {
    const wrapper = mount(StepsBlock, { props: { ...BASE(), stepsTarget: UNLOGGED } });
    expect(wrapper.find('[data-test="steps-row"]').text()).toContain("— not logged");
  });

  it("labels the row with the target's short date on a past day", () => {
    const wrapper = mount(StepsBlock, {
      props: { ...BASE(), isPastDay: true, stepsTarget: { on_date: "2026-10-03", log: null } },
    });
    const label = wrapper.find('[data-test="steps-row"] .label').text();
    expect(label).not.toBe("Yesterday");
    expect(label).toContain("Sat");
    expect(label).toContain("3");
  });

  it("shows the window average of logged days", () => {
    const wrapper = mount(StepsBlock, { props: BASE() });
    expect(wrapper.find('[data-test="steps-avg"]').text()).toBe("avg 8,137 / 4d");
  });

  it("hides the average when nothing in the window is logged", () => {
    const wrapper = mount(StepsBlock, { props: { ...BASE(), logs: [] } });
    expect(wrapper.find('[data-test="steps-avg"]').exists()).toBe(false);
  });

  it("renders a bar per logged day, a ghost per gap, and marks the target bar", () => {
    const wrapper = mount(StepsBlock, { props: BASE() });
    const bars = wrapper.findAll('[data-test="steps-bar"]');
    expect(bars).toHaveLength(3);
    expect(wrapper.findAll('[data-test="steps-ghost"]')).toHaveLength(1);
    expect(at(bars, 1).text()).toContain("10k");
    expect(at(bars, 2).classes()).toContain("target");
    expect(at(bars, 0).classes()).not.toContain("target");
  });

  it("saves to stepsTarget.on_date and emits saved", async () => {
    const calls: Call[] = [];
    const wrapper = mount(StepsBlock, {
      props: { ...BASE(), stepsTarget: UNLOGGED, client: makeClient(calls) },
    });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    await wrapper.find('[data-test="steps-edit-input"]').setValue("9000");
    await wrapper.find('[data-test="steps-edit-save"]').trigger("click");
    await flushPromises();
    expect(calls).toEqual([
      { method: "POST", path: "/v1/step-logs", body: { on_date: "2026-10-05", steps: 9000 } },
    ]);
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });

  it("prefills the input with the logged count", async () => {
    const wrapper = mount(StepsBlock, { props: BASE() });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    expect((wrapper.find('[data-test="steps-edit-input"]').element as HTMLInputElement).value).toBe(
      "9412",
    );
  });

  it("disables save for empty, zero, or non-integer input", async () => {
    const wrapper = mount(StepsBlock, { props: { ...BASE(), stepsTarget: UNLOGGED } });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    const input = wrapper.find('[data-test="steps-edit-input"]');
    const save = wrapper.find('[data-test="steps-edit-save"]');
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    for (const bad of ["12abc", "-5", "0"]) {
      await input.setValue(bad);
      expect((save.element as HTMLButtonElement).disabled).toBe(true);
    }
    await input.setValue("7500");
    expect((save.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("Delete asks to confirm; Yes deletes, No backs out; no Delete when unlogged", async () => {
    const calls: Call[] = [];
    const wrapper = mount(StepsBlock, { props: { ...BASE(), client: makeClient(calls) } });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    await wrapper.find('[data-test="steps-edit-delete"]').trigger("click");
    await wrapper.find('[data-test="steps-delete-no"]').trigger("click");
    expect(calls).toHaveLength(0);
    await wrapper.find('[data-test="steps-edit-delete"]').trigger("click");
    await wrapper.find('[data-test="steps-delete-yes"]').trigger("click");
    await flushPromises();
    expect(calls).toEqual([{ method: "DELETE", path: "/v1/step-logs/3" }]);
    expect(wrapper.emitted("saved")).toHaveLength(1);

    const unlogged = mount(StepsBlock, { props: { ...BASE(), stepsTarget: UNLOGGED } });
    await unlogged.find('[data-test="block-edit"]').trigger("click");
    expect(unlogged.find('[data-test="steps-edit-delete"]').exists()).toBe(false);
  });

  it("clicking a logged bar edits that day: prefilled, dated label, saves to it", async () => {
    const calls: Call[] = [];
    const wrapper = mount(StepsBlock, { props: { ...BASE(), client: makeClient(calls) } });
    await at(wrapper.findAll('[data-test="steps-bar"]'), 0).trigger("click");
    const input = wrapper.find('[data-test="steps-edit-input"]');
    expect((input.element as HTMLInputElement).value).toBe("5000");
    expect(wrapper.find('[data-test="steps-row"] .label').text()).toContain("2");
    expect(wrapper.find('[data-test="steps-row"] .label').text()).not.toBe("Yesterday");
    expect(at(wrapper.findAll('[data-test="steps-bar"]'), 0).classes()).toContain("editing");
    await input.setValue("5200");
    await wrapper.find('[data-test="steps-edit-save"]').trigger("click");
    await flushPromises();
    expect(calls).toEqual([
      { method: "POST", path: "/v1/step-logs", body: { on_date: "2026-10-02", steps: 5200 } },
    ]);
  });

  it("deletes the clicked day's log, not the target's", async () => {
    const calls: Call[] = [];
    const wrapper = mount(StepsBlock, { props: { ...BASE(), client: makeClient(calls) } });
    await at(wrapper.findAll('[data-test="steps-bar"]'), 1).trigger("click");
    await wrapper.find('[data-test="steps-edit-delete"]').trigger("click");
    await wrapper.find('[data-test="steps-delete-yes"]').trigger("click");
    await flushPromises();
    expect(calls).toEqual([{ method: "DELETE", path: "/v1/step-logs/2" }]);
  });

  it("clicking a ghost opens an empty editor for that day", async () => {
    const wrapper = mount(StepsBlock, { props: BASE() });
    await at(wrapper.findAll('[data-test="steps-ghost"]'), 0).trigger("click");
    expect((wrapper.find('[data-test="steps-edit-input"]').element as HTMLInputElement).value).toBe(
      "",
    );
    expect(wrapper.find('[data-test="steps-row"] .label').text()).toContain("4");
    expect(wrapper.find('[data-test="steps-edit-delete"]').exists()).toBe(false);
  });

  it("ignores bar clicks while an edit is open", async () => {
    const wrapper = mount(StepsBlock, { props: BASE() });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    await at(wrapper.findAll('[data-test="steps-bar"]'), 0).trigger("click");
    expect(wrapper.find('[data-test="steps-row"] .label').text()).toBe("Yesterday");
  });

  it("bars are labelled buttons", () => {
    const wrapper = mount(StepsBlock, { props: BASE() });
    const bar = at(wrapper.findAll('[data-test="steps-bar"]'), 0);
    expect(bar.element.tagName).toBe("BUTTON");
    expect(bar.attributes("aria-label")).toContain("Edit steps for");
  });

  it("shows an error and stays editing when save fails", async () => {
    const wrapper = mount(StepsBlock, {
      props: { ...BASE(), stepsTarget: UNLOGGED, client: makeClient([], true) },
    });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    await wrapper.find('[data-test="steps-edit-input"]').setValue("9000");
    await wrapper.find('[data-test="steps-edit-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("saved")).toBeUndefined();
    expect(wrapper.find('[data-test="steps-edit-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="steps-edit-input"]').exists()).toBe(true);
  });

  it("cancel closes the editor without a request", async () => {
    const calls: Call[] = [];
    const wrapper = mount(StepsBlock, { props: { ...BASE(), client: makeClient(calls) } });
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    await wrapper.find('[data-test="steps-edit-cancel"]').trigger("click");
    expect(wrapper.find('[data-test="steps-edit-input"]').exists()).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
