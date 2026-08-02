import { at } from "@almanac/core/test-support";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useStoredMealsStore } from "../../stores/stored-meals.js";
import MealsList from "./MealsList.vue";

function stubClient() {
  return {
    post: () => Promise.resolve({}),
    patch: () => Promise.resolve({}),
    delete: () => Promise.resolve(undefined),
  } as unknown as import("../../api/client.js").ApiClient;
}

const baseProps = () => ({ client: stubClient(), realToday: "2026-05-21" });

// MealsList renders StoredMealsSection, which reads a Pinia store on mount, so
// every mount needs an active Pinia.
beforeEach(() => setActivePinia(createPinia()));

function makeMeal(
  overrides: Partial<{
    id: number;
    eaten_at: string;
    name: string | null;
    kcal: number;
    protein_g: number;
    carb_g: number;
    fat_g: number;
    notes: string | null;
  }> = {},
) {
  const o = {
    id: 1,
    eaten_at: "2026-05-21T08:30:00Z",
    name: "oatmeal" as string | null,
    kcal: 320,
    protein_g: 12,
    carb_g: 54,
    fat_g: 6,
    notes: null as string | null,
    ...overrides,
  };
  return {
    id: o.id,
    user_id: 1,
    eaten_at: o.eaten_at,
    name: o.name,
    kcal: o.kcal,
    protein_g: o.protein_g,
    carb_g: o.carb_g,
    fat_g: o.fat_g,
    notes: o.notes,
    created_at: o.eaten_at,
  };
}

describe("MealsList", () => {
  it("renders the empty-state message when meals is []", () => {
    const wrapper = mount(MealsList, { props: { ...baseProps(), meals: [] } });
    expect(wrapper.find('[data-test="meals-empty"]').exists()).toBe(true);
    expect(wrapper.text()).toMatch(/no meals logged today/i);
    expect(wrapper.findAll('[data-test="meal-row"]')).toHaveLength(0);
  });

  it("renders one row per meal with time, name, kcal, and macros", () => {
    const wrapper = mount(MealsList, {
      props: {
        ...baseProps(),
        meals: [
          makeMeal({
            id: 1,
            name: "protein bar",
            kcal: 210,
            protein_g: 20,
            carb_g: 22,
            fat_g: 7,
          }),
        ],
      },
    });
    const rows = wrapper.findAll('[data-test="meal-row"]');
    expect(rows).toHaveLength(1);
    const text = at(rows, 0).text();
    expect(text).toContain("protein bar");
    expect(text).toContain("210");
    expect(text).toContain("kcal");
    expect(text).toContain("20");
    expect(text).toContain("22");
    expect(text).toContain("7");
    expect(text.toLowerCase()).toContain("p");
    expect(text.toLowerCase()).toContain("c");
    expect(text.toLowerCase()).toContain("f");
  });

  it("formats meal time as HH:MM using the user's locale", () => {
    const wrapper = mount(MealsList, {
      props: { ...baseProps(), meals: [makeMeal({ eaten_at: "2026-05-21T08:30:00Z" })] },
    });
    const time = wrapper.find('[data-test="meal-time"]').text();
    // Intl.DateTimeFormat with hour:"2-digit", minute:"2-digit" yields "HH:MM"
    // (in 24h locales) or "08:30" — we just assert the colon-separated shape.
    expect(time).toMatch(/^\d{2}:\d{2}$/);
  });

  it("colors macro letters with the macro palette CSS vars", () => {
    const wrapper = mount(MealsList, {
      props: { ...baseProps(), meals: [makeMeal()] },
    });
    // The component routes color through scoped CSS class selectors; just
    // confirm the per-macro elements exist so the palette wiring is testable.
    const row = wrapper.find('[data-test="meal-row"]');
    expect(row.find(".m.kcal").exists()).toBe(true);
    expect(row.find(".m.protein").exists()).toBe(true);
    expect(row.find(".m.carb").exists()).toBe(true);
    expect(row.find(".m.fat").exists()).toBe(true);
    // Letter labels rendered (lowercase per design).
    expect(row.find(".m.protein").text()).toMatch(/p/i);
    expect(row.find(".m.carb").text()).toMatch(/c/i);
    expect(row.find(".m.fat").text()).toMatch(/f/i);
  });

  it("captions the block 'Today's meals' by default (no date/isPastDay)", () => {
    const wrapper = mount(MealsList, { props: { ...baseProps(), meals: [] } });
    expect(wrapper.find(".caption-label").text()).toBe("Today's meals");
  });

  it("keeps 'Today's meals' when isPastDay is explicitly false", () => {
    const wrapper = mount(MealsList, {
      props: { ...baseProps(), meals: [], date: "2026-06-15", isPastDay: false },
    });
    expect(wrapper.find(".caption-label").text()).toBe("Today's meals");
  });

  it("captions the block 'Meals · <date>' when viewing a past day", () => {
    const wrapper = mount(MealsList, {
      props: { ...baseProps(), meals: [], date: "2026-06-10", isPastDay: true },
    });
    const caption = wrapper.find(".caption").text();
    expect(caption).not.toBe("Today's meals");
    expect(caption.startsWith("Meals · ")).toBe(true);
    expect(caption).toContain("Wed");
    expect(caption).toContain("Jun");
    expect(caption).toContain("10");
  });

  it("renders multiple meals in the order they were passed", () => {
    const wrapper = mount(MealsList, {
      props: {
        ...baseProps(),
        meals: [
          makeMeal({ id: 1, eaten_at: "2026-05-21T08:30:00Z", name: "oatmeal" }),
          makeMeal({ id: 2, eaten_at: "2026-05-21T12:15:00Z", name: "salad" }),
          makeMeal({ id: 3, eaten_at: "2026-05-21T19:00:00Z", name: "chicken bowl" }),
        ],
      },
    });
    const names = wrapper.findAll('[data-test="meal-name"]').map((el) => el.text());
    expect(names).toEqual(["oatmeal", "salad", "chicken bowl"]);
  });
});

