import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AboutMeField from "./AboutMeField.vue";

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
    llm_logging_enabled: 1,
    about_me: null,
    created_at: "2026-01-01T00:00:00Z",
    ...user,
  };
  return {
    get: vi.fn().mockResolvedValue(base),
    patch: vi
      .fn()
      .mockImplementation((_path, body) =>
        Promise.resolve({ ...base, about_me: (body as { about_me: string | null }).about_me }),
      ),
  };
}

describe("AboutMeField", () => {
  it("pre-fills the textarea from GET /v1/users/me", async () => {
    const client = stubClient({ about_me: "Vegetarian, training for a century ride." });
    const wrapper = mount(AboutMeField, { props: { client: client as unknown as never } });
    await flushPromises();
    expect(
      (wrapper.find('[data-test="about-me-input"]').element as HTMLTextAreaElement).value,
    ).toBe("Vegetarian, training for a century ride.");
  });

  it("PATCHes the trimmed value on Save", async () => {
    const client = stubClient({ about_me: null });
    const wrapper = mount(AboutMeField, { props: { client: client as unknown as never } });
    await flushPromises();
    await wrapper.find('[data-test="about-me-input"]').setValue("  cutting back on drinks  ");
    await wrapper.find('[data-test="about-me-save"]').trigger("click");
    await flushPromises();
    expect(client.patch).toHaveBeenCalledWith(
      "/v1/users/me",
      { about_me: "cutting back on drinks" },
      expect.anything(),
    );
  });

  it("disables Save when over 600 chars", async () => {
    const client = stubClient({ about_me: null });
    const wrapper = mount(AboutMeField, { props: { client: client as unknown as never } });
    await flushPromises();
    await wrapper.find('[data-test="about-me-input"]').setValue("x".repeat(601));
    await flushPromises();
    expect(
      (wrapper.find('[data-test="about-me-save"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(wrapper.find('[data-test="about-me-count"]').text()).toContain("601");
  });
});
