import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PhaseOnboardingCard from "./PhaseOnboardingCard.vue";

describe("PhaseOnboardingCard", () => {
  it("State A (profileComplete=false): single step, form collects weight inline", () => {
    const wrapper = mount(PhaseOnboardingCard, { props: { profileComplete: false } });
    expect(wrapper.find('[data-test="onboarding-card"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Let's set up your targets");
    expect(wrapper.text()).toContain("Start a nutrition phase");
    // The misleading "log a weight first" prerequisite is gone — the form asks
    // for the current weight inline, so there's nothing to hunt for beforehand.
    expect(wrapper.text()).not.toContain("Log your current weight");
    expect(wrapper.text().toLowerCase()).toContain("asks for your current weight");
    // The create button is present in both states.
    expect(wrapper.find('button[data-test="onboarding-create-phase"]').exists()).toBe(true);
  });

  it("State B (profileComplete=true): weight done, prompts next phase", () => {
    const wrapper = mount(PhaseOnboardingCard, { props: { profileComplete: true } });
    expect(wrapper.text()).toContain("Start your next phase");
    expect(wrapper.text()).toContain("Weight logged");
    // Reassuring copy that logging keeps working.
    expect(wrapper.text().toLowerCase()).toContain("still logging");
    expect(wrapper.find('button[data-test="onboarding-create-phase"]').exists()).toBe(true);
  });

  it.each([
    true,
    false,
  ])("emits `create` when the create button is clicked (profileComplete=%s)", async (profileComplete) => {
    const wrapper = mount(PhaseOnboardingCard, { props: { profileComplete } });
    await wrapper.find('[data-test="onboarding-create-phase"]').trigger("click");
    expect(wrapper.emitted("create")).toHaveLength(1);
  });

  it("State A lists the full 6-item unlock grid", () => {
    const wrapper = mount(PhaseOnboardingCard, { props: { profileComplete: false } });
    expect(wrapper.text()).toContain("Daily targets");
    expect(wrapper.text()).toContain("Remaining today");
    expect(wrapper.text()).toContain("On-track status");
    expect(wrapper.findAll(".grid .it")).toHaveLength(6);
  });

  it("State B shows the concise 'resumes' grid (4 items)", () => {
    const wrapper = mount(PhaseOnboardingCard, { props: { profileComplete: true } });
    expect(wrapper.text()).toContain("Resumes when you start");
    expect(wrapper.findAll(".grid .it")).toHaveLength(4);
  });
});