describe("MealsList orchestration", () => {
  it("shows a header edit button that opens the add form", async () => {
    const wrapper = mount(MealsList, { props: { ...baseProps(), meals: [] } });
    expect(wrapper.find('[data-test="meals-add"]').exists()).toBe(true);
    await wrapper.find('[data-test="meals-add"]').trigger("click");
    expect(wrapper.find('[data-test="meal-add-form"]').exists()).toBe(true);
  });

  it("hides the 'Log with AI' shortcut when the feature is disabled", () => {
    const wrapper = mount(MealsList, { props: { ...baseProps(), meals: [] } });
    expect(wrapper.find('[data-test="meals-log-with-ai"]').exists()).toBe(false);
  });

  it("shows the 'Log with AI' shortcut and emits log-with-ai when enabled", async () => {
    const wrapper = mount(MealsList, {
      props: { ...baseProps(), meals: [], mealChatEnabled: true },
    });
    const aiBtn = wrapper.find('[data-test="meals-log-with-ai"]');
    expect(aiBtn.exists()).toBe(true);
    await aiBtn.trigger("click");
    expect(wrapper.emitted("log-with-ai")).toBeTruthy();
  });

  it("POSTs a new meal with a naive-local eaten_at on the viewed day", async () => {
    const posted: Array<{ path: string; body: unknown }> = [];
    const client = {
      post: (path: string, body: unknown) => {
        posted.push({ path, body });
        return Promise.resolve({});
      },
    } as unknown as import("../../api/client.js").ApiClient;
    const wrapper = mount(MealsList, {
      props: { client, realToday: "2026-05-21", meals: [], date: "2026-05-21" },
    });
    await wrapper.find('[data-test="meals-add"]').trigger("click");
    await wrapper.find('[data-test="meal-add-form"] [data-test="meal-edit-kcal"]').setValue("500");
    await wrapper
      .find('[data-test="meal-add-form"] [data-test="meal-edit-time"]')
      .setValue("09:15");
    await wrapper.find('[data-test="meal-add-form"] [data-test="meal-edit-save"]').trigger("click");
    await flushPromises();
    expect(posted).toHaveLength(1);
    expect(posted[0]?.path).toBe("/v1/meals");
    expect((posted[0]?.body as { eaten_at: string }).eaten_at).toBe("2026-05-21T09:15:00");
    expect((posted[0]?.body as { kcal: number }).kcal).toBe(500);
    expect(wrapper.emitted("changed")).toBeTruthy();
  });

  it("prefills the add-form time to noon for a past day (TZ-independent)", async () => {
    // Past day → defaultTime() returns "12:00"; the seed must round-trip through
    // MealRow's local time formatter unchanged. A Z-suffixed seed would shift it.
    const wrapper = mount(MealsList, {
      props: { ...baseProps(), meals: [], date: "2026-05-10", isPastDay: true },
    });
    await wrapper.find('[data-test="meals-add"]').trigger("click");
    const t = (
      wrapper.find('[data-test="meal-add-form"] [data-test="meal-edit-time"]')
        .element as HTMLInputElement
    ).value;
    expect(t).toBe("12:00");
  });

  it("composes a pre-4am meal time onto the next calendar date so it buckets to the viewed day", async () => {
    // Viewing Fri 2026-06-19; a 01:59 time is in the 00:00–03:59 window. The
    // viewed day's tracking window runs 4am→4am, so 01:59 lives in the NEXT
    // calendar morning (Jun 20) but still belongs to Fri Jun 19. Composing on
    // Jun 19 would make the API roll it back to Thu Jun 18 (the bug).
    const posted: Array<{ path: string; body: unknown }> = [];
    const client = {
      post: (path: string, body: unknown) => {
        posted.push({ path, body });
        return Promise.resolve({});
      },
    } as unknown as import("../../api/client.js").ApiClient;
    const wrapper = mount(MealsList, {
      props: { client, realToday: "2026-06-19", meals: [], date: "2026-06-19" },
    });
    await wrapper.find('[data-test="meals-add"]').trigger("click");
    await wrapper.find('[data-test="meal-add-form"] [data-test="meal-edit-kcal"]').setValue("100");
    await wrapper
      .find('[data-test="meal-add-form"] [data-test="meal-edit-time"]')
      .setValue("01:59");
    await wrapper.find('[data-test="meal-add-form"] [data-test="meal-edit-save"]').trigger("click");
    await flushPromises();
    expect((posted[0]?.body as { eaten_at: string }).eaten_at).toBe("2026-06-20T01:59:00");
  });

  it("composes a post-4am meal time onto the viewed date unchanged", async () => {
    const posted: Array<{ path: string; body: unknown }> = [];
    const client = {
      post: (path: string, body: unknown) => {
        posted.push({ path, body });
        return Promise.resolve({});
      },
    } as unknown as import("../../api/client.js").ApiClient;
    const wrapper = mount(MealsList, {
      props: { client, realToday: "2026-06-19", meals: [], date: "2026-06-19" },
    });
    await wrapper.find('[data-test="meals-add"]').trigger("click");
    await wrapper.find('[data-test="meal-add-form"] [data-test="meal-edit-kcal"]').setValue("100");
    await wrapper
      .find('[data-test="meal-add-form"] [data-test="meal-edit-time"]')
      .setValue("08:30");
    await wrapper.find('[data-test="meal-add-form"] [data-test="meal-edit-save"]').trigger("click");
    await flushPromises();
    expect((posted[0]?.body as { eaten_at: string }).eaten_at).toBe("2026-06-19T08:30:00");
  });
});

