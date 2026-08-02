import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChangelogRelease } from "../lib/parse-changelog.js";
import { compareVersions, useLastSeenVersion } from "./useLastSeenVersion.js";

const RELEASES: ChangelogRelease[] = [
  { version: "1.25.0", date: "2026-06-28", items: [{ kind: "Changed", text: "x" }] },
  { version: "1.24.2", date: "2026-06-27", items: [{ kind: "Fixed", text: "y" }] },
  { version: "1.24.0", date: "2026-06-24", items: [{ kind: "Added", text: "z" }] },
];

const KEY = "almanac.lastSeenVersion";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("compareVersions", () => {
  it("orders by major, minor, patch", () => {
    expect(compareVersions("1.25.0", "1.24.2")).toBeGreaterThan(0);
    expect(compareVersions("1.24.2", "1.25.0")).toBeLessThan(0);
    expect(compareVersions("1.24.0", "1.24.0")).toBe(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });
  it("treats malformed versions as 0.0.0", () => {
    expect(compareVersions("garbage", "0.0.0")).toBe(0);
  });
});

describe("useLastSeenVersion", () => {
  it("first visit (no stored value) reports 0 unseen", () => {
    const { unseenCount, lastSeen } = useLastSeenVersion(RELEASES);
    expect(lastSeen.value).toBeNull();
    expect(unseenCount.value).toBe(0);
  });

  it("counts releases strictly newer than the stored last-seen", () => {
    localStorage.setItem(KEY, "1.24.2");
    const { unseenCount } = useLastSeenVersion(RELEASES);
    expect(unseenCount.value).toBe(1); // only 1.25.0 is newer
  });

  it("markAllSeen persists the newest version and zeroes the count", () => {
    localStorage.setItem(KEY, "1.24.0");
    const { unseenCount, markAllSeen, lastSeen } = useLastSeenVersion(RELEASES);
    expect(unseenCount.value).toBe(2);
    markAllSeen();
    expect(localStorage.getItem(KEY)).toBe("1.25.0");
    expect(lastSeen.value).toBe("1.25.0");
    expect(unseenCount.value).toBe(0);
  });

  it("handles an empty release list without throwing", () => {
    const { unseenCount, markAllSeen } = useLastSeenVersion([]);
    expect(unseenCount.value).toBe(0);
    expect(() => markAllSeen()).not.toThrow();
  });
});
