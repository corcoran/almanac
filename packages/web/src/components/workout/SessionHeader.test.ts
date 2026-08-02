import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SessionHeader from "./SessionHeader.vue";

describe("SessionHeader cancel-session affordance", () => {
  const baseProps = {
    templateName: "PUSH A",
    startedAt: "2026-05-21T17:00:00.000Z",
    completedCount: 0,
    totalCount: 4,
  };

  it("shows Cancel session button by default", () => {
    const wrapper = mount(SessionHeader, { props: baseProps });
    expect(wrapper.find('[data-test="cancel-session"]').exists()).toBe(true);
  });

  it("reveals Discard / Keep going on Cancel session click", async () => {
    const wrapper = mount(SessionHeader, { props: baseProps });
    await wrapper.find('[data-test="cancel-session"]').trigger("click");
    expect(wrapper.find('[data-test="cancel-discard"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="cancel-keep"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="cancel-session"]').exists()).toBe(false);
  });

  it("Discard emits cancel", async () => {
    const wrapper = mount(SessionHeader, { props: baseProps });
    await wrapper.find('[data-test="cancel-session"]').trigger("click");
    await wrapper.find('[data-test="cancel-discard"]').trigger("click");
    expect(wrapper.emitted("cancel")).toEqual([[]]);
  });

  it("Keep going returns to default state without emitting", async () => {
    const wrapper = mount(SessionHeader, { props: baseProps });
    await wrapper.find('[data-test="cancel-session"]').trigger("click");
    await wrapper.find('[data-test="cancel-keep"]').trigger("click");
    expect(wrapper.find('[data-test="cancel-session"]').exists()).toBe(true);
    expect(wrapper.emitted("cancel")).toBeUndefined();
  });
});
