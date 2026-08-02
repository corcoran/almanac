import { describe, expect, it } from "vitest";
import { normalizeTimestamp } from "./params.js";

describe("normalizeTimestamp", () => {
  it("interprets a naked-local datetime in the user's timezone", () => {
    const out = normalizeTimestamp(
      { eaten_at: "2026-05-08T16:20:00" },
      "eaten_at",
      "America/Toronto",
    );
    // Toronto in May (EDT, UTC-4): 16:20 EDT → 20:20 UTC.
    expect(out.eaten_at).toBe("2026-05-08T20:20:00.000Z");
  });

  it("passes through an ISO instant with offset unchanged (as a UTC ISO)", () => {
    const out = normalizeTimestamp(
      { started_at: "2026-05-08T20:20:00Z" },
      "started_at",
      "America/Toronto",
    );
    expect(out.started_at).toBe("2026-05-08T20:20:00.000Z");
  });

  it("returns the body unchanged when the field is undefined", () => {
    const body = { drinks_count: 2 };
    const out = normalizeTimestamp(
      body,
      "ended_at" as keyof typeof body & string,
      "America/Toronto",
    );
    // Field stays absent — no `ended_at` key magically appears.
    expect(out).toEqual({ drinks_count: 2 });
    expect("ended_at" in out).toBe(false);
  });

  it("returns the body unchanged when the field is null", () => {
    const body = { ended_at: null as unknown as string };
    const out = normalizeTimestamp(body, "ended_at", "America/Toronto");
    expect(out.ended_at).toBeNull();
  });
});
