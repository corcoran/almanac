# Fitness App — Design Spec

A local-first fitness tracker that replaces a 9-year plain-text workout log, accessible to an LLM via MCP for conversational logging and cross-signal analysis.

**Thesis:** The text file logs *what*. The database reveals *why*.

---

## Core Concept

Single-developer (initially) personal training app with potential as an open-source tool for friends, family, or wider community. Workouts and manual inputs on the left of the UI; graphs, stats, and computed signals on the right. Built around the principle that single metrics lie — cross-referencing signals over rolling windows is where truth lives.

---

## Inputs (What Gets Logged)

### Original notes
- Exercises grouped by muscle (PPL split)
- Sets, reps, and load per exercise
- Calendar view to pencil in planned workout days
- Body weight (graphed)
- Meals with macros
- Calories in + out

### Added during design discussion
- RPE on top set per main exercise (not per set — overkill for hypertrophy)
- Sleep hours + optional quality rating (1–5)
- Alcohol: drinks + time relative to workout
- Cardio tracked separately (TDEE contribution, not muscle stimulation)
- Layoff context tag: illness / vacation / intentional deload (for return-to-load calibration)

---

## Computed Signals (What the App Shows)

### Workout side

**Per-muscle-group stimulation meters** (~8 groups: chest, back, shoulders, biceps, triceps, quads, hamstrings, calves; abs/traps/forearms optional)
- Acts as **advisor, not scorekeeper** — output is "here's the smart move," not "you failed"
- Decay curve calibrated to real detraining science:
  - **0–7 days:** essentially neutral (glycogen/water move; muscle intact)
  - **7–14 days:** mild fade
  - **14–21 days:** real losses start (~5% strength, neural decay)
  - **21d+:** measurable hypertrophy loss, accelerating
- Stimulus quality (RPE × volume) feeds the meter, not just session presence — prevents junk-volume gaming
- "Protected" state for flagged illness/intentional deload — gentler decay during legitimate layoffs

**Growth-window band** inside each meter
- Green from ~48h to ~7 days — wide, not a sharp peak at 72h
- Communicates "optimal restimulation window" distinct from "am I detraining"

**Personalized return-to-load recommendations**
- Parse historical comeback patterns from imported text-file data
- Example output: *"Last time you took 10 days off chest, you came back at 87% of working weight and were back to normal in 2 sessions. Suggest 40lb DB incline today."*
- Learns your personal detraining response, not population averages

### Nutrition / recovery side

**Dynamic TDEE via energy-balance back-calculation**
- Formula: `TDEE = avg daily kcal intake − (weight change × 7700 kcal/kg) / days`
- Rolling 14–21 day window; self-correcting, captures NEAT/age/genetic quirks automatically
- Component-based estimate (Mifflin BMR + estimated NEAT + exercise) seeds the first 2 weeks
- Confidence indicator grows as data accumulates

**Trend weight**
- Exponential moving average drives all decisions
- Raw daily weight shown as dots (informational, not actionable)
- Don't expose TDEE numbers until ≥14 days of data — show "calibrating, X days remaining"

**Sleep trend** with optimal band (7–9h) and rolling sleep debt indicator

**Alcohol effect overlay** on stim pills
- 0–6h post-workout: peak MPS suppression
- 6–24h: sleep/hormone-mediated drag
- 24h+: mostly recovered
- Visualizes effect of drinking-night timing relative to training

### Cross-signal analysis

- RPE × sleep correlation surfacing
- RPE drift at constant loads (distinguishes accumulating fatigue from progression)
- Sleep-adjusted session expectations ("expect RPE +1 today after that 5h night")
- Drinking-night impact on next-day session quality
- Carb intake vs. session quality the following day

---

## Architecture

| Layer | Choice | Rationale |
|---|---|---|
| Database | SQLite via `better-sqlite3` | Synchronous, fast, one file, easy backups |
| Backend | Node + Fastify or Hono | Lightweight, modern, low ceremony |
| Frontend | Vue 3, Composition API | Less ceremony than Angular for solo dev |
| Language | TypeScript end-to-end | Shared types between front and back |
| LLM integration | MCP server (official TS SDK) | Tools (read/write) + resources (ambient context) |
| Remote access | Cloudflare Tunnel | Local server reachable from claude.ai web/mobile |
| Deployment | Single Node process + SQLite file | Trivial for friends/family self-hosting |

### MCP layer

- **Tools (write):** `log_workout`, `log_meal`, `log_drink`, `log_cardio`, `log_weight`, `log_sleep`
- **Tools (read):** `get_recent_workouts`, `get_stim_state`, `get_macros`, `get_alcohol_log`, `get_workout_history`
- **Edit/delete tools:** Every read returns IDs; corrections are addressable
- **Resources:** Auto-loaded "today's context" (current phase, week-to-date macros/sessions, active stim windows) so conversations start with shared state
- **Scoping:** Default reads to last 7 days; explicit filters for larger queries to protect context window

---

## Layout

**Desktop-first two-pane:** inputs left, viz right.

**Mobile:** deferred. Eventually tabbed (Stats / Inputs). Most logging happens at the standing desk anyway — mobile is a nice-to-have, not v1.

---

## Phased Rollout

1. **Phase 1 — Replace the text file**
   Workouts, sets/reps/RPE, per-muscle stim pills, detraining curve. Ship this. Use it. Validate the data model before expanding.

2. **Phase 2 — Close the nutrition loop**
   Weight + meals + back-calculated TDEE. Sleep input. Alcohol overlay on stim pills.

3. **Phase 3 — Refinement and planning**
   Calendar planning view. Cardio tracking. Cross-signal correlation surfaces in the analysis layer.

4. **Phase 4 — Polish and reach**
   Wearable integration (HealthKit / Health Connect). Mobile UX. Possible in-app LLM features (food parsing, workout suggestions).

---

## Migration

The 9-year text file is a real artifact and the highest-value input on day one.

- Treat the parser as its own workstream
- Format has likely evolved over the years — handle multiple schemas
- Get the parser right *once*, then current-state and historical analysis both plug into the same clean SQLite store
- Don't conflate parser work with app feature work

---

## Design Principles

These are the rails that keep the app from drifting into a generic fitness tracker:

1. **Meter as advisor, not scorekeeper.** Reflects physiology, doesn't punish life.
2. **Keep signals separate.** Never black-box multiple inputs into a single opaque number.
3. **Personal data > population averages.** Your history teaches the app how *you* respond.
4. **Logging stays dumb-simple.** Complexity lives in the analysis layer, never in the input UI.
5. **Cross-reference reveals truth.** Single metrics lie; patterns across signals don't.

---

## Open Questions / Future Decisions

- Wearable integration approach (HealthKit/Health Connect via web bridge vs. native mobile companion)
- How to handle the in-conversation context resource — single blob vs. structured fields
- Whether to ship an MCP-only v1 (chat-driven) before building any web UI, or build them in parallel
- Open-source license + contribution model if/when it goes public
- Whether to add an LLM directly into the app or keep it as a pure data product (favoring the latter for v1)
