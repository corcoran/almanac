---
title: Architecture
---

# Architecture

How the MCP server translates natural-language tool calls from AI assistants
into validated API requests, and what mechanisms keep the data safe along the
way.

If you know REST APIs but not MCP, think of it this way: MCP is a protocol that
lets an AI assistant discover available operations (like an OpenAPI spec), call
them (like HTTP requests), and receive structured responses — but the "client"
is an LLM, not a browser. The server's job is to make the operations
discoverable, validate inputs, call the real API, and shape responses so the AI
can reason about them.

For how a client authenticates before any of this happens, see
[Connecting assistants](/guide/connecting-assistants).

## Connection and discovery

When an AI client connects to the MCP server, three things happen before any
tool is called.

**1. Capability advertisement.** The server declares that it supports tools and
resources. The client now knows it can ask for a tool list and read resources.

**2. Instructions delivery.** The server ships a short block of plain-text
instructions in the `initialize` response — a unit test holds it under 2,000
characters, since it costs context on every session. The client injects these into the
LLM's system prompt. The instructions cover:

- **Timestamp conventions** — naked local strings are interpreted in the user's
  profile timezone; only use `Z` when the user explicitly gave UTC.
- **Date conventions** — "today" is user-local with a day-start rollover; trust
  `get_today_context.now` rather than computing it.
- **Idempotency** — which log tools are safe to retry on network failure.
- **Warning protocol** — when `log_cardio` returns an `estimate_warning`
  (HR-derived kcal differs more than 20% from the user estimate), surface it
  rather than silently accepting.
- **Nudge protocol** — `get_day_status` returns nudge codes
  (`low_intake_today`, `stale_weight_log`, and others) with severities; surface
  warn and concern proactively.
- **Refusal boundaries** — don't invent kcal, don't edit history without
  confirmation, don't log for dates the user didn't mention, don't give medical
  advice.
- **Onboarding** — if the user profile is incomplete or there's no active
  nutrition phase, walk them through setup. `get_next_best_action` reports the
  next unmet setup step, and once set up, forgotten daily logs — so the client
  doesn't have to infer state.

**3. Tool catalog.** The client calls `tools/list` and receives the full tool
set. Each entry includes:

- **Name** — `log_meal`, `get_weight_trend`, `delete_workout`.
- **Description** — LLM-facing prose explaining when and how to use the tool,
  including what *not* to use it for. `log_meal`, for example, warns against
  logging alcohol as a meal to avoid double-counting kcal.
- **Input schema** — a JSON Schema object generated from the tool's Zod
  definition. Field-level descriptions are embedded; `eaten_at` explains the
  timezone interpretation rules. Clients use this to validate arguments before
  sending and to show the AI what parameters exist.
- **Annotations** — behavioral hints for the client, covered below.

