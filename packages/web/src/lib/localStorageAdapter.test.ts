import { beforeEach, describe, expect, it } from "vitest";
import { ACTIVE_WORKOUT_SCHEMA_VERSION, type ActiveWorkout } from "./active-workout-types.js";
import {
  clearActiveWorkout,
  LOCAL_STORAGE_KEY,
  loadActiveWorkout,
  saveActiveWorkout,
} from "./localStorageAdapter.js";

const sampleActive: ActiveWorkout = {
  schema_version: ACTIVE_WORKOUT_SCHEMA_VERSION,
  started_at: "2026-05-19T17:00:00.000Z",
  template_id: 1,
  template_baseline: {
    template_id: 1,
    template_name: "PUSH A",
    exercises: [],
  },
  exercises: [],
  rpe: null,
};

describe("localStorageAdapter", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when no entry exists", () => {
    expect(loadActiveWorkout()).toBeNull();
  });

  it("round-trips a saved workout", () => {
    saveActiveWorkout(sampleActive);
    const loaded = loadActiveWorkout();
    expect(loaded).toEqual(sampleActive);
  });

  it("discards an entry with a mismatched schema_version", () => {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({ ...sampleActive, schema_version: 999 }),
    );
    expect(loadActiveWorkout()).toBeNull();
    // And clears the bad entry so it doesn't keep triggering on every load.
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBeNull();
  });

  it("discards an unparseable entry", () => {
    localStorage.setItem(LOCAL_STORAGE_KEY, "{ not valid json");
    expect(loadActiveWorkout()).toBeNull();
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBeNull();
  });

  it("clearActiveWorkout removes the entry", () => {
    saveActiveWorkout(sampleActive);
    clearActiveWorkout();
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBeNull();
  });
});
