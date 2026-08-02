import { beforeEach, describe, expect, it } from "vitest";
import { CALENDAR_MODE_KEY, loadCalendarMode, saveCalendarMode } from "./calendar-mode.js";

describe("calendar-mode persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to workouts when nothing is stored", () => {
    expect(loadCalendarMode()).toBe("workouts");
  });

  it("round-trips intake", () => {
    saveCalendarMode("intake");
    expect(localStorage.getItem(CALENDAR_MODE_KEY)).toBe("intake");
    expect(loadCalendarMode()).toBe("intake");
  });

  it("round-trips workouts", () => {
    saveCalendarMode("intake");
    saveCalendarMode("workouts");
    expect(loadCalendarMode()).toBe("workouts");
  });

  it("falls back to workouts on a corrupt stored value", () => {
    localStorage.setItem(CALENDAR_MODE_KEY, "garbage");
    expect(loadCalendarMode()).toBe("workouts");
  });
});
