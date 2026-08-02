import { describe, expect, it } from "vitest";
import { ShareReportSchema } from "./report.js";

describe("ShareReportSchema", () => {
  it("accepts the workouts + history sub-shapes", () => {
    expect(ShareReportSchema.shape.history_14d.safeParse([]).success).toBe(true);
    expect(
      ShareReportSchema.shape.workouts.safeParse({
        window_from: "2026-06-06",
        window_label: "phase",
        total: 3,
        by_template: [
          { template_name: "Push", count: 2 },
          { template_name: null, count: 1 },
        ],
      }).success,
    ).toBe(true);
    expect(
      ShareReportSchema.shape.workouts.safeParse({
        window_from: "2026-06-06",
        window_label: "last_14_days",
        total: 0,
        by_template: [],
      }).success,
    ).toBe(true);
  });

  it("rejects an invalid window_label", () => {
    const r = ShareReportSchema.shape.workouts.safeParse({
      window_from: "2026-06-06",
      window_label: "nope",
      total: 0,
      by_template: [],
    });
    expect(r.success).toBe(false);
  });
});
