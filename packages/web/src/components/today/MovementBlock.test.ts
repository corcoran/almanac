import { at } from "@almanac/core/test-support";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MovementBlock from "./MovementBlock.vue";

const realMatchMedia = window.matchMedia;

/**
 * `useIsMobile` reads `window.matchMedia`, which vitest.setup.ts stubs as
 * always-false. Point that stub at a width instead. The composable reads it
 * once at setup, so call this before mounting.
 */
function setViewportWidth(px: number): void {
  window.matchMedia = ((query: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Number.NaN);
    return {
      matches: !Number.isNaN(max) && px <= max,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

type CardioSession = {
  id: number;
  modality: string | null;
  duration_min: number | null;
  avg_hr: number | null;
  est_kcal: number;
};

function makeCardio(overrides: Partial<CardioSession> = {}): CardioSession {
  return {
    id: 1,
    modality: "bike",
    duration_min: 45,
    avg_hr: null,
    est_kcal: 320,
    ...overrides,
  };
}

function makeClient(
  overrides: Partial<{
    get: (p: string) => Promise<unknown>;
    post: (p: string, b: unknown) => Promise<unknown>;
    patch: (p: string, b: unknown) => Promise<unknown>;
    delete: (p: string) => Promise<unknown>;
  }> = {},
) {
  return {
    post: overrides.post ?? (async () => ({ id: 1 })),
    patch: overrides.patch ?? (async () => ({ id: 1 })),
    delete: overrides.delete ?? (async () => undefined),
    get: overrides.get ?? (async () => []),
    put: async () => ({}),
  } as unknown as import("../../api/client.js").ApiClient;
}

/** Shape of GET /v1/cardio-sessions/kcal-preview, as far as the form reads it. */
function previewResponse(est_kcal_hr: number) {
  return {
    est_kcal_hr,
    basis: "keytel_and_mets",
    components: {
      keytel_kcal: est_kcal_hr,
      mets_kcal: est_kcal_hr,
      met_value_used: 9,
      pct_hrmax: 80,
      mets_basis: "zone_scaled",
    },
  };
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

  it("prefills and patches a corrected heart rate from the edit row", async () => {
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
        cardio: [makeCardio({ id: 7, avg_hr: 150, duration_min: 30, est_kcal: 431 })],
      },
    });
    await wrapper.find('[data-test="cardio-row-edit"]').trigger("click");
    const hr = wrapper.find('[data-test="cardio-hr-input"]');
    expect((hr.element as HTMLInputElement).value).toBe("150");
    await hr.setValue("135");
    await wrapper.find('[data-test="cardio-row-save"]').trigger("click");
    await flushPromises();
    expect(at(calls, 0).body).toMatchObject({ avg_hr: 135 });
    // An untouched kcal box is not a claim on the figure, so leaving it out
    // lets a server-derived one follow the corrected heart rate.
    expect(at(calls, 0).body).not.toHaveProperty("est_kcal");
  });

  it("sends est_kcal only when the edit row's kcal box was changed", async () => {
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
        cardio: [makeCardio({ id: 7, avg_hr: 150, duration_min: 30, est_kcal: 431 })],
      },
    });
    await wrapper.find('[data-test="cardio-row-edit"]').trigger("click");
    await wrapper.find('[data-test="cardio-kcal-input"]').setValue("500");
    await wrapper.find('[data-test="cardio-row-save"]').trigger("click");
    await flushPromises();
    expect(at(calls, 0).body).toMatchObject({ est_kcal: 500, avg_hr: 150 });
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

  it("posts avg_hr with no est_kcal when the user fills HR and duration only", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = makeClient({
      post: async (path, body) => {
        calls.push({ path, body });
        return { id: 9 };
      },
    });
    const wrapper = mount(MovementBlock, { props: { ...MB_BASE(), client } });
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    await wrapper.find('[data-test="cardio-add-duration"]').setValue("30");
    await wrapper.find('[data-test="cardio-add-hr"]').setValue("150");
    await wrapper.find('[data-test="cardio-add-save"]').trigger("click");
    await flushPromises();
    expect(at(calls, 0).body).toMatchObject({ avg_hr: 150, duration_min: 30 });
    expect(at(calls, 0).body).not.toHaveProperty("est_kcal");
  });

  it("still posts est_kcal when the user types one and leaves HR blank", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = makeClient({
      post: async (path, body) => {
        calls.push({ path, body });
        return { id: 9 };
      },
    });
    const wrapper = mount(MovementBlock, { props: { ...MB_BASE(), client } });
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    await wrapper.find('[data-test="cardio-add-duration"]').setValue("30");
    await wrapper.find('[data-test="cardio-add-kcal"]').setValue("400");
    await wrapper.find('[data-test="cardio-add-save"]').trigger("click");
    await flushPromises();
    expect(at(calls, 0).body).toMatchObject({ est_kcal: 400, duration_min: 30, avg_hr: null });
  });

  it("enables Save on HR + duration alone, and on kcal alone", async () => {
    const wrapper = mount(MovementBlock, { props: MB_BASE() });
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    const save = wrapper.find('[data-test="cardio-add-save"]');
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.find('[data-test="cardio-add-hr"]').setValue("150");
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.find('[data-test="cardio-add-duration"]').setValue("30");
    expect((save.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("states the either-or rule while the form is open", async () => {
    const wrapper = mount(MovementBlock, { props: MB_BASE() });
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    expect(wrapper.find('[data-test="cardio-add-hint"]').text()).toBe(
      "Enter calories, or heart rate and we'll work them out.",
    );
  });

  it("echoes the derivation once heart rate and duration are in", async () => {
    const wrapper = mount(MovementBlock, { props: MB_BASE() });
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    await wrapper.find('[data-test="cardio-add-duration"]').setValue("30");
    await wrapper.find('[data-test="cardio-add-hr"]').setValue("142");
    // No preview has resolved yet, so it names the inputs rather than a figure.
    expect(wrapper.find('[data-test="cardio-add-hint"]').text()).toBe(
      "Calories from 142 bpm over 30 min.",
    );
    expect(wrapper.find('[data-test="cardio-add-kcal"]').attributes("placeholder")).toBe("auto");
  });

  it("stacks activity above the numbers on mobile", async () => {
    setViewportWidth(375);
    const wrapper = mount(MovementBlock, { props: MB_BASE() });
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    expect(wrapper.find('[data-test="cardio-add-form"]').classes()).toContain("stacked");
  });

  it("keeps the add form on one row on desktop", async () => {
    setViewportWidth(1280);
    const wrapper = mount(MovementBlock, { props: MB_BASE() });
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    expect(wrapper.find('[data-test="cardio-add-form"]').classes()).not.toContain("stacked");
  });

  it("offers common activities as suggestions", async () => {
    const wrapper = mount(MovementBlock, { props: MB_BASE() });
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    const input = wrapper.find('[data-test="cardio-add-modality"]');
    expect(input.attributes("list")).toBe("cardio-activities");
    expect(input.attributes("placeholder")).toBe("activity");
    expect(wrapper.findAll("#cardio-activities option").length).toBeGreaterThan(4);
  });

  it("points the edit rows at the same single datalist", async () => {
    const wrapper = mount(MovementBlock, {
      props: {
        ...MB_BASE(),
        cardio: [makeCardio({ id: 1 }), makeCardio({ id: 2, modality: "row" })],
      },
    });
    await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
    for (const btn of wrapper.findAll('[data-test="cardio-row-edit"]')) {
      await btn.trigger("click");
    }
    for (const input of wrapper.findAll('[data-test="cardio-modality-input"]')) {
      expect(input.attributes("list")).toBe("cardio-activities");
    }
    // An id has to be unique in the document, so the block renders the list
    // once for every input that points at it.
    expect(wrapper.findAll("#cardio-activities")).toHaveLength(1);
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

describe("MovementBlock kcal preview", () => {
  // Only setTimeout is faked: @vue/test-utils' flushPromises schedules on
  // setImmediate, which has to stay real or every await here deadlocks.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Open the form and type a heart rate and duration into it. */
  async function fillDerivable(
    wrapper: ReturnType<typeof mount>,
    hr: string,
    duration = "30",
  ): Promise<void> {
    if (!wrapper.find('[data-test="cardio-add-form"]').exists()) {
      await wrapper.find('[data-test="cardio-add-button"]').trigger("click");
      await wrapper.find('[data-test="cardio-add-duration"]').setValue(duration);
    }
    await wrapper.find('[data-test="cardio-add-hr"]').setValue(hr);
  }

  /** Let the debounce elapse and the resulting response land in the DOM. */
  async function settle(): Promise<void> {
    vi.advanceTimersByTime(300);
    await flushPromises();
  }

  it("fills the placeholder and the hint with the derived figure", async () => {
    const wrapper = mount(MovementBlock, {
      props: { ...MB_BASE(), client: makeClient({ get: async () => previewResponse(384) }) },
    });
    await fillDerivable(wrapper, "142");
    await settle();

    expect(wrapper.find('[data-test="cardio-add-kcal"]').attributes("placeholder")).toBe("384");
    expect(wrapper.find('[data-test="cardio-add-hint"]').text()).toBe(
      "384 kcal from 142 bpm over 30 min.",
    );
  });

  it("asks the preview route for the typed inputs on the selected date", async () => {
    const paths: string[] = [];
    const wrapper = mount(MovementBlock, {
      props: {
        ...MB_BASE(),
        date: "2026-06-15",
        client: makeClient({
          get: async (p) => {
            paths.push(p);
            return previewResponse(384);
          },
        }),
      },
    });
    await fillDerivable(wrapper, "142");
    await settle();

    expect(paths).toEqual([
      "/v1/cardio-sessions/kcal-preview?avg_hr=142&duration_min=30&on_date=2026-06-15",
    ]);
  });

  it("debounces a burst of keystrokes into one request", async () => {
    const paths: string[] = [];
    const wrapper = mount(MovementBlock, {
      props: {
        ...MB_BASE(),
        client: makeClient({
          get: async (p) => {
            paths.push(p);
            return previewResponse(431);
          },
        }),
      },
    });
    await fillDerivable(wrapper, "1");
    vi.advanceTimersByTime(100);
    await fillDerivable(wrapper, "14");
    vi.advanceTimersByTime(100);
    await fillDerivable(wrapper, "142");
    // Under the 300ms window the whole way, so nothing has gone out yet.
    expect(paths).toHaveLength(0);
    await settle();

    expect(paths).toEqual([
      "/v1/cardio-sessions/kcal-preview?avg_hr=142&duration_min=30&on_date=2026-06-15",
    ]);
  });

  it("ignores a slow response that lands after a newer one", async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    const wrapper = mount(MovementBlock, {
      props: {
        ...MB_BASE(),
        client: makeClient({
          get: async () =>
            new Promise((resolve) => {
              resolvers.push(resolve);
            }),
        }),
      },
    });
    await fillDerivable(wrapper, "140");
    await settle();
    await fillDerivable(wrapper, "150");
    await settle();
    expect(resolvers).toHaveLength(2);

    at(resolvers, 1)(previewResponse(431));
    await flushPromises();
    expect(wrapper.find('[data-test="cardio-add-kcal"]').attributes("placeholder")).toBe("431");

    // The first request finally answers, with a figure for a heart rate the
    // user has since changed.
    at(resolvers, 0)(previewResponse(999));
    await flushPromises();
    expect(wrapper.find('[data-test="cardio-add-kcal"]').attributes("placeholder")).toBe("431");
  });

  it("clears a resolved figure when the heart rate is emptied", async () => {
    const wrapper = mount(MovementBlock, {
      props: { ...MB_BASE(), client: makeClient({ get: async () => previewResponse(384) }) },
    });
    await fillDerivable(wrapper, "142");
    await settle();
    await wrapper.find('[data-test="cardio-add-hr"]').setValue("");

    expect(wrapper.find('[data-test="cardio-add-kcal"]').attributes("placeholder")).toBe("kcal");
    expect(wrapper.find('[data-test="cardio-add-hint"]').text()).toBe(
      "Enter calories, or heart rate and we'll work them out.",
    );
  });

  it("leaves the form usable and silent when the preview fails", async () => {
    const wrapper = mount(MovementBlock, {
      props: {
        ...MB_BASE(),
        client: makeClient({
          get: async () => {
            throw new Error("nope");
          },
        }),
      },
    });
    await fillDerivable(wrapper, "142");
    await settle();

    expect(wrapper.find('[data-test="cardio-add-kcal"]').attributes("placeholder")).toBe("auto");
    expect(wrapper.find('[data-test="cardio-add-hint"]').text()).toBe(
      "Calories from 142 bpm over 30 min.",
    );
    expect(wrapper.find('[data-test="cardio-error"]').exists()).toBe(false);
    expect(
      (wrapper.find('[data-test="cardio-add-save"]').element as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("does not preview while the form is closed", async () => {
    const paths: string[] = [];
    const wrapper = mount(MovementBlock, {
      props: {
        ...MB_BASE(),
        client: makeClient({
          get: async (p) => {
            paths.push(p);
            return previewResponse(384);
          },
        }),
      },
    });
    await fillDerivable(wrapper, "142");
    await wrapper.find('[data-test="cardio-add-cancel"]').trigger("click");
    await settle();

    expect(paths).toHaveLength(0);
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
