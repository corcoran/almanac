import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import StopPhaseDialog from "./StopPhaseDialog.vue";

function stubClient() {
  return { patch: vi.fn().mockResolvedValue({}) };
}

const phase = { id: 7, started_on: "2026-06-01" };

describe("StopPhaseDialog", () => {
  it("rejects an end date before started_on and does not call the API", async () => {
    const client = stubClient();
    const wrapper = mount(StopPhaseDialog, {
      props: { client: client as unknown as never, phase, today: "2026-06-21" },
    });
    await wrapper.find('[data-test="end-date"]').setValue("2026-05-30");
    await wrapper.find('[data-test="confirm"]').trigger("click");
    expect(wrapper.find('[data-test="error"]').exists()).toBe(true);
    expect(client.patch).not.toHaveBeenCalled();
  });

  it("PATCHes ended_on and emits stopped on confirm", async () => {
    const client = stubClient();
    const wrapper = mount(StopPhaseDialog, {
      props: { client: client as unknown as never, phase, today: "2026-06-21" },
    });
    await wrapper.find('[data-test="confirm"]').trigger("click");
    expect(client.patch).toHaveBeenCalledWith(
      "/v1/nutrition-phases/7",
      { ended_on: "2026-06-21" },
      expect.anything(),
    );
    expect(wrapper.emitted("stopped")).toBeTruthy();
  });

  it("defaults the end-date input to today", () => {
    const wrapper = mount(StopPhaseDialog, {
      props: { client: stubClient() as unknown as never, phase, today: "2026-06-21" },
    });
    expect((wrapper.find('[data-test="end-date"]').element as HTMLInputElement).value).toBe(
      "2026-06-21",
    );
  });

  it("emits close on cancel", async () => {
    const wrapper = mount(StopPhaseDialog, {
      props: { client: stubClient() as unknown as never, phase, today: "2026-06-21" },
    });
    await wrapper.find('[data-test="cancel"]').trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });
});
