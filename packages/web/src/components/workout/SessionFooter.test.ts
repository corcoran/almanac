import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SessionFooter from "./SessionFooter.vue";

describe("SessionFooter", () => {
  it("disables End Session until rpe is set", () => {
    const wrapper = mount(SessionFooter, { props: { rpe: null } });
    const btn = wrapper.find('[data-test="end-session"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables End Session once rpe is set", () => {
    const wrapper = mount(SessionFooter, { props: { rpe: 7 } });
    const btn = wrapper.find('[data-test="end-session"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("emits endSession when the enabled button is clicked", async () => {
    const wrapper = mount(SessionFooter, { props: { rpe: 8 } });
    await wrapper.find('[data-test="end-session"]').trigger("click");
    expect(wrapper.emitted("endSession")).toEqual([[]]);
  });

  it("emits update:rpe when the rpe input changes", async () => {
    const wrapper = mount(SessionFooter, { props: { rpe: null } });
    await wrapper.find('[data-test="rpe-input"]').setValue("8");
    expect(wrapper.emitted("update:rpe")).toEqual([[8]]);
  });

  it("renders the prominent 'Session RPE' label and 1–10 hint", () => {
    const wrapper = mount(SessionFooter, { props: { rpe: null } });
    expect(wrapper.text()).toContain("Session RPE");
    expect(wrapper.text()).toContain("1–10");
  });
});
