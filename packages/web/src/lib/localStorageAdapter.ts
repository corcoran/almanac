import { ACTIVE_WORKOUT_SCHEMA_VERSION, type ActiveWorkout } from "./active-workout-types.js";

export const LOCAL_STORAGE_KEY = "almanac.active_workout";

export function loadActiveWorkout(): ActiveWorkout | null {
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt entry — drop it so the next save can succeed cleanly.
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("schema_version" in parsed) ||
    (parsed as { schema_version: unknown }).schema_version !== ACTIVE_WORKOUT_SCHEMA_VERSION
  ) {
    // Mismatched schema_version (or missing). Discard with a clean slate so
    // the user sees "your in-progress workout was cleared" rather than
    // a confusing crash. Spec §4.5.
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    return null;
  }
  return parsed as ActiveWorkout;
}

export function saveActiveWorkout(workout: ActiveWorkout): void {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(workout));
}

export function clearActiveWorkout(): void {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
}
