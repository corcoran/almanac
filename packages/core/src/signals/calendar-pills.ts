import type { z } from "zod";
import type { UntrackedReason } from "../domain/untracked-periods.js";
import { currentUserDate } from "../domain/user-day.js";
import type { CalendarPhaseSchema } from "../schemas/signals.js";
import { DEFAULT_STIM_CONFIG, type StimConfig } from "./config.js";
import { phaseFromHours } from "./stim.js";

export type CalendarPillsInput = {
  /** Workouts loaded by the route — should include enough history before
   *  the requested month to anchor pills extending into it (14 days back
   *  from month-start is enough since detrained = 336h). */
  workouts: Array<{
    id: number;
    template_id: number | null;
    template_name: string | null;
    started_at: string;
  }>;
  /** Month requested, as "YYYY-MM". */
  month: string;
  /** User's IANA timezone (e.g. "America/New_York"). Used for the "today"
   *  comparison and to bucket past sessions into calendar days. Bucketing is
   *  user-local via `currentUserDate` (honors the 4am DAY_START_HOUR rollover),
   *  so a pre-4am workout lands on the previous calendar day — matching how the
   *  6-day summary attributes it, instead of the raw wall-clock date. */
  timezone: string;
  /** Current wall time, injected for testability. */
  now: Date;
  /** Phase boundaries config. Defaults to DEFAULT_STIM_CONFIG. */
  config?: StimConfig;
  /** The user's untracked periods overlapping the requested month. Loaded by
   *  the route and injected so the signal stays DB-free. Optional — defaults
   *  to no bands. */
  untrackedPeriods?: Array<{ started_on: string; ended_on: string; reason: UntrackedReason }>;
};

export type CalendarPhase = z.infer<typeof CalendarPhaseSchema>;

export type CalendarPillsOutput = {
  month: string;
  tally: { total: number; by_template: Record<string, number> };
  past_sessions: Array<{
    date: string;
    workout_id: number;
    template_id: number;
    template_name: string;
  }>;
  pill_segments: Array<{
    template_id: number;
    template_name: string;
    last_hit_at: string;
    segments: Array<{ date: string; phase: CalendarPhase; is_proposed: boolean }>;
  }>;
  untracked_bands: Array<{ from: string; to: string; reason: UntrackedReason }>;
};

type DatedWorkout = {
  workout_id: number;
  template_id: number;
  template_name: string;
  started_at_ms: number;
  date: string;
};

/** First and last calendar dates of a "YYYY-MM" month. */
function monthBounds(month: string): { firstDate: string; lastDate: string } {
  const [year, m] = month.split("-").map(Number);
  if (!year || !m) throw new Error(`bad month: ${month}`);
  const first = `${month}-01`;
  // Last day = day before next month's first day.
  const nextMonth = m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
  const nextFirst = new Date(`${nextMonth}-01T12:00:00Z`);
  const lastMs = nextFirst.getTime() - 86_400_000;
  const lastDate = new Date(lastMs).toISOString().slice(0, 10);
  return { firstDate: first, lastDate };
}

export function computeCalendarPills(input: CalendarPillsInput): CalendarPillsOutput {
  const config = input.config ?? DEFAULT_STIM_CONFIG;
  const { firstDate, lastDate } = monthBounds(input.month);
  const todayDate = currentUserDate(input.now, input.timezone);

  // Untracked bands: clip each period to [firstDate, lastDate], drop those
  // entirely outside the month, preserve start order. Rendered regardless of
  // monthIsPast (a vacation is usually a past event you look back on).
  const untracked_bands = (input.untrackedPeriods ?? [])
    .map((p) => ({
      from: p.started_on < firstDate ? firstDate : p.started_on,
      to: p.ended_on > lastDate ? lastDate : p.ended_on,
      reason: p.reason,
    }))
    .filter((b) => b.from <= b.to)
    .sort((a, b) => a.from.localeCompare(b.from));

  // Bucket past sessions by user-local date and filter to the month. The
  // type-guard predicate narrows the element type so the map needs no
  // non-null assertions on template_id/template_name.
  type WorkoutWithTemplate = (typeof input.workouts)[number] & {
    template_id: number;
    template_name: string;
  };
  const filteredWorkouts = input.workouts.filter(
    (w): w is WorkoutWithTemplate => w.template_id !== null && w.template_name !== null,
  );
  const dated: DatedWorkout[] = filteredWorkouts.map((w) => ({
    workout_id: w.id,
    template_id: w.template_id,
    template_name: w.template_name,
    started_at_ms: Date.parse(w.started_at),
    date: currentUserDate(new Date(w.started_at), input.timezone),
  }));
  const in_month = dated
    .filter((d) => d.date >= firstDate && d.date <= lastDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.workout_id - b.workout_id);

  const tally_by_template: Record<string, number> = {};
  for (const s of in_month) {
    tally_by_template[s.template_name] = (tally_by_template[s.template_name] ?? 0) + 1;
  }

  const past_sessions = in_month.map((s) => ({
    date: s.date,
    workout_id: s.workout_id,
    template_id: s.template_id,
    template_name: s.template_name,
  }));

  // Pill segments (forward) — skip if the requested month is strictly in the past.
  const monthIsPast = lastDate < todayDate;
  const pill_segments: CalendarPillsOutput["pill_segments"] = [];

  if (!monthIsPast) {
    // Find each template's most-recent session across the full workouts input.
    const recentByTemplate = new Map<number, DatedWorkout>();
    for (const d of dated) {
      const prev = recentByTemplate.get(d.template_id);
      if (!prev || d.started_at_ms > prev.started_at_ms) {
        recentByTemplate.set(d.template_id, d);
      }
    }
    for (const [, recent] of recentByTemplate) {
      const entry = computePillEntry(recent, firstDate, lastDate, todayDate, input.now, config);
      if (entry !== null) pill_segments.push(entry);
    }
    // Stable sort by template_name asc.
    pill_segments.sort((a, b) => a.template_name.localeCompare(b.template_name));
  }

  return {
    month: input.month,
    tally: { total: in_month.length, by_template: tally_by_template },
    past_sessions,
    pill_segments,
    untracked_bands,
  };
}

