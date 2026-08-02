import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../../stores/auth.js";
import NewTokenReveal from "./NewTokenReveal.vue";

const CLEARTEXT = "alm_99abcdef.full-secret-shown-once";

describe("NewTokenReveal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the cleartext token inside a <code> block (copy-friendly)", () => {
    const wrapper = mount(NewTokenReveal, { props: { token: CLEARTEXT } });
    const code = wrapper.find('[data-test="new-token-cleartext"]');
    expect(code.element.tagName).toBe("CODE");
    expect(code.text()).toBe(CLEARTEXT);
  });

  it("surfaces the one-time warning prominently", () => {
    const wrapper = mount(NewTokenReveal, { props: { token: CLEARTEXT } });
    const warn = wrapper.find('[data-test="new-token-warning"]');
    expect(warn.text()).toContain("only time you'll see this token");
  });

  it("dismiss button clears auth.lastMintedToken", async () => {
    const auth = useAuthStore();
    auth.lastMintedToken = CLEARTEXT;
    const wrapper = mount(NewTokenReveal, { props: { token: CLEARTEXT } });
    await wrapper.find('[data-test="new-token-dismiss"]').trigger("click");
    expect(auth.lastMintedToken).toBeNull();
  });

  it("copy button writes the cleartext to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // jsdom doesn't ship navigator.clipboard. Define it for the test.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const wrapper = mount(NewTokenReveal, { props: { token: CLEARTEXT } });
    await wrapper.find('[data-test="new-token-copy"]').trigger("click");
    expect(writeText).toHaveBeenCalledWith(CLEARTEXT);
  });
});
