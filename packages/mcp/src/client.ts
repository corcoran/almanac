export type ApiClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

/**
 * Thrown when the API responds with a non-2xx status. Carries the parsed JSON
 * body so callers (in particular MCP tool handlers) can branch on structured
 * error envelopes — e.g. the 422 `tdee_unavailable` envelope emitted by
 * `POST /api/v1/nutrition-phases`, which the start-nutrition-phase tool needs to
 * forward verbatim rather than re-wrap.
 *
 * The string message preserves the previous format so the `.includes("404")`
 * checks scattered through the read-tools keep working unchanged.
 */
export class ApiHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(method: string, path: string, status: number, body: unknown) {
    super(`API ${method} ${path} ${status}: ${JSON.stringify(body)}`);
    this.name = "ApiHttpError";
    this.status = status;
    this.body = body;
  }
}

export class ApiClient {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Make an authenticated request to the API. The `bearer` in `extra` is the
   * per-call PAT (or static dev token) captured at MCP connection time; tool
   * handlers source it via `deps.currentToken()`. Threading the bearer per
   * call (rather than baking it into the client at construction) is what lets
   * one MCP process serve multiple users — each SSE connection closes over
   * its own bearer.
   *
   * The bearer validation is intentionally synchronous so the typecheck-via-
   * test contract (`expect(() => api.request(...)).toThrow()`) fires for
   * accidental misuse without forcing every caller to write `.rejects`.
   */
  request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    extra: { bearer: string; headers?: Record<string, string> } = { bearer: "" },
  ): Promise<T> {
    if (!extra.bearer) throw new Error("ApiClient.request requires a bearer token");
    return this.send<T>(method, path, body, extra);
  }

  private async send<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    extra: { bearer: string; headers?: Record<string, string> },
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${extra.bearer}`,
        "content-type": "application/json",
        ...(extra.headers ?? {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new ApiHttpError(method, path, res.status, errBody);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
