import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import UserMenu from "./UserMenu.vue";

const exampleMe = {
  id: 1,
  name: "Jeff Corcoran",
  email: "jeff@example.com",
  preferred_unit_system: "metric" as const,
  timezone: "America/Toronto",
  llm_logging_enabled: 0,
  llm_available: false,
};

describe("UserMenu", () => {
  it("renders initials from a two-word name", () => {
    const wrapper = mount(UserMenu, { props: { me: exampleMe } });
    expect(wrapper.find(".initials").text()).toBe("JC");
  });

  it("falls back to first two letters when the name is a single word", () => {
    const wrapper = mount(UserMenu, {
      props: { me: { ...exampleMe, name: "Jeff" } },
    });
    expect(wrapper.find(".initials").text()).toBe("JE");
  });

  it("falls back to email initial when name is empty", () => {
    const wrapper = mount(UserMenu, {
      props: { me: { ...exampleMe, name: "" } },
    });
    expect(wrapper.find(".initials").text()).toBe("J");
  });

  it("shows ? when me is null (pre-load)", () => {
    const wrapper = mount(UserMenu, { props: { me: null } });
    expect(wrapper.find(".initials").text()).toBe("?");
  });

  it("dropdown is closed by default", () => {
    const wrapper = mount(UserMenu, { props: { me: exampleMe } });
    expect(wrapper.find('[data-test="user-menu-dropdown"]').exists()).toBe(false);
  });

  it("clicking the avatar opens the dropdown and reveals name + email", async () => {
    const wrapper = mount(UserMenu, { props: { me: exampleMe } });
    await wrapper.find('[data-test="user-menu-button"]').trigger("click");
    const dd = wrapper.find('[data-test="user-menu-dropdown"]');
    expect(dd.exists()).toBe(true);
    expect(dd.text()).toContain("Jeff Corcoran");
    expect(dd.text()).toContain("jeff@example.com");
  });

  it("clicking Settings emits open-settings and closes the dropdown", async () => {
    const wrapper = mount(UserMenu, { props: { me: exampleMe } });
    await wrapper.find('[data-test="user-menu-button"]').trigger("click");
    await wrapper.find('[data-test="user-menu-settings"]').trigger("click");
    expect(wrapper.emitted("open-settings")).toEqual([[]]);
    expect(wrapper.find('[data-test="user-menu-dropdown"]').exists()).toBe(false);
  });

  it("logout link points to the oauth2-proxy signout endpoint", async () => {
    const wrapper = mount(UserMenu, { props: { me: exampleMe } });
    await wrapper.find('[data-test="user-menu-button"]').trigger("click");
    const logout = wrapper.find('[data-test="user-menu-logout"]');
    expect(logout.attributes("href")).toBe("/oauth2/sign_out?rd=/");
  });

  it("aria-expanded toggles with the dropdown", async () => {
    const wrapper = mount(UserMenu, { props: { me: exampleMe } });
    const btn = wrapper.find('[data-test="user-menu-button"]');
    expect(btn.attributes("aria-expanded")).toBe("false");
    await btn.trigger("click");
    expect(btn.attributes("aria-expanded")).toBe("true");
  });

  it("shows the unseen badge dot when hasUnseen is true", () => {
    const wrapper = mount(UserMenu, { props: { me: exampleMe, hasUnseen: true } });
    expect(wrapper.find("[data-test='user-menu-badge']").exists()).toBe(true);
  });

  it("hides the badge when hasUnseen is false", () => {
    const wrapper = mount(UserMenu, { props: { me: exampleMe, hasUnseen: false } });
    expect(wrapper.find("[data-test='user-menu-badge']").exists()).toBe(false);
  });
});
