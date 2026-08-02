import type { ZodTypeAny, z } from "zod";
import type { ApiError } from "./errors.js";

export type ApiClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export class ApiClient {
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async get<S extends ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>> {
    return this.request("GET", path, undefined, schema);
  }

  async post<S extends ZodTypeAny>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
    return this.request("POST", path, body, schema);
  }

  async put<S extends ZodTypeAny>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
    return this.request("PUT", path, body, schema);
  }

  async patch<S extends ZodTypeAny>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
    return this.request("PATCH", path, body, schema);
  }

  // DELETE has no body. The auth-token revoke endpoint returns 204, which the
  // request() helper already short-circuits through the schema with
  // `undefined` — callers pass `z.undefined()` or `z.void()`.
  async delete<S extends ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>> {
    return this.request("DELETE", path, undefined, schema);
  }

  private async request<S extends ZodTypeAny>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    schema: S,
  ): Promise<z.infer<S>> {
    let response: Response;
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { "content-type": "application/json" };
    }
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (cause) {
      const err: ApiError = { kind: "network", cause };
      throw err;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const err: ApiError = { kind: "http", status: response.status, body: text };
      throw err;
    }

    // Defensive: 204 No Content or empty body → parse undefined so future
    // 204/empty-body consumers don't surface as "parse" errors — they get
    // undefined which the caller's schema can accept or reject.
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      const parsed = schema.safeParse(undefined);
      if (!parsed.success) {
        const err: ApiError = { kind: "parse", issues: parsed.error.issues };
        throw err;
      }
      return parsed.data;
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (cause) {
      const err: ApiError = { kind: "parse", issues: cause };
      throw err;
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const err: ApiError = { kind: "parse", issues: parsed.error.issues };
      throw err;
    }
    return parsed.data;
  }
}
