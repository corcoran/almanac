import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { ChangelogRelease } from "../../lib/parse-changelog.js";
import WhatsNew from "./WhatsNew.vue";

const RELEASES: ChangelogRelease[] = [
  {
    version: "1.25.0",
    date: "2026-06-28",
    items: [{ kind: "Changed", text: "Ends **always** show" }],
  },
  { version: "1.24.2", date: "2026-06-27", items: [{ kind: "Fixed", text: "macros" }] },
];

describe("WhatsNew", () => {
  it("renders a row per release with version and date", () => {
    const w = mount(WhatsNew, { props: { lastSeen: null, releases: RELEASES } });
    const rows = w.findAll("[data-test='whats-new-release']");
    expect(rows).toHaveLength(2);
    expect(w.text()).toContain("1.25.0");
    expect(w.text()).toContain("2026-06-28");
  });

  it("renders **bold** item text as <strong>, not literal asterisks", () => {
    const w = mount(WhatsNew, { props: { lastSeen: null, releases: RELEASES } });
    expect(w.find("strong").text()).toBe("always");
    expect(w.text()).not.toContain("**always**");
  });

  it("applies the 'is-new' class only to releases newer than lastSeen", () => {
    const w = mount(WhatsNew, { props: { lastSeen: "1.24.2", releases: RELEASES } });
    const rows = w.findAll("[data-test='whats-new-release']");
    expect(rows[0]?.classes()).toContain("is-new"); // 1.25.0 > 1.24.2
    expect(rows[1]?.classes()).not.toContain("is-new"); // 1.24.2 not > itself
  });

  it("applies no 'is-new' class on first visit (lastSeen null)", () => {
    const w = mount(WhatsNew, { props: { lastSeen: null, releases: RELEASES } });
    expect(w.findAll(".is-new")).toHaveLength(0);
  });

  it("shows an empty state when there are no releases", () => {
    const w = mount(WhatsNew, { props: { lastSeen: null, releases: [] } });
    expect(w.text()).toContain("No release notes");
  });
});
