import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../api/client.js";
import { useAuthStore } from "../../stores/auth.js";
import SettingsPanel from "./SettingsPanel.vue";
import TimezoneSelector from "./TimezoneSelector.vue";
import UnitSelector from "./UnitSelector.vue";

function makeClient(): ApiClient {
  const fetchImpl = vi.fn(async () => new Response("noop", { status: 500 }));
  return new ApiClient({ baseUrl: "/api", fetchImpl });
}

// Stub the Profile-section children (each fires its own GET /v1/users/me on
// mount) so these panel-level tests stay focused on the panel's own behavior
// rather than the children's network calls against the 500ing client.
const childStubs = {
  CreateTokenForm: true,
  NewTokenReveal: true,
  TokenList: true,
  ActivitySelector: true,
  UnitSelector: true,
  TimezoneSelector: true,
};

describe("SettingsPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls auth.loadTokens on mount", () => {
    const auth = useAuthStore();
    const spy = vi.spyOn(auth, "loadTokens").mockResolvedValue();
    const client = makeClient();
    mount(SettingsPanel, {
      props: { client },
      global: { stubs: childStubs },
    });
    expect(spy).toHaveBeenCalledWith(client);
  });

  it("renders the modal heading", () => {
    const wrapper = mount(SettingsPanel, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
    });
    expect(wrapper.text()).toContain("Settings");
    expect(wrapper.text()).toContain("Personal Access Tokens");
  });

  it("close button emits close", async () => {
    const wrapper = mount(SettingsPanel, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
    });
    await wrapper.find('[data-test="settings-close"]').trigger("click");
    expect(wrapper.emitted("close")).toEqual([[]]);
  });

  it("Esc key on the focused modal card emits close", async () => {
    const wrapper = mount(SettingsPanel, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
      attachTo: document.body,
    });
    // The card is the tabindex="-1" element that takes focus on mount, so
    // it (not the backdrop) is where keydown.esc actually reaches the
    // handler. Mirrors EndSessionDialog's auto-focus pattern.
    await wrapper.find('[data-test="settings-card"]').trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });

  it("clicking the backdrop emits close (clicks on the card do not)", async () => {
    const wrapper = mount(SettingsPanel, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
    });
    // Clicking inside the card should NOT close. We trigger on the .modal
    // child — its @click.stop prevents the backdrop's handler from firing.
    await wrapper.find(".modal").trigger("click");
    expect(wrapper.emitted("close")).toBeUndefined();

    // Clicking the backdrop itself does close. trigger("click") on the
    // root component dispatches with target === currentTarget.
    await wrapper.find('[data-test="settings-panel"]').trigger("click");
    expect(wrapper.emitted("close")).toEqual([[]]);
  });

  it("renders NewTokenReveal only when auth.lastMintedToken is set", async () => {
    const auth = useAuthStore();
    vi.spyOn(auth, "loadTokens").mockResolvedValue();
    const wrapper = mount(SettingsPanel, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
    });
    expect(wrapper.findComponent({ name: "NewTokenReveal" }).exists()).toBe(false);

    auth.lastMintedToken = "alm_x.secret";
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent({ name: "NewTokenReveal" }).exists()).toBe(true);
  });

  it("mounts CreateTokenForm and TokenList children", () => {
    const wrapper = mount(SettingsPanel, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
    });
    expect(wrapper.findComponent({ name: "CreateTokenForm" }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: "TokenList" }).exists()).toBe(true);
  });

  it("mounts the unit and timezone selectors in the Profile section", () => {
    const wrapper = mount(SettingsPanel, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
    });
    expect(wrapper.findComponent(UnitSelector).exists()).toBe(true);
    expect(wrapper.findComponent(TimezoneSelector).exists()).toBe(true);
  });

  it("renders the What's new section", () => {
    const wrapper = mount(SettingsPanel, {
      props: { client: makeClient() },
      global: { stubs: childStubs },
    });
    expect(wrapper.find("[data-test='whats-new']").exists()).toBe(true);
    expect(wrapper.text()).toContain("What's new");
  });
});
