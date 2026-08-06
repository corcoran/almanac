# Changelog

All notable changes to Almanac are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

## [1.31.1] - 2026-07-01

### Fixed

- **A workout logged in the evening now reliably appears on the month
  calendar.** If you logged a workout late in the day, its chip could be missing
  from that day's calendar cell — even after a full refresh — while still showing
  up in the 6-day summary and template list. The calendar's month lookup was
  cutting off at UTC midnight, so an evening workout (whose stored time rolls into
  the next UTC day for timezones behind UTC) fell outside the month it belonged to
  and never rendered. It now shows on the correct day.

### Internal

- Made a date-sensitive nutrition-phases test seed its weigh-in relative to the
  current day instead of a hard-coded date, so it no longer starts failing as the
  calendar advances past the weigh-in's validity window.

## [1.31.0] - 2026-06-30

### Changed

- **The workout picker now previews your *recommended* template's last session
  by default.** When you open the workout screen, the picker auto-expands a
  template's last session so you can see what you did last time without an extra
  tap. It used to expand the row for your most recent workout overall — now it
  expands the **recommended** template instead (the one it's steering you toward),
  falling back to your last workout only when there's no recommendation.

### Internal

- oauth2-proxy session cookie lifetime extended from the 7-day default to 30 days
  (`--cookie-expire=720h` in `docker-compose.yml`), so you re-authenticate roughly
  monthly instead of weekly. Applied on the next deploy of the proxy config.

## [1.30.0] - 2026-06-29

### Changed

- **The AI insights coach now runs on a stronger model.** The coach (which does
  multi-signal reasoning — trends, recovery, what-to-train) was sharing the cheap
  model used for quick meal parsing, which led to occasional self-contradictions
  and over-confident detail. It now uses a stronger reasoning model by default
  (configurable via `ALMANAC_LLM_INSIGHTS_MODEL`), while meal logging stays on the
  fast, cheap model. Insights replies cost a bit more per turn; the daily usage
  budget is unchanged.

## [1.29.1] - 2026-06-29

### Fixed

- **The AI coach no longer crashes on questions that need more than one piece of
  data.** Asking something like "what workout should I do next?" — which the coach
  answers by consulting several tools — could fail with a server error, because
  the agent loop only handled one tool call per turn and left the others
  unanswered (an invalid request the AI provider rejected). The loop now sends one
  tool call per turn and always answers every one, so multi-step questions work.

## [1.29.0] - 2026-06-29

### Added

- **The AI coach can now pull up a specific day's workout in detail.** Ask "how
  was my push session today?" and it reads the actual exercises, sets, reps,
  weights, RPE, and duration you logged — via the new `get_workout_for_day` tool
  (also available to external assistants over MCP), keyed by date.

### Changed

- **The insights coach no longer makes up numbers.** It now cites only figures
  it was actually given (from your overview or a tool); when it doesn't have a
  number — a session length, a weight, a count — it says so instead of inventing
  a plausible-looking value or silently changing one it already stated.

## [1.28.0] - 2026-06-28

### Added

- **The AI coach can now read your training patterns, not just your recovery
  state.** A new training-history capability summarizes the last ~2 weeks per
  workout split — how often you've trained it, whether your RPE is drifting up
  or down vs your norm, how often you've deviated from the template, and which
  main lifts are climbing, stalled, or dropping. The insights coach uses this to
  lead with non-obvious observations instead of restating what you just did, and
  it's exposed to external assistants as the `get_training_history` MCP tool.

### Changed

- **The insights coach no longer states the obvious about training.** It used to
  recite your recovery table ("you trained legs yesterday, rest them"); it now
  leads with the non-obvious training-pattern insight and gives the
  what-to-train pick in one line when there's nothing more to add.

## [1.27.0] - 2026-06-28

### Fixed

- **The AI insights coach no longer invents workout-recovery data.** It would
  sometimes assert which muscle groups were "fresh" or "depleted" — data it
  didn't actually have — and recommend (or contradict) workouts on that basis.
  It now grounds every workout/recovery claim in the real recommendation signal
  (which muscle groups are recovered, in-window, or trained-too-recently), and
  if it hasn't checked, it says so instead of guessing.

### Added

- **`get_workout_recommendation` MCP tool** — an intent-named alias of
  `get_recommended_template` (same data: ranked workout splits with
  per-muscle-group recovery state). The original name still works.

## [1.26.1] - 2026-06-28

### Fixed

- **A new release now reliably shows up on a normal browser reload.** The SPA
  shell (`index.html`) was served with `Cache-Control: no-cache`, which only
  asks the browser to *revalidate*. Because every build produces a same-size
  `index.html`, that revalidation could return a false `304 Not Modified` and
  reuse the previous shell — which still pointed at the old asset bundle — so a
  deploy didn't appear until a hard refresh. The shell now sends `no-store`, so
  every load fetches the current shell (and therefore the current assets).
  Hashed assets remain cached for a year, unchanged.

## [1.26.0] - 2026-06-28

### Added

- **A "What's new" panel in Settings.** The Settings modal now lists recent
  releases and what changed in each, parsed from the project changelog at build
  time. A small dot appears on your account avatar when there are releases you
  haven't seen yet; opening Settings clears it. Purely internal/developer
  changelog entries are filtered out of the list.

## [1.25.0] - 2026-06-28

### Changed

- **Finishing a workout always shows the "End workout" confirmation now —
  so you can set the duration every time.** Previously, if your workout
  matched its template exactly (no changed reps/sets/exercises), ending the
  session submitted immediately with an auto-computed length and never gave
  you a chance to adjust it; the duration field only appeared when the
  workout had deviated from the template and triggered the "save changes to
  template?" prompt. Now every workout ends through the same confirmation
  dialog with an editable Duration field, and the template-save section only
  layers in when there are actual changes to propagate.

## [1.24.3] - 2026-06-27

### Changed

- **Internal: the MCP server now runs on the SDK's high-level `McpServer` API**
  instead of the deprecated low-level `Server` class. No change to tool or
  resource behavior — every tool returns the same payloads and the same
  `_meta`/error envelopes as before. Two visible-on-the-wire side effects, both
  benign and verified against a live MCP client: tool `inputSchema` JSON now
  includes the standard `$schema` key (previously stripped; definitions are
  still inlined with no `$ref`), and the server now advertises the standard
  `listChanged` capability for tools/resources (Almanac's sets are static, so
  the notification is never sent). This removes the test suite's reliance on
  private SDK internals.

## [1.24.2] - 2026-06-27

### Fixed

- **The MCP macro tools now return carbs and fat, not just protein.** AI
  assistants connected over MCP could see how much protein you'd eaten today,
  but `get_macros_today` and `get_macros_for_date` dropped the carb and fat
  intake totals — so a question like "how many carbs have I had today?" got
  the *target* but not the *actual* amount consumed. Both tools now surface
  full P/C/F intake (alongside the existing per-macro targets) in their
  structured output and their one-line summaries. `get_macros_range` already
  returned full macros and is unchanged. No data migration; MCP-layer only.

## [1.24.1] - 2026-06-26

### Fixed

- **Recent average intake (and the deficit/projection built on it) no longer
  dips mid-day.** The insights report's 7-day "week-to-date" averages and counts
  (avg intake, avg protein, workout/cardio/alcohol totals) included today's
  in-progress day, so a partially-logged "today" pulled the recent-average
  intake low — verified on real data at 1,734 kcal when the last 7 *completed*
  days actually averaged 1,971 — which in turn understated your real deficit and
  skewed the end-of-phase projection. The week-to-date window now covers the last
  7 completed days; today's own numbers are still shown separately in the
  report's Today section, and your sleep average still counts last night (a
  completed night). Same exclude-the-in-progress-day principle as the live TDEE.

