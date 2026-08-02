import { describe, expect, it } from "vitest";
import { BootstrapUserInputSchema, sanitizeAboutMe, UserUpdateSchema } from "./users.js";

describe("UserUpdateSchema", () => {
  it("rejects an invalid IANA timezone", () => {
    expect(() => UserUpdateSchema.parse({ timezone: "Not/A_Zone" })).toThrow();
  });

  it("accepts a valid IANA timezone", () => {
    expect(UserUpdateSchema.parse({ timezone: "America/Toronto" })).toEqual({
      timezone: "America/Toronto",
    });
  });
});

describe("BootstrapUserInputSchema", () => {
  it("accepts activity_level at creation (regression: it was silently dropped)", () => {
    const parsed = BootstrapUserInputSchema.parse({ name: "Jeff", activity_level: "moderate" });
    expect(parsed.activity_level).toBe("moderate");
  });

  it("rejects an invalid activity_level", () => {
    expect(() =>
      BootstrapUserInputSchema.parse({ name: "Jeff", activity_level: "athlete" }),
    ).toThrow();
  });

  it("leaves activity_level undefined when omitted (still optional)", () => {
    const parsed = BootstrapUserInputSchema.parse({ name: "Jeff" });
    expect(parsed.activity_level).toBeUndefined();
  });
});

describe("sanitizeAboutMe", () => {
  it("trims and keeps normal text", () => {
    expect(sanitizeAboutMe("  hi there  ")).toBe("hi there");
  });
  it("coerces empty/whitespace to null", () => {
    expect(sanitizeAboutMe("   ")).toBeNull();
    expect(sanitizeAboutMe("")).toBeNull();
    expect(sanitizeAboutMe(null)).toBeNull();
  });
  it("strips control chars but keeps newlines and tabs", () => {
    // The input has a NUL (\u0000) between a and b; it must be removed,
    // but the tab (\t) and newline (\n) must be kept.
    expect(sanitizeAboutMe("a\u0000b\tc\nd")).toBe("ab\tc\nd");
  });
});

describe("UserUpdateSchema about_me", () => {
  it("accepts a string and transforms it (trims)", () => {
    const r = UserUpdateSchema.parse({ about_me: "  cyclist  " });
    expect(r.about_me).toBe("cyclist");
  });
  it("accepts null", () => {
    expect(UserUpdateSchema.parse({ about_me: null }).about_me).toBeNull();
  });
  it("coerces empty string to null via the transform", () => {
    expect(UserUpdateSchema.parse({ about_me: "   " }).about_me).toBeNull();
  });
  it("rejects over 600 chars (before transform)", () => {
    expect(() => UserUpdateSchema.parse({ about_me: "x".repeat(601) })).toThrow();
  });
});
