import { describe, expect, it } from "vitest";
import { DERIVED_HARD_CAP_MULTIPLIER, llmLimitConfigError, resolveDailyLimits } from "./caps.js";

describe("llmLimitConfigError", () => {
  it("flags an env hard cap at or below the env soft limit", () => {
    expect(llmLimitConfigError(50000, 20000)).toMatch(/must exceed the soft limit/);
    expect(llmLimitConfigError(50000, 50000)).toMatch(/must exceed the soft limit/);
  });

  it("names both variables and the value that will actually apply", () => {
    const msg = llmLimitConfigError(50000, 20000) ?? "";
    expect(msg).toContain("ALMANAC_LLM_HARD_DAILY_TOKEN_CAP (20000)");
    expect(msg).toContain("ALMANAC_LLM_DEFAULT_DAILY_TOKEN_LIMIT (50000)");
    expect(msg).toContain("13333");
  });

  it("stays quiet on a sane pair, or when either side is unset", () => {
    expect(llmLimitConfigError(50000, 150000)).toBeNull();
    expect(llmLimitConfigError(50000, undefined)).toBeNull();
    expect(llmLimitConfigError(undefined, 20000)).toBeNull();
  });
});

type Maybe = number | null | undefined;

/** Shorthand: envSoft, userSoft, envCap, userCap. */
const resolve = (
  envSoft: Maybe = null,
  userSoft: Maybe = null,
  envCap: Maybe = null,
  userCap: Maybe = null,
) => resolveDailyLimits({ envSoft, userSoft, envCap, userCap });

describe("resolveDailyLimits", () => {
  it("prefers the user's own soft limit over the env default", () => {
    expect(resolve(30000, 10000).softLimit).toBe(10000);
    expect(resolve(30000, null).softLimit).toBe(30000);
    expect(resolve(undefined, null).softLimit).toBeNull();
  });

  it("takes the lower of the env and per-user hard caps", () => {
    expect(resolve(null, null, 150000, 20000).hardCap).toBe(20000);
    expect(resolve(null, null, 150000, 500000).hardCap).toBe(150000);
    expect(resolve(null, null, 150000, null).hardCap).toBe(150000);
    expect(resolve(null, null, null, 20000).hardCap).toBe(20000);
  });

  it("derives the cap from the soft limit when none is configured", () => {
    expect(resolve(30000).hardCap).toBe(45000);
    expect(resolve(50000).hardCap).toBe(75000);
    expect(DERIVED_HARD_CAP_MULTIPLIER).toBe(1.5);
  });

  it("is uncapped only with no cap and no soft limit to derive from", () => {
    expect(resolve()).toEqual({ softLimit: null, hardCap: null });
  });

  // The invariant. A cap at or below the soft limit means the user gets a 429
  // while the pill still promises headroom, which is the surprise cliff the
  // whole two-tier design exists to prevent.
  it("keeps the hard cap strictly above the soft limit", () => {
    const cases = [
      resolve(50000, null, null, 20000),
      resolve(50000, null, 20000, null),
      resolve(50000, 50000, null, 50000),
      resolve(200000, null, null, 20000),
      resolve(30000),
    ];
    for (const { softLimit, hardCap } of cases) {
      expect(softLimit).not.toBeNull();
      expect(hardCap).not.toBeNull();
      expect(hardCap).toBeGreaterThan(Number(softLimit));
    }
  });

  it("clamps the soft limit down when the cap sits below it", () => {
    // Cap a guest at 20k against a 50k default: their budget becomes 20k/1.5,
    // so the counter reaches zero exactly as the cap starts blocking.
    expect(resolve(50000, null, null, 20000)).toEqual({ softLimit: 13333, hardCap: 20000 });
  });

  it("leaves the soft limit alone when the cap is already above it", () => {
    expect(resolve(50000, null, 150000, null)).toEqual({ softLimit: 50000, hardCap: 150000 });
  });

  it("still honours an explicit cap above the derived one", () => {
    // Derivation is a fallback, not a policy ceiling: granting 200k against a
    // 30k soft limit is deliberate and must not be clamped back to 45k.
    expect(resolve(30000, null, null, 200000)).toEqual({ softLimit: 30000, hardCap: 200000 });
  });

  it("reports a cap with no soft limit to warn against", () => {
    expect(resolve(null, null, null, 20000)).toEqual({ softLimit: null, hardCap: 20000 });
  });
});