## [1.24.0] - 2026-06-26

### Fixed

- **AI "logs left" now reflects the chat surface you're in.** The estimate
  divided the daily budget by one blended average across both AI chats, but
  meal-chat turns (~1k tokens) are far cheaper than insights turns (~5k). So the
  meal coach showed ~1/6th of the meal logs you could actually afford — the same
  pessimistic count as the insights coach. Each panel now divides by its own
  surface's recent average against the shared daily budget. (Verified on real
  data: the meal estimate jumped from ~3 to ~30 logs left; the insights count is
  effectively unchanged — its number shifts slightly from the blended ~5.9k to
  its own ~6.7k average. Both still spend from the one shared daily budget.)
- **Usage detail card no longer shows a nonsensical "8 of 7 used."** The expanded
  card compared today's *all-chat* call count against *this surface's* implied log
  capacity — incompatible bases, so the numerator could exceed the denominator. It
  now shows the real shared quantity: tokens used of the daily budget
  (e.g. "32.0k of 50k tokens used").
- **"Current TDEE" no longer drifts during the day.** The dashboard's live TDEE
  included today's partial intake, so it crept as you logged meals. It now ends
  its back-calc window on the last completed day (like the NET number and the
  TDEE detail already did), so it holds steady through the day and only updates
  as completed days roll in. The same fix flows through to the AI assistant
  (the `get_today_context` / `get_day_status` / next-best-action MCP tools and
  the insights report all read this value) and to the phase-setup TDEE estimate
  and the TDEE snapshot taken when a phase starts — so every TDEE in the app now
  agrees on excluding the in-progress day.

## [1.23.0] - 2026-06-25

### Added

- **Mark time off from the calendar.** A "Mark vacation" button on the month
  calendar opens a modal to create, list, and delete time-off periods
  (vacation / sick / deload). These days are already excluded from your TDEE,
  macro averages, and the week grid; this adds the web UI to manage them
  (previously only the AI assistant / API could). The calendar's shaded bands
  update immediately when you add or remove a period.

## [1.22.0] - 2026-06-25

### Changed

- **TDEE is now robust to post-vacation water-weight spikes.** The measured
  back-calc previously used a fixed 21-day window and read the weight trend from
  single endpoint readings. When that window happened to open on a transient
  water/glycogen spike (e.g. the morning after a vacation), it read your loss
  rate roughly twice too fast and inflated your TDEE — and every daily NET was
  snapshotted against that inflated number. The window now scales with your data
  (14–28 days) and the trend slope uses a 3-point median at each end, so a single
  high reading can't drive the estimate. Your displayed TDEE may drop slightly if
  you're active and losing weight (it now tracks your true longer-baseline rate),
  and your historical daily NET / deficit summaries are recomputed once on the
  first run of this version so they reflect the correction.
- **The displayed TDEE no longer counts the day in progress.** It previously
  included today in its window, so a half-logged "today" (e.g. only breakfast
  entered) dragged the estimate around as the day filled in. The live estimate
  now ends on the last completed day, so it stops moving just because you haven't
  finished logging today. (Snapshotted daily deficits were already computed
  against the prior completed day and are unaffected.)

## [1.21.0] - 2026-06-24

### Added

- **"About Me" personal context for the AI.** A free-text field in Settings
  (max 600 chars) describing your body type, goals, and preferences. It's sent as
  advisory background context to the meal coach, the insights coach, and
  connected assistants (MCP) so their tone and advice fit you — it never
  overrides your data or the app's rules.

## [1.20.0] - 2026-06-24

### Added

- The meal-chat coach now knows your running daily macros and answers questions
  about them. Ask "what are my remaining macros?" or "what would be left if I had
  my protein shake?" and it replies with the budget — including the hypothetical
  math — instead of asking you for numbers it already has or trying to log a
  meal. It also no longer falsely claims it can't see your stored-meal library or
  daily totals — both are in front of it. Logging a meal you actually ate still
  works exactly as before.