describe("MealsList stored-meals integration", () => {
  it("renders the StoredMealsSection", () => {
    const wrapper = mount(MealsList, { props: { ...baseProps(), meals: [] } });
    expect(wrapper.find('[data-test="stored-head"]').exists()).toBe(true);
  });

  it("logging a stored meal POSTs a meal on the viewed day and emits changed", async () => {
    const posted: Array<{ path: string; body: unknown }> = [];
    const client = {
      get: () => Promise.resolve([]),
      post: (path: string, body: unknown) => {
        posted.push({ path, body });
        return Promise.resolve({});
      },
    } as unknown as import("../../api/client.js").ApiClient;
    const store = useStoredMealsStore();
    store.data = [
      {
        id: 3,
        user_id: 1,
        name: "Shake",
        kcal: 240,
        protein_g: 40,
        carb_g: 8,
        fat_g: 4,
        description: null,
        created_at: "2026-06-01T00:00:00Z",
      },
    ];
    store.status = "ready";
    const wrapper = mount(MealsList, {
      props: { client, realToday: "2026-06-19", meals: [], date: "2026-06-17" },
    });
    await wrapper.find('[data-test="stored-head"]').trigger("click");
    await wrapper.find('[data-test="stored-row-log"]').trigger("click");
    await flushPromises();
    const mealPost = posted.find((p) => p.path === "/v1/meals");
    expect(mealPost).toBeTruthy();
    expect((mealPost?.body as { name: string }).name).toBe("Shake");
    expect((mealPost?.body as { kcal: number }).kcal).toBe(240);
    expect((mealPost?.body as { eaten_at: string }).eaten_at).toBe("2026-06-17T12:00:00");
    expect(wrapper.emitted("changed")).toBeTruthy();
  });
});
