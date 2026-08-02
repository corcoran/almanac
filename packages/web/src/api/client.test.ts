import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClient } from "./client.js";
import type { ApiError } from "./errors.js";

const PingSchema = z.object({ ok: z.boolean() });

describe("ApiClient", () => {
  it("returns parsed JSON on 2xx with matching schema", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const result = await client.get("/v1/ping", PingSchema);
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/ping",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws ApiError('http') on non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    await expect(client.get("/v1/ping", PingSchema)).rejects.toMatchObject({
      kind: "http",
      status: 500,
    } satisfies Partial<ApiError>);
  });

  it("throws ApiError('parse') when response doesn't match schema", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: "not-a-bool" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    await expect(client.get("/v1/ping", PingSchema)).rejects.toMatchObject({
      kind: "parse",
    } satisfies Partial<ApiError>);
  });

  it("throws ApiError('network') when fetch rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    await expect(client.get("/v1/ping", PingSchema)).rejects.toMatchObject({
      kind: "network",
    } satisfies Partial<ApiError>);
  });

  it("short-circuits 204 No Content without calling response.json()", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const result = await client.get("/v1/ping", z.undefined());
    expect(result).toBeUndefined();
  });
});

describe("ApiClient.post", () => {
  it("sends JSON body with content-type and returns parsed response", async () => {
    const ResponseSchema = z.object({ id: z.number() });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 42 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const result = await client.post("/v1/things", { name: "x" }, ResponseSchema);
    expect(result).toEqual({ id: 42 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/things",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "x" }),
        headers: expect.objectContaining({ "content-type": "application/json" }),
      }),
    );
  });

  it("throws ApiError('http') on non-2xx", async () => {
    const ResponseSchema = z.object({ id: z.number() });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    await expect(client.post("/v1/things", {}, ResponseSchema)).rejects.toMatchObject({
      kind: "http",
      status: 500,
    } satisfies Partial<ApiError>);
  });
});

describe("ApiClient.put", () => {
  it("sends JSON body and returns parsed response", async () => {
    const ResponseSchema = z.object({ ok: z.boolean() });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const result = await client.put("/v1/things/1", { name: "y" }, ResponseSchema);
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/things/1",
      expect.objectContaining({ method: "PUT" }),
    );
  });
});

describe("ApiClient.patch", () => {
  it("sends JSON body and returns parsed response", async () => {
    const ResponseSchema = z.object({ ok: z.boolean() });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const result = await client.patch("/v1/things/1", { name: "y" }, ResponseSchema);
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/things/1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});

describe("ApiClient.delete", () => {
  it("sends DELETE with no body and parses 204 via z.undefined()", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    const result = await client.delete("/v1/things/1", z.undefined());
    expect(result).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/things/1",
      expect.objectContaining({ method: "DELETE" }),
    );
    // No body — and therefore no content-type header — was sent.
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.body).toBeUndefined();
  });

  it("throws ApiError('http') on non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new ApiClient({ baseUrl: "/api", fetchImpl });
    await expect(client.delete("/v1/things/1", z.undefined())).rejects.toMatchObject({
      kind: "http",
      status: 500,
    } satisfies Partial<ApiError>);
  });
});
