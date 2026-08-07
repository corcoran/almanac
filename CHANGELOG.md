# Changelog

All notable changes to Almanac are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The today snapshot dates the trend weight.** `trend_weight.as_of` is the
  most recent weigh-in the EWMA reflects, so a value carried forward across a
  gap can't read as current.
- **Sitemap and social-card tags on the documentation site.**

### Fixed

- **Day-one TDEE now uses your logged weight.** When the only weigh-in was
  dated today, the TDEE estimate fell back to a built-in 80 kg body instead of
  the weight just logged — inflating or deflating the number until the next
  day. The dashboard's "est" chip and the MCP `get_tdee` tool now anchor on it
  immediately, matching what starting a phase already snapshots.

- **Signing out now ends the provider's session, not just Almanac's.** Sign-out
  cleared Almanac's cookie and left the identity provider's session running, so
  the next request signed you straight back in. Set
  `OAUTH2_PROXY_BACKEND_LOGOUT_URL` to your issuer's `end_session_endpoint` to
  enable it; Google publishes no such endpoint, so Google deployments are
  unchanged.
- **Social login through the Keycloak fixture works.** Its realm shipped a
  custom first-broker-login flow with no branch for a first-time user, so any
  Google or GitHub sign-in failed with "Invalid username or password" after
  authenticating successfully. Both providers now use Keycloak's built-in flow.
- **The fixture's `almanac-web` client accepts oauth2-proxy's callback.** Its
  redirect URIs only covered the MCP server's port, so browser sign-in failed
  with `invalid_redirect_uri`.
- **A misconfigured MCP client now gets an error that names the problem.**
  Registering `/mcp` under the SSE transport instead of Streamable HTTP
  returned "Server not initialized", which reads as a broken server; it now
  returns `405` with `Allow: POST`. Connecting assistants documents the
  transport.
- **Unlogged step days no longer count as zero in the dashboard average.**
  They're excluded and shown as a dash, the way unlogged intake days already
  were.
- **A step count of zero is rejected everywhere** — API, MCP `log_steps` and
  `update_steps`, and the web editor. A day without steps is an untracked day.
- **The coach can tell an unlogged day from a zero-kcal one.**
  `get_macros_range` reports `meals_logged` per day.
- **The API and MCP server report the release tag they were built from**, not a
  hand-maintained version string that had drifted from what's running.

## [1.35.0] - 2026-08-07

### Added

- **Sign in with any OAuth provider, not just Google.** Browser sign-in takes
  anything oauth2-proxy supports; MCP OAuth takes any OpenID Connect issuer,
  discovered from `/.well-known/openid-configuration`. Set the four
  `ALMANAC_MCP_OAUTH_*` variables together, or leave them all blank for
  PAT-only. ID tokens are signature-verified against the issuer's published
  keys.
- **Optional self-hosted Keycloak**, behind a Compose profile so
  `docker compose up -d` is unaffected. Useful for several users or several
  sign-in methods behind one issuer. `scripts/local-dev/keycloak.sh` runs a
  throwaway instance with a seeded realm.

### Fixed

- **`ALMANAC_LLM_INSIGHTS_MODEL` now works under Docker.** Compose never passed
  it to the API container, so setting it did nothing.

## [1.34.0] - 2026-08-06

### Added

