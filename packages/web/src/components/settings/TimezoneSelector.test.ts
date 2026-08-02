import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reloadPage } from "../../lib/reload-page.js";
import TimezoneSelector from "./TimezoneSelector.vue";

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
    patch: vi.fn().mockResolvedValue({ ...base, timezone: "America/Toronto" }),
  };
}

beforeEach(() => {
  vi.mocked(reloadPage).mockClear();
});

describe("TimezoneSelector", () => {
  it("seeds the input from GET /v1/users/me", async () => {
    const client = stubClient({ timezone: "America/Toronto" });
    const wrapper = mount(TimezoneSelector, { props: { client: client as unknown as never } });
    await flushPromises();
    expect((wrapper.find('[data-test="tz-input"]').element as HTMLInputElement).value).toBe(
      "America/Toronto",
    );
  });

  it("filters the option list by typed text", async () => {
    const client = stubClient();
    const wrapper = mount(TimezoneSelector, { props: { client: client as unknown as never } });
    await flushPromises();
    const input = wrapper.find('[data-test="tz-input"]');
    await input.setValue("toron");
    await flushPromises();
    const labels = wrapper.findAll('[data-test="tz-option"]').map((o) => o.text());
    expect(labels).toContain("America/Toronto");
    expect(labels.every((l) => l.toLowerCase().includes("toron"))).toBe(true);
  });

  it("PATCHes the picked zone and reloads on success", async () => {
    const client = stubClient();
    const wrapper = mount(TimezoneSelector, { props: { client: client as unknown as never } });
    await flushPromises();
    await wrapper.find('[data-test="tz-input"]').setValue("toron");
    await flushPromises();
    const option = wrapper
      .findAll('[data-test="tz-option"]')
      .find((o) => o.text() === "America/Toronto");
    expect(option).toBeDefined();
    await option?.trigger("mousedown");
    await flushPromises();
    expect(client.patch).toHaveBeenCalledWith(
      "/v1/users/me",
      { timezone: "America/Toronto" },
      expect.anything(),
    );
    expect(vi.mocked(reloadPage)).toHaveBeenCalledOnce();
  });

  it("selects the active option on ArrowDown then Enter", async () => {
    const client = stubClient();
    const wrapper = mount(TimezoneSelector, { props: { client: client as unknown as never } });
    await flushPromises();
    const input = wrapper.find('[data-test="tz-input"]');
    await input.setValue("america/toronto");
    await flushPromises();
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(client.patch).toHaveBeenCalledWith(
      "/v1/users/me",
      { timezone: "America/Toronto" },
      expect.anything(),
    );
  });

  it("reverts the input and shows an error on PATCH failure", async () => {
    const client = stubClient({ timezone: "UTC" });
    client.patch.mockRejectedValueOnce(new Error("boom"));
    const wrapper = mount(TimezoneSelector, { props: { client: client as unknown as never } });
    await flushPromises();
    await wrapper.find('[data-test="tz-input"]').setValue("toron");
    await flushPromises();
    const option = wrapper
      .findAll('[data-test="tz-option"]')
      .find((o) => o.text() === "America/Toronto");
    await option?.trigger("mousedown");
    await flushPromises();
    expect(vi.mocked(reloadPage)).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="tz-error"]').exists()).toBe(true);
    expect((wrapper.find('[data-test="tz-input"]').element as HTMLInputElement).value).toBe("UTC");
  });

  it("does not PATCH or reload when committing the already-saved zone", async () => {
    const client = stubClient({ timezone: "America/Toronto" });
    const wrapper = mount(TimezoneSelector, { props: { client: client as unknown as never } });
    await flushPromises();
    // open the list and click the saved zone itself
    await wrapper.find('[data-test="tz-input"]').setValue("America/Toronto");
    await flushPromises();
    const option = wrapper
      .findAll('[data-test="tz-option"]')
      .find((o) => o.text() === "America/Toronto");
    expect(option).toBeDefined();
    await option?.trigger("mousedown");
    await flushPromises();
    expect(client.patch).not.toHaveBeenCalled();
    expect(vi.mocked(reloadPage)).not.toHaveBeenCalled();
  });

  it("restores the input to the saved zone when blurred without selecting", async () => {
    const client = stubClient({ timezone: "America/Toronto" });
    const wrapper = mount(TimezoneSelector, { props: { client: client as unknown as never } });
    await flushPromises();
    const input = wrapper.find('[data-test="tz-input"]');
    await input.setValue("toron"); // orphan partial text
    await flushPromises();
    await input.trigger("blur");
    await flushPromises();
    expect((input.element as HTMLInputElement).value).toBe("America/Toronto");
    expect(client.patch).not.toHaveBeenCalled();
  });

  it("restores the input to the saved zone on Escape", async () => {
    const client = stubClient({ timezone: "America/Toronto" });
    const wrapper = mount(TimezoneSelector, { props: { client: client as unknown as never } });
    await flushPromises();
    const input = wrapper.find('[data-test="tz-input"]');
    await input.setValue("toron");
    await flushPromises();
    await input.trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect((input.element as HTMLInputElement).value).toBe("America/Toronto");
  });
});
