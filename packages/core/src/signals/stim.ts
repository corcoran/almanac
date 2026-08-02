import { last } from "./array.js";
import { DEFAULT_STIM_CONFIG, type StimConfig, type StimPhase } from "./config.js";

export type StimAdvice = {
  recommendation: string;
  rationale: string;
  suggested_intensity_pct: number;
};

export type TrainableCapacity = "depleted" | "recovering" | "fresh";

export type StimState = {
  group_id: number;
  group_name: string;
  // Always populated 0..100. See the level computation below for the
  // three-tier fallback (comparative ratio → decay-based fallback → 0).
  level: number;
  trainable_capacity: TrainableCapacity;
  phase: StimPhase;
  last_hit_at: string | null;
  hours_since_last_hit: number | null;
  advice: StimAdvice;
  contributing_sessions: Array<{
    workout_id: number;
    // ISO 8601 timestamp of the session. Surfaced so callers can reason
    // about decay timing (Gap 22) without a second round-trip to fetch the
    // workout by id. Lets the spec's "0-7d neutral, 7-14d fade" narrative be
    // computed from the snapshot alone.
    started_at: string;
    quality_volume: number;
    context_multiplier: number;
  }>;
};

type WorkoutForStim = {
  id: number;
  started_at: string;
  rpe: number;
  exercises: Array<{
    exercise_id: number;
    sets: Array<{ reps: number; weight_kg: number | null }>;
  }>;
};

export type StimInput = {
  groups: Array<{ id: number; name: string }>;
  // Caller is responsible for window-filtering. Signal does NOT re-filter by date.
  workouts: WorkoutForStim[];
  exerciseToGroup: Map<number, number>;
  latestBodyWeightKg: number | null; // null → use config.bodyweight.fallbackKg
  now: Date;
  config?: StimConfig;
};

export function phaseFromHours(h: number | null, b: StimConfig["phaseBoundariesHours"]): StimPhase {
  if (h === null) return "detrained";
  if (h < b.tooSoon) return "too_soon";
  if (h < b.acceptable) return "acceptable";
  if (h < b.prime) return "prime";
  if (h < b.inWindow) return "in_window";
  if (h < b.fading) return "fading";
  return "detrained";
}

function capacityFor(hours: number | null, curve: StimConfig["capacityCurve"]): number {
  // curve is non-empty by construction (its tuple type requires ≥1 element),
  // so `last` returns the tail element as `T`, not `T | undefined`.
  const tail = last(curve).pct;
  if (hours === null) return tail;
  for (const seg of curve) if (hours < seg.untilHours) return seg.pct;
  return tail;
}

// Maps the numeric capacity pct from `capacityFor` to a presentation enum. The
// default capacityCurve emits values in {20, 35, 50, 55, 75, 80, 90, 95, 100};
// the ≤25 / ≤75 / >75 bucket boundaries separate each cleanly (depleted: 20;
// recovering: 35-75; fresh: 80-100) and survive curve tweaks as long as values
// stay within their respective bands.
function trainableCapacityFor(pct: number): TrainableCapacity {
  if (pct <= 25) return "depleted";
  if (pct <= 75) return "recovering";
  return "fresh";
}

function decayFor(hoursAgo: number, d: StimConfig["decay"]): number {
  // Uses <= (not <) at segment seams to keep the function continuous: both
  // sides yield the same value at the boundary. Phase/capacity classifiers
  // use < for half-open intervals — a deliberate asymmetry.
  if (hoursAgo <= d.fullCreditUntilHours) return 1;
  if (hoursAgo <= d.halfwayFadeAtHours) {
    const t = (hoursAgo - d.fullCreditUntilHours) / (d.halfwayFadeAtHours - d.fullCreditUntilHours);
    return 1 - t * (1 - 0.85);
  }
  if (hoursAgo <= d.fastFadeAtHours) {
    const t = (hoursAgo - d.halfwayFadeAtHours) / (d.fastFadeAtHours - d.halfwayFadeAtHours);
    return 0.85 - t * (0.85 - 0.5);
  }
  const over = hoursAgo - d.fastFadeAtHours;
  return 0.5 * Math.exp(-over / d.longTailTauHours);
}

// Effective load for a set, handling null weight per §5.2.1.
function effectiveWeight(
  weightKg: number | null,
  latestBodyWeightKg: number | null,
  config: StimConfig,
): number {
  if (weightKg !== null) return weightKg;
  const bw = latestBodyWeightKg ?? config.bodyweight.fallbackKg;
  return bw * config.bodyweight.defaultMultiplier;
}

// Aggregate one workout's contribution to a group. Returns null if the workout
// has no sets in the group (i.e., it's not a hit for this group).
function workoutContribution(
  w: WorkoutForStim,
  groupId: number,
  exerciseToGroup: Map<number, number>,
  latestBodyWeightKg: number | null,
  config: StimConfig,
): { volume: number; startedAtMs: number } | null {
  let volume = 0;
  let hit = false;
  for (const ei of w.exercises) {
    if (exerciseToGroup.get(ei.exercise_id) !== groupId) continue;
    hit = true; // at least one exercise in the group is present in this workout
    for (const s of ei.sets) {
      const eff = effectiveWeight(s.weight_kg, latestBodyWeightKg, config);
      volume += s.reps * eff;
    }
  }
  if (!hit) return null;
  return { volume, startedAtMs: Date.parse(w.started_at) };
}

