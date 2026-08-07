import { kgToDisplayWeight, weightUnitLabel } from "../domain/units.js";
import type { UnitSystem } from "../domain/users.js";
import type { ShareReport } from "../schemas/report.js";

/** Integer-grouped number, e.g. 2050 → "2,050". Deterministic (fixed locale). */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Whole-gram macro value. Real meal macros are fractional (e.g. 178.4 g), and
 * target−intake deltas leak float noise (1.5999999999999943); round to a whole
 * gram for display, matching the 14-day table columns and the mockup.
 */
function g(n: number): number {
  return Math.round(n);
}

/**
 * A "remaining" kcal value: a magnitude when under budget ("630"), a unicode-minus
 * signed value when over ("−339"). Unlike `signed()` it does NOT prefix `+` on the
 * common positive case — "Remaining: 630 kcal" reads more naturally than "+630".
 * Rounds, so fractional intake doesn't leak float noise into the delta.
 */
function remainingKcal(n: number): string {
  const r = Math.round(n);
  return r < 0 ? `−${fmt(-r)}` : fmt(r);
}

/** Signed delta with a real unicode minus (U+2212): 190 → "+190", -480 → "−480", 0 → "0". */
function signed(n: number): string {
  const r = Math.round(n);
  if (r < 0) return `−${fmt(-r)}`;
  if (r === 0) return "0";
  return `+${fmt(r)}`;
}

/** Map a phase intent to a parenthetical gloss for the header line. */
function intentGloss(intent: string): string {
  switch (intent) {
    case "cut":
      return "fat loss";
    case "bulk":
      return "muscle gain";
    case "recomp":
      return "recomposition";
    case "maintenance":
      return "maintenance";
    default:
      return intent;
  }
}

/** Title-case a phase intent for the bold label: "cut" → "Cut". */
function intentLabel(intent: string): string {
  return intent.charAt(0).toUpperCase() + intent.slice(1);
}

/**
 * Friendly label for a stim `phase` enum (time-since-last-trained band), so the
 * readiness line reads as prose instead of leaking raw values like "detrained".
 * Mirrors the bands in `stim.ts phaseFromHours`.
 */
function stimPhaseLabel(phase: string): string {
  switch (phase) {
    case "too_soon":
      return "needs more rest";
    case "acceptable":
      return "ready";
    case "prime":
      return "prime window";
    case "in_window":
      return "still primed";
    case "fading":
      return "fading";
    case "detrained":
      return "long layoff";
    default:
      return phase;
  }
}

/**
 * Resolve the effective phase direction for framing the balance + biggest-miss
 * lines. `phase_type` is the clean field ("cut" | "bulk" | "maintenance") but is
 * nullable; fall back to the legacy `intent` (which also carries "recomp", treated
 * like maintenance). Anything unrecognized defaults to "cut" — the historical
 * framing, so no existing behavior shifts for a real cut.
 */
function phaseDirection(
  phase: NonNullable<ShareReport["context"]["phase"]>,
): "cut" | "bulk" | "maintenance" {
  const t = phase.phase_type;
  if (t === "cut" || t === "bulk" || t === "maintenance") return t;
  if (phase.intent === "bulk") return "bulk";
  if (phase.intent === "maintenance" || phase.intent === "recomp") return "maintenance";
  return "cut";
}

type HistoryDay = ShareReport["history_14d"][number];

/** Per-row flag for the Last-14-days table: today marker, untracked, not-logged, or blank. */
function flagFor(day: HistoryDay, generatedForDate: string): string {
  if (day.date === generatedForDate) return "(today, partial)";
  if (day.untracked) return "untracked";
  // A day with no meals is "didn't log", not a real 0-kcal day — flag it so the
  // table doesn't read as a sustained 1,900-kcal deficit through unlogged days.
  if (!day.meals_logged) return "not logged";
  return "";
}

/** Status enum → human copy for the Today section. */
function statusLabel(status: string): string {
  switch (status) {
    case "on_track":
      return "on track";
    case "at_risk":
      return "at risk";
    case "off_track":
      return "off track";
    default:
      return status;
  }
}