- The insights coach can now break your day down meal-by-meal and read your
  saved-meal library. Ask "what did I eat today?" or "what's in my protein
  shake?" and it answers from your actual entries instead of saying it only has
  daily totals. (Both chats now draw their read tools from one shared catalog,
  so capabilities like this reach either coach.)

### Changed

- Chat system prompts are split into a stable, cacheable prefix and a small
  per-day uncached tail (today's date, running macros, recent meals / the
  insights overview), so logging a meal no longer invalidates the cached prefix.
  Prompt caching kicks in once that prefix is large enough to qualify (e.g. once
  you've saved a few meals), making repeat chats cheaper from then on.

## [1.19.0] - 2026-06-24

### Added

- The AI chat now shows the web pages it consulted. When a reply involved a web
  search, a small "Searched N sources" footnote with site favicons appears under
  it; tap to expand the full list of source titles and domains (each links out).
  This replaces the bare "searched the web" line, so you can see and trust where
  an answer came from. Favicons fall back to a colored monogram if an icon can't
  load. The insights coach is wired for sources too, dormant until its own web
  search is enabled.

## [1.18.3] - 2026-06-24

### Fixed

- Insights chat no longer drops into read-only "Jump to today" mode on the
  current day — e.g. while waiting for the first AI reply of a day that didn't yet
  have a conversation. The read-only check now keys off the actual current date
  rather than whether today already has a saved conversation, so today's input box
  stays available and only genuine past days are read-only.

## [1.18.2] - 2026-06-24

### Fixed

- AI Insights coach no longer mischaracterizes how your days relate. It used to
  occasionally call two non-consecutive days "the last two days" (e.g. flagging an
  overage on the 20th and the 23rd as back-to-back, ignoring the on-target days
  between). It now verifies the actual dates before describing day relationships
  and states gaps explicitly ("the 20th and the 23rd, with two on-target days
  between") instead of implying adjacency.

## [1.18.1] - 2026-06-24

### Fixed

- AI Insights coach no longer miscomputes your numbers. It used to occasionally
  get your actual deficit wrong (e.g. comparing against the wrong TDEE) or claim
  the wrong "biggest miss" day by eyeballing the table — LLMs are unreliable at
  in-head arithmetic and table rankings. The key figures (your **actual recent
  deficit/surplus/balance** and your **biggest target miss** in the window) are
  now computed in code and stated in the data the coach reads, with the
  arithmetic shown, so it reports the right number every time instead of doing
  fragile mental math.
- These computed figures and the coach's language are now **phase-aware**: a cut
  is framed around a deficit (the "miss" is a day over target), a bulk around a
  surplus (the "miss" is a day *under* target — under-eating slows gains), and
  maintenance around staying near target (the "miss" is the biggest swing either
  way). The coach adapts its advice to your current phase goal rather than
  assuming a cut.

## [1.18.0] - 2026-06-24

### Added

- AI Insights coach is sharper and more personal. It now actively analyzes your
  **~10-day trend** (rather than reading numbers back), surfaces non-obvious
  connections (e.g. a stalled scale alongside an intake creep), projects forward
  ("on track for GOAL around DATE if the deficit holds"), and recommends next
  steps grounded in your numbers — training, nutrition, recovery, phase strategy
  (still no medical advice).
- The coach now has **memory across days**. It compares against your last
  session's takeaway and adapts to how long it's been: checking again the next
  day with nothing new gets a short "same picture — nothing's moved, check back
  in a few days" instead of the same full read; returning after a long break
  ("Welcome back! It's been about 24 days…") gets a fresh, full re-orientation
  rather than a stale recap.

### Changed

- Past insights conversations are now **read-only archives**. Browse them via the
  ◀/▶ day stepper or by selecting a day on the calendar and opening the chat —
  either way the conversation opens to that day. A "Jump to today" button returns
  you to the live conversation. Today stays fully interactive.
- "New chat" is now **"Reset day"** and confirms before clearing, since it
  permanently deletes the day's conversation.

### Fixed

- Opening the insights chat from a selected past calendar day now loads that
  day's conversation instead of always loading today.
- The ◀ day-stepper is reachable on a brand-new day (no conversation yet) when
  past days exist, so the archive is never stranded.

## [1.17.0] - 2026-06-23

### Added

- AI Insights chat — a read-only conversational surface (the 💬 icon) that
  analyzes your own tracked data and **coaches** you: ask "how's my cut going?",
  "what should I do today?", "how should I adjust my intake?" and it answers with
  recommendations grounded in your actual numbers — training, nutrition, recovery,
  phase strategy, anything the app covers. It opens with an auto-generated insight
  and lets you ask follow-ups; the assistant pulls live data on demand (weight
  trend, past phases, older macro windows, any day's full overview) via read-only
  tools, and never logs or changes anything itself — it advises, you act. Replies
  render as formatted markdown. The "copy stats for LLM" action now lives inside
  this panel. Stays out of medical advice. Shares the existing daily AI token
  budget; gated by the same per-user flag + server API key as the meal assistant.
  Built on a shared agent core extracted from the meal-chat agent (no change to
  meal logging).
- AI Insights chat **persists per day** (server-side): the conversation survives
  closing the panel, reloading, and switching devices. Re-opening re-renders the
  saved thread with **no tokens spent** — the AI only runs when you ask something
  new. A ◀/▶ day stepper browses past days' conversations (kept as an archive),
  and you can continue any past day (the assistant can pull that day's full stats
  on request). A "New chat" button starts a fresh thread; the auto-insight fires
  only on a brand-new, empty day.

## [1.16.0] - 2026-06-23

### Fixed

- AI web searches no longer burn through the daily token budget. A search now
  debits the budget the **same as one ordinary chat turn** (the recent
  non-search average, with the configured flat rate as fallback) — the expensive
  web-result tokens are logged truthfully but subsidized, not charged. Search
  volume is governed by the separate daily search cap. Previously the per-search
  charge was averaged from prior *search* calls, whose `input_tokens` include the
  web-result bloat; each search inflated the next one's price in an unbounded
  runaway (observed in prod: 2500 → 707 → 4268 → 13378 tokens per search).
- "Logs left" estimate is no longer cratered by a single web search. The
  per-call average that drives it now excludes search calls (its docstring
  claimed this, but the query never filtered them), so one search's 10k–20k
  `input_tokens` no longer drags the estimate up several-fold in one jump.

## [1.15.1] - 2026-06-23

### Fixed

- API no longer crashes at boot when an optional LLM cap env var
  (`ALMANAC_LLM_DEFAULT_DAILY_TOKEN_LIMIT`, `ALMANAC_LLM_HARD_DAILY_TOKEN_CAP`,
  `ALMANAC_LLM_HARD_DAILY_SEARCH_CAP`, `ALMANAC_LLM_TOKENS_PER_SEARCH`) is present
  but blank. docker-compose maps these as `"${VAR:-}"`, so leaving one unset
  passes an empty string, which the config previously coerced to `0` and rejected
  as not-positive — crashlooping the container and tripping a Watchtower rollback.
  An empty string is now treated as unset (the var's default or "no cap").

## [1.15.0] - 2026-06-23

### Added

- AI Meal Assistant — a built-in web chat panel (no external client needed) for
  logging meals in plain language. Describe what you ate and it returns editable
  proposal cards: it matches your stored-meal library first, estimates macros
  otherwise, and asks one focused question when a detail would swing the calories.
  Backed by a gated `POST /v1/llm/meal-chat` endpoint (Anthropic, propose-then-
  confirm; never writes without your confirmation). Off by default
  (`ALMANAC_LLM_ENABLED`), per-user (`llm_logging_enabled`), and shown only when
  the server has an API key. Manual meal logging is unchanged and never touches
  any of this.
- Admin user-management: a `requireAdmin` guard, `GET /v1/admin/users` +
  `PATCH /v1/admin/users/:id`, and MCP tools (`admin_list_users`,
  `admin_set_user_llm_access`, `admin_set_user_daily_limit`,
  `admin_set_user_admin`) to set another user's LLM access, daily token limit,
  and admin flag without database edits. The first user to sign in on a fresh
  deployment (empty users table) is auto-bootstrapped as admin; on an existing
  deployment, grant the first admin with a one-time
  `UPDATE users SET is_admin = 1 WHERE email = '...'`.
- Daily LLM usage balance: a `GET /v1/llm/usage` endpoint and a chat-panel
  indicator showing "~N logs left today" (a soft daily token limit that warns
  as it drains but never blocks the chat), plus a hard backstop
  (`ALMANAC_LLM_HARD_DAILY_TOKEN_CAP`) that returns 429 as a runaway
  circuit-breaker. Manual meal logging is never affected by either limit.
- AI Meal Assistant can use web search to look up nutrition facts for unfamiliar
  foods. Each search costs a flat, self-calibrating token charge against the same
  daily AI budget (measured from your recent searches, with a default fallback);
  real token use is still recorded. A per-day search cap (`ALMANAC_LLM_HARD_DAILY_SEARCH_CAP`,
  default 8) disables search once reached — meals still log without it, with a
  note in chat. Turns that searched show a "🔍 searched the web" note. The default
  soft token limit is now 30000 (~15 meal logs/day).

### Fixed

- The activity level chosen during onboarding (in the cold-start phase form) is
  now saved to your profile instead of only feeding the TDEE estimate — it no
  longer shows as "Not set" in Settings afterward. Also accepted at user
  bootstrap (`POST /v1/users` and the `bootstrap_user` MCP tool).
- The AI Meal Assistant is hidden when the server has no provider API key (not
  just when the per-user flag is off), so its buttons no longer appear when the
  chat would 403.
- AI Meal Assistant chat on mobile: the input bar stays above the soft keyboard
  (including Firefox Android), the thread auto-scrolls to the newest message, and
  the wait indicator no longer claims to be "searching the web" when it isn't.
- LLM prompt caching now works for the meal chat: the stored-meal-library prefix
  is cached with a 1-hour TTL and is no longer invalidated every request, cutting
  repeated-call cost.

## [1.14.1] - 2026-06-22

### Fixed

- **The 6-day summary now updates right after you finish a workout.** Its
  workout and net-calorie rows are sourced separately from the rest of the
  dashboard, so completing a session left them stale until a manual page
  reload. They now refresh as soon as the workout is saved, matching the
  weight, meal, and cardio cards.
- **The "next steps" nudge now clears after the action that resolves it.** It
  was loaded once when the page opened and only refreshed after a workout, so
  (for example) it kept telling you to log your weight even after you'd just
  logged it. It now refreshes after logging weight, sleep, meals, steps, or a
  phase change, so it reflects what you've actually done without a reload.

## [1.14.0] - 2026-06-22

### Added

- **Settings: timezone + unit controls** — the web Settings panel now lets you
  change your timezone (a searchable picker over all IANA zones) and preferred
  unit system (metric/imperial) directly, instead of only via the API/MCP.
  Saving either reloads the dashboard so weights and day boundaries re-render
  immediately.

### Fixed

- **Calendar bucketed early-morning workouts a day late** — a workout logged
  before 4am showed under the next calendar day on the month calendar while the
  6-day summary (correctly) showed it under the current day. The calendar now
  buckets workouts to the same user-local day as the rest of the app (honoring
  the 4am day-start), so both surfaces agree.

## [1.13.0] - 2026-06-21

### Added

- **Create and edit workout templates from the app** — no more asking your
  assistant to define a routine. The workout screen gains a "New template" button
  and a ✎ pencil on each template, opening an editor where you name the template
  and build an ordered list of exercises, each with default sets / reps / weight.
  Reorder exercises with up/down arrows, remove them, and archive a template you
  no longer use. Weights show and accept your preferred units (lb or kg). An
  exercise that has no sets prescribed is flagged with a gentle "add sets" nudge.
- **Add exercises without leaving the editor** — the exercise picker reads
  "Exercise name": pick from your library (grouped by muscle group), or type a name
  that doesn't exist yet and a "Create" option defines it on the spot (name + group)
  and drops it straight into the template.
- **Starter programs** — pick Push/Pull/Legs or Upper/Lower and the app seeds the
  whole split for you, each template pre-filled with sensible exercises and default
  sets/reps (weights left blank — those are personal). It walks you through each
  template so you can tweak before saving, and creates any missing exercises in your
  library automatically. The programs are offered prominently when you have few
  templates and tuck away once your library is set up.

### Fixed

- **Workouts now save on the correct day.** A workout started in the evening could
  be attributed to the next day for users in timezones behind UTC, because the start
  time was recorded in UTC rather than your local wall-clock time. Workouts now use
  your local time, so an evening session lands on today — matching how meals already
  behave.

## [1.12.0] - 2026-06-21

### Added

- **Create, edit, and stop nutrition phases from the dashboard** — no more asking
  your assistant to set up a phase. The onboarding card's "Start a nutrition phase"
  button opens a form to pick a type (cut / bulk / maintain), a daily calorie
  target, and macros; the active phase header gains ✎ Edit and Stop controls. The
  form keeps your numbers consistent — it shows the resulting deficit live and
  warns if a target doesn't match the phase type (e.g. a "cut" target above
  maintenance). Stopping a phase sets an end date (which you can backdate) and
  keeps the phase in your history rather than deleting it.
- **A guided cold-start for brand-new users** — if you haven't logged a weigh-in
  yet, the create form collects everything the estimate needs inline: your current
  weight (logged as a real weigh-in), and any missing profile details (height, sex,
  date of birth). The estimated TDEE updates live as you fill these in — weight,
  height, sex, and age all feed it — and a metric/imperial toggle lets you enter
  weight and height in your preferred units. A fully-set-up user sees none of these
  extra fields.
- **Activity level** — a profile setting (sedentary → very active) that makes the
  starting TDEE estimate fit you, shown in the create form and in Settings. It only
  affects the cold-start estimate before you've logged ~2 weeks of weigh-ins; once
  your TDEE is measured from real data it no longer applies (Settings says so).
- **Auto-suggested macros** — the create form pre-fills a protein / carb / fat split
  from your bodyweight, calorie target, and phase type, refreshed live as you adjust
  them, and fully editable. Protein is anchored to bodyweight on the muscle-protective
  high end (cut 2.4, bulk 2.3, maintenance 2.2 g/kg), fat ~25% of calories, carbs the
  remainder.
- **Dismissible welcome screen** — the "Welcome to Almanac" splash now has a "Skip
  the AI assistant for now" option that takes you straight to the dashboard so you
  can set up a phase manually; previously it stayed up until you'd connected your
  assistant and logged a weigh-in. Settings gains a "Connect your assistant" section
  with the MCP URL so you can hook it up whenever you're ready.
- `GET /v1/phase-estimate` — a read-only endpoint behind the create form that returns
  a server-computed TDEE estimate (optionally previewing an activity level, weight,
  height, sex, and date of birth without saving them) plus a macro suggestion, so the
  web app never re-implements the math.

### Changed

- The cold-start TDEE estimate now uses your chosen activity level instead of a fixed
  assumption (it falls back to the previous behaviour when no level is set, so existing
  users' numbers are unchanged until they pick one). The share-to-LLM report and the
  MCP profile tools now surface your activity level too.

## [1.11.0] - 2026-06-21

### Added

- **Copy stats for LLM** — a new button in the dashboard top bar (beside the 🏆
  achievements button) copies a full markdown briefing of your current picture to
  the clipboard, ready to paste into any LLM chat. The briefing covers your phase
  and where you are in it (target, day count, on-target days, average deficit,
  phase TDEE vs. current calculated TDEE), today's intake and energy balance,
  trend weight and TDEE, your workouts this phase (count, frequency, and a
  by-type breakdown), a 7-day summary, and a 14-day per-day history table that
  mirrors the dashboard — macros, the cardio/workout/steps breakdown, net, the
  on/off-track verdict, which workout you trained, and a drink marker per day, so
  an assistant can spot patterns (e.g. which days drove you over target). Days you
  didn't log read as "not logged" rather than a misleading zero. Backed by a new
  read-only `GET /v1/report` endpoint.

## [1.10.0] - 2026-06-20

### Added

- **Save and reuse meals from the dashboard** — the Today's meals card now has a
  collapsible "Stored meals" section. Add, edit, and delete saved meals (name +
  macros), and log any of them as eaten with one tap — it's recorded on the day
  you're viewing (now today, noon on a past day) and the calorie ring updates
  right away. Adding a saved meal whose name already exists asks before
  overwriting it. (Saved meals were previously manageable only through Claude.)

## [1.9.0] - 2026-06-20

### Added

- **Add, edit, and delete meals from the dashboard** — the "Today's meals" card
  is now fully editable in the web UI. A "+ Add meal" button opens an inline form
  (name, calories, protein, carbs, fat, and time); each meal row has its own edit
  and delete controls, with delete confirmed inline. Works for today and any past
  day via the calendar — a new meal defaults to the current time today, or noon on
  a past day, and the time is always shown in your timezone. A meal you add always
  lands on the day you're viewing, even in the small hours before the 4am day
  rollover. Saving updates the calorie ring, the remaining-macro bars, and the
  week grid right away. (Meals were previously add/edit/delete only through
  Claude; this brings the same to the web dashboard.)

## [1.8.2] - 2026-06-15

### Fixed

- Switching days on the dashboard (calendar or the `‹ ›` day stepper) now updates the meals list too. Previously the meals list stayed pinned to today while the rest of the dashboard followed the selected day.

## [1.8.1] - 2026-06-15

### Added

- Edit steps inline from the dashboard Movement block — log, correct, or remove a day's step count for today or any past day (calorie estimate recomputes automatically from body weight).

## [1.8.0] - 2026-06-15

### Added

- **Edit today's weight from the dashboard** — the weight card now has an edit
  button (top-right). Tap it to enter or correct today's weigh-in inline: a
  single field in your own unit (kg or lb), Save, and you're back to the card.
  Saving updates everything that depends on your weight — the trend line, the
  10-day average, and your measured TDEE — straight away. This is the first of
  a set of cards becoming editable directly in the web UI.
- **Edit last night's sleep from the dashboard** — the sleep card now has an
  edit button. Tap it to enter or correct your hours and a 1–5 quality rating
  inline, then Save. Sleep quality now appears on the card too (`· 4/5`),
  shown only when you've rated it. Saving updates the week histogram and your
  sleep-debt right away. Hours is required; the quality rating is optional
  (tap the selected number again to clear it).
- **Add, edit, and delete cardio sessions from the dashboard** — the Movement
  card's cardio list is now fully editable in the web UI. Each session has an
  edit and a delete control, and a "+ Add cardio" button logs a new one inline
  (type, duration, and calories — calories required). Deletes ask for a quick
  confirm. Changes update your energy balance and the week grid right away.
  Heart-rate-based logging and the calorie cross-check stay in the assistant
  chat flow.
- **Browse and edit any past day** — tap a day on the calendar (or step through
  with the new `‹ ›` banner) and the whole dashboard re-renders as that day:
  its meals, movement, weight, sleep, macros, and targets. An amber banner
  makes it obvious you're viewing a past day, with a "Today" button to jump
  back. The weight, sleep, and cardio cards are editable on a past day too —
  edits write to the day you're viewing, not today. The calendar highlights the
  selected day and follows it across months. The address bar reflects the day
  (`?date=…`) so a viewed day is linkable.

### Fixed

- **Steps placeholder wording** — when no steps are logged for the day, the
  Movement card now reads `Steps: — not logged` instead of the misleading
  `— syncs next day` (there is no automatic step sync; steps are entered
  manually). Matches the `— no data` / `— no log` placeholders on the weight
  and sleep cards.
- **Week grid stays current after an inline edit** — editing your weight or a
  cardio session now refreshes the dashboard's week grid (its cardio and net
  rows) immediately, instead of showing a stale value until the next page load.

## [1.7.1] - 2026-06-14

### Changed

- **Today's Movement** — the dashboard's "Today's cardio" block is now
  "Today's Movement" and folds in your step count: cardio sessions list as
  before, with a steps line beneath them (`Steps: 8,432 → 312 kcal`). Steps no
  longer sits under the macro bars. When today's steps haven't synced yet —
  the usual daytime case, since steps typically arrive the next day — the line
  reads `Steps: — syncs next day` rather than looking like missing data.
  Presentation only; no numbers changed.

## [1.7.0] - 2026-06-14

### Added

- **Stored meals** — a user-scoped library of reusable meal definitions
  (name + macros + an optional description). Define a meal once, then log it as
  a real eating event in one step. New REST surface (`/v1/stored-meals` CRUD,
  with create upserting on name) and five MCP tools: `define_stored_meal`,
  `list_stored_meals`, `update_stored_meal`, `delete_stored_meal`, and
  `log_meal_from_stored` (copies a saved meal's macros into today's log via the
  normal meal write-path, so day totals and accomplishments update as usual).
  Backend only — no web UI yet.

## [1.6.0] - 2026-06-10

### Added

- **Intake calendar view** — the dashboard month calendar now has a
  Workouts | Intake toggle (remembered across visits). Intake mode tints each
  day by adherence (green on-target, amber at-risk, red off-track), shows
  total kcal, the delta vs target, and a 🍺 line on days with alcohol.
  Deliberately-skipped (untracked) days read solid gray, forgotten days stay
  empty, and today renders striped with a neutral running delta. The header
  summarizes the visible month (logged / on target / off track).

### Changed

- **Calendar header** — single line in both modes: the per-template workout
  counts now sit inline next to the month (with their color dots) instead of
  on a duplicated second row.

## [1.5.2] - 2026-06-10

### Added

- **Tracked-day count in the phase header** — the line under the phase title
  now reads "day 40 (28 tracked) · started May 1", so the denominator in the
  On Target box (logged days, not phase days) is explained right where the
  phase length is shown. Hidden while TDEE is still calibrating, matching the
  On Target box.

## [1.5.1] - 2026-06-10

### Fixed

- **Mobile phase-header layout** — the four stat boxes (Phase TDEE, Current
  TDEE, Daily Deficit, On Target) now lay out as a clean 2×2 on phones and go
  4-across once there's room, instead of being squeezed onto one cramped row.
  This removes the wasted whitespace that appeared at in-between widths (where
  three boxes fit and the fourth was orphaned on its own row), and the box grid
  now aligns with the phase title above it even when the title wraps. Desktop
  layout is unchanged.

## [1.5.0] - 2026-06-10

### Added

- **Phase "On Target" box** — the dashboard phase header now shows how many of
  your logged days this phase hit target (X / N) plus your average daily
  deficit/surplus vs the phase TDEE anchor. Mobile box sizing is now fluid so all
  four stat boxes stay legible on phones.

## [1.4.3] - 2026-06-09

### Added

- BSD 2-Clause license.

### Changed

- `backup-db.sh` moved to `scripts/backup-db.sh` to sit alongside the other
  helper scripts; all references in the deploy docs, `update.sh`, and
  `sync-to-server.sh` updated accordingly.

### Removed

- Stale end-to-end bash/curl/jq test harness (`tests/scripts/`). It predated
  the auth system and the IDOR fix and hadn't been runnable for some time;
  the vitest suites across all four packages are the test layer now.

## [1.4.2] - 2026-06-09

### Fixed

- After a deploy, you'll now reliably see the new version without a manual hard
  refresh. Two caching gaps were closed: the app shell is no longer cached at the
  wrong layer (so it always loads the latest assets), and API responses now tell
  the browser never to reuse a stale copy — which is what made a just-fixed value
  occasionally still show its old form until you force-reloaded.
- The mobile summary bar that appears when you scroll down the dashboard now
  actually works on phones. It had never reliably shown on real Android browsers
  (it relied on the wrong scroll mechanism and a header that scrolled off-screen
  instead of staying pinned); it's been rebuilt to appear the moment the phase
  card scrolls out of view and stay fixed at the top, with the remaining-calories
  readout centered beside the achievements button.

## [1.4.1] - 2026-06-09

### Fixed

- Strength-PR wins now show the estimated 1-rep max as a clean round number
  (floored to the nearest 5 in your unit — e.g. "e1RM 60 lb" instead of
  "e1RM 62.8 lb"). The e1RM is an estimate extrapolated from your set, so the
  precise decimal implied a number you didn't actually lift; rounding down reads
  as "at least this much." Display only — the underlying value that detects and
  ranks your PRs is unchanged, so this applies to all past and future PR wins.
- The mobile sticky summary header (added in 1.4.0) now reliably appears when you
  scroll past the phase card. It previously depended on a load-timing race that
  could leave it stuck hidden — on a slower connection it might never show, even
  after a refresh. It now binds to the dashboard directly, so it works regardless
  of how the page loads.

## [1.4.0] - 2026-06-08

### Changed

- The phase header now shows your **Phase TDEE** (the value your plan was anchored
  to when the phase began) and your **Current TDEE** (the latest measured estimate)
  as two side-by-side boxes, instead of tucking the comparison into a small drift
  line. Seeing both numbers at once makes any drift obvious at a glance — and
  removes the old "≈ start" wording, which could read as if your TDEE hadn't moved
  when it simply hadn't moved by more than the display threshold.
- On mobile, the sticky summary bar at the top (day, calories left, P/C/F, TDEE)
  no longer duplicates the dashboard cards right below it. It now appears only once
  you scroll down past the phase card, where a quick at-a-glance readout is
  actually useful, and tucks away again when you scroll back to the top.

### Fixed

- Weights now display in your preferred unit (lb / kg) everywhere they were
  previously stuck in kilograms. For imperial users this fixes the "save changes
  to template?" prompt at the end of a workout (the edited set loads), and your
  accomplishments — strength PRs ("New PR … e1RM 212.7 lb"), weight-loss
  milestones, phase-completion results, and lifetime tonnage — plus the
  "previous best" and "most down" figures in the Wins card and the Achievements
  history. The same conversion applies to the `get_accomplishments` and
  `get_accomplishment_history` MCP tools, so AI assistants see your unit too.
  Stored data is unchanged (weights remain canonical kilograms); only the
  displayed figures convert, so the fix applies retroactively to all past wins
  and follows your unit preference if you change it.

## [1.3.0] - 2026-06-08

### Changed

- The top of the dashboard has been redesigned into a more app-like layout. Your
  remaining calories now read as a ring, and remaining protein/carbs/fat show as
  bars that drain as you eat. Going over a target stays calm — the number flips to
  "over" but nothing turns alarming red. The phase header now presents your current
  TDEE and planned deficit/surplus as two tidy boxes, with TDEE drift shown as a
  neutral "↓65 since start" only when it's moved meaningfully (no good/bad framing,
  since the plan stays anchored regardless).
- While your TDEE is still calibrating, the phase header shows a clear progress
  chip that names exactly what's left — "6 weigh-ins to go", or "6 days of meals to
  go" once your weigh-ins are in — instead of a bare estimate. (The number is
  tagged "est" until calibration completes.)
- The "no active phase" state is now a guided onboarding card instead of a plain
  banner. A brand-new account sees a two-step checklist (log a weight, then start a
  phase) and what a phase unlocks; between phases it's a reassuring "you're still
  logging — start your next phase when ready". Phase creation remains assistant-led
  (no in-app form), and the card instructs accordingly.

### Fixed

- On mobile, the achievements (🏆) button no longer sits flush against the
  remaining-calories readout in the sticky header — they now have proper spacing.

## [1.2.0] - 2026-06-08

### Added

- Strength PRs: logging a workout that beats your best estimated 1-rep-max
  (e1RM, Epley formula, sets of 1–12 reps) on an exercise now earns a 💪 PR win,
  shown with your previous best on that same lift. Surfaced on the dashboard and
  via the `get_accomplishments` MCP tool.
- Two new Accomplishment ("Wins") types built around your nutrition phases. When
  a cut or bulk ends, Almanac mints a result win summarizing the net change in
  your smoothed trend weight over the phase — "Cut complete: −4.2 kg over 10
  weeks" (a cut that gained, or a bulk that lost, isn't celebrated). Phases with
  a planned end date also earn a halfway milestone at their midpoint — "Halfway
  through your cut — 21/42 days". Both fire automatically when a phase ends or as
  you keep logging, appear on the dashboard Wins card, and are available through
  MCP via the existing `get_accomplishments` tool.
- Lifetime accomplishment milestones — cumulative "year in review" wins for your
  total workouts, total kilograms lifted, meals logged, and weigh-ins logged.
  They're earned at thresholds (e.g. your 100th workout, 1,000,000 kg lifted) and
  backdated to the day you actually crossed each one, so they surface as ordinary
  dashboard and MCP wins alongside the existing streaks and milestones.
- Sleep/recovery accomplishment: a new "win" that celebrates good sleep. It fires
  when 4 of your last 7 nights hit your sleep baseline (8h+) and when you clear
  your accumulated sleep debt. Both reuse the existing sleep-debt signal's
  baseline — no separate target to chase — and are edge-triggered, so each genuine
  recovery is celebrated once rather than repeated daily. Shows up in the dashboard
  Wins section and through the `get_accomplishments` MCP tool, alongside the other
  win types.
- Achievement history view: a 🏆 button in the top bar opens a full-timeline
  overlay of every win you've ever earned, grouped by month, with a summary strip
  of your totals and personal bests. (The dashboard Wins card still shows only
  recent wins; this is the complete archive.) Also available to an assistant in
  chat via a new read-only `get_accomplishment_history` MCP tool, which returns
  the full timeline plus the same aggregates.

### Changed

- The dashboard Wins section now shows wins from the last **7 days** (was 14),
  and each win displays when it was earned ("earned today" / "3 days ago"). Win
  records still persist — only the on-dashboard celebration is time-boxed, and a
  win's "previous best" still draws on your full history.

## [1.1.0] - 2026-06-07

### Added

- Accomplishments ("Wins"): a new dashboard section that celebrates what you're
  doing well, not just what's missing. It surfaces logging streaks, workout
  consistency, calorie-target adherence streaks, body-weight milestones, and the
  moment your TDEE becomes measured from your own data — each shown with the
  previous best of its kind ("12-day weigh-in streak — previous best was 10 days
  on May 1"). Wins are derived automatically from your existing logs and accrue
  as you log; the section sits below the nudges and stays hidden when there's
  nothing to show. Also exposed through MCP via a read-only `get_accomplishments`
  tool, so an assistant in chat can give you credit with the same context.

## [1.0.1] - 2026-06-07

### Added

- Automatic pre-migration database snapshot. Before a deploy applies any schema
  migration, the API writes a timestamped copy of the database to
  `data/backups/pre-<release>-<timestamp>.sqlite`, giving every migration a
  rollback point. If the snapshot can't be written, startup aborts and the
  previous version keeps serving.

## [1.0.0] - 2026-06-07

Almanac is now 1.0 — the app's surface is considered stable.

### Security

- Record access is now strictly scoped to its owner. Previously, on a
  multi-account instance, an authenticated user could read or change another
  user's records (meals, weights, sleep, steps, cardio, alcohol, nutrition
  phases, workouts, sets, exercises, groups, and templates) by referencing their
  id directly. Every fetch, edit, and delete now verifies ownership, returning
  "not found" for anything that isn't yours. Single-account instances were never
  exposed.

### Changed

- Polished the daily-use experience: in-app confirmation for revoking access
  tokens (no more browser pop-up), a "Saving…" state when ending a workout so
  it's clear the session is being saved, friendlier wording in the setup banners
  and the end-of-workout summary, mobile-friendly numeric inputs (no more
  autocorrect fighting your reps and weights), and a consistent one-decimal
  weight delta.

### Fixed

- Hardened the TDEE calculation against a latent configuration mismatch. No
  change to current numbers — a guard so a future settings change can't silently
  skew the estimate.

## [0.11.1] - 2026-06-06

### Added

- This changelog. Notable changes are now documented here, with detailed entries
  going back to 0.9.0 and a condensed summary of earlier releases.

## [0.11.0] - 2026-06-06

### Changed

- **Workout recommendations now surface the most-neglected muscle group first.**
  The recommender ranks templates recency-first: the template whose muscles are
  most overdue rises to the top, instead of being pushed down behind a
  freshly-recovered "prime" template. A group you've skipped for ~12 days now
  gets recommended next, which is what you want on a cut (the priority is
  retaining what you haven't trained). A template flagged "low confidence"
  (everything it hits is overdue) is still annotated as such, but that no longer
  demotes it in the ranking.

## [0.10.1] - 2026-06-06

### Changed

- Internal cleanup of the API route layer (shared request helpers, removed dead
  code). No user-facing behavior change.

## [0.10.0] - 2026-06-06

### Added

- **Daily NET snapshot.** Each day now records a factual NET = (calories in) −
  (that day's TDEE), snapshotted as you log. The macros week grid shows the NET
  row from this snapshot. NET is recomputed automatically whenever you add,
  edit, or delete a meal or an alcohol session.
- A one-off backfill script populated NET for historical days.

### Changed

- **Replaced the old activity-variance "net" with the snapshot above.** The
  previous calculation double-counted activity and over-subtracted on
  low-activity days; the new NET is a straight intake-minus-TDEE mirror, so the
  number is easier to trust. Day-attributed NET values will differ from before.

## [0.9.0] - 2026-06-06

### Fixed

- **Day boundaries now respect your timezone everywhere.** Meals, workouts, and
  other events are bucketed into the day they belong to in *your* local time
  (with the 4am day-start rollover), not in UTC. Previously an evening event for
  a non-UTC user could land on the next day, skewing week averages and TDEE and
  breaking untracked-day exclusion. This shifts day-attributed numbers for
  non-UTC users to their correct values.

### Changed

- TDEE and day-status aggregates (week-to-date, workout streaks, gap detection)
  are all computed against your local day rather than UTC.

## [0.3.0] - 0.8.1 — earlier releases

Detailed per-version notes start at 0.9.0 (above). Highlights from the earlier
0.3.x–0.8.x releases, condensed:

- **Nutrition phases & macro targets** — start cut/bulk/maintenance phases with
  TDEE-derived daily targets; macros response flags untracked days.
- **Next-best-action & nudges** — a prioritized "what should I do next" surface
  (onboarding gaps, yesterday's missed logs, today's nudges), rendered in the
  web app's idle workout pane and refreshed after each workout.
- **Calendar** — month view with workout pills and time-off (untracked-period)
  shading.
- **Deployment** — CI-built GHCR images on tag, running-commit visibility in
  Settings, and auto-deploy via a maintained watchtower fork.
- **Hardening** — null-safety cleanup across the codebase, plus the test/lint
  pre-push gate and tag-release script.

[Unreleased]: https://github.com/corcoran/almanac/compare/v1.32.1...HEAD
