import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../api/client.js";
import { useAuthStore } from "../../stores/auth.js";
import CreateTokenForm from "./CreateTokenForm.vue";

function makeClient(): ApiClient {
  const fetchImpl = vi.fn(async () => new Response("noop", { status: 500 }));
  return new ApiClient({ baseUrl: "/api", fetchImpl });
}

describe("CreateTokenForm", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("submit button is disabled while the input is empty", () => {
    const wrapper = mount(CreateTokenForm, { props: { client: makeClient() } });
    const btn = wrapper.find('[data-test="create-token-submit"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
  });

  it("submit button enables once the input has a non-blank value", async () => {
    const wrapper = mount(CreateTokenForm, { props: { client: makeClient() } });
    await wrapper.find('[data-test="create-token-name"]').setValue("MCP Laptop");
    const btn = wrapper.find('[data-test="create-token-submit"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("submit ignores whitespace-only input", async () => {
    const wrapper = mount(CreateTokenForm, { props: { client: makeClient() } });
    await wrapper.find('[data-test="create-token-name"]').setValue("   ");
    const btn = wrapper.find('[data-test="create-token-submit"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
  });

  it("calls auth.createToken with the trimmed name and clears the input on success", async () => {
    const auth = useAuthStore();
    const spy = vi.spyOn(auth, "createToken").mockResolvedValue();
    const client = makeClient();
    const wrapper = mount(CreateTokenForm, { props: { client } });

    await wrapper.find('[data-test="create-token-name"]').setValue("  MCP Laptop  ");
    await wrapper.find('[data-test="create-token-form"]').trigger("submit");

    expect(spy).toHaveBeenCalledWith(client, "MCP Laptop");

    // After successful resolution, the input is cleared.
    await wrapper.vm.$nextTick();
    const input = wrapper.find('[data-test="create-token-name"]').element as HTMLInputElement;
    expect(input.value).toBe("");
  });
});
