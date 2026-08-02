import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import OfflineBanner from "./OfflineBanner.vue";

describe("OfflineBanner", () => {
  it("renders nothing when show=false", () => {
    const wrapper = mount(OfflineBanner, { props: { show: false } });
    expect(wrapper.find('[data-test="offline-banner"]').exists()).toBe(false);
  });

  it("renders the banner when show=true", () => {
    const wrapper = mount(OfflineBanner, { props: { show: true } });
    const banner = wrapper.find('[data-test="offline-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("Couldn't reach API");
  });
});
