import { describe, expect, it } from "vitest";
import {
  isWithinMaintenanceBand,
  MAINTENANCE_BAND_PCT,
  STATUS_GRACE_PCT,
} from "./maintenance-band";

describe("isWithinMaintenanceBand", () => {
  it("is true when intake equals target", () => {
    expect(isWithinMaintenanceBand(2370, 2370)).toBe(true);
  });

  it("is true within +5% of target", () => {
    expect(isWithinMaintenanceBand(2370 + 100, 2370)).toBe(true); // 100 < 118.5 (5% of 2370)
  });

  it("is true within -5% of target", () => {
    expect(isWithinMaintenanceBand(2370 - 100, 2370)).toBe(true);
  });

  it("is false above +5% of target", () => {
    expect(isWithinMaintenanceBand(2370 + 200, 2370)).toBe(false);
  });

  it("is false below -5% of target", () => {
    expect(isWithinMaintenanceBand(2370 - 200, 2370)).toBe(false);
  });

  it("exposes MAINTENANCE_BAND_PCT as 0.05", () => {
    expect(MAINTENANCE_BAND_PCT).toBe(0.05);
  });

  it("exposes STATUS_GRACE_PCT as 0.10", () => {
    expect(STATUS_GRACE_PCT).toBe(0.1);
  });
});
