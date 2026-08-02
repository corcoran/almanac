import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import OnboardingCard from "./OnboardingCard.vue";

describe("OnboardingCard", () => {
  it("emits dismiss when the 'connect later' button is clicked", async () => {
    const wrapper = mount(OnboardingCard);
    await wrapper.find('[data-test="onboarding-dismiss"]').trigger("click");
    expect(wrapper.emitted("dismiss")).toBeTruthy();
  });

  it("emits open-settings from the manual-token link", async () => {
    const wrapper = mount(OnboardingCard);
    await wrapper.find(".link-btn").trigger("click");
    expect(wrapper.emitted("open-settings")).toBeTruthy();
  });
});
