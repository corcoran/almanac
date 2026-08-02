import { at } from "@almanac/core/test-support";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../api/client.js";
import { useAuthStore } from "../../stores/auth.js";
import TokenList from "./TokenList.vue";

function makeClient(): ApiClient {
  const fetchImpl = vi.fn(async () => new Response("noop", { status: 500 }));
  return new ApiClient({ baseUrl: "/api", fetchImpl });
}

function makeToken(
  overrides: Partial<{
    id: number;
    name: string;
    prefix: string;
    last_used_at: string | null;
    created_at: string;
  }> = {},
) {
  return {
    id: 1,
    name: "Laptop",
    prefix: "alm_aaaaaaaa",
    last_used_at: null,
    created_at: "2026-05-20T12:00:00Z",
    ...overrides,
  };
}

describe("TokenList", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the empty-state hint when there are no tokens", () => {
    const auth = useAuthStore();
    // Force the resolved-but-empty state — default 'idle' would also avoid
    // the loading branch, but 'ready' is what we actually see post-fetch.
    auth.status = "ready";
    const wrapper = mount(TokenList, { props: { client: makeClient() } });
    const empty = wrapper.find('[data-test="token-list-empty"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain("No tokens yet");
  });

  it("renders the loading hint while loadTokens is in flight", () => {
    const auth = useAuthStore();
    // Mimic the brief window after SettingsPanel mount triggers loadTokens
    // but before the response arrives: status flips to 'loading' while the
    // tokens array is still []. Without this branch we'd flash the
    // empty-state copy and then the row list.
    auth.status = "loading";
    auth.tokens = [];
    const wrapper = mount(TokenList, { props: { client: makeClient() } });
    const loading = wrapper.find('[data-test="token-list-loading"]');
    expect(loading.exists()).toBe(true);
    expect(loading.text()).toContain("Loading tokens");
    // And the empty-state isn't simultaneously shown.
    expect(wrapper.find('[data-test="token-list-empty"]').exists()).toBe(false);
  });

  it("renders one row per token with prefix and name", () => {
    const auth = useAuthStore();
    auth.tokens = [
      makeToken({ id: 1, name: "Laptop", prefix: "alm_aa" }),
      makeToken({ id: 2, name: "Phone", prefix: "alm_bb" }),
    ];
    const wrapper = mount(TokenList, { props: { client: makeClient() } });
    const rows = wrapper.findAll('[data-test="token-row"]');
    expect(rows).toHaveLength(2);
    expect(at(rows, 0).text()).toContain("alm_aa");
    expect(at(rows, 0).text()).toContain("Laptop");
    expect(at(rows, 1).text()).toContain("alm_bb");
    expect(at(rows, 1).text()).toContain("Phone");
  });

  it("renders 'last used Never' when last_used_at is null", () => {
    const auth = useAuthStore();
    auth.tokens = [makeToken({ last_used_at: null })];
    const wrapper = mount(TokenList, { props: { client: makeClient() } });
    expect(wrapper.find('[data-test="token-row"]').text()).toContain("Never");
  });

  it("clicking Revoke shows the inline confirm and does NOT call revokeToken", async () => {
    const auth = useAuthStore();
    auth.tokens = [makeToken({ id: 7, name: "Laptop" })];
    const spy = vi.spyOn(auth, "revokeToken").mockResolvedValue();

    const wrapper = mount(TokenList, { props: { client: makeClient() } });

    // Initial state: revoke-token button shown, confirm controls hidden.
    expect(wrapper.find('[data-test="revoke-token"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="confirm-revoke"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="cancel-revoke"]').exists()).toBe(false);

    await wrapper.find('[data-test="revoke-token"]').trigger("click");

    // After click: confirm controls shown, revoke-token button hidden.
    expect(wrapper.find('[data-test="revoke-token"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="confirm-revoke"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="cancel-revoke"]').exists()).toBe(true);

    // The actual revoke has NOT been called yet.
    expect(spy).not.toHaveBeenCalled();
  });

  it("cancel-revoke hides the confirm controls without calling revokeToken", async () => {
    const auth = useAuthStore();
    auth.tokens = [makeToken({ id: 7, name: "Laptop" })];
    const spy = vi.spyOn(auth, "revokeToken").mockResolvedValue();

    const wrapper = mount(TokenList, { props: { client: makeClient() } });

    // Open the confirm.
    await wrapper.find('[data-test="revoke-token"]').trigger("click");
    expect(wrapper.find('[data-test="confirm-revoke"]').exists()).toBe(true);

    // Cancel.
    await wrapper.find('[data-test="cancel-revoke"]').trigger("click");

    // Confirm controls gone, revoke-token button back.
    expect(wrapper.find('[data-test="confirm-revoke"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="cancel-revoke"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="revoke-token"]').exists()).toBe(true);

    // Still no call.
    expect(spy).not.toHaveBeenCalled();
  });

  it("confirm-revoke calls auth.revokeToken exactly once with the row id", async () => {
    const auth = useAuthStore();
    auth.tokens = [makeToken({ id: 7, name: "Laptop" })];
    const spy = vi.spyOn(auth, "revokeToken").mockResolvedValue();

    const client = makeClient();
    const wrapper = mount(TokenList, { props: { client } });

    // Open the confirm then confirm.
    await wrapper.find('[data-test="revoke-token"]').trigger("click");
    await wrapper.find('[data-test="confirm-revoke"]').trigger("click");

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(client, 7);
  });

  it("only shows the inline confirm for the clicked row when multiple tokens exist", async () => {
    const auth = useAuthStore();
    auth.tokens = [makeToken({ id: 1, name: "Laptop" }), makeToken({ id: 2, name: "Phone" })];
    const spy = vi.spyOn(auth, "revokeToken").mockResolvedValue();

    const wrapper = mount(TokenList, { props: { client: makeClient() } });
    const rows = wrapper.findAll('[data-test="token-row"]');

    // Click revoke on the first row.
    await at(rows, 0).find('[data-test="revoke-token"]').trigger("click");

    // First row is in confirm state; second row still shows the normal button.
    expect(at(rows, 0).find('[data-test="confirm-revoke"]').exists()).toBe(true);
    expect(at(rows, 1).find('[data-test="revoke-token"]').exists()).toBe(true);
    expect(at(rows, 1).find('[data-test="confirm-revoke"]').exists()).toBe(false);

    expect(spy).not.toHaveBeenCalled();
  });

  it("clears confirm state even when revokeToken throws", async () => {
    const auth = useAuthStore();
    auth.tokens = [makeToken({ id: 7, name: "Laptop" })];
    vi.spyOn(auth, "revokeToken").mockRejectedValue(new Error("boom"));

    const client = makeClient();
    // Install a Vue-level error handler so Vue's callWithAsyncErrorHandling
    // swallows the rejection locally instead of re-emitting it as an
    // unhandled-rejection event to the Node process.
    const wrapper = mount(TokenList, {
      props: { client },
      global: { config: { errorHandler: () => undefined } },
    });

    // Open the confirm.
    await wrapper.find('[data-test="revoke-token"]').trigger("click");
    expect(wrapper.find('[data-test="confirm-revoke"]').exists()).toBe(true);

    // Confirm — the store throws, but the finally must clear confirm state.
    await wrapper.find('[data-test="confirm-revoke"]').trigger("click");
    // Allow the rejected promise to settle through the microtask queue.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Confirm controls gone, revoke-token button back.
    expect(wrapper.find('[data-test="confirm-revoke"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="cancel-revoke"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="revoke-token"]').exists()).toBe(true);
  });
});
