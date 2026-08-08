# Almanac

[![CI](https://img.shields.io/github/actions/workflow/status/corcoran/almanac/ci.yml?branch=master&label=ci)](https://github.com/corcoran/almanac/actions/workflows/ci.yml)
[![Latest tag](https://img.shields.io/github/v/tag/corcoran/almanac?label=release&color=c8871f)](https://github.com/corcoran/almanac/tags)
[![License](https://img.shields.io/github/license/corcoran/almanac?color=4a7a5f)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-almanac--fitness.com-c8871f)](https://almanac-fitness.com/guide/)
![MCP](https://img.shields.io/badge/MCP-70%2B_tools-c8871f)
![Self-hosted](https://img.shields.io/badge/self--hosted-4a7a5f)

**A precise, self-hosted fitness record your own AI agent can read.**

**[See what it does →](https://almanac-fitness.com/)** &nbsp;·&nbsp; **[Read the docs →](https://almanac-fitness.com/guide/)**

Almanac keeps an accurate account of what you eat, lift, weigh, and sleep, then hands it to whatever assistant you already use over MCP. Ask how the cut is going or what to train today, and the answer comes off your own numbers instead of a guess. It runs on your hardware, so the record stays yours.

You don't need an outside assistant to get value from it. The web dashboard does everything, and two chat surfaces ship inside the app: a meal assistant that turns "chicken burrito bowl" into editable macros, and a read-only insights coach. One API and one SQLite file sit underneath, so every surface reads the same data.

## Screenshots

The web dashboard. Nutrition phase and TDEE, today's macros and meals, a seven-day macro grid, weight trend, sleep, and the training panel with a recommended session.

<p align="center">
  <img src="screenshots/demo-dashboard.png" alt="Almanac dashboard" width="984">
</p>

The built-in AI meal assistant. Describe what you ate and it returns editable entries, looking up unfamiliar foods and asking about portion size when that changes the math.

<p align="center">
  <img src="screenshots/demo-meal-lookup.png" alt="AI meal assistant parsing a meal description into editable macros" width="984">
</p>

The AI insights coach. A read-only pass over your logged history: nutrition adherence, TDEE drift, training volume, and sleep.

<p align="center">
  <img src="screenshots/demo-insights-chat.png" alt="AI insights coach summarizing nutrition, training, and sleep" width="984">
</p>

Logging and reviewing through an outside assistant over MCP:

| | |
|---|---|
| <img src="screenshots/chat3.png" alt="Training recommendation and accomplishments" width="420"> | <img src="screenshots/chat4.png" alt="Resistance training volume analysis" width="420"> |
| <img src="screenshots/chat2.png" alt="Cut progress overview" width="420"> | <img src="screenshots/chat1.png" alt="Daily check-in" width="420"> |

## Architecture

```
Browser ──► nginx ──► oauth2-proxy ──► almanac-web   (Vue 3 SPA)
                          │
                          ├──► almanac-api   (Fastify + SQLite)
                          │
Claude / ChatGPT ─────────┴──► almanac-mcp   (70+ tools, 5 resources)
                                    │
                                    └──► almanac-api
```

Four containers sit in the request path behind nginx. oauth2-proxy handles browser SSO through Google, GitHub, or any OIDC provider it supports, while MCP traffic skips SSO entirely and authenticates with OAuth 2.1 or a personal access token. Every path converges on the same PAT format stored in SQLite. The [authentication guide](https://almanac-fitness.com/guide/authentication) has the full picture.

## Documentation

Everything lives at **[almanac-fitness.com](https://almanac-fitness.com/)**.

- [Getting started](https://almanac-fitness.com/guide/getting-started). Run it locally, then connect your assistant.
- [Deploy](https://almanac-fitness.com/guide/deploy). The production walkthrough.
- [Authentication](https://almanac-fitness.com/guide/authentication). Google, GitHub, or any OIDC provider, step by step.
- [Connecting assistants](https://almanac-fitness.com/guide/connecting-assistants). MCP clients and PATs.
- [Configuration](https://almanac-fitness.com/guide/configuration). Every environment variable.
- [Operations](https://almanac-fitness.com/guide/operations). Updates, backups, recovery.
- [Architecture](https://almanac-fitness.com/guide/architecture). How the MCP layer works.

## Features

### Nutrition

- Log meals with kcal, protein, carbs and fats, then edit, delete, or review them by date.
- Save a meal definition once and log it as eaten in one tap afterward.
- Run a cut, bulk, or maintenance phase with daily kcal targets that are either static or TDEE-relative. The create form suggests a macro split from your bodyweight and target, and a guided cold start collects whatever a TDEE estimate still needs.
- Track today against target, historical summaries by date or range, rolling 7-day averages, and an on-track, at-risk, or off-track verdict per day.
- TDEE runs off one of three bases: a profile baseline from Mifflin BMR times activity, measured intake back-calculated from your weight trend, or your own assertion. It moves from baseline to measured across roughly 14 days of weigh-ins.

### Body composition

- Daily weigh-ins with optional notes.
- An exponentially weighted moving average over 14 or 30 days, with a change rate and a confidence level, so a salty dinner doesn't read as fat gain.

### Training

- Build reusable templates with ordered exercises and defaults, in the app or through an assistant, then start a session and skip, override, or add exercises as you go.
- Starter programs seed a whole Push/Pull/Legs or Upper/Lower split.
- Each set records reps, weight, and RPE from 1 to 10, with duration and estimated kcal per workout.
- Custom exercises group by muscle and archive once you stop using them.
- Recovery per muscle group runs 0 to 100 and classifies too_soon, prime, or detrained, using a multi-phase decay model that reads hours since the last session against trainable capacity.
- Almanac scores which template to run next from that recovery state, not from what day of the week it is.

### Cardio, steps, and alcohol

- Cardio logs by modality such as bike, run, or ruck, with duration, distance, average HR, and estimated kcal from Keytel or METs.
- Steps take a daily count with automatic kcal estimation you can override when you have better data.
- Alcohol is session-based: start, end, US standard drinks, and a kcal estimate that overlays onto daily energy balance.

### Sleep

- Hours and quality from 1 to 5 per night, handling timezone-aware midnight crossings.
- A rolling sleep debt against a baseline, over a window you configure. It defaults to 14 days.

### Accomplishments

- Milestones fall out of your logs without you asking: logging and workout streaks, calorie-adherence streaks, body-weight milestones off the smoothed trend, strength PRs, sleep recovery, and the day your TDEE flips to measured.
- Each one shows your previous best and lands the moment a log completes it.
- Lifetime totals like a 100th workout or total kilograms lifted get backdated to the day you actually crossed them.

### Web UI

- The daily dashboard leads with a calorie ring and draining protein, carb, and fat bars, then current against phase TDEE, deficit or surplus, on-target adherence, today's meals and movement, a weekly macro grid, weight sparkline, sleep debt, phase progress, and earned wins above the workout picker.
- Meals, weight, sleep, cardio, and steps all add, edit, and delete straight from the dashboard rather than only through chat, and every edit hits the ring, bars, grid, and trends immediately.
- Phases start, edit, and stop from the same place, with a live TDEE estimate in the create form.
- The workout panel holds the template picker, template and starter-program editing, an active session with live set entry, mid-session exercise adds, an end-and-save dialog, and last-session reference numbers.
- A month calendar flips between Workouts and Intake. Workouts shows per-template tallies, recovery pills, and a forward recommendation window, while Intake tints each day by adherence. Tap a day or step through with `‹ ›` to view and edit any past day, and the URL tracks it via `?date=…`.
- The meal assistant takes a plain-language description and returns editable proposal cards, checking your stored-meal library first, estimating when nothing matches, and web-searching unfamiliar foods. A daily token budget shows roughly how many logs you have left, and both budget and search have configurable caps.
- The insights coach reads your nutrition adherence, TDEE drift, training volume, split balance, and sleep back to you, running a stronger model than the meal parser. It's read-only by design, with no write tools and no web search, and transcripts persist per day with `◀ ▶` navigation.
- Both AI panels are off by default. See [Configuration](#configuration) before switching them on.
- Settings handles profile editing, activity level, timezone, metric or imperial units, PAT creation and revocation, and the MCP URL.
- One button copies a full markdown briefing covering phase, TDEE, today, trends, recent workouts, and a 14-day history table, ready to paste into any chat.
- The whole UI responds down to a single 768 px breakpoint, with swipeable panels through CSS scroll-snap, a contextual sticky header, and 36 px touch targets.

### MCP integration

- 70+ tools and 5 resources give full CRUD over every entity, including stored meals and `log_meal_from_stored`, plus the derived signals: stim state, TDEE, sleep debt, day status, calendar.
- `get_next_best_action` drives onboarding and next-step guidance, and `get_accomplishments` lets an assistant surface earned wins mid-conversation.
- Say "two eggs, toast and butter, and a flat white" to Claude on mobile, Desktop, or Code, or to ChatGPT, and it works out the calories and macros, logs them, and the entry appears in the web UI.
- Claude mobile and ChatGPT connect through the standard MCP OAuth flow using whichever SSO provider you configured, with no manual token setup. Claude Code and any other HTTP client use a personal access token instead.
- Retrying a meal, weight, or sleep call is safe.
- Adding a custom MCP server is a paid-plan feature on both vendors, so check the current terms before counting on it for everyone you invite. The dashboard and its built-in AI work on any account.

### Auth

- The allowlist decides whether this is a one-person instance or several. Each allowlisted email gets its own account provisioned on first sign-in, with no separate account-creation step.
- The first account on a fresh instance becomes admin, so you're never locked out of the admin tooling. Make sure that first sign-in is you, because the [deploy guide](https://almanac-fitness.com/guide/deploy) has to walk you back out of it otherwise.
- That same `allowed-users.txt` gets read in three places: oauth2-proxy for browser SSO, the API for account provisioning, and MCP during the OAuth flow.
- OAuth tokens are real PATs, minted through the API, stored in SQLite, and revocable from Settings.
- Every record is scoped to its owner and enforced at the data layer, so one account never reads or touches another's data.

## Requirements

Node 20 or newer and pnpm 9 or newer. Docker only matters once you want real sign-in. SQLite ships bundled inside `better-sqlite3`, so there's no database server to set up.

## Quickstart

Fastest path to a running instance with your own data in it:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm install
scripts/local-dev/dev-noauth.sh you@example.com
```

No `.env`, no Docker, no OAuth client. The API and web server run on header-trust auth, so the UI needs no login and acts as the address you passed, and the script prints the URL when it's up.

That Anthropic key powers the two chat panels built into the web UI. Without it everything else works the same and those two panels stay hidden. They also sit behind a per-user flag that starts at 0, which you flip once after signing in:

```bash
sqlite3 data/almanac.sqlite \
  "UPDATE users SET llm_logging_enabled = 1 WHERE email = 'you@example.com';"
```

To connect Claude Code instead, mint a PAT in Settings, run `pnpm --filter @almanac/mcp dev`, and point your client at `http://127.0.0.1:3030/mcp`.

[Getting started](https://almanac-fitness.com/guide/getting-started) covers the rest: adding real sign-in, putting it on a domain, and the demo instance if you want a populated look first.

## Configuration

Everything is configured through `.env`. `.env.example` documents each variable inline, and the [configuration reference](https://almanac-fitness.com/guide/configuration) groups all of them by concern: core, MCP, OAuth, watchtower notifications, and the optional LLM surfaces.

The AI surfaces are off by default and bill your own Anthropic key, so they cost real money per use. Per-user daily token and search caps exist. Leave them unset and there is **no cap**. Read the [LLM section](https://almanac-fitness.com/guide/configuration#llm-ai-surfaces) before switching them on or inviting anyone else.

## Production deployment

Five Docker Compose services run behind host nginx with TLS: web, API, MCP, oauth2-proxy, and watchtower for hands-off updates. Only oauth2-proxy binds a host port, and the three almanac services stay inside the Docker network. Images build in CI and publish to GHCR on each release tag, so the server pulls prebuilt images and never builds anything locally.

[Deploy](https://almanac-fitness.com/guide/deploy) walks through DNS, TLS, nginx, OAuth, and first boot. [Operations](https://almanac-fitness.com/guide/operations) covers updates, watchtower, backups, and recovery.

## Testing

```bash
pnpm -r test        # full test suite across all packages
pnpm -r typecheck   # tsc --noEmit workspace-wide
pnpm lint           # Biome
pnpm format         # Biome
```

Scope to one package with `pnpm --filter @almanac/<pkg> test`.

## Troubleshooting

**The API returns 403 for a new user.** That email isn't in `allowed-users.txt`. Add it, then restart the API container or wait for oauth2-proxy to hot-reload the file.

**`ALMANAC_DB_PATH` ended up somewhere unexpected.** This is the `pnpm --filter` cwd trap: a relative path resolves against `packages/<pkg>/` rather than the workspace root. Use an absolute path.

## Project layout

```
almanac/
├── packages/
│   ├── core/           # SQLite, migrations, repos, domain types, signals, schemas
│   ├── api/            # Fastify HTTP server, zod request/response validation
│   ├── mcp/            # MCP server, MCP tools + resources, OAuth 2.1
│   └── web/            # Vue 3 SPA, Vite, Pinia
├── deploy/             # nginx config, post-migration smoke test
├── docs/               # documentation site (VitePress) + landing page
├── scripts/
│   └── local-dev/      # up.sh / down.sh, dev-noauth.sh, demo.sh, screenshot.mjs
├── docker-compose.yml
├── allowed-users.txt   # shared email allowlist
├── .env.example
└── pnpm-workspace.yaml
```

## License

[BSD 2-Clause](LICENSE)