- **Documentation site at [almanac-fitness.com](https://almanac-fitness.com).**
  Setting Almanac up asks you to be comfortable with web, MCP, backend *and*
  DevOps, and being strong in three of those still leaves you stranded in the
  fourth. The deploy and setup material moved out of a 420-line README and two
  scattered reference files into a browsable, searchable site with a sidebar
  and cross-links, so you can arrive in the middle and find your way.
- **A real OAuth walkthrough.** The old runbook named the callback URL and left
  you to work out where an OAuth client comes from. There is now a step-by-step
  Google Cloud Console guide, a table mapping each console value onto its
  environment variable, and the failure modes with their causes — wrong
  redirect URI, unlisted email, a cached session claiming first-admin.
- **The deploy runbook is longer, not shorter.** Every step gained a
  verification block showing what healthy output looks like, failure modes now
  sit at the step where they happen, and nginx settings that vary by host are
  called out with the errors they produce.

### Fixed

- **Starting a nutrition phase no longer mislabels who chose your TDEE.**
  Opening a phase before logging a weigh-in returned an error blaming missing
  *measured* data and telling your assistant to pass an explicit TDEE override
  — which recorded the resulting number as something you had asserted, even
  though Almanac had calculated it. The error now names the real prerequisite
  (log a weight) and points at the right tool, and a phase opened afterwards is
  correctly recorded as formula-derived. Phases created from the web dashboard
  get the same treatment: the override is only sent when you actually type your
  own TDEE, instead of on every save.
- **Today's weigh-in now counts when you start a phase.** The check for whether
  you had ever logged a weight only looked as far back as yesterday, so logging
  your weight and starting a phase in the same sitting — exactly what a new
  account does — was refused, and retrying could not help. Your latest weigh-in
  now also anchors the starting estimate, so a phase opened on your first day
  reflects your actual body weight rather than a placeholder.
- **Onboarding now asks for your activity level.** It is the single biggest
  lever on your starting TDEE estimate — the gap between "moderate" and
  "active" is roughly 300 kcal a day — but nothing prompted for it, so it was
  easy to never set. Existing profiles are untouched and no existing estimate
  moves.
- **The "set up workout templates" prompt now clears as soon as you create one.**
  Saving a template refreshed the template list but not the next-steps panel, so
  the prompt sat there telling you to do something you had just done until you
  reloaded the page.
- **A timezone change now takes effect immediately over MCP.** The timezone
  stamped on tool results was resolved once per connection and cached for the
  life of the process, so updating your profile left assistants seeing the old
  zone until they reconnected.
- **Corrected the MCP OAuth callback path in `.env.example`.** It documented a
  URL that Google would never redirect to, so following it produced a
  `redirect_uri_mismatch` with nothing to explain it.
- **The first-boot instructions no longer describe log lines that do not
  exist.** The runbook told you to watch for two specific messages during the
  first `docker compose up`; neither string has ever been in the codebase, so a
  patient operator could wait indefinitely and conclude the deploy had failed.
  Verification now points at the health endpoint instead.
- **Corrected the MCP URL handed out for assistant setup.** It carried a
  trailing slash that the PAT-only listener rejects, so the copy-paste config
  returned a 404 for anyone who had not enabled MCP OAuth.
- **Documented the per-user flag that gates the AI surfaces.** Setting the
  environment variables is not enough — each user also needs
  `llm_logging_enabled`, which has no toggle in the web UI, so the chat buttons
  simply never appeared with nothing to indicate why.

### Changed

- **The MCP server's instructions speak plainly.** They previously handed
  assistants Almanac's internal field names when explaining TDEE calibration,
  which made repeating that jargon back at you the path of least resistance.
  They now describe the behavior in ordinary language and explicitly tell
  assistants not to surface field names, tool names, or error codes unless you
  ask how something works.

## [1.33.0] - 2026-08-05

### Removed

- **The `bootstrap_user` MCP tool and the `POST /v1/users` endpoint.** Both
  created a user row with no email, but production looks accounts up *by* email
  — so calling either before your first sign-in left you with two accounts: an
  orphaned one holding your data and the admin flag, and the empty one you
  actually logged into. Accounts have been provisioned automatically from your
  verified email at sign-in for some time now; this was a leftover from before
  auth existed, and nothing in the docs pointed at it. The MCP tool count goes
  from 77 to 76.
- **`ALMANAC_FIRST_LOGIN_EMAIL`.** Its only job was repairing the email-less row
  the above could create. With that path gone there is nothing left to repair,
  so the variable, its startup hook, and the "adopting a pre-auth database"
  deploy section are all removed. Unset it in your `.env` if present; it is now
  ignored.

### Fixed

- **Connect instructions no longer recommend a setup that can't work.** The
  onboarding card and Settings both said "add this as a remote MCP server in
  Claude or ChatGPT" and showed whatever address you were browsing from. On a
  local or LAN install that's `http://localhost:.../mcp`, which Claude Code can
  reach but Claude's and ChatGPT's web and mobile apps cannot — they connect
  from the vendor's servers, so the connection just fails with nothing
  explaining why. Both surfaces now detect a non-routable origin (localhost,
  RFC1918, CGNAT, `.local`) and lead with the Claude Code + token path,
  noting that web and mobile clients need a public HTTPS domain.
- Local dev: `scripts/local-dev/up.sh` gave the API and MCP a one-address
  allowlist while oauth2-proxy got the full `allowed-users.txt`, so a second
  allowlisted person could sign in and then be rejected by the API on every
  request — a blank UI with no visible cause. All three now read the same file,
  matching prod.

### Changed

- The LLM docs now say what the AI surfaces **cost to run**: they bill against
  your own Anthropic key, roughly 5–10¢ per active user on a day they use it,
  held down by putting the high-volume work on the cheap model and serving the
  stable prompt prefix from the 1-hour cache. The daily token and search caps
  are described as the guardrails they are, including that leaving them unset
  means no cap at all. Also states plainly that **Anthropic is the only
  supported provider** today — `ALMANAC_LLM_PROVIDER` is a validated seam for a
  future one, not a working switch.
- Docs now warn that **connecting a custom MCP server is a paid-plan feature on
  both Claude and ChatGPT**, and that the qualifying tiers change — so check
  before assuming someone you invite can connect their own assistant. Anyone on
  a free plan can still use the whole web dashboard, including the built-in AI
  meal assistant and insights coach, which run on the server's API key.
- Documentation now states plainly that Almanac supports **one user or several**.
  Every email on the allowlist gets its own account and its own isolated data on
  first sign-in, and the first account on a fresh instance becomes admin. This
  has been true since the multi-user work landed, but the README, landing page,
  and MCP server instructions all still described a single-user app.
- Corrected two stale code comments claiming the first admin required a manual
  `UPDATE users SET is_admin = 1`. The auth layer has granted it automatically
  since auto-provisioning landed.

## [1.32.1] - 2026-08-02

### Internal

- Extracted the time-composition logic shared by the meal and alcohol AI proposal
  cards into a single unit-tested `proposalTime` helper. No user-facing change —
  the two cards now delegate the user-local-day rollover rule to one source of
  truth instead of carrying near-identical copies that could drift apart.

## [1.32.0] - 2026-08-02

### Added

- **The AI meal assistant now logs alcohol as a separate drink, not as food.**
  Tell it "two beers" or "a burger and a glass of wine" and it proposes the
  drinks as an alcohol session (drinks + calories, no macros) on its own amber
  card, while food stays a meal — each committing to the right place. Alcohol
  calories now correctly count toward your day as alcohol rather than food, and
  "Log all" saves both in one tap. When a drink's size is ambiguous (a shot is
  1 oz in Canada vs 1.5 oz in the US, a "glass" of wine varies), the assistant
  asks rather than guessing.

## [1.31.2] - 2026-08-02

### Fixed

- **Logging one of several meals the AI assistant proposed now removes the right
  card.** When the assistant suggested multiple meals and you logged the first
  one, the *second* card would disappear while the first appeared to stay — so you
  couldn't log the remaining meal(s). Each proposed card is now tracked by a
  stable identity, so logging (or dismissing) one leaves the others in place and
  loggable, with a "✓ Logged …" confirmation replacing the one you logged.

### Internal

- Added a regression test that logs the first of several proposed meals and
  asserts the un-logged card survives — the proposal list was being keyed by array
  position, so a front/middle removal reused the wrong card component.

## Earlier releases

Almanac was developed privately before its public release at 1.31.2; earlier
release notes are not included.

[Unreleased]: https://github.com/corcoran/almanac/compare/v1.35.0...HEAD
