import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BlockEditButton from "./BlockEditButton.vue";

describe("BlockEditButton", () => {
  it("renders a button with the default aria-label", () => {
    const wrapper = mount(BlockEditButton);
    const btn = wrapper.find('[data-test="block-edit"]');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("aria-label")).toBe("Edit");
  });

  it("uses a custom aria-label when label prop is given", () => {
    const wrapper = mount(BlockEditButton, { props: { label: "Edit weight" } });
    expect(wrapper.find('[data-test="block-edit"]').attributes("aria-label")).toBe("Edit weight");
  });

  it("emits click when pressed", async () => {
    const wrapper = mount(BlockEditButton);
    await wrapper.find('[data-test="block-edit"]').trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });
});
