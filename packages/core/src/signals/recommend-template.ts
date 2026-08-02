import type { StimState } from "./stim.js";

// Sentinel for "never trained, infinitely recovered" — used both as the wire
// value on TemplateRecommendation.avg_recovery_hours and as the in-memory
// stand-in when StimState.hours_since_last_hit is null. Chosen so it
// JSON-serializes cleanly (Number.POSITIVE_INFINITY does not) while still
// dominating any realistic hours-since-last-hit value (a year is ~8760h).
const NEVER_TRAINED_HOURS = 999_999;

export type RecommendTemplateInput = {
  templates: Array<{
    id: number;
    name: string;
    items: Array<{ exercise_id: number }>;
  }>;
  stimStates: StimState[];
  exerciseToGroup: Map<number, number>;
};

export type TemplateRecommendation = {
  template_id: number;
  template_name: string;
  score: number;
  /**
   * `"actionable"` when the score reflects a real timing signal — the template
   * hits at least one prime / in_window / too_soon group, so the ranking means
   * something. `"low"` for the case where `score` is 0 because every hit group is overdue
   * (fading/detrained), untrained, or has no stim data: the *score* carries no
   * timing signal. NOTE: this no longer demotes the template — ranking is
   * recency-first (see the sort), so an overdue template still ranks by how
   * overdue it is. `"low"` is purely an annotation a client can use to caveat
   * ("this is an overdue/layoff pick, not a timing-driven one"). The returning-
   * from-layoff case (everything overdue) still produces a defined order —
   * most-overdue first — rather than a meaningless tie.
   */
  confidence: "actionable" | "low";
  /**
   * Average hours since last hit across the template's muscle groups. The
   * PRIMARY sort key: the most-recovered (most-overdue) template ranks first,
   * with `score` as the tie-break among equally-recovered templates. Untrained groups
   * (last_hit_at: null) count as 999_999 hours so they push the average up —
   * they're maximally "ready" by definition. The value is clamped at the same
   * sentinel so an all-untrained template surfaces as 999_999 rather than
   * Infinity (which doesn't JSON-serialize).
   */
  avg_recovery_hours: number;
  reasoning: {
    prime_groups_hit: string[];
    in_window_groups_hit: string[];
    too_soon_groups_hit: string[];
    /** `acceptable`-phase groups only — mid-fade but not yet overdue. */
    neutral_groups_hit: string[];
    /**
     * `fading` / `detrained` groups — trained long enough ago that they no
     * longer contribute to the score but DO signal a training gap. Surfaced
     * separately from `neutral` so the layoff is visible rather than buried.
     */
    overdue_groups_hit: string[];
  };
};

/**
 * Score each workout template against the user's current stim state. Scoring:
 *
 *   score = 2 × in_window_groups + prime_groups − (2 if any too_soon else 0)
 *
 * In-window groups (120-168h since last hit) are weighted above prime (72-120h)
 * because they carry asymmetric urgency: an in_window group neglected today
 * crosses into "fading" tomorrow and starts losing adaptation. A prime group
 * stays prime for ~48h.
 *
 * The too_soon penalty is a flat -2 (any vs none), NOT -2 per group. The
 * per-group penalty produced a perverse outcome when all of the user's
 * templates were too_soon (e.g., trained PUSH/LEGS/PULL in the last 48h):
 * the recommender preferred templates with fewer total muscle groups
 * (LEGS at -6 beat PULL at -12) regardless of how recently each was trained.
 * Flattening collapses the "all too_soon" case to a single tied score and
 * lets the secondary key — `avg_recovery_hours` — pick the one that's
 * waited longest. For mixed templates (some too_soon + some prime), the
 * flat penalty still flags the conflict ("you're trying to train something
 * you just hit") without scaling with group count.
 *
 * Ranking is recency-first: primary key is `avg_recovery_hours` desc, so the
 * most-recovered (most-overdue / most-neglected) template ranks first — a long
 * training gap surfaces the group that most needs hitting instead of being
 * penalised out of the ranking. `score` (above) is the SECONDARY key, breaking
 * ties among equally-recovered templates; `template_name` asc breaks remaining
 * ties. The too_soon penalty therefore only matters among equally-recovered
 * templates (a just-trained template already has a low avg_recovery_hours and
 * sinks on its own); it is retained to keep surfacing the "you just hit this"
 * conflict in `reasoning`.
 *
 * Gap 24 framing: per-muscle-group output is a scorecard; per-template
 * output is advice — answers the user's natural "is today PUSH or PULL?"
 * question instead of forcing them to interpret 13 stim entries themselves.
 */