/** Walk forward day-by-day from `recent.started_at_ms`, classify each day,
 *  emit segments until phase becomes `fading`/`detrained`. Apply Q9b and Q10
 *  rules. Returns null if no segments should be emitted (Q9b: entire window
 *  is past, or no segments land in the requested month). */
function computePillEntry(
  recent: DatedWorkout,
  firstDate: string,
  lastDate: string,
  todayDate: string,
  now: Date,
  config: StimConfig,
): CalendarPillsOutput["pill_segments"][number] | null {
  // Q9b guard FIRST: if `now` is already past the in_window cutoff for this
  // template (i.e. today's phase is fading or detrained), no pill is emitted
  // at all — even if the (now-past) forward walk would overlap the requested
  // month. This is the spec §2 Q9b rule: "no pill is rendered for that
  // template. The template's only visible mark on the calendar is the
  // past-session chip on the day of its last session."
  const hoursSinceNow = (now.getTime() - recent.started_at_ms) / 3_600_000;
  const currentPhase = phaseFromHours(hoursSinceNow, config.phaseBoundariesHours);
  if (currentPhase === "fading" || currentPhase === "detrained") return null;

  // Start walking the day AFTER the workout's user-local date.
  const segments: Array<{ date: string; phase: CalendarPhase; is_proposed: boolean }> = [];
  let firstPrimeDate: string | null = null;
  let dayCursor = nextDate(recent.date);
  // Walking cap: don't loop forever. Detrained kicks in at 336h = 14d, so
  // at most ~14-16 iterations.
  const HARD_CAP = 60;
  for (let i = 0; i < HARD_CAP; i++) {
    // Phase classification uses UTC noon per day (not user-local time) as a
    // deliberate simplification. For users far east of UTC (≈ UTC+10 or more) a
    // pill's phase boundary can shift by up to ~1 calendar day. Acceptable: phase
    // windows are >=48h wide, so a <=12h skew moves a boundary by at most one day.
    const dayNoonMs = Date.parse(`${dayCursor}T12:00:00Z`); // tz-agnostic noon
    const hours = (dayNoonMs - recent.started_at_ms) / 3_600_000;
    const phase = phaseFromHours(hours, config.phaseBoundariesHours);
    if (phase === "fading" || phase === "detrained") break;
    if (dayCursor >= firstDate && dayCursor <= lastDate) {
      // Narrow StimPhase (6 values) to CalendarPhase (4 values).
      // fading and detrained are emit-stops handled above (line 179).
      if (
        phase === "too_soon" ||
        phase === "acceptable" ||
        phase === "prime" ||
        phase === "in_window"
      ) {
        segments.push({ date: dayCursor, phase, is_proposed: false });
        if (phase === "prime" && firstPrimeDate === null) {
          firstPrimeDate = dayCursor;
        }
      }
    } else if (phase === "prime" && firstPrimeDate === null) {
      // Track first prime day even if it falls outside the requested month,
      // so we can correctly suppress ★ when the user's next prime day is
      // already in the past.
      firstPrimeDate = dayCursor;
    }
    if (dayCursor > lastDate) break;
    dayCursor = nextDate(dayCursor);
  }

  // Edge case: Q9b guard passed (today's phase is too_soon|acceptable|prime|in_window)
  // but the requested month is far enough in the past or future that NO segments
  // landed in it. Return null in that case — there's nothing to render for this
  // template in this month.
  if (segments.length === 0) return null;

  // Q10: ★ on first prime day iff that day ≥ today. If no prime day OR first
  // prime is in the past, no ★. Does NOT fall through to subsequent prime days.
  if (firstPrimeDate !== null && firstPrimeDate >= todayDate) {
    const seg = segments.find((s) => s.date === firstPrimeDate);
    if (seg) seg.is_proposed = true;
  }

  return {
    template_id: recent.template_id,
    template_name: recent.template_name,
    last_hit_at: new Date(recent.started_at_ms).toISOString(),
    segments,
  };
}

function nextDate(yyyy_mm_dd: string): string {
  const ms = Date.parse(`${yyyy_mm_dd}T12:00:00Z`);
  return new Date(ms + 86_400_000).toISOString().slice(0, 10);
}
