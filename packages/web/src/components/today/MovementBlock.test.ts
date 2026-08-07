import { at } from "@almanac/core/test-support";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MovementBlock from "./MovementBlock.vue";

type CardioSession = {
  id: number;
  modality: string | null;
  duration_min: number | null;
  est_kcal: number;
};

function makeCardio(overrides: Partial<CardioSession> = {}): CardioSession {
  return {
    id: 1,
    modality: "bike",
    duration_min: 45,
    est_kcal: 320,
    ...overrides,
  };
}

function makeClient(
  overrides: Partial<{
    post: (p: string, b: unknown) => Promise<unknown>;
    patch: (p: string, b: unknown) => Promise<unknown>;
    delete: (p: string) => Promise<unknown>;
  }> = {},
) {
  return {
    post: overrides.post ?? (async () => ({ id: 1 })),
    patch: overrides.patch ?? (async () => ({ id: 1 })),
    delete: overrides.delete ?? (async () => undefined),
    get: async () => [],
    put: async () => ({}),
  } as unknown as import("../../api/client.js").ApiClient;
}

const MB_BASE = () => ({ cardio: [], steps: null, client: makeClient(), date: "2026-06-15" });

describe("MovementBlock", () => {
  it("renders the empty-state message when cardio is []", () => {
    const wrapper = mount(MovementBlock, {
      props: { cardio: [], steps: null, client: makeClient(), date: "2026-06-15" },
    });
    expect(wrapper.find('[data-test="cardio-empty"]').exists()).toBe(true);
    expect(wrapper.text()).toMatch(/no cardio logged today/i);
    expect(wrapper.findAll('[data-test="cardio-row"]')).toHaveLength(0);
  });

  it("renders one row per session with modality, duration, and kcal", () => {
    const wrapper = mount(MovementBlock, {
      props: {
        cardio: [
          makeCardio({ id: 1, modality: "bike", duration_min: 45, est_kcal: 320 }),
          makeCardio({ id: 2, modality: "row", duration_min: 20, est_kcal: 180 }),
        ],
        steps: null,
        client: makeClient(),
        date: "2026-06-15",
      },
    });
    const rows = wrapper.findAll('[data-test="cardio-row"]');
    expect(rows).toHaveLength(2);
    const first = at(rows, 0).text();
    expect(first).toContain("bike");
    expect(first).toContain("45");
    expect(first).toContain("320");
    expect(first).toContain("kcal");
    const second = at(rows, 1).text();
    expect(second).toContain("row");
    expect(second).toContain("20");
    expect(second).toContain("180");
  });

  it("falls back to a placeholder when modality is null", () => {
    const wrapper = mount(MovementBlock, {
      props: {
        cardio: [makeCardio({ modality: null })],
        steps: null,
        client: makeClient(),
        date: "2026-06-15",
      },
    });
    const text = wrapper.find('[data-test="cardio-row"]').text();
    // Either "Cardio" or "(no modality)" or similar — assert it's not blank
    // and doesn't contain literal "null".
    expect(text.toLowerCase()).toMatch(/cardio|modality/);
    expect(text).not.toContain("null");
  });

  it("omits duration gracefully when duration_min is null", () => {
    const wrapper = mount(MovementBlock, {
      props: {
        cardio: [makeCardio({ modality: "bike", duration_min: null, est_kcal: 200 })],
        steps: null,
        client: makeClient(),
        date: "2026-06-15",
      },
    });
    const text = wrapper.find('[data-test="cardio-row"]').text();
    expect(text).toContain("bike");
    expect(text).toContain("200");
    expect(text).not.toContain("null");
    // Either omitted or rendered as a dash; key thing is no "null" leakage
    // and kcal still visible.
  });

  it("captions the block 'Today's Movement'", () => {
    const wrapper = mount(MovementBlock, {
      props: { cardio: [], steps: null, client: makeClient(), date: "2026-06-15" },
    });
    expect(wrapper.find(".caption").text()).toBe("Today's Movement");
    expect(wrapper.find('[data-test="movement-block"]').exists()).toBe(true);
  });

  it("keeps the 'Today's Movement' caption when isPastDay is explicitly false", () => {
    const wrapper = mount(MovementBlock, {
      props: {
        cardio: [],
        steps: null,
        client: makeClient(),
        date: "2026-06-15",
        isPastDay: false,
      },
    });
    expect(wrapper.find(".caption").text()).toBe("Today's Movement");
  });

  it("captions the block 'Movement · <date>' when viewing a past day", () => {
    const wrapper = mount(MovementBlock, {
      props: { cardio: [], steps: null, client: makeClient(), date: "2026-06-10", isPastDay: true },
    });
    const caption = wrapper.find(".caption").text();
    expect(caption).not.toBe("Today's Movement");
    expect(caption.startsWith("Movement · ")).toBe(true);
    expect(caption).toContain("Wed");
    expect(caption).toContain("Jun");
    expect(caption).toContain("10");
  });

  it("renders 'Steps: — not logged' when steps is null", () => {
    const wrapper = mount(MovementBlock, {
      props: { cardio: [], steps: null, client: makeClient(), date: "2026-06-15" },
    });
    const row = wrapper.find('[data-test="steps-row"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain("Steps:");
    expect(row.text()).toMatch(/not logged/i);
    expect(row.text()).not.toMatch(/syncs next day/i);
  });

  it("renders 'Steps: N → K kcal' when steps is populated", () => {
    const wrapper = mount(MovementBlock, {
      props: {
        cardio: [],
        steps: { id: 1, count: 8432, est_kcal: 312 },
        client: makeClient(),
        date: "2026-06-15",
      },
    });
    const row = wrapper.find('[data-test="steps-row"]');
    expect(row.text()).toContain("8,432");
    expect(row.text()).toContain("312");
    expect(row.text()).toContain("kcal");
    expect(row.text()).not.toMatch(/syncs next day/i);
  });

  it("renders an explicit zero-count step log as a real zero (not deferred)", () => {
    const wrapper = mount(MovementBlock, {
      props: {
        cardio: [],
        steps: { id: 1, count: 0, est_kcal: 0 },
        client: makeClient(),
        date: "2026-06-15",
      },
    });
    const row = wrapper.find('[data-test="steps-row"]');
    expect(row.text()).toContain("0");
    expect(row.text()).not.toMatch(/syncs next day/i);
  });

  it("shows the steps footer alongside cardio sessions", () => {
    const wrapper = mount(MovementBlock, {
      props: {
        cardio: [makeCardio({ id: 1, modality: "bike", duration_min: 45, est_kcal: 320 })],
        steps: { id: 1, count: 5000, est_kcal: 200 },
        client: makeClient(),
        date: "2026-06-15",
      },
    });
    expect(wrapper.findAll('[data-test="cardio-row"]')).toHaveLength(1);
    expect(wrapper.find('[data-test="steps-row"]').text()).toContain("5,000");
  });

  it("localizes a large steps est_kcal with grouping", () => {
    const wrapper = mount(MovementBlock, {
      props: {
        cardio: [],
        steps: { id: 1, count: 20000, est_kcal: 1234 },
        client: makeClient(),
        date: "2026-06-15",
      },
    });
    expect(wrapper.find('[data-test="steps-row"]').text()).toContain("1,234");
  });
});

describe("MovementBlock cardio CRUD", () => {
  it("clicking '+ Add cardio' shows a blank add form", async () => {
    const wrapper = mount(MovementBlock, { props: MB_BASE() });
    expect(wrapper.find('[data-test="cardio-add-form"]').exists()).toBe(false);
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    expect(wrapper.find('[data-test="cardio-add-form"]').exists()).toBe(true);
    expect((wrapper.find('[data-test="cardio-add-kcal"]').element as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("add POSTs started_at (date prop) + fields and emits changed", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = makeClient({
      post: async (path, body) => {
        calls.push({ path, body });
        return { id: 9 };
      },
    });
    const wrapper = mount(MovementBlock, { props: { ...MB_BASE(), client, date: "2026-06-15" } });
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    await wrapper.find('[data-test="cardio-add-modality"]').setValue("swim");
    await wrapper.find('[data-test="cardio-add-duration"]').setValue("30");
    await wrapper.find('[data-test="cardio-add-kcal"]').setValue("250");
    await wrapper.find('[data-test="cardio-add-save"]').trigger("click");
    await flushPromises();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/v1/cardio-sessions");
    const body = calls[0]?.body as {
      started_at: string;
      modality: string | null;
      duration_min: number | null;
      est_kcal: number;
    };
    expect(body.started_at.startsWith("2026-06-15T")).toBe(true);
    expect(body.modality).toBe("swim");
    expect(body.duration_min).toBe(30);
    expect(body.est_kcal).toBe(250);
    expect(wrapper.emitted("changed")).toHaveLength(1);
    expect(wrapper.find('[data-test="cardio-add-form"]').exists()).toBe(false);
  });

  it("add Save is disabled until a valid kcal", async () => {
    const wrapper = mount(MovementBlock, { props: MB_BASE() });
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    const kcal = wrapper.find('[data-test="cardio-add-kcal"]');
    const save = wrapper.find('[data-test="cardio-add-save"]');
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await kcal.setValue("12abc");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await kcal.setValue("200");
    expect((save.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("editing a row PATCHes by id and emits changed", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = makeClient({
      patch: async (path, body) => {
        calls.push({ path, body });
        return { id: 7 };
      },
    });
    const wrapper = mount(MovementBlock, {
      props: {
        ...MB_BASE(),
        client,
        cardio: [makeCardio({ id: 7, modality: "run", duration_min: 32, est_kcal: 410 })],
      },
    });
    await wrapper.find('[data-test="cardio-row-edit"]').trigger("click");
    await wrapper.find('[data-test="cardio-kcal-input"]').setValue("450");
    await wrapper.find('[data-test="cardio-row-save"]').trigger("click");
    await flushPromises();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/v1/cardio-sessions/7");
    expect((calls[0]?.body as { est_kcal: number }).est_kcal).toBe(450);
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("deleting a row DELETEs by id and emits changed", async () => {
    const calls: string[] = [];
    const client = makeClient({
      delete: async (path) => {
        calls.push(path);
        return undefined;
      },
    });
    const wrapper = mount(MovementBlock, {
      props: { ...MB_BASE(), client, cardio: [makeCardio({ id: 7 })] },
    });
    await wrapper.find('[data-test="cardio-row-delete"]').trigger("click");
    await wrapper.find('[data-test="cardio-delete-yes"]').trigger("click");
    await flushPromises();
    expect(calls).toEqual(["/v1/cardio-sessions/7"]);
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("does not emit changed when an op fails, and shows an error", async () => {
    const client = makeClient({
      post: async () => {
        throw new Error("nope");
      },
    });
    const wrapper = mount(MovementBlock, { props: { ...MB_BASE(), client } });
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    await wrapper.find('[data-test="cardio-add-kcal"]').setValue("200");
    await wrapper.find('[data-test="cardio-add-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("changed")).toBeUndefined();
    expect(wrapper.find('[data-test="cardio-error"]').exists()).toBe(true);
    // form stays open on failure so the user can retry
    expect(wrapper.find('[data-test="cardio-add-form"]').exists()).toBe(true);
  });

  it("clears the error banner when the add form is cancelled", async () => {
    const client = makeClient({
      post: async () => {
        throw new Error("nope");
      },
    });
    const wrapper = mount(MovementBlock, { props: { ...MB_BASE(), client } });
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    await wrapper.find('[data-test="cardio-add-kcal"]').setValue("200");
    await wrapper.find('[data-test="cardio-add-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="cardio-error"]').exists()).toBe(true);
    // form is still open after the failed save; cancel clears the error
    await wrapper.find('[data-test="cardio-add-cancel"]').trigger("click");
    expect(wrapper.find('[data-test="cardio-error"]').exists()).toBe(false);
  });
});

describe("MovementBlock steps editing", () => {
  it("shows an edit control on the steps row", () => {
    const wrapper = mount(MovementBlock, {
      props: { cardio: [], steps: null, client: makeClient(), date: "2026-06-15" },
    });
    expect(wrapper.find('[data-test="steps-edit"]').exists()).toBe(true);
  });

  it("edit → input prefilled with current count when a row exists", async () => {
    const wrapper = mount(MovementBlock, {
      props: {
        cardio: [],
        steps: { id: 3, count: 8432, est_kcal: 312 },
        client: makeClient(),
        date: "2026-06-15",
      },
    });
    await wrapper.find('[data-test="steps-edit"]').trigger("click");
    const input = wrapper.find('[data-test="steps-edit-input"]');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("8432");
  });

  it("edit → input empty when no row exists", async () => {
    const wrapper = mount(MovementBlock, {
      props: { cardio: [], steps: null, client: makeClient(), date: "2026-06-15" },
    });
    await wrapper.find('[data-test="steps-edit"]').trigger("click");
    expect((wrapper.find('[data-test="steps-edit-input"]').element as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("save POSTs { on_date, steps } and emits changed", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = makeClient({
      post: async (path, body) => {
        calls.push({ path, body });
        return { id: 5 };
      },
    });
    const wrapper = mount(MovementBlock, {
      props: { cardio: [], steps: null, client, date: "2026-06-12" },
    });
    await wrapper.find('[data-test="steps-edit"]').trigger("click");
    await wrapper.find('[data-test="steps-edit-input"]').setValue("9000");
    await wrapper.find('[data-test="steps-edit-save"]').trigger("click");
    await flushPromises();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/v1/step-logs");
    expect(calls[0]?.body).toEqual({ on_date: "2026-06-12", steps: 9000 });
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("disables save for empty, zero, or non-integer input", async () => {
    const wrapper = mount(MovementBlock, {
      props: { cardio: [], steps: null, client: makeClient(), date: "2026-06-15" },
    });
    await wrapper.find('[data-test="steps-edit"]').trigger("click");
    const input = wrapper.find('[data-test="steps-edit-input"]');
    const save = wrapper.find('[data-test="steps-edit-save"]');
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await input.setValue("12abc");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await input.setValue("-5");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await input.setValue("0");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await input.setValue("7500");
    expect((save.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("cancel closes the editor without a request", async () => {
    const calls: string[] = [];
    const client = makeClient({
      post: async (p) => {
        calls.push(p);
        return { id: 1 };
      },
    });
    const wrapper = mount(MovementBlock, {
      props: { cardio: [], steps: null, client, date: "2026-06-15" },
    });
    await wrapper.find('[data-test="steps-edit"]').trigger("click");
    await wrapper.find('[data-test="steps-edit-input"]').setValue("9000");
    await wrapper.find('[data-test="steps-edit-cancel"]').trigger("click");
    expect(wrapper.find('[data-test="steps-edit-input"]').exists()).toBe(false);
    expect(calls).toHaveLength(0);
    expect(wrapper.emitted("changed")).toBeUndefined();
  });

  it("does not emit changed and shows an error when save fails", async () => {
    const client = makeClient({
      post: async () => {
        throw new Error("nope");
      },
    });
    const wrapper = mount(MovementBlock, {
      props: { cardio: [], steps: null, client, date: "2026-06-15" },
    });
    await wrapper.find('[data-test="steps-edit"]').trigger("click");
    await wrapper.find('[data-test="steps-edit-input"]').setValue("9000");
    await wrapper.find('[data-test="steps-edit-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("changed")).toBeUndefined();
    expect(wrapper.find('[data-test="steps-edit-error"]').exists()).toBe(true);
  });

  it("no delete control when steps is null", async () => {
    const wrapper = mount(MovementBlock, {
      props: { cardio: [], steps: null, client: makeClient(), date: "2026-06-15" },
    });
    await wrapper.find('[data-test="steps-edit"]').trigger("click");
    expect(wrapper.find('[data-test="steps-edit-delete"]').exists()).toBe(false);
  });

  it("delete DELETEs by id and emits changed", async () => {
    const calls: string[] = [];
    const client = makeClient({
      delete: async (path) => {
        calls.push(path);
        return undefined;
      },
    });
    const wrapper = mount(MovementBlock, {
      props: {
        cardio: [],
        steps: { id: 42, count: 8432, est_kcal: 312 },
        client,
        date: "2026-06-15",
      },
    });
    await wrapper.find('[data-test="steps-edit"]').trigger("click");
    await wrapper.find('[data-test="steps-edit-delete"]').trigger("click");
    await flushPromises();
    expect(calls).toEqual(["/v1/step-logs/42"]);
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });
});