export function recommendTemplate(input: RecommendTemplateInput): TemplateRecommendation[] {
  const stimByGroup = new Map(input.stimStates.map((s) => [s.group_id, s] as const));
  const recs: TemplateRecommendation[] = [];

  for (const tpl of input.templates) {
    const hitGroups = new Set<number>();
    for (const item of tpl.items) {
      const g = input.exerciseToGroup.get(item.exercise_id);
      if (g !== undefined) hitGroups.add(g);
    }
    const prime: string[] = [];
    const inWindow: string[] = [];
    const tooSoon: string[] = [];
    // `neutral` collects only `acceptable` (mid-fade); `overdue` collects
    // fading/detrained. in_window is bucketed separately because it carries
    // real urgency signal.
    const neutral: string[] = [];
    const overdue: string[] = [];
    const recoveryHoursSamples: number[] = [];
    for (const g of hitGroups) {
      const stim = stimByGroup.get(g);
      if (!stim) continue;
      if (stim.phase === "prime") prime.push(stim.group_name);
      else if (stim.phase === "in_window") inWindow.push(stim.group_name);
      else if (stim.phase === "too_soon") tooSoon.push(stim.group_name);
      else if (stim.phase === "fading" || stim.phase === "detrained") overdue.push(stim.group_name);
      else neutral.push(stim.group_name);
      // null hours_since_last_hit = never trained → maximally recovered.
      recoveryHoursSamples.push(stim.hours_since_last_hit ?? NEVER_TRAINED_HOURS);
    }
    // Within the score, weight in_window above prime: in_window groups are hours
    // from fading and carry asymmetric decay cost if neglected. too_soon is a flat
    // signal ("any group too recent? deduct 2") rather than per-group — see
    // function JSDoc for why. (Score is only the tie-break; recency drives the sort.)
    const score = 2 * inWindow.length + prime.length - (tooSoon.length > 0 ? 2 : 0);
    // The score only means something if a timing signal contributed to it.
    // When score is 0 AND no prime/in_window/too_soon group was hit, the
    // template is a degenerate tie (everything overdue/untrained/no-data) and
    // the ranking is noise — flag it so consumers don't surface it as advice.
    const hasSignal = prime.length > 0 || inWindow.length > 0 || tooSoon.length > 0;
    const confidence: TemplateRecommendation["confidence"] =
      score === 0 && !hasSignal ? "low" : "actionable";
    // 0 (rather than NaN or NEVER_TRAINED_HOURS) when no hit groups have stim
    // entries — empty average is a separate signal from "infinitely recovered."
    const avg_recovery_hours =
      recoveryHoursSamples.length === 0
        ? 0
        : recoveryHoursSamples.reduce((a, b) => a + b, 0) / recoveryHoursSamples.length;
    recs.push({
      template_id: tpl.id,
      template_name: tpl.name,
      score,
      confidence,
      avg_recovery_hours,
      reasoning: {
        prime_groups_hit: prime.sort(),
        in_window_groups_hit: inWindow.sort(),
        too_soon_groups_hit: tooSoon.sort(),
        neutral_groups_hit: neutral.sort(),
        overdue_groups_hit: overdue.sort(),
      },
    });
  }
  // Recency-first: the most-recovered (i.e. most-overdue / most-neglected)
  // template ranks first, always — so a long training gap surfaces the group
  // that most needs hitting, instead of being penalised out of the ranking by a
  // small timing signal. `score` (prime/in_window/too_soon) is now only a
  // tie-break among equally-recovered templates; `confidence` annotates but does
  // not demote. See docs/superpowers/specs/2026-06-06-recommender-recency-first-design.md.
  recs.sort(
    (a, b) =>
      b.avg_recovery_hours - a.avg_recovery_hours ||
      b.score - a.score ||
      a.template_name.localeCompare(b.template_name),
  );
  return recs;
}
