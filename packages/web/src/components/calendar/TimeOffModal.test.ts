import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../api/client.js";
import TimeOffModal from "./TimeOffModal.vue";

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PERIOD = {
  id: 1,
  user_id: 1,
  started_on: "2026-06-10",
  ended_on: "2026-06-14",
  reason: "vacation" as const,
  notes: null,
  created_at: "2026-06-09T12:00:00Z",
};

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("TimeOffModal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("lists existing periods after load", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonOk([PERIOD]));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const wrapper = mount(TimeOffModal, {
      props: { client, month: "2026-06", today: "2026-06-25" },
    });
    await flush();
    expect(wrapper.find('[data-test="period-row"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("2026-06-10");
  });

  it("shows an empty state when there are no periods", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonOk([]));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const wrapper = mount(TimeOffModal, {
      props: { client, month: "2026-06", today: "2026-06-25" },
    });
    await flush();
    expect(wrapper.find('[data-test="empty-state"]').exists()).toBe(true);
  });

  it("disables submit when end is before start", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonOk([]));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const wrapper = mount(TimeOffModal, {
      props: { client, month: "2026-06", today: "2026-06-25" },
    });
    await flush();
    await wrapper.find('[data-test="start-on"]').setValue("2026-06-20");
    await wrapper.find('[data-test="end-on"]').setValue("2026-06-18");
    expect(wrapper.find('[data-test="create-submit"]').attributes("disabled")).toBeDefined();
  });

  it("creates a period and emits changed", async () => {
    const created = { ...PERIOD, id: 2, started_on: "2026-07-01", ended_on: "2026-07-03" };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([]))
      .mockResolvedValueOnce(jsonOk(created, 201));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const wrapper = mount(TimeOffModal, {
      props: { client, month: "2026-07", today: "2026-07-10" },
    });
    await flush();
    await wrapper.find('[data-test="start-on"]').setValue("2026-07-01");
    await wrapper.find('[data-test="end-on"]').setValue("2026-07-03");
    await wrapper.find('[data-test="create-submit"]').trigger("click");
    await flush();
    expect(wrapper.emitted("changed")).toBeTruthy();
    expect(wrapper.find('[data-test="period-row"]').exists()).toBe(true);
  });

  it("shows the overlap error inline and does not emit changed", async () => {
    const overlapBody = {
      error: "period_overlap",
      message: "overlaps",
      conflicting_period: PERIOD,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PERIOD]))
      .mockResolvedValueOnce(jsonOk(overlapBody, 422));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const wrapper = mount(TimeOffModal, {
      props: { client, month: "2026-06", today: "2026-06-25" },
    });
    await flush();
    await wrapper.find('[data-test="start-on"]').setValue("2026-06-12");
    await wrapper.find('[data-test="end-on"]').setValue("2026-06-13");
    await wrapper.find('[data-test="create-submit"]').trigger("click");
    await flush();
    expect(wrapper.find('[data-test="create-error"]').text()).toContain("overlaps an existing");
    expect(wrapper.emitted("changed")).toBeFalsy();
  });

  it("deletes a period after confirm and emits changed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonOk([PERIOD]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const wrapper = mount(TimeOffModal, {
      props: { client, month: "2026-06", today: "2026-06-25" },
    });
    await flush();
    await wrapper.find('[data-test="period-delete"]').trigger("click");
    await flush();
    expect(confirmSpy).toHaveBeenCalled();
    expect(wrapper.emitted("changed")).toBeTruthy();
    expect(wrapper.find('[data-test="empty-state"]').exists()).toBe(true);
    confirmSpy.mockRestore();
  });
});
