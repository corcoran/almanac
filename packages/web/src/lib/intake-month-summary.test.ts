import type { DayMacrosResponseSchema } from "@almanac/core/schemas";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { summarizeIntakeMonth } from "./intake-month-summary.js";

type DayMacros = z.infer<typeof DayMacrosResponseSchema>;
type Status = "on_track" | "at_risk" | "off_track";

function makeDay(
  date: string,
  over: { kcal?: number; status?: Status | null; untracked?: boolean } = {},
): DayMacros {
  const kcal = over.kcal ?? 1900;
  const status = over.status === undefined ? "on_track" : over.status;
  return {
    date,
    day_totals: {
      kcal,
      protein_g: 150,
      carb_g: 180,
      fat_g: 60,
      kcal_from_food: kcal,
      kcal_from_alcohol: 0,
    },
    // status: null models a pre-phase day (no target snapshot at all).
    day_target:
      status === null
        ? null
        : {
            target: { kcal: 1900, protein_g: 180, carb_g: 200, fat_g: 70 },
            maintenance: { kcal: 2370 },
            intake: { kcal, protein_g: 150, carb_g: 180, fat_g: 60 },
            observed: {
              cardio_kcal: 0,
              workout_kcal: 0,
              steps_kcal: 0,
              vs_target: kcal - 1900,
              vs_maintenance: kcal - 2370,
              status,
            },
          },
    net_kcal: null,
    untracked: over.untracked ?? false,
  };
}

describe("summarizeIntakeMonth", () => {
  const month = "2026-06";
  const today = "2026-06-10";

  it("counts logged, on-target and off-track past days", () => {
    const days = [
      makeDay("2026-06-01", { status: "on_track" }),
      makeDay("2026-06-02", { status: "on_track" }),
      makeDay("2026-06-03", { status: "at_risk" }),
      makeDay("2026-06-04", { status: "off_track" }),
    ];
    expect(summarizeIntakeMonth(days, month, today)).toEqual({
      logged: 4,
      on_target: 2,
      off_track: 1,
    });
  });

  it("excludes untracked and zero-kcal days from logged", () => {
    const days = [
      makeDay("2026-06-01"),
      makeDay("2026-06-02", { untracked: true }),
      makeDay("2026-06-03", { kcal: 0 }),
    ];
    expect(summarizeIntakeMonth(days, month, today)).toEqual({
      logged: 1,
      on_target: 1,
      off_track: 0,
    });
  });

  it("counts today as logged but never toward the status counts", () => {
    const days = [makeDay("2026-06-10", { status: "off_track" })];
    expect(summarizeIntakeMonth(days, month, today)).toEqual({
      logged: 1,
      on_target: 0,
      off_track: 0,
    });
  });

  it("ignores days outside the month or in the future", () => {
    const days = [makeDay("2026-05-31"), makeDay("2026-06-11"), makeDay("2026-06-01")];
    expect(summarizeIntakeMonth(days, month, today)).toEqual({
      logged: 1,
      on_target: 1,
      off_track: 0,
    });
  });

  it("treats no-target logged days as logged with no status contribution", () => {
    const days = [makeDay("2026-06-01", { status: null })];
    expect(summarizeIntakeMonth(days, month, today)).toEqual({
      logged: 1,
      on_target: 0,
      off_track: 0,
    });
  });
});