There is also a `get_capabilities` tool that returns a hand-curated catalog:
every entity the system tracks, which CRUD tools apply to each, data
conventions, and step-by-step workflow recipes for common tasks
("new_user_onboarding", "log a meal the user described", "delete a duplicate
workout", "first-time setup"). It also names a `recommended_entrypoint`
(`get_next_best_action`) so a fresh client has one orienting call to start from.
This gives the AI a map of the system on first use. A unit test fails if a
registered tool isn't represented in the catalog.

Onboarding discoverability is deliberately layered — catalog
(`recommended_entrypoint`) → a dedicated `get_next_best_action` tool that
reports current setup state → per-tool follow-up hints — so an LLM peer reliably
finds "what's next?" rather than inferring it from `phase: null`.

### Resources

Five read-only resources are available at stable URIs: `almanac://today`,
`almanac://phase/current`, `almanac://stim-states`, `almanac://templates`, and
`almanac://exercises`. Clients can read these for ambient context without making
tool calls — useful for pre-loading state into an AI's context window at session
start. Each resource is a thin wrapper over a single API GET request.

## Tool annotations

Every tool carries annotations that tell the client how to treat it:

| Annotation | Meaning | Example |
| --- | --- | --- |
| `readOnlyHint: true` | No data changes. Client can skip confirmation prompts. | `get_macros_today`, `list_exercises` |
| `destructiveHint: true` | Permanent data deletion. Client should show a strong warning. | `delete_meal`, `delete_workout` |
| `idempotentHint: true` | Same input, same result; safe to retry on failure. | `log_meal`, `log_weight`, all reads |
| `idempotentHint: false` | Each call creates new state. Don't auto-retry. | `log_workout`, `start_nutrition_phase` |
| `openWorldHint: false` | No third-party API calls. Always false for Almanac. | All tools |

These are protocol-level metadata, not just documentation. Claude Desktop uses
`readOnlyHint` to decide whether to prompt "allow this tool?"; retry logic uses
`idempotentHint` to decide whether a failed call is safe to replay.

## From tool call to API request

When the AI invokes a tool, here's the full pipeline:

```
AI calls tool (e.g. log_meal)
  │
  ▼
┌─────────────────────────────────┐
│  1. Input validation (Zod)      │  MCP layer
│     Parse against tool schema   │
│     → fail fast with field-     │
│       level error messages      │
├─────────────────────────────────┤
│  2. MCP-side business rules     │  MCP layer
│     e.g. confirm:true on        │
│     deletes, phase coherence    │
│     checks on update_phase      │
├─────────────────────────────────┤
│  3. Bearer token threading      │  MCP layer
│     Token captured at connect   │
│     time, passed to every API   │
│     call as Authorization hdr   │
├─────────────────────────────────┤
│  4. API request                 │  HTTP to API
│     POST/GET/PATCH/DELETE to    │
│     the Fastify API, with       │
│     idempotency-key header      │
│     where applicable            │
├─────────────────────────────────┤
│  5. API validation + execution  │  API layer
│     Fastify validates again,    │
│     runs business logic,        │
│     writes to SQLite            │
├─────────────────────────────────┤
│  6. Response shaping            │  MCP layer
│     Tool handler may make       │
│     follow-up reads (e.g.       │
│     fetch day totals after      │
│     logging a meal)             │
├─────────────────────────────────┤
│  7. _meta enrichment            │  MCP layer
│     Attach server_now and       │
│     user_tz to every success    │
│     response                    │
├─────────────────────────────────┤
│  8. MCP response                │  Protocol
│     { content: [{ type: "text", │
│       text: JSON }] }           │
└─────────────────────────────────┘
  │
  ▼
AI receives structured JSON
```

### Step by step: `log_meal`

To make this concrete, here's what happens when the AI calls `log_meal` with
`{ eaten_at: "2026-05-25T12:30:00", kcal: 500, protein_g: 25, carb_g: 50, fat_g: 18 }`:

1. **Zod validation** — `LogMealInputSchema.parse(input)` checks types, ensures
   kcal is a nonnegative integer, and so on. Fails immediately with field paths
   if anything is wrong.

2. **User ID resolution** — `currentUserId()` calls `GET /api/v1/users/me` with
   the bearer token, cached after the first call per session.

3. **Idempotency key** — SHA-256 hash of the canonical JSON payload, prefixed
   with `meal:<userId>:`. Sent as the `idempotency-key` header.

4. **API call** — `POST /api/v1/meals` with the input body and bearer token. The
   API validates again (Fastify + Zod), inserts into SQLite, and returns the
   created meal.

5. **Context fetch** — `GET /api/v1/signals/macros?at=2026-05-25T12:30:00` to
   get the day's running totals and target. This lets the response include "500
   kcal logged; day total now 1200/2400 (50%)" without requiring a second tool
   call from the AI.

6. **Response** — The handler returns a structured object with the meal ID, a
   human-readable summary, day totals, and the day target. The dispatcher
   attaches `_meta` and serializes to JSON.

## Input validation

Validation happens at two layers.

**MCP layer (Zod schemas, fast feedback).** Every tool defines a Zod schema that
validates shape, types, and cross-field constraints before any API call is made.
Field-level `.describe()` strings are converted to JSON Schema descriptions that
the AI can read. Cross-field constraints use `.refine()` — `log_workout`, for
example, enforces that you provide `exercises` or `deviations`, not both.

**API layer (Fastify, authoritative).** The API validates again with its own
schemas. This is defense in depth: even if the MCP layer is bypassed, or a
non-MCP client hits the API directly, the API enforces its own invariants.

When Zod validation fails at the MCP layer, the response includes each failing
field's path and message:

```
tool log_meal input validation failed — kcal: Expected number, received string; protein_g: Required
```

When the API returns a 400 or 422, the MCP layer passes the structured error
body through verbatim as an `isError: true` response, so the AI can read and act
on it. The `tdee_unavailable` envelope from `start_nutrition_phase`, for
instance, tells the AI to ask for a TDEE override.

## Business rules enforced at the MCP layer

Some constraints are enforced before the API round-trip, for faster feedback.

**Delete confirmation.** Every delete tool requires `confirm: z.literal(true)`
in its input schema. The AI must ask the user first, then call with
`confirm: true`. This is belt-and-suspenders with the `destructiveHint`
annotation — even a thin client that ignores annotations can't silently delete
data.

**Phase coherence.** `update_phase` runs a `checkPhaseInvariant()` before calling
the API: a "cut" phase must have a deficit below -5% of TDEE, a "bulk" must be
above +5%, and "maintenance" must be within ±5%. Ambiguous patches that would
violate these constraints are rejected immediately with a structured error
explaining the conflict.

**Workout shape constraints.** `log_workout` uses `.refine()` to enforce that
the caller provides either `exercises` (ad-hoc) or `deviations` from a template,
not both. At least one of `exercises` or `template_id` must be present.

## Idempotency

Every log tool except `log_workout` is idempotent. The MCP layer
computes a SHA-256 hash of the canonical JSON payload and sends it as an
`idempotency-key` header. If the API has already processed that exact payload
within 24 hours, it returns the cached response instead of creating a duplicate.

`log_workout` is intentionally **not** idempotent — every call creates a new
workout row. Workout logging is session-based (you might do the same template
twice in a week), so payload deduplication would be wrong.

## Timestamp metadata

Every successful tool response is enriched with a `_meta` block:

```json
{
  "id": 42,
  "summary": "Logged meal for 2026-05-25 ...",
  "day_totals": { "kcal": 1200, "protein_g": 75, "carb_g": 150, "fat_g": 40 },
  "_meta": {
    "server_now": "2026-05-25T14:30:45-04:00",
    "user_tz": "America/Toronto"
  }
}
```

`server_now` is the wall-clock time in the user's profile timezone at the moment
the response was generated. `user_tz` is the IANA timezone name. This anchors
the AI to real time without it having to ask "what time is it?" or compute
timezone offsets. The timezone is resolved lazily from the user profile on the
first tool call and cached for the session — and invalidated when
`update_user_profile` changes it, so the next response stamps the new zone.

Error responses do **not** include `_meta` — they have their own shape and pass
the API's structured error body through directly.

## Error handling

Errors follow a tiered model:

| Source | What happens | AI sees |
| --- | --- | --- |
| Unknown tool name | MCP dispatcher returns an error | `"unknown tool: foo_bar"` with `isError: true` |
| Zod validation failure | MCP dispatcher catches, formats field paths | `"tool log_meal input validation failed — kcal: Expected number, received string"` with `isError: true` |
| `ToolError` (MCP-side business rule or API 400/422) | Handler throws `ToolError` with a structured payload | The payload serialized as JSON with `isError: true` — e.g. `{ "error": "tdee_unavailable", "message": "..." }` |
| API 401/403 | `ApiHttpError` propagates | MCP transport error (session-level, not tool-level) |
| API 500 or network failure | Exception propagates | MCP transport error |

The key design choice: structured API errors — validation failures, business
rule violations — are passed through to the AI as readable JSON, not generic
"something went wrong" messages. This lets the AI diagnose and retry
intelligently.

## Response shaping

Tool handlers don't just proxy API responses. They often make follow-up reads to
give the AI useful context in a single round-trip:

- `log_meal` fetches the day's macro totals and target after inserting, so the
  response includes "day total: 1200/2400 (50%)" without requiring a second tool
  call.
- `log_cardio` returns a `kcal_estimate` (HR-derived) alongside the user's
  `est_kcal`, plus an `estimate_warning` if they diverge by more than 20%.
- `get_today_context` is a composite read that returns the active phase, today's
  intake, week-to-date averages, TDEE, energy balance, and stim states — all in
  one call.

This is intentional: AI tool calls are expensive, since each one is a round-trip
through the LLM, so responses are designed to be self-contained enough that the
AI rarely needs to chain multiple reads.

## Authentication threading

The bearer token is captured once at connection time and threaded through to
every API call:

- **Stdio transport** — a static PAT from the `ALMANAC_MCP_CLIENT_TOKEN`
  environment variable.
- **HTTP transport** — extracted from the `Authorization: Bearer` header on the
  initial request. When OAuth 2.1 is enabled, the token is minted during the
  OAuth flow: provider sign-in, email allowlist check, PAT generation.

Every API call includes `Authorization: Bearer <token>`. One token equals one
user. The user ID is resolved lazily on the first tool call via
`GET /api/v1/users/me` and cached for the session.

### The OAuth server

When the OAuth environment variables are set, the MCP container runs its own
OAuth 2.1 authorization server, built on the `@modelcontextprotocol/sdk` auth
module. When they are unset, it falls back to PAT-only mode with no discovery
endpoints.

`mcpAuthRouter(options)` is SDK-provided Express middleware that mounts all the
RFC-required endpoints: `/.well-known/oauth-authorization-server`,
`/.well-known/oauth-protected-resource/{path}`, `/authorize`, `/token`,
`/register`, and `/revoke`.

Almanac implements the `OAuthServerProvider` interface on top of it:

| Method | What it does |
| --- | --- |
| `clientsStore` | In-memory map of dynamically registered clients |
| `authorize()` | Redirects to the provider's consent screen |
| `challengeForAuthorizationCode()` | Returns the stored PKCE challenge |
| `exchangeAuthorizationCode()` | Verifies the provider token, checks the allowlist, mints a PAT via the API |
| `exchangeRefreshToken()` | Not implemented — PATs don't expire |
| `verifyAccessToken()` | Checks an in-memory cache, falls back to API validation |

### What's in memory versus persistent

| Data | Storage | Survives restart? |
| --- | --- | --- |
| Registered OAuth clients | In-memory map | No — clients re-register automatically |
| Pending auth flows (state params) | In-memory map | No — stale flows fail gracefully |
| Auth codes | In-memory map | No — codes are short-lived (5 min) anyway |
| Access tokens (PATs) | SQLite, via the API | Yes |
| Streamable HTTP sessions | In-memory map | No — the server returns 404 for stale session IDs, prompting clients to re-initialize |

The only thing that matters across restarts is the PAT itself, and that's in the
database. Clients that lose their registration re-register and re-authorize —
the OAuth spec handles this gracefully.

## Where the code lives

| File | Role |
| --- | --- |
| `packages/mcp/src/tools/index.ts` | Tool registry. Every tool is constructed and registered here. |
| `packages/mcp/src/server.ts` | Builds the `McpServer`, ships the instructions block, registers tools and resources. |
| `packages/mcp/src/instructions.ts` | The plain-text instructions delivered at `initialize`. |
| `packages/mcp/src/capabilities.ts` | The hand-curated `get_capabilities` catalog. |
| `packages/mcp/src/index.ts` | Express app with `mcpAuthRouter`. Mounts OAuth endpoints, the provider callback, and Streamable HTTP at `/mcp`. Falls back to PAT-only mode when the OAuth variables are unset. |
| `packages/mcp/src/oauth-provider.ts` | The `OAuthServerProvider` implementation — redirect, callback, auth-code minting, PAT minting via the API, token verification. |
| `packages/mcp/src/config.ts` | The MCP environment variable schema. |
| `packages/api/src/auth.ts` | API auth middleware. Validates PATs against `personal_access_tokens`, accepts `X-Forwarded-Email` from oauth2-proxy, checks the allowlist before auto-provisioning. |
| `packages/core/src/repos/personal-access-tokens.repo.ts` | PAT CRUD. `mintToken()` generates `alm_…` tokens and stores a SHA-256 hash. |

## Schema sharing with `@almanac/core`

Base types like `PhaseTypeSchema` (`"cut" | "bulk" | "maintenance"`) and
`TdeeSourceSchema` (`"formula" | "measured" | "user_asserted"`) are defined in
`@almanac/core` and imported by both the API route handlers and the MCP tool
schemas. This keeps the two layers in sync on enum values and domain constraints
without coupling their full request/response shapes — the MCP tools define their
own input schemas optimized for AI ergonomics, such as optional fields with
descriptive defaults, while the API schemas enforce the persistence contract.

## Relevant specs

- [MCP Authorization (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) — the MCP OAuth 2.1 spec
- [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728) — OAuth 2.0 Protected Resource Metadata
- [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) — OAuth 2.0 Authorization Server Metadata
- [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591) — OAuth 2.0 Dynamic Client Registration
- [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636) — PKCE (Proof Key for Code Exchange)

## Next steps

- [Connecting assistants](/guide/connecting-assistants) — MCP clients and PATs
- [Authentication](/guide/authentication) — how the two auth paths are implemented
- [Configuration](/guide/configuration) — the MCP environment variables
