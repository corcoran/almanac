import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import type { Turn } from "../../stores/meal-chat.store.js";
import ChatThread from "./ChatThread.vue";

const usage = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  web_search_requests: 0,
  sources: [],
  cost_usd: 0,
  model: "x",
};

const turns: Turn[] = [
  { role: "user", content: "burrito and beer" },
  {
    role: "assistant",
    kind: "proposal",
    content: "Proposed: …",
    usage,
    loggedSummaries: [],
    alcoholSessions: [],
    meals: [
      {
        source: "estimated",
        name: "Burrito",
        kcal: 640,
        protein_g: 35,
        carb_g: 70,
        fat_g: 22,
        suggest_store: false,
        _key: 1,
      },
      {
        source: "estimated",
        name: "Beer",
        kcal: 150,
        protein_g: 1,
        carb_g: 13,
        fat_g: 0,
        suggest_store: false,
        _key: 2,
      },
    ],
  },
];

describe("ChatThread", () => {
  it("renders user and assistant turns in order with a card per meal", () => {
    const wrapper = mount(ChatThread, {
      props: { turns, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    expect(wrapper.find('[data-test="chat-user-turn"]').text()).toContain("burrito and beer");
    expect(wrapper.findAll('[data-test="proposal-card"]')).toHaveLength(2);
  });

  it("shows Log all only when a proposal turn has more than one card", () => {
    const wrapper = mount(ChatThread, {
      props: { turns, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    expect(wrapper.find('[data-test="chat-log-all"]').exists()).toBe(true);
  });

  it("emits log-all with the turn index", async () => {
    const wrapper = mount(ChatThread, {
      props: { turns, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    await wrapper.find('[data-test="chat-log-all"]').trigger("click");
    expect(wrapper.emitted("log-all")?.[0]).toEqual([1]);
  });

  it("renders an AlcoholCard for each alcohol session and a unified Log-all count", () => {
    const mixedTurns: Turn[] = [
      { role: "user", content: "a burger and two beers" },
      {
        role: "assistant",
        kind: "proposal",
        content: "Proposed: …",
        usage,
        loggedSummaries: [],
        meals: [
          {
            source: "estimated",
            name: "Burger",
            kcal: 600,
            protein_g: 30,
            carb_g: 45,
            fat_g: 32,
            suggest_store: false,
            _key: 1,
          },
        ],
        alcoholSessions: [{ drinks_count: 2, est_kcal: 300, _key: 2 }],
      },
    ];
    const wrapper = mount(ChatThread, {
      props: { turns: mixedTurns, viewedDate: "2026-08-02", realToday: "2026-08-02" },
    });
    expect(wrapper.findAll('[data-test="alcohol-card"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-test="proposal-card"]')).toHaveLength(1);
    // 1 meal + 1 alcohol = 2 total → unified "Log all 2"
    expect(wrapper.find('[data-test="chat-log-all"]').text()).toContain("2");
  });

  it("bubbles log-alcohol and dismiss-alcohol with turn + alcohol index", async () => {
    const mixedTurns: Turn[] = [
      { role: "user", content: "two beers" },
      {
        role: "assistant",
        kind: "proposal",
        content: "Proposed: …",
        usage,
        loggedSummaries: [],
        meals: [],
        alcoholSessions: [{ drinks_count: 2, est_kcal: 300, _key: 5 }],
      },
    ];
    const wrapper = mount(ChatThread, {
      props: { turns: mixedTurns, viewedDate: "2026-08-02", realToday: "2026-08-02" },
    });
    await wrapper.find('[data-test="alc-log"]').trigger("click");
    const logEvt = wrapper.emitted("log-alcohol")?.[0];
    // [turnIndex, alcoholIndex, body]
    expect(logEvt?.[0]).toBe(1);
    expect(logEvt?.[1]).toBe(0);
    await wrapper.find('[data-test="alc-dismiss"]').trigger("click");
    expect(wrapper.emitted("dismiss-alcohol")?.[0]).toEqual([1, 0]);
  });

  it("renders a QuestionBubble for a question turn", () => {
    const qTurns: Turn[] = [
      { role: "user", content: "lunch" },
      { role: "assistant", kind: "question", content: "What did you have?", usage },
    ];
    const wrapper = mount(ChatThread, {
      props: { turns: qTurns, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    expect(wrapper.find('[data-test="chat-question"]').text()).toContain("What did you have?");
  });

  it("renders a logged-confirmation row for each turn.loggedSummaries entry", () => {
    const loggedTurns: Turn[] = [
      { role: "user", content: "a big mac" },
      {
        role: "assistant",
        kind: "proposal",
        content: "Proposed: …",
        usage,
        loggedSummaries: ["✓ Logged Big Mac — 550 kcal"],
        alcoholSessions: [],
        meals: [],
      },
    ];
    const wrapper = mount(ChatThread, {
      props: { turns: loggedTurns, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    const rows = wrapper.findAll('[data-test="chat-logged"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text()).toContain("✓ Logged Big Mac — 550 kcal");
  });

  it("renders the source footnote for a searched turn", () => {
    const searchedTurns: Turn[] = [
      { role: "user", content: "lunch" },
      {
        role: "assistant",
        kind: "question",
        content: "?",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          web_search_requests: 1,
          cost_usd: 0,
          model: "m",
          sources: [{ url: "https://x.com/a", title: "A", domain: "x.com" }],
        },
      },
    ];
    const wrapper = mount(ChatThread, {
      props: { turns: searchedTurns, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    expect(wrapper.find('[data-test="web-sources"]').exists()).toBe(true);
    // The old bare line is gone for turns that have structured sources.
    expect(wrapper.find('[data-test="chat-searched"]').exists()).toBe(false);
  });

  it("bubbles dismiss with turn + meal index", async () => {
    const wrapper = mount(ChatThread, {
      props: { turns, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    await wrapper.findAll('[data-test="card-dismiss"]')[0]?.trigger("click");
    expect(wrapper.emitted("dismiss")?.[0]).toEqual([1, 0]);
  });

  // Regression: logging the FIRST of several proposed meals splices meals[0]
  // out. If the v-for keys cards by array index, Vue reuses the key=0 component
  // instance for the meal that shifted down — and since ProposalCard seeds its
  // editable name from the prop only at setup, the surviving card keeps showing
  // the *logged* meal's name. Symptom: log the first, the second visually
  // disappears and the first appears to remain. Cards must be keyed by a stable
  // per-meal identity so the correct card is removed.
  it("keeps the un-logged card when an earlier meal is spliced out", async () => {
    // Reactive so the post-mount splice (what markLogged does in the store)
    // re-renders the list, exactly as production reactivity would.
    const two: Turn[] = reactive([
      { role: "user", content: "burrito and beer" },
      {
        role: "assistant",
        kind: "proposal",
        content: "Proposed: …",
        usage,
        loggedSummaries: [],
        alcoholSessions: [],
        meals: [
          {
            source: "estimated",
            name: "Burrito",
            kcal: 640,
            protein_g: 35,
            carb_g: 70,
            fat_g: 22,
            suggest_store: false,
            _key: 1,
          },
          {
            source: "estimated",
            name: "Beer",
            kcal: 150,
            protein_g: 1,
            carb_g: 13,
            fat_g: 0,
            suggest_store: false,
            _key: 2,
          },
        ],
      },
    ]);
    const wrapper = mount(ChatThread, {
      props: { turns: two, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    expect(wrapper.findAll('[data-test="proposal-card"]')).toHaveLength(2);

    // Simulate logging the first card: markLogged splices meals[0] out.
    const turn = two[1];
    if (turn?.role !== "assistant" || turn.kind !== "proposal") throw new Error("bad fixture");
    turn.meals.splice(0, 1);
    await wrapper.vm.$nextTick();

    const cards = wrapper.findAll('[data-test="proposal-card"]');
    expect(cards).toHaveLength(1);
    // The surviving card must be Beer (the one NOT logged), not a stale Burrito.
    const name = cards[0]?.find('[data-test="card-name"]').element as HTMLInputElement;
    expect(name.value).toBe("Beer");
  });
});
