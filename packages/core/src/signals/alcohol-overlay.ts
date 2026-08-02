export type AlcoholOverlay = {
  workout_id: number;
  drinks_peak_mps_zone: number;
  drinks_sleep_zone: number;
  drinks_recovered_zone: number;
  total_drinks_in_window: number;
  est_kcal_in_window: number;
};

type WorkoutRef = { id: number; started_at: string };
type AlcoholRef = { started_at: string; drinks_count: number; est_kcal: number };

export function computeAlcoholOverlay(workout: WorkoutRef, sessions: AlcoholRef[]): AlcoholOverlay {
  const wT = Date.parse(workout.started_at);
  let peak = 0;
  let sleep = 0;
  let recovered = 0;
  let kcal = 0;
  for (const s of sessions) {
    const hoursBefore = (wT - Date.parse(s.started_at)) / 3_600_000;
    if (hoursBefore <= 0 || hoursBefore > 48) continue;
    kcal += s.est_kcal;
    if (hoursBefore <= 6) peak += s.drinks_count;
    else if (hoursBefore <= 24) sleep += s.drinks_count;
    else recovered += s.drinks_count;
  }
  return {
    workout_id: workout.id,
    drinks_peak_mps_zone: peak,
    drinks_sleep_zone: sleep,
    drinks_recovered_zone: recovered,
    total_drinks_in_window: peak + sleep + recovered,
    est_kcal_in_window: kcal,
  };
}
