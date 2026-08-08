import { describe, expect, it } from "vitest";
import { StepLogInputSchema, StepLogUpdateSchema } from "./body.js";

describe("StepLogInputSchema", () => {
  it("rejects a zero step count", () => {
    const result = StepLogInputSchema.safeParse({ on_date: "2026-08-07", steps: 0 });
    expect(result.success).toBe(false);
  });

  it("accepts a one-step count", () => {
    const result = StepLogInputSchema.safeParse({ on_date: "2026-08-07", steps: 1 });
    expect(result.success).toBe(true);
  });

  it("still rejects a negative step count", () => {
    const result = StepLogInputSchema.safeParse({ on_date: "2026-08-07", steps: -1 });
    expect(result.success).toBe(false);
  });

  it("allows est_kcal of 0 — a 1-step day rounds to zero burn", () => {
    const result = StepLogInputSchema.safeParse({
      on_date: "2026-08-07",
      steps: 1,
      est_kcal: 0,
    });
    expect(result.success).toBe(true);
  });
});

describe("StepLogUpdateSchema", () => {
  it("rejects correcting a step count to zero", () => {
    expect(StepLogUpdateSchema.safeParse({ steps: 0 }).success).toBe(false);
  });
});
