import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import OnboardingCard from "./OnboardingCard.vue";

/**
 * The card reads window.location.origin at setup() time to decide whether a
 * third-party assistant could reach this deployment. jsdom's default origin is
 * http://localhost:3000, so the "public domain" case has to be stubbed.
 */
function stubOrigin(origin: string): void {
  vi.spyOn(window, "location", "get").mockReturnValue({
    ...window.location,
    origin,
  } as Location);
}

describe("OnboardingCard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns that a localhost URL is unreachable from Claude/ChatGPT web", () => {
    stubOrigin("http://localhost:4180");
    const wrapper = mount(OnboardingCard);
    expect(wrapper.find('[data-test="onboarding-local-note"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Claude Code");
    // Must NOT promise the remote-server flow that cannot work here.
    expect(wrapper.text()).not.toContain("add this as a remote MCP server");
  });

  it("keeps the remote-server instructions on a public domain", () => {
    stubOrigin("https://almanac.example.com");
    const wrapper = mount(OnboardingCard);
    expect(wrapper.find('[data-test="onboarding-local-note"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("remote MCP server");
  });

  it("shows the deployment's own /mcp URL either way", () => {
    stubOrigin("https://almanac.example.com");
    expect(mount(OnboardingCard).text()).toContain("https://almanac.example.com/mcp");
  });

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