/** Weight in the user's display unit with a unit label, e.g. "82.4 kg". */
function weightStr(kg: number, system: UnitSystem): string {
  return `${kgToDisplayWeight(kg, system)} ${weightUnitLabel(system)}`;
}

/** Inclusive day count between two YYYY-MM-DD dates (deterministic UTC math). */
function inclusiveDays(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Serialize a {@link ShareReport} into a single markdown briefing string for an
 * LLM. Pure: output is a deterministic function of the input — no clock, no I/O.
 */
export function buildReportMarkdown(report: ShareReport): string {
  const { context, history_14d, workouts } = report;
  const { user, phase, today, week_to_date, tdee, trend_weight, phase_adherence, stim_states } =
    context;
  const system = user.preferred_unit_system;
  const lines: string[] = [];

  // --- Header / intro ------------------------------------------------------
  lines.push(`# Almanac stats — ${report.generated_for_date}`);
  lines.push("");
  lines.push(
    "_This is my current nutrition and training data from Almanac. Help me interpret it._",
  );
  lines.push("");
  lines.push(`_Snapshot for ${user.name} · ${user.timezone} · ${system}._`);
  lines.push("");

  const tdeeEstimated = tdee.basis === "profile_baseline";

  // --- Phase ---------------------------------------------------------------
  lines.push("## Phase");
  if (phase) {
    const remaining =
      phase.days_remaining !== null ? ` · ~${phase.days_remaining} days remaining` : "";
    lines.push(
      `- **${intentLabel(phase.intent)}** (${intentGloss(phase.intent)}) — day ${phase.days_in} of phase · started ${phase.started_on}${remaining}`,
    );
    lines.push(
      `- Daily target: **${fmt(phase.daily_kcal_target)} kcal** · ${phase.base_protein_g} P / ${phase.base_carb_g} C / ${phase.base_fat_g} F`,
    );
    const anchor = phase.tdee_at_phase_start;
    if (anchor !== null) {
      const calcLabel = tdeeEstimated ? "estimated TDEE" : "current calculated TDEE";
      const deficit =
        phase.deficit_kcal !== null ? ` (deficit ${fmt(Math.abs(phase.deficit_kcal))}/day)` : "";
      lines.push(`- Phase anchor TDEE ${fmt(anchor)} vs ${calcLabel} ${fmt(tdee.kcal)}${deficit}`);
    }
    // The actual energy balance the user is running NOW — pre-computed (current
    // TDEE − recent avg intake) with the subtraction shown, so the model reads it
    // rather than deriving it from separate numbers (which it does unreliably).
    // Framed by phase DIRECTION: a cut wants a deficit (surplus = off-plan), a bulk
    // wants a surplus (deficit = off-plan, may not be gaining), maintenance wants
    // an even balance (deviation either way is just noted, neither is alarming).
    // Only when there's real recent intake — a balance vs 0 intake is garbage.
    if (week_to_date.avg_kcal_in.days_with_data > 0) {
      const avgIn = week_to_date.avg_kcal_in.value;
      // deficitNow > 0 = a deficit (TDEE above intake); < 0 = a surplus.
      const deficitNow = Math.round(tdee.kcal - avgIn);
      const dir = phaseDirection(phase);
      if (dir === "cut") {
        if (deficitNow >= 0) {
          lines.push(
            `- Actual recent **deficit**: current TDEE ${fmt(tdee.kcal)} − recent avg intake (7-day) ${fmt(avgIn)} = **${fmt(deficitNow)} kcal/day** (your phase target is a deficit; this is the real one you're running now, the planned deficit above is the target).`,
          );
        } else {
          lines.push(
            `- Actual recent balance: recent avg intake (7-day) ${fmt(avgIn)} − current TDEE ${fmt(tdee.kcal)} = **+${fmt(-deficitNow)} kcal/day SURPLUS** (you're eating above maintenance — off-plan for a cut; your phase target is a deficit).`,
          );
        }
      } else if (dir === "bulk") {
        if (deficitNow < 0) {
          lines.push(
            `- Actual recent **surplus**: recent avg intake (7-day) ${fmt(avgIn)} − current TDEE ${fmt(tdee.kcal)} = **${fmt(-deficitNow)} kcal/day** (your phase target is a surplus; this is the real one you're running now).`,
          );
        } else {
          lines.push(
            `- Actual recent balance: current TDEE ${fmt(tdee.kcal)} − recent avg intake (7-day) ${fmt(avgIn)} = **${fmt(deficitNow)} kcal/day DEFICIT** (you're eating below maintenance — off-plan for a bulk; you may not be gaining; your phase target is a surplus).`,
          );
        }
      } else {
        // maintenance: target is roughly even; report the signed delta, frame
        // neither direction as alarming, just note how far from even.
        lines.push(
          `- Actual recent **energy balance**: current TDEE ${fmt(tdee.kcal)} vs recent avg intake (7-day) ${fmt(avgIn)} = **${signed(deficitNow)} kcal/day** (your phase target is an even balance; this is how far from even you are).`,
        );
      }
    }
    if (phase_adherence) {
      const avg =
        phase_adherence.avg_delta_kcal !== null
          ? ` · avg daily deficit ${signed(phase_adherence.avg_delta_kcal)} kcal`
          : "";
      lines.push(
        `- On target: **${phase_adherence.on_track_days} of ${phase_adherence.logged_days} logged days**${avg}`,
      );
    }
  } else {
    lines.push("- No active nutrition phase.");
  }
  lines.push("");

  // --- Today ---------------------------------------------------------------
  // `meals_logged_today` separates "ate 0 kcal" from "didn't log". When nothing
  // is logged, a literal 0-intake "on track" reads as a false positive, so we
  // surface "no meals logged yet" and drop the intake/remaining/status lines.
  lines.push(`## Today (${context.today_date})`);
  if (today.meals_logged_today) {
    lines.push(
      `- Intake so far: **${fmt(today.intake.kcal)} kcal** · ${g(today.intake.protein_g)} P / ${g(today.intake.carb_g)} C / ${g(today.intake.fat_g)} F`,
    );
    if (today.target) {
      const rem = {
        kcal: today.target.kcal - today.intake.kcal,
        protein_g: today.target.protein_g - today.intake.protein_g,
        carb_g: today.target.carb_g - today.intake.carb_g,
        fat_g: today.target.fat_g - today.intake.fat_g,
      };
      // remainingKcal: magnitude when under budget, unicode-minus when over; rounds
      // so fractional intake doesn't leak float noise. Macro grams whole via g().
      lines.push(
        `- Remaining vs target: ${remainingKcal(rem.kcal)} kcal · ${g(rem.protein_g)} P / ${g(rem.carb_g)} C / ${g(rem.fat_g)} F`,
      );
    }
    if (today.observed) {
      lines.push(
        `- Status: **${statusLabel(today.observed.status)}** (${signed(today.observed.vs_target)} vs target)`,
      );
    }
  } else {
    lines.push("- No meals logged yet today.");
  }
  const eb = today.energy_balance;
  lines.push(
    `- Energy balance: ${fmt(eb.total_in)} in − ${fmt(eb.tdee_baseline)} TDEE = **${signed(eb.net)} net** today`,
  );
  lines.push("");

  // --- Weight & TDEE -------------------------------------------------------
  lines.push("## Weight & TDEE");
  if (trend_weight.current_kg !== null) {
    const change = trend_weight.weight_change;
    const paren = change
      ? ` (${signed(kgToDisplayWeight(change.value_kg, system))} ${weightUnitLabel(system)} over ${change.over_days} days)`
      : "";
    lines.push(`- Trend weight: **${weightStr(trend_weight.current_kg, system)}**${paren}`);
  } else {
    lines.push("- No weight logged yet");
  }
  if (user.activity_level) {
    lines.push(`- Activity: ${user.activity_level}`);
  }
  if (tdeeEstimated) {
    const toGo =
      tdee.components.days_remaining_to_calibrate ??
      tdee.components.meal_days_remaining_to_calibrate;
    const togo = toGo !== undefined ? ` (${toGo} days to go)` : "";
    lines.push(`- Current TDEE: **${fmt(tdee.kcal)} kcal** — estimated TDEE — calibrating${togo}`);
  } else {
    // basis is necessarily "measured_intake" here (the "profile_baseline"
    // case is handled by the tdeeEstimated branch above).
    lines.push(
      `- Current TDEE: **${fmt(tdee.kcal)} kcal** — measured intake, ${tdee.confidence} (${tdee.window_days}-day window)`,
    );
  }
  lines.push("");

  // --- Workouts ------------------------------------------------------------
  const workoutHeading =
    workouts.window_label === "phase"
      ? `## Workouts (this phase, since ${workouts.window_from})`
      : "## Workouts (last 14 days)";
  lines.push(workoutHeading);
  if (workouts.by_template.length === 0) {
    lines.push("- No workouts logged in this window.");
  } else {
    const windowDays = inclusiveDays(workouts.window_from, report.generated_for_date);
    const perWeek = workouts.total / (windowDays / 7);
    lines.push(
      `- **${workouts.total} sessions** in ${windowDays} days (~${perWeek.toFixed(1)} / week)`,
    );
    const byType = workouts.by_template
      .map((t) => `${t.template_name ?? "Unlabeled"} ×${t.count}`)
      .join(" · ");
    lines.push(`- By type: ${byType}`);
  }
  if (stim_states.length > 0) {
    const readiness = stim_states
      .map((s) => `${s.group_name} ${s.trainable_capacity} (${stimPhaseLabel(s.phase)})`)
      .join(" · ");
    lines.push(`- Training readiness now: ${readiness}`);
  }
  lines.push("");

  // --- This week -----------------------------------------------------------
  lines.push("## This week (7-day)");
  lines.push(
    `- Avg intake: ${fmt(week_to_date.avg_kcal_in.value)} kcal · avg protein ${g(week_to_date.avg_protein_g.value)} g`,
  );
  lines.push(
    `- Workouts: ${week_to_date.workouts_count.value} · Cardio: ${week_to_date.cardio_sessions_count.value} sessions / ${week_to_date.cardio_minutes.value} min / ${fmt(week_to_date.cardio_kcal.value)} kcal`,
  );
  const drinks = week_to_date.alcohol_drinks_count.value;
  const drinkingDays = week_to_date.drinking_days_count.value;
  lines.push(
    `- Alcohol: ${drinks} drinks across ${drinkingDays} ${drinkingDays === 1 ? "day" : "days"}`,
  );
  const sd = week_to_date.sleep_debt;
  lines.push(
    `- Sleep: avg ${week_to_date.sleep_avg_hours.value} h/night · debt ${sd.debt_hours} h (${sd.baseline_hours} h baseline)`,
  );
  lines.push("");

  // --- Last 14 days table --------------------------------------------------
  // Mirrors the dashboard's per-day grid + calendar: macros, activity-kcal,
  // net, the on/off-track verdict, which template was trained, and a drink
  // marker — so an LLM can correlate intake ↔ macros ↔ training ↔ alcohol.
  lines.push("## Last 14 days");
  lines.push("");
  // Pre-compute the single biggest MISS in the visible window — "miss" meaning the
  // worst day in the WRONG direction for the active phase. LLMs reliably
  // hallucinate "biggest/worst miss in N days" by pattern-matching the table
  // instead of scanning + ranking it; hand the model the ranked answer so it reads
  // a fact instead of eyeballing. Only real, on-phase logged days count (a target
  // exists and meals were logged on a tracked day). On a CUT the miss is the most
  // OVER target; on a BULK it's the most UNDER (under-eating slows gains); on
  // MAINTENANCE it's the largest swing EITHER way. If no day misses in the
  // meaningful direction, skip the line rather than claim a false miss.
  if (phase) {
    const dir = phaseDirection(phase);
    let biggest: { date: string; over: number } | null = null;
    for (const day of history_14d) {
      if (day.untracked || !day.meals_logged || !day.day_target) continue;
      // over > 0 = ate over target, over < 0 = ate under target.
      const over = day.day_totals.kcal - day.day_target.target.kcal;
      const qualifies = dir === "cut" ? over > 0 : dir === "bulk" ? over < 0 : over !== 0;
      if (!qualifies) continue;
      const better =
        biggest === null ||
        (dir === "cut"
          ? over > biggest.over
          : dir === "bulk"
            ? over < biggest.over
            : Math.abs(over) > Math.abs(biggest.over));
      if (better) biggest = { date: day.date.slice(5), over };
    }
    if (biggest !== null) {
      const tail = "(Use this for any 'biggest/worst miss' claim — do NOT eyeball the table.)";
      if (dir === "cut") {
        lines.push(
          `- Biggest overage in this 14-day window: **${biggest.date}** at +${fmt(biggest.over)} kcal vs target. ${tail}`,
        );
      } else if (dir === "bulk") {
        lines.push(
          `- Biggest shortfall in this 14-day window: **${biggest.date}** at −${fmt(-biggest.over)} kcal vs target (under-eating slows gains). ${tail}`,
        );
      } else {
        lines.push(
          `- Biggest deviation in this 14-day window: **${biggest.date}** at ${signed(biggest.over)} kcal vs target. ${tail}`,
        );
      }
      lines.push("");
    }
  }
  lines.push(
    "| Date | kcal | vs | P | C | F | cardio | workout | steps | net | status | trained | 🍺 | flag |",
  );
  lines.push(
    "|------|-----:|---:|--:|--:|--:|-------:|--------:|------:|----:|--------|---------|:--:|------|",
  );
  for (const day of history_14d) {
    const dateCol = day.date.slice(5); // MM-DD
    // No real intake to show on an untracked OR unlogged day — dash the macro
    // columns rather than print a misleading 0 / full-target deficit. Activity
    // (cardio/workout/steps), the trained marker, and the drink marker are NOT
    // intake, so they still render on an unlogged day.
    const noData = day.untracked || !day.meals_logged;
    const kcalCol = noData ? "—" : fmt(day.day_totals.kcal);
    const vsCol =
      !noData && day.day_target ? signed(day.day_totals.kcal - day.day_target.target.kcal) : "—";
    const pCol = noData ? "—" : String(g(day.day_totals.protein_g));
    const cCol = noData ? "—" : String(g(day.day_totals.carb_g));
    const fCol = noData ? "—" : String(g(day.day_totals.fat_g));
    // Activity kcal come from the day's observed breakdown (only present with a
    // target). Cardio and workout print 0 on a logged day — no session means no
    // burn. Steps are different: an absent step log says nothing about whether
    // the user walked, so absence dashes rather than reading as sedentary.
    const obs = day.day_target?.observed;
    const cardioCol = obs ? fmt(obs.cardio_kcal) : "—";
    const workoutCol = obs ? fmt(obs.workout_kcal) : "—";
    const stepsCol = obs && obs.steps_kcal !== null ? fmt(obs.steps_kcal) : "—";
    const netCol = !noData && day.net_kcal !== null ? signed(day.net_kcal) : "—";
    const statusCol = obs ? statusLabel(obs.status) : "—";
    const trainedCol = day.workout_name ?? "—";
    const drinkCol = day.day_totals.kcal_from_alcohol > 0 ? "🍺" : "";
    const flag = flagFor(day, report.generated_for_date);
    lines.push(
      `| ${dateCol} | ${kcalCol} | ${vsCol} | ${pCol} | ${cCol} | ${fCol} | ${cardioCol} | ${workoutCol} | ${stepsCol} | ${netCol} | ${statusCol} | ${trainedCol} | ${drinkCol} | ${flag} |`,
    );
  }

  return lines.join("\n");
}