export function computeStimStates(input: StimInput): StimState[] {
  const config = input.config ?? DEFAULT_STIM_CONFIG;
  const out: StimState[] = [];
  const nowMs = input.now.getTime();
  const recentWindowEndMs = nowMs - config.baselineWindow.daysOmittedAtEnd * 86_400_000;
  const baselineStartMs = nowMs - config.baselineWindow.daysBack * 86_400_000;

  for (const group of input.groups) {
    let lastHitMs: number | null = null;
    let recentCredit = 0;
    let baselineCredit = 0;
    let baselineSessionCount = 0;
    const contributing: StimState["contributing_sessions"] = [];

    for (const w of input.workouts) {
      const contrib = workoutContribution(
        w,
        group.id,
        input.exerciseToGroup,
        input.latestBodyWeightKg,
        config,
      );
      if (!contrib) continue;

      const hoursAgo = (nowMs - contrib.startedAtMs) / 3_600_000;
      const intensity = w.rpe / 10;
      const qualityVolume = contrib.volume * intensity;
      const decay = decayFor(hoursAgo, config.decay);
      const contextMultiplier = 1.0; // v1 invariant (§5.2.3 of spec)
      const credit = qualityVolume * decay * contextMultiplier;

      // last_hit_at: any session with sets in this group is a hit, regardless
      // of which window it falls in (per spec §5.2: "A session with sets in
      // the group always counts as a hit and updates last_hit_at").
      if (lastHitMs === null || contrib.startedAtMs > lastHitMs) {
        lastHitMs = contrib.startedAtMs;
      }

      // Workout is either in the recent window or the baseline window.
      if (contrib.startedAtMs >= recentWindowEndMs) {
        // Recent window — feeds level numerator and contributing_sessions.
        recentCredit += credit;
        contributing.push({
          workout_id: w.id,
          started_at: w.started_at,
          quality_volume: qualityVolume,
          context_multiplier: contextMultiplier,
        });
      } else if (contrib.startedAtMs >= baselineStartMs) {
        // Baseline window [now - daysBack, now - daysOmittedAtEnd)
        baselineCredit += credit;
        baselineSessionCount += 1;
      }
      // Anything older than the baseline window is ignored.
    }

    const hoursSince = lastHitMs === null ? null : (nowMs - lastHitMs) / 3_600_000;
    const phase = phaseFromHours(hoursSince, config.phaseBoundariesHours);
    const capacity = capacityFor(hoursSince, config.capacityCurve);
    // advice is Record<StimPhase, ...> and phase is a StimPhase, so a missing
    // entry is an invariant violation (a malformed config), not an expected
    // case — throw rather than silently flow `undefined` downstream.
    const ad = config.advice[phase];
    if (ad === undefined) {
      throw new Error(`No advice configured for stim phase: ${phase}`);
    }

    // level is always populated 0..100. Three tiers, primary first:
    //   1. Baseline available → comparative ratio (recent / baseline * 100),
    //      capped at 100. "100 ≈ doing your usual" — the richest signal,
    //      relative to the user's own norm. The cap discards a surge signal
    //      (training 2x usual would otherwise read 200); use `phase` +
    //      `trainable_capacity` for the overtraining channel instead.
    //      The ratio is asymmetric by design:
    //      recentCredit's decay factor is always ~1.0 (recent window =
    //      [now-7d, now], decay.fullCreditUntilHours = 168h = 7d), so it's
    //      effectively Σ qualityVolume. baselineCredit IS decay-weighted
    //      (sessions span 7-21d ago).
    //   2. Baseline thin but recent activity → decay-weighted recent credit
    //      mapped to 0..100 via config.level.earlyDaysCeiling. Honest about
    //      being thin, but week-one users still see signal instead of a hole.
    //   3. No sessions in either window → 0.
    let level: number;
    if (
      baselineSessionCount >= config.baselineWindow.minSessionsForBaseline &&
      baselineCredit > 0
    ) {
      level = Math.min(100, (recentCredit / baselineCredit) * 100);
    } else if (recentCredit > 0) {
      level = Math.min(100, (recentCredit / config.level.earlyDaysCeiling) * 100);
    } else {
      level = 0;
    }

    out.push({
      group_id: group.id,
      group_name: group.name,
      level: Number(level.toFixed(1)),
      trainable_capacity: trainableCapacityFor(capacity),
      phase,
      last_hit_at: lastHitMs === null ? null : new Date(lastHitMs).toISOString(),
      hours_since_last_hit: hoursSince === null ? null : Number(hoursSince.toFixed(1)),
      advice: {
        recommendation: ad.recommendation,
        rationale: ad.rationale,
        suggested_intensity_pct: ad.suggestedIntensityPct,
      },
      contributing_sessions: contributing,
    });
  }
  return out;
}
