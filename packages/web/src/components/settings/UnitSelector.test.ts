import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reloadPage } from "../../lib/reload-page.js";
import UnitSelector from "./UnitSelector.vue";

vi.mock("../../lib/reload-page.js", () => ({ reloadPage: vi.fn() }));

function stubClient(user: Record<string, unknown> = {}) {
  const base = {
    id: 1,
    name: "Jeff",
    dob: null,
    height_cm: 180,
    sex: "male",
    email: null,
    preferred_unit_system: "metric",
    timezone: "UTC",
    activity_level: null,
    created_at: "2026-01-01T00:00:00Z",
    ...user,
  };
  return {
    get: vi.fn().mockResolvedValue(base),
    patch: vi.fn().mockResolvedValue({ ...base, preferred_unit_system: "imperial" }),
  };
}

beforeEach(() => {
  vi.mocked(reloadPage).mockClear();
});

describe("UnitSelector", () => {
  it("seeds the control from GET /v1/users/me", async () => {
    const client = stubClient({ preferred_unit_system: "imperial" });
    const wrapper = mount(UnitSelector, { props: { client: client as unknown as never } });
    await flushPromises();
    expect((wrapper.find('[data-test="unit-select"]').element as HTMLSelectElement).value).toBe(
      "imperial",
    );
  });

  it("PATCHes the chosen unit and reloads on success", async () => {
    const client = stubClient();
    const wrapper = mount(UnitSelector, { props: { client: client as unknown as never } });
    await flushPromises();
    await wrapper.find('[data-test="unit-select"]').setValue("imperial");
    await flushPromises();
    expect(client.patch).toHaveBeenCalledWith(
      "/v1/users/me",
      { preferred_unit_system: "imperial" },
      expect.anything(),
    );
    expect(vi.mocked(reloadPage)).toHaveBeenCalledOnce();
  });

  it("does not PATCH or reload when re-picking the current value", async () => {
    const client = stubClient({ preferred_unit_system: "metric" });
    const wrapper = mount(UnitSelector, { props: { client: client as unknown as never } });
    await flushPromises();
    await wrapper.find('[data-test="unit-select"]').setValue("metric");
    await flushPromises();
    expect(client.patch).not.toHaveBeenCalled();
    expect(vi.mocked(reloadPage)).not.toHaveBeenCalled();
  });

  it("reverts and shows an error on PATCH failure", async () => {
    const client = stubClient({ preferred_unit_system: "metric" });
    client.patch.mockRejectedValueOnce(new Error("boom"));
    const wrapper = mount(UnitSelector, { props: { client: client as unknown as never } });
    await flushPromises();
    await wrapper.find('[data-test="unit-select"]').setValue("imperial");
    await flushPromises();
    expect(vi.mocked(reloadPage)).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="unit-error"]').exists()).toBe(true);
    expect((wrapper.find('[data-test="unit-select"]').element as HTMLSelectElement).value).toBe(
      "metric",
    );
  });
});
