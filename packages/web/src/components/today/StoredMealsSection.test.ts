import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStoredMealsStore } from "../../stores/stored-meals.js";
import StoredMealsSection from "./StoredMealsSection.vue";

function makeStored(overrides = {}) {
  return {
    id: 1,
    user_id: 1,
    name: "My usual breakfast",
    kcal: 520,
    protein_g: 32,
    carb_g: 50,
    fat_g: 18,
    description: null as string | null,
    created_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

function stubClient(overrides = {}) {
  return {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as import("../../api/client.js").ApiClient;
}

function mountSection(props = {}) {
  return mount(StoredMealsSection, {
    props: { client: stubClient(), logMeal: vi.fn().mockResolvedValue(undefined), ...props },
  });
}

describe("StoredMealsSection", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("is collapsed by default and shows the saved count", () => {
    const store = useStoredMealsStore();
    store.data = [makeStored({ id: 1 }), makeStored({ id: 2, name: "Shake" })];
    store.status = "ready";
    const wrapper = mountSection();
    expect(wrapper.find('[data-test="stored-head"]').text()).toContain("2");
    expect(wrapper.find('[data-test="stored-row"]').exists()).toBe(false);
  });

  it("expands to show rows when the header is clicked", async () => {
    const store = useStoredMealsStore();
    store.data = [makeStored()];
    store.status = "ready";
    const wrapper = mountSection();
    await wrapper.find('[data-test="stored-head"]').trigger("click");
    expect(wrapper.find('[data-test="stored-row"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="stored-add"]').exists()).toBe(true);
  });

  it("logs a stored meal via the logMeal callback", async () => {
    const store = useStoredMealsStore();
    store.data = [makeStored({ id: 5 })];
    store.status = "ready";
    const logMeal = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountSection({ logMeal });
    await wrapper.find('[data-test="stored-head"]').trigger("click");
    await wrapper.find('[data-test="stored-row-log"]').trigger("click");
    await flushPromises();
    expect(logMeal).toHaveBeenCalledWith(store.data[0]);
  });

  it("POSTs a new stored meal on add-save", async () => {
    const store = useStoredMealsStore();
    store.status = "ready";
    const client = stubClient();
    const wrapper = mountSection({ client });
    await wrapper.find('[data-test="stored-head"]').trigger("click");
    await wrapper.find('[data-test="stored-add"]').trigger("click");
    await wrapper
      .find('[data-test="stored-add-form"] [data-test="stored-edit-name"]')
      .setValue("New meal");
    await wrapper
      .find('[data-test="stored-add-form"] [data-test="stored-edit-kcal"]')
      .setValue("300");
    await wrapper
      .find('[data-test="stored-add-form"] [data-test="stored-edit-save"]')
      .trigger("click");
    await flushPromises();
    expect(client.post).toHaveBeenCalledWith(
      "/v1/stored-meals",
      { name: "New meal", kcal: 300, protein_g: 0, carb_g: 0, fat_g: 0 },
      expect.anything(),
    );
  });

  it("shows an overwrite confirm when adding a name that already exists", async () => {
    const store = useStoredMealsStore();
    store.data = [makeStored({ name: "My usual breakfast" })];
    store.status = "ready";
    const client = stubClient();
    const wrapper = mountSection({ client });
    await wrapper.find('[data-test="stored-head"]').trigger("click");
    await wrapper.find('[data-test="stored-add"]').trigger("click");
    await wrapper
      .find('[data-test="stored-add-form"] [data-test="stored-edit-name"]')
      .setValue("My usual breakfast");
    await wrapper
      .find('[data-test="stored-add-form"] [data-test="stored-edit-kcal"]')
      .setValue("300");
    await wrapper
      .find('[data-test="stored-add-form"] [data-test="stored-edit-save"]')
      .trigger("click");
    await flushPromises();
    expect(client.post).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="stored-overwrite-confirm"]').exists()).toBe(true);
    await wrapper.find('[data-test="stored-overwrite-yes"]').trigger("click");
    await flushPromises();
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it("DELETEs a stored meal", async () => {
    const store = useStoredMealsStore();
    store.data = [makeStored({ id: 8 })];
    store.status = "ready";
    const client = stubClient();
    const wrapper = mountSection({ client });
    await wrapper.find('[data-test="stored-head"]').trigger("click");
    await wrapper.find('[data-test="stored-row-delete"]').trigger("click");
    await wrapper.find('[data-test="stored-delete-yes"]').trigger("click");
    await flushPromises();
    expect(client.delete).toHaveBeenCalledWith("/v1/stored-meals/8", expect.anything());
  });

  it("surfaces the API's friendly 409 message on a rename collision", async () => {
    const store = useStoredMealsStore();
    store.data = [makeStored({ id: 8, name: "Breakfast" })];
    store.status = "ready";
    const client = stubClient({
      patch: vi.fn().mockRejectedValue({
        kind: "http",
        status: 409,
        body: JSON.stringify({
          error: { code: "conflict", message: "A stored meal named 'Lunch' already exists." },
        }),
      }),
    });
    const wrapper = mountSection({ client });
    await wrapper.find('[data-test="stored-head"]').trigger("click");
    await wrapper.find('[data-test="stored-row-edit"]').trigger("click");
    await wrapper.find('[data-test="stored-edit-name"]').setValue("Lunch");
    await wrapper.find('[data-test="stored-edit-kcal"]').setValue("500");
    await wrapper.find('[data-test="stored-edit-save"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="stored-error"]').text()).toContain("already exists");
  });

  it("hides the add-form while the overwrite confirm is pending, restores it on cancel", async () => {
    const store = useStoredMealsStore();
    store.data = [makeStored({ name: "Eggs" })];
    store.status = "ready";
    const client = stubClient();
    const wrapper = mountSection({ client });
    await wrapper.find('[data-test="stored-head"]').trigger("click");
    await wrapper.find('[data-test="stored-add"]').trigger("click");
    await wrapper
      .find('[data-test="stored-add-form"] [data-test="stored-edit-name"]')
      .setValue("Eggs");
    await wrapper
      .find('[data-test="stored-add-form"] [data-test="stored-edit-kcal"]')
      .setValue("200");
    await wrapper
      .find('[data-test="stored-add-form"] [data-test="stored-edit-save"]')
      .trigger("click");
    await flushPromises();
    // form hidden, confirm shown, no POST
    expect(wrapper.find('[data-test="stored-add-form"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="stored-overwrite-confirm"]').exists()).toBe(true);
    expect(client.post).not.toHaveBeenCalled();
    // cancel → form returns, still no POST
    await wrapper.find('[data-test="stored-overwrite-no"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="stored-overwrite-confirm"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="stored-add-form"]').exists()).toBe(true);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("clears the overwrite candidate when the add form is cancelled", async () => {
    const store = useStoredMealsStore();
    store.data = [makeStored({ name: "Eggs" })];
    store.status = "ready";
    const wrapper = mountSection();
    await wrapper.find('[data-test="stored-head"]').trigger("click");
    await wrapper.find('[data-test="stored-add"]').trigger("click");
    await wrapper
      .find('[data-test="stored-add-form"] [data-test="stored-edit-name"]')
      .setValue("Eggs");
    await wrapper
      .find('[data-test="stored-add-form"] [data-test="stored-edit-kcal"]')
      .setValue("200");
    await wrapper
      .find('[data-test="stored-add-form"] [data-test="stored-edit-save"]')
      .trigger("click");
    await flushPromises();
    // cancel the overwrite, then re-open add — no stale candidate banner
    await wrapper.find('[data-test="stored-overwrite-no"]').trigger("click");
    await wrapper
      .find('[data-test="stored-add-form"] [data-test="stored-edit-cancel"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="stored-overwrite-confirm"]').exists()).toBe(false);
  });
});
