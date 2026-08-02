export type DayKcalInInput = {
  date: string; // YYYY-MM-DD — used only as the `date` field on the result.
  /**
   * Meals belonging to the day. **Caller is responsible for pre-filtering**:
   * the helper sums kcal across every meal it is handed. This keeps the helper
   * tz-agnostic — bucketing into a "day" is a user-tz question that the caller
   * already answered via its window query (see `userDayWindow`).
   */
  meals: Array<{ kcal: number }>;
  /** Alcohol sessions belonging to the day. Same pre-filter contract as `meals`. */
  alcoholSessions: Array<{ est_kcal: number }>;
};

export type DayKcalIn = { date: string; kcal: number };

export function computeDayKcalIn(input: DayKcalInInput): DayKcalIn {
  let kcal = 0;
  for (const m of input.meals) kcal += m.kcal;
  for (const a of input.alcoholSessions) kcal += a.est_kcal;
  return { date: input.date, kcal };
}
