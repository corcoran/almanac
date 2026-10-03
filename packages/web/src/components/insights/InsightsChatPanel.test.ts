import { defined } from "@almanac/core/test-support";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInsightsChatStore } from "../../stores/insights-chat.store.js";
import InsightsChatPanel from "./InsightsChatPanel.vue";

// The copy-stats button serializes the report with buildReportMarkdown. That
// function is exhaustively tested in core; here we only care that the panel
// fetches the report and writes the serialized markdown to the clipboard, so
// stub the serializer with a sentinel string.
vi.mock("@almanac/core/signals", () => ({
  buildReportMarkdown: () => "MOCK MARKDOWN",
}));

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
}

// A client stub whose `post` resolves an insights-chat answer, whose `get`
// routes by path (history → a transcript, days → the day list, report → a
// mocked-away report), and whose `delete` resolves the new-chat reset. Each
// `post` returns the same `text`; `historyTurns`/`days` seed the hydration the
// store performs on `load()`.
// A minimal usage envelope matching UsageSummary so the store's `res.usage.sources`
// read works against the fake. `sources` defaults to [] (search off → dormant).
function usage(sources: Array<{ url: string; title: string; domain: string }> = []) {
  return {
    input_tokens: 1,
    output_tokens: 1,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    web_search_requests: sources.length > 0 ? 1 : 0,
    sources,
    cost_usd: 0,
    model: "m",
  };
}

