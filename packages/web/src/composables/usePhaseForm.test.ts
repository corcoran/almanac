import { describe, expect, it } from "vitest";
import { usePhaseForm } from "./usePhaseForm.js";

describe("usePhaseForm", () => {
  it("derives deficit from target and tdee", () => {
    const f = usePhaseForm();
    f.tdee.value = 2450;
    f.targetKcal.value = 1950;
    expect(f.deficitKcal.value).toBe(-500);
  });

  it("deficit is null until both tdee and target are set", () => {
    const f = usePhaseForm();
    f.tdee.value = 2400;
    expect(f.deficitKcal.value).toBeNull();
  });

  it("flags an invalid cut when the target is at/above maintenance", () => {
    const f = usePhaseForm();
    f.phaseType.value = "cut";
    f.tdee.value = 2400;
    f.targetKcal.value = 2400; // 0 deficit -> not a cut
    expect(f.bandError.value).toMatch(/cut|maintenance/i);
  });

  it("accepts a valid cut (deficit beyond -5% of tdee)", () => {
    const f = usePhaseForm();
    f.phaseType.value = "cut";
    f.tdee.value = 2400;
    f.targetKcal.value = 1900; // -500, beyond -5% (-120)
    expect(f.bandError.value).toBeNull();
  });

  it("flags a 'bulk' whose target is actually a deficit", () => {
    const f = usePhaseForm();
    f.phaseType.value = "bulk";
    f.tdee.value = 2400;
    f.targetKcal.value = 2000;
    expect(f.bandError.value).toMatch(/surplus|bulk|deficit/i);
  });

  it("accepts maintenance within +/-5%", () => {
    const f = usePhaseForm();
    f.phaseType.value = "maintenance";
    f.tdee.value = 2400;
    f.targetKcal.value = 2450; // +50, within +/-120
    expect(f.bandError.value).toBeNull();
  });

  it("flags maintenance that is too far from maintenance", () => {
    const f = usePhaseForm();
    f.phaseType.value = "maintenance";
    f.tdee.value = 2400;
    f.targetKcal.value = 2700; // +300, beyond +/-120
    expect(f.bandError.value).toMatch(/maintenance|cut|bulk/i);
  });
});
