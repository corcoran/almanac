import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWelcomeDismissed } from "./useWelcomeDismissed.js";

describe("useWelcomeDismissed", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    // Reset the module-level ref to a clean state for the next test by
    // dismissing-then-clearing is not enough; the ref persists. Each test
    // that cares sets the storage + re-reads via dismiss(), so we only need
    // storage cleared. The shared-ref behavior is asserted explicitly below.
    localStorage.clear();
  });

  it("dismiss() flips the flag and persists to localStorage", () => {
    const { dismissed, dismiss } = useWelcomeDismissed();
    dismiss();
    expect(dismissed.value).toBe(true);
    expect(localStorage.getItem("almanac_welcome_dismissed")).toBe("true");
  });

  it("two callers share the same flag (module-level ref)", () => {
    const a = useWelcomeDismissed();
    const b = useWelcomeDismissed();
    a.dismiss();
    expect(b.dismissed.value).toBe(true);
  });
});
