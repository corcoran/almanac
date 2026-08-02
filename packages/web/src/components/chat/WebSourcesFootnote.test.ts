import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WebSourcesFootnote from "./WebSourcesFootnote.vue";

const sources = [
  { url: "https://healthline.com/a", title: "A", domain: "healthline.com" },
  { url: "https://wikipedia.org/b", title: "B", domain: "wikipedia.org" },
];

describe("WebSourcesFootnote", () => {
  it("renders nothing when sources is empty", () => {
    const w = mount(WebSourcesFootnote, { props: { sources: [] } });
    expect(w.find('[data-test="web-sources"]').exists()).toBe(false);
  });

  it("shows a collapsed count with correct pluralization", () => {
    const w = mount(WebSourcesFootnote, { props: { sources } });
    expect(w.find('[data-test="web-sources-toggle"]').text()).toContain("Searched 2 sources");
  });

  it("expands the source list on click and links safely", async () => {
    const w = mount(WebSourcesFootnote, { props: { sources } });
    expect(w.find('[data-test="web-sources-list"]').exists()).toBe(false);
    await w.find('[data-test="web-sources-toggle"]').trigger("click");
    const links = w.findAll('[data-test="web-source-link"]');
    expect(links).toHaveLength(2);
    expect(links[0]?.attributes("rel")).toBe("noopener noreferrer");
    expect(links[0]?.attributes("target")).toBe("_blank");
  });

  it("falls back to a monogram when a favicon errors", async () => {
    const w = mount(WebSourcesFootnote, { props: { sources } });
    const img = w.find('[data-test="web-source-favicon"]');
    await img.trigger("error");
    expect(w.find('[data-test="web-source-monogram"]').exists()).toBe(true);
  });

  it("singularizes one source", () => {
    const w = mount(WebSourcesFootnote, { props: { sources: sources.slice(0, 1) } });
    expect(w.find('[data-test="web-sources-toggle"]').text()).toContain("Searched 1 source");
  });
});
