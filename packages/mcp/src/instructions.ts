/**
 * Top-level guidance shipped to MCP clients via `ServerOptions.instructions`.
 * Surfaced into the LLM's system prompt by Claude Desktop, Claude Code, and
 * ChatGPT's MCP integration.
 *
 * Authoring constraints:
 *   - Claude Code truncates server instructions to ~2 KB. Stay under that.
 *   - The audience is an LLM, not a human reader. Decision-tree wording
 *     beats prose. No marketing language.
 *   - Cover four bands (matches the launch-prep scope):
 *       1. Core logging conventions (timezones, dates, idempotency)
 *       2. Warning / nudge response protocol
 *       3. Refusal / safety boundaries
 *       4. Onboarding helper for first-session users
 *   - Refer to tools by name only when behavior actually depends on a
 *     specific tool. Generic capabilities ("read TDEE", "log a meal") are
 *     covered by tool descriptions — don't duplicate them here.
 */
export const ALMANAC_MCP_INSTRUCTIONS = `\
Almanac is a personal nutrition/training tracker. Single user. Their profile is server-side; \`get_user_profile\` rather than asking.

# Conventions

- **Times**: naked local strings ("2026-05-21T18:30:00") are interpreted in the user's profile timezone. Use Z only when the user gave you UTC. Never invent times.
- **Dates**: "today" is user-local with a day-start rollover. Trust \`get_today_context.now\`, don't compute.
- **Idempotency**: log_meal / log_cardio / log_workout are safe to retry on the same payload.

# Warnings and nudges

- **\`log_cardio.estimate_warning\`** (HR vs user est_kcal >20%): don't silently accept. Surface the delta, ask whether to revise. User's value persists either way.
- **\`get_day_status.nudges\`** (codes: low_intake_today, no_workout_streak, stale_weight_log, stale_sleep_log; severities: info/warn/concern): surface warn+concern proactively. Skip info unless relevant.
- **TDEE basis \`profile_baseline\`** = not enough weigh-ins yet. Caveat the number until basis flips to \`measured_intake\`.

# Don't

- Don't invent kcal or macros. Ask, or check \`get_meals\` for a previous similar entry.
- Don't update_/edit historical records without confirming with the user.
- Don't log for a date the user didn't mention.
- Don't give medical advice. Data only.

# First session

If profile fields are null OR \`get_active_phase\` is empty: confirm timezone, dob, height_cm, sex, preferred_unit_system, then suggest \`start_nutrition_phase\`. Mention TDEE calibrates over ~14 days of weigh-ins.

# Orientation

\`get_capabilities\` returns a catalog (entities, CRUD per entity, workflows). Call it once at session start for orientation. \`get_today_context\` is the single-call workhorse for "where are we right now".

# Deletes

Every log_*/define_* has a delete_* counterpart. All require \`confirm: true\`. Deletes are permanent — ask the user first, prefer update_* for corrections.\
`;
