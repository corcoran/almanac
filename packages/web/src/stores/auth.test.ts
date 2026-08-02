import { defined } from "@almanac/core/test-support";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { useAuthStore } from "./auth.js";

// -- Fixtures ----------------------------------------------------------------

function makeWhoami() {
  return {
    id: 1,
    name: "Jeff Corcoran",
    email: "jeff@example.com",
    preferred_unit_system: "metric" as const,
    timezone: "America/Toronto",
    llm_logging_enabled: 0,
    llm_available: false,
  };
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
    id: 7,
    name: "MCP Laptop",
    prefix: "alm_abc12345",
    last_used_at: null,
    created_at: "2026-05-20T12:00:00Z",
    ...overrides,
  };
}

// -- Helpers -----------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Wires a fake fetchImpl whose behavior is dispatched on `${method} ${path}`.
// Returns the spy so individual tests can inspect call args.
function buildClient(routes: Record<string, () => Response | Promise<Response>>) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = typeof input === "string" ? input : input.toString();
    // Strip the /api prefix so route keys read naturally.
    const path = url.replace(/^\/api/, "");
    const key = `${method} ${path}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unhandled ${key}`);
    return handler();
  }) as unknown as typeof fetch;
  return {
    client: new ApiClient({ baseUrl: "/api", fetchImpl }),
    fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn>,
  };
}

// -- Tests -------------------------------------------------------------------

describe("useAuthStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts in idle with no me / no tokens / no minted token", () => {
    const store = useAuthStore();
    expect(store.status).toBe("idle");
    expect(store.me).toBeNull();
    expect(store.tokens).toEqual([]);
    expect(store.lastMintedToken).toBeNull();
    expect(store.error).toBeNull();
  });

  it("loadWhoami transitions to ready and populates `me`", async () => {
    const fixture = makeWhoami();
    const { client } = buildClient({
      "GET /v1/auth/whoami": () => jsonResponse(fixture),
    });
    const store = useAuthStore();
    await store.loadWhoami(client);
    expect(store.status).toBe("ready");
    expect(store.me).toEqual(fixture);
  });

  it("loadWhoami sets error on http failure", async () => {
    const { client } = buildClient({
      "GET /v1/auth/whoami": () => new Response("nope", { status: 500 }),
    });
    const store = useAuthStore();
    await store.loadWhoami(client);
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });

  it("loadTokens populates `tokens`", async () => {
    const a = makeToken({ id: 1, name: "Laptop", prefix: "alm_a" });
    const b = makeToken({ id: 2, name: "Phone", prefix: "alm_b" });
    const { client } = buildClient({
      "GET /v1/auth/tokens": () => jsonResponse([a, b]),
    });
    const store = useAuthStore();
    await store.loadTokens(client);
    expect(store.tokens).toEqual([a, b]);
  });

  it("loadTokens drives status: loading → ready (consumer can branch on it)", async () => {
    // Use a deferred response so we can observe the in-flight 'loading'
    // state — without this, the await resolves before we can read `status`
    // and we'd only ever see the terminal 'ready'.
    let resolveFetch: (r: Response) => void = () => {};
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const store = useAuthStore();

    const inFlight = store.loadTokens(client);
    // Synchronous state immediately after kickoff: status should be loading.
    expect(store.status).toBe("loading");
    expect(store.error).toBeNull();

    resolveFetch(jsonResponse([]));
    await inFlight;
    expect(store.status).toBe("ready");
  });

  it("loadTokens sets error + status='error' on http failure", async () => {
    const { client } = buildClient({
      "GET /v1/auth/tokens": () => new Response("nope", { status: 500 }),
    });
    const store = useAuthStore();
    await store.loadTokens(client);
    expect(store.status).toBe("error");
    expect(store.error?.kind).toBe("http");
  });

  it("createToken stores cleartext on `lastMintedToken` and reloads list", async () => {
    const minted = {
      ...makeToken({ id: 99, name: "MCP", prefix: "alm_99abcdef" }),
      token: "alm_99abcdef.full-secret-shown-once",
    };
    const reloaded = [makeToken({ id: 99, name: "MCP", prefix: "alm_99abcdef" })];
    const { client, fetchImpl } = buildClient({
      "POST /v1/auth/tokens": () => jsonResponse(minted, 201),
      "GET /v1/auth/tokens": () => jsonResponse(reloaded),
    });
    const store = useAuthStore();
    await store.createToken(client, "MCP");

    expect(store.lastMintedToken).toBe("alm_99abcdef.full-secret-shown-once");
    // List reflects the (cleartext-stripped) reload, not the mint response.
    expect(store.tokens).toEqual(reloaded);
    // Two HTTP calls: POST (mint) then GET (reload).
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const calls = fetchImpl.mock.calls as Array<[string, RequestInit]>;
    const [post, get] = calls;
    expect(post).toBeDefined();
    expect(get).toBeDefined();
    expect(defined(post, "post")[0]).toBe("/api/v1/auth/tokens");
    expect(defined(post, "post")[1].method).toBe("POST");
    expect(defined(post, "post")[1].body).toBe(JSON.stringify({ name: "MCP" }));
    expect(defined(get, "get")[1].method).toBe("GET");
  });

  it("revokeToken DELETEs the id and reloads the list", async () => {
    const { client, fetchImpl } = buildClient({
      "DELETE /v1/auth/tokens/42": () => new Response(null, { status: 204 }),
      "GET /v1/auth/tokens": () => jsonResponse([]),
    });
    const store = useAuthStore();
    // Prime with a stale token to confirm the reload mutates state.
    store.tokens = [makeToken({ id: 42 })];

    await store.revokeToken(client, 42);

    expect(store.tokens).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const calls = fetchImpl.mock.calls as Array<[string, RequestInit]>;
    const [del, get] = calls;
    expect(del).toBeDefined();
    expect(get).toBeDefined();
    expect(defined(del, "del")[0]).toBe("/api/v1/auth/tokens/42");
    expect(defined(del, "del")[1].method).toBe("DELETE");
    expect(defined(get, "get")[0]).toBe("/api/v1/auth/tokens");
    expect(defined(get, "get")[1].method).toBe("GET");
  });

  it("dismissMintedToken clears the cleartext", () => {
    const store = useAuthStore();
    store.lastMintedToken = "alm_x.secret";
    store.dismissMintedToken();
    expect(store.lastMintedToken).toBeNull();
  });
});
