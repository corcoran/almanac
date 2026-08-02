import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ActivitySelector from "./ActivitySelector.vue";

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
    patch: vi.fn().mockResolvedValue({ ...base, activity_level: "active" }),
  };
}

describe("ActivitySelector", () => {
  it("seeds the control from GET /v1/users/me", async () => {
    const client = stubClient({ activity_level: "moderate" });
    const wrapper = mount(ActivitySelector, { props: { client: client as unknown as never } });
    await flushPromises();
    expect((wrapper.find('[data-test="activity-select"]').element as HTMLSelectElement).value).toBe(
      "moderate",
    );
  });

  it("PATCHes the chosen activity_level on change", async () => {
    const client = stubClient();
    const wrapper = mount(ActivitySelector, { props: { client: client as unknown as never } });
    await flushPromises();
    await wrapper.find('[data-test="activity-select"]').setValue("active");
    await flushPromises();
    expect(client.patch).toHaveBeenCalledWith(
      "/v1/users/me",
      { activity_level: "active" },
      expect.anything(),
    );
  });

  it("shows the measured-basis caption only when on measured_intake", async () => {
    const client = stubClient();
    const measured = mount(ActivitySelector, {
      props: { client: client as unknown as never, tdeeBasis: "measured_intake" },
    });
    await flushPromises();
    expect(measured.find('[data-test="activity-measured-caption"]').exists()).toBe(true);

    const baseline = mount(ActivitySelector, {
      props: { client: stubClient() as unknown as never, tdeeBasis: "profile_baseline" },
    });
    await flushPromises();
    expect(baseline.find('[data-test="activity-measured-caption"]').exists()).toBe(false);
    expect(baseline.find('[data-test="activity-helper"]').exists()).toBe(true);
  });
});