function makeClient(
  text = "You're doing great.",
  opts: {
    historyTurns?: Array<{
      role: "user" | "assistant";
      content: string;
      id?: number;
      helpful?: boolean;
      sources?: Array<{ url: string; title: string; domain: string }>;
    }>;
    onDate?: string;
    days?: string[];
    sources?: Array<{ url: string; title: string; domain: string }>;
  } = {},
) {
  const historyTurns = opts.historyTurns ?? [];
  // Default onDate matches mountPanel's default realToday (2026-06-24) so the
  // default mount is genuinely "today" (interactive). Past-day tests pass an
  // explicit earlier onDate. Past-view is now `viewedDate < realToday`, not
  // `viewedDate !== days[0]`.
  const onDate = opts.onDate ?? "2026-06-24";
  const days = opts.days ?? (historyTurns.length > 0 ? [onDate] : []);
  return {
    post: vi.fn().mockResolvedValue({ text, usage: usage(opts.sources), assistant_turn_id: 2 }),
    get: vi.fn((path: string) => {
      if (path.startsWith("/v1/llm/insights-chat/history")) {
        return Promise.resolve({ on_date: onDate, turns: historyTurns });
      }
      if (path === "/v1/llm/insights-chat/days") {
        return Promise.resolve({ days });
      }
      return Promise.resolve({ report: true });
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    patch: vi.fn().mockResolvedValue(undefined),
  };
}

// `viewedDate`/`realToday` default to the SAME value so the panel treats the
// mount as the current/interactive day (past-day loading is gated on
// `viewedDate < realToday`). Tests exercising a past day pass distinct values.
function mountPanel(
  client: ReturnType<typeof makeClient>,
  props: { viewedDate?: string; realToday?: string } = {},
) {
  const viewedDate = props.viewedDate ?? "2026-06-24";
  const realToday = props.realToday ?? "2026-06-24";
  return mount(InsightsChatPanel, {
    props: { client: client as never, viewedDate, realToday },
  });
}

describe("InsightsChatPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    stubClipboard();
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the panel", async () => {
    const client = makeClient();
    const wrapper = mountPanel(client);
    await flushPromises();
    expect(wrapper.find('[data-test="insights-panel"]').exists()).toBe(true);
  });

  it("renders the assistant answer as an assistant turn", async () => {
    const client = makeClient("x", {
      historyTurns: [
        { role: "user", content: "q" },
        { role: "assistant", content: "Trend is solid; keep it up." },
      ],
    });
    const wrapper = mountPanel(client);
    await flushPromises();
    const turns = wrapper.findAll('[data-test="insights-assistant-turn"]');
    expect(turns.length).toBeGreaterThanOrEqual(1);
    expect(wrapper.text()).toContain("Trend is solid; keep it up.");
  });

  it("renders assistant markdown (bold + list) as HTML", async () => {
    const client = makeClient("x", {
      historyTurns: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: "You're **on track** for your cut.\n\n- weight down 1.2kg\n- net -260/day",
        },
      ],
    });
    const wrapper = mountPanel(client);
    await flushPromises();
    const turn = wrapper.find('[data-test="insights-assistant-turn"]');
    expect(turn.exists()).toBe(true);
    const html = turn.html();
    expect(html).toContain("<strong>on track</strong>");
    expect(html).toContain("<li>");
  });

  it("escapes raw HTML in assistant content (XSS-safe, html:false)", async () => {
    const client = makeClient("x", {
      historyTurns: [
        { role: "user", content: "q" },
        { role: "assistant", content: "<img src=x onerror=alert(1)><script>alert(1)</script>" },
      ],
    });
    const wrapper = mountPanel(client);
    await flushPromises();
    const turn = wrapper.find('[data-test="insights-assistant-turn"]');
    const html = turn.html();
    // markdown-it with html:false escapes literal HTML — no live tags rendered.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
  });

  async function renderedAnchor(content: string) {
    const client = makeClient("x", {
      historyTurns: [
        { role: "user", content: "q" },
        { role: "assistant", content },
      ],
    });
    const wrapper = mountPanel(client);
    await flushPromises();
    return wrapper.find('[data-test="insights-assistant-turn"] a');
  }

  it("shortens a bare long URL to a label of at most 40 chars, keeping the full href", async () => {
    const url =
      "https://www.researchgate.net/publication/318368028_A_systematic_review_meta-analysis";
    const a = await renderedAnchor(`Link: ${url}`);
    expect(a.attributes("href")).toBe(url);
    expect(a.attributes("title")).toBe(url);
    expect(a.attributes("target")).toBe("_blank");
    expect(a.attributes("rel")).toContain("noopener");
    const text = a.text();
    expect(text.length).toBeLessThanOrEqual(40);
    expect(text.startsWith("researchgate.net/")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
  });

  it("keeps the title text of a [title](url) link", async () => {
    const url = "https://example.com/very/long/path/that/goes/on";
    const a = await renderedAnchor(`[Morton 2018](${url})`);
    expect(a.text()).toBe("Morton 2018");
    expect(a.attributes("href")).toBe(url);
    expect(a.attributes("target")).toBe("_blank");
  });

  it("shows a short bare URL without protocol and without an ellipsis", async () => {
    const a = await renderedAnchor("https://e.com/a");
    expect(a.text()).toBe("e.com/a");
  });

  it("renders the typed message as a user turn", async () => {
    const client = makeClient();
    const wrapper = mountPanel(client);
    await flushPromises();
    await wrapper.get('[data-test="insights-input"]').setValue("How is my sleep?");
    // jsdom doesn't fire form submit from a submit-button click — submit the form.
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const userTurns = wrapper.findAll('[data-test="insights-user-turn"]');
    expect(userTurns.some((t) => t.text().includes("How is my sleep?"))).toBe(true);
  });

  it("sends the typed text via the store and clears the input", async () => {
    const client = makeClient();
    const wrapper = mountPanel(client);
    await flushPromises();
    const before = client.post.mock.calls.length;
    await wrapper.get('[data-test="insights-input"]').setValue("Am I on target?");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(client.post.mock.calls.length).toBe(before + 1);
    const lastBody = client.post.mock.calls.at(-1)?.[1] as { message: string };
    expect(lastBody.message).toBe("Am I on target?");
    expect((wrapper.get('[data-test="insights-input"]').element as HTMLTextAreaElement).value).toBe(
      "",
    );
  });

  it("copies stats: fetches /v1/report and writes markdown to the clipboard", async () => {
    const writeText = stubClipboard();
    const client = makeClient();
    const wrapper = mountPanel(client);
    await flushPromises();
    await wrapper.get('[data-test="insights-copy"]').trigger("click");
    await flushPromises();
    expect(client.get).toHaveBeenCalledWith("/v1/report", expect.anything());
    expect(writeText).toHaveBeenCalledWith("MOCK MARKDOWN");
  });

  it("shows the error state when copy fails", async () => {
    // Make the clipboard write reject so onCopy lands in the catch → "error".
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const client = makeClient();
    const wrapper = mountPanel(client);
    await flushPromises();
    await wrapper.get('[data-test="insights-copy"]').trigger("click");
    await flushPromises();
    const btn = wrapper.get('[data-test="insights-copy"]');
    expect(btn.attributes("data-state")).toBe("error");
    expect(btn.attributes("aria-label")).toBe("Copy failed");
    expect(btn.text()).toContain("✕");
  });

  it("does not throw when unmounted after a copy click (timer cleaned up)", async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      const wrapper = mountPanel(client);
      await wrapper.get('[data-test="insights-copy"]').trigger("click");
      // Unmount before the 2s copy-reset timer fires.
      wrapper.unmount();
      // Advancing past the timer must not throw / mutate the torn-down component.
      expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits close when the close button is clicked", async () => {
    const client = makeClient();
    const wrapper = mountPanel(client);
    await flushPromises();
    await wrapper.get('[data-test="insights-close"]').trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("hydrates history on mount by calling store.load with the client", async () => {
    const client = makeClient();
    const loadSpy = vi.spyOn(useInsightsChatStore(), "load");
    mountPanel(client);
    await flushPromises();
    expect(loadSpy).toHaveBeenCalled();
    // Current day → load today (no past date threaded through).
    expect(loadSpy).toHaveBeenCalledWith(client, undefined);
  });

  it("auto-opener does NOT fire when LOADED turns are non-empty", async () => {
    const client = makeClient("hi", {
      historyTurns: [
        { role: "user", content: "earlier" },
        { role: "assistant", content: "earlier reply" },
      ],
      onDate: "2026-06-23",
    });
    const sendSpy = vi.spyOn(useInsightsChatStore(), "send");
    mountPanel(client);
    await flushPromises();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("renders the web-sources footnote under an assistant turn that has sources", async () => {
    const client = makeClient("with sources", {
      historyTurns: [
        {
          role: "assistant",
          content: "with sources",
          sources: [{ url: "https://x.com/a", title: "A", domain: "x.com" }],
        },
      ],
      onDate: "2026-06-23",
    });
    const wrapper = mountPanel(client, { viewedDate: "2026-06-23", realToday: "2026-06-24" });
    await flushPromises();
    expect(wrapper.find('[data-test="web-sources"]').exists()).toBe(true);
  });

  it("renders the day stepper and new-chat controls", async () => {
    const client = makeClient();
    const wrapper = mountPanel(client);
    await flushPromises();
    expect(wrapper.find('[data-test="insights-prev-day"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="insights-next-day"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="insights-new-chat"]').exists()).toBe(true);
  });

  it("◀ is enabled on a fresh today (no convo yet) when past days exist", async () => {
    // Today (2026-06-24) loads empty and isn't in `days`; a past day exists.
    // The back arrow must be reachable so the user can get to the archive.
    const client = makeClient("hi", {
      historyTurns: [],
      onDate: "2026-06-24",
      days: ["2026-06-23"],
    });
    const wrapper = mountPanel(client);
    await flushPromises();
    const prev = wrapper.get('[data-test="insights-prev-day"]');
    expect((prev.element as HTMLButtonElement).disabled).toBe(false);
    // ...and there's nothing newer than today, so ▶ stays disabled.
    expect(
      (wrapper.get('[data-test="insights-next-day"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("stays INTERACTIVE on a fresh today even when only past days are in `days` (read-only regression)", async () => {
    // The bug: today (2026-06-24) has no conversation yet, so it's not in `days`
    // (only the past day 06-23 is). The old past-view check (viewedDate !== days[0])
    // wrongly read today as a PAST day and flipped the input to "Jump to today" —
    // e.g. while waiting for the first reply. Past-view is now viewedDate < realToday,
    // so today stays interactive.
    const client = makeClient("hi", {
      historyTurns: [],
      onDate: "2026-06-24", // today
      days: ["2026-06-23"], // only a PAST day has a conversation
    });
    const wrapper = mountPanel(client, { realToday: "2026-06-24" });
    await flushPromises();
    expect(wrapper.find('[data-test="insights-input"]').exists()).toBe(true); // input present
    expect(wrapper.find('[data-test="insights-jump-today"]').exists()).toBe(false); // NOT read-only
  });

  it("◀ calls store.stepDay(client, -1)", async () => {
    const client = makeClient("hi", {
      historyTurns: [{ role: "user", content: "x" }],
      days: ["2026-06-23", "2026-06-22"],
      onDate: "2026-06-23",
    });
    const stepSpy = vi.spyOn(useInsightsChatStore(), "stepDay");
    const wrapper = mountPanel(client);
    await flushPromises();
    await wrapper.get('[data-test="insights-prev-day"]').trigger("click");
    expect(stepSpy).toHaveBeenCalledWith(client, -1);
  });

  it("Reset day (cancelled) does NOT wipe the conversation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const client = makeClient();
    const newChatSpy = vi.spyOn(useInsightsChatStore(), "newChat");
    const wrapper = mountPanel(client);
    await flushPromises();
    await wrapper.get('[data-test="insights-new-chat"]').trigger("click");
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalled();
    expect(newChatSpy).not.toHaveBeenCalled(); // cancelled → no destructive reset
    confirmSpy.mockRestore();
  });

  it("labels the reset control 'Reset day'", async () => {
    const client = makeClient();
    const wrapper = mountPanel(client);
    await flushPromises();
    expect(wrapper.get('[data-test="insights-new-chat"]').text()).toBe("Reset day");
  });

  it("shows the Loading… indicator while the store is hydrating", async () => {
    const client = makeClient();
    const wrapper = mountPanel(client);
    await flushPromises();
    const store = useInsightsChatStore();
    store.loading = true;
    await flushPromises();
    const pending = wrapper.find('[data-test="insights-pending"]');
    expect(pending.exists()).toBe(true);
    expect(pending.text()).toContain("Loading…");
  });

  it("shows the viewed date (compact MM/DD) when viewing an older day", async () => {
    const client = makeClient("hi", {
      historyTurns: [{ role: "user", content: "x" }],
      days: ["2026-06-23", "2026-06-22"],
      onDate: "2026-06-22",
    });
    const wrapper = mountPanel(client);
    await flushPromises();
    // Compact MM/DD keeps the header narrow so action buttons stay on-screen.
    expect(wrapper.find('[data-test="insights-viewed-date"]').text()).toBe("06/22");
  });

  it("hides New chat when viewing a past day (it only resets today)", async () => {
    const client = makeClient("hi", {
      historyTurns: [{ role: "user", content: "x" }],
      days: ["2026-06-23", "2026-06-22"],
      onDate: "2026-06-22",
    });
    const wrapper = mountPanel(client);
    await flushPromises();
    expect(wrapper.find('[data-test="insights-new-chat"]').exists()).toBe(false);
  });

  it("opens the SELECTED past calendar day (loads that day, not today)", async () => {
    // Calendar has a past day selected; the panel must hydrate THAT day, not today.
    const client = makeClient("hi", {
      historyTurns: [{ role: "user", content: "past" }],
      days: ["2026-06-23", "2026-06-22"],
      onDate: "2026-06-22",
    });
    const loadSpy = vi.spyOn(useInsightsChatStore(), "load");
    mountPanel(client, { viewedDate: "2026-06-22", realToday: "2026-06-24" });
    await flushPromises();
    expect(loadSpy).toHaveBeenCalledWith(client, "2026-06-22");
    // The history GET went to the dated endpoint, not the bare today one.
    expect(client.get).toHaveBeenCalledWith(
      "/v1/llm/insights-chat/history?date=2026-06-22",
      expect.anything(),
    );
  });

  it("a past day is READ-ONLY: shows Jump-to-today instead of the input form", async () => {
    const client = makeClient("hi", {
      historyTurns: [{ role: "user", content: "x" }],
      days: ["2026-06-23", "2026-06-22"],
      onDate: "2026-06-22",
    });
    const wrapper = mountPanel(client, { viewedDate: "2026-06-22", realToday: "2026-06-24" });
    await flushPromises();
    expect(wrapper.find('[data-test="insights-input"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="insights-send"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="insights-jump-today"]').exists()).toBe(true);
  });

  it("today is interactive: input form present, Jump-to-today absent", async () => {
    const client = makeClient();
    const wrapper = mountPanel(client);
    await flushPromises();
    expect(wrapper.find('[data-test="insights-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="insights-send"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="insights-jump-today"]').exists()).toBe(false);
  });

  it("Jump to today calls store.load(client) with no date (returns to today)", async () => {
    const client = makeClient("hi", {
      historyTurns: [{ role: "user", content: "x" }],
      days: ["2026-06-23", "2026-06-22"],
      onDate: "2026-06-22",
    });
    const wrapper = mountPanel(client, { viewedDate: "2026-06-22", realToday: "2026-06-24" });
    await flushPromises();
    const loadSpy = vi.spyOn(useInsightsChatStore(), "load");
    await wrapper.get('[data-test="insights-jump-today"]').trigger("click");
    await flushPromises();
    // No date arg → today; resets viewedDate to the live day.
    expect(loadSpy).toHaveBeenCalledWith(client);
  });

  it("does NOT auto-fire the opener on an empty past day", async () => {
    // A past day with no conversation must stay silent — the opener is a
    // current-day-only affordance.
    const client = makeClient("hi", {
      historyTurns: [],
      days: ["2026-06-23"],
      onDate: "2026-06-22",
    });
    const sendSpy = vi.spyOn(useInsightsChatStore(), "send");
    mountPanel(client, { viewedDate: "2026-06-22", realToday: "2026-06-24" });
    await flushPromises();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("does not auto-send anything on mount", async () => {
    const client = makeClient();
    mountPanel(client);
    await flushPromises();
    expect(client.post).not.toHaveBeenCalled();
  });

  it("shows the four starters on an empty today thread and sends the tapped one", async () => {
    const client = makeClient();
    const w = mountPanel(client);
    await flushPromises();
    const buttons = w.findAll('[data-test="insights-starter"]');
    expect(buttons.map((b) => b.text())).toEqual([
      "Quick read",
      "What should I eat?",
      "Review my training",
      "What have you told me?",
    ]);
    await buttons[1]?.trigger("click");
    await flushPromises();
    const body = defined(client.post.mock.calls[0]?.[1], "body") as { message: string };
    expect(body.message).toBe("What should I eat for the rest of today?");
  });

  it("hides starters once the thread has turns", async () => {
    const client = makeClient("hi", {
      historyTurns: [
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
      ],
    });
    const w = mountPanel(client);
    await flushPromises();
    expect(w.find('[data-test="insights-starter"]').exists()).toBe(false);
  });

  it("hides starters on an empty past day", async () => {
    const client = makeClient("hi", { historyTurns: [], onDate: "2026-06-22" });
    const w = mountPanel(client, { viewedDate: "2026-06-22", realToday: "2026-06-24" });
    await flushPromises();
    expect(w.find('[data-test="insights-starter"]').exists()).toBe(false);
  });

  it("Reset day clears without auto-sending", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const client = makeClient("hi", {
      historyTurns: [
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
      ],
    });
    const newChatSpy = vi.spyOn(useInsightsChatStore(), "newChat");
    const w = mountPanel(client);
    await flushPromises();
    await w.find('[data-test="insights-new-chat"]').trigger("click");
    await flushPromises();
    expect(newChatSpy).toHaveBeenCalledWith(client);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("toggles Helpful on an assistant turn", async () => {
    const client = makeClient("hi", {
      historyTurns: [
        { role: "user", content: "q" },
        { role: "assistant", content: "a", id: 9, helpful: false },
      ],
    });
    const w = mountPanel(client);
    await flushPromises();
    await w.find('[data-test="insights-helpful"]').trigger("click");
    await flushPromises();
    expect(client.patch).toHaveBeenCalledWith(
      "/v1/llm/insights-chat/turns/9",
      { helpful: true },
      expect.anything(),
    );
    expect(w.find('[data-test="insights-helpful"]').classes()).toContain("on");
  });

  it("renders the sources footnote under a turn that has sources", async () => {
    const client = makeClient("hi", {
      historyTurns: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: "a",
          id: 3,
          sources: [{ url: "https://e.com", title: "E", domain: "e.com" }],
        },
      ],
    });
    const w = mountPanel(client);
    await flushPromises();
    expect(w.find('[data-test="insights-assistant-turn"] [data-test="web-sources"]').exists()).toBe(
      true,
    );
  });

  it("hides starters while the store is loading or pending", async () => {
    const client = makeClient();
    const w = mountPanel(client);
    await flushPromises();
    expect(w.find('[data-test="insights-starter"]').exists()).toBe(true);
    const store = useInsightsChatStore();
    store.loading = true;
    await flushPromises();
    expect(w.find('[data-test="insights-starter"]').exists()).toBe(false);
    store.loading = false;
    store.pending = true;
    await flushPromises();
    expect(w.find('[data-test="insights-starter"]').exists()).toBe(false);
  });

  it("does not warn about duplicate keys across two exchanges", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = makeClient();
    const w = mountPanel(client);
    await flushPromises();
    for (const q of ["one", "two"]) {
      await w.get('[data-test="insights-input"]').setValue(q);
      await w.get("form").trigger("submit");
      await flushPromises();
    }
    expect(w.findAll('[data-test="insights-assistant-turn"]').length).toBe(2);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("Duplicate keys"))).toBe(false);
  });
});
