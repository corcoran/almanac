import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import UsageIndicator from "./UsageIndicator.vue";

const balance = {
  tokensUsed: 10000,
  callsToday: 5,
  softLimit: 50000,
  hardCap: 150000,
  avgTokensPerLog: 2000,
  logsLeftEstimate: 20,
  pctRemaining: 80,
  hardLogsLeftEstimate: 58,
  hardPctRemaining: 93,
  overSoftLimit: false,
  overHardCap: false,
  resetsAt: "4am",
};

/** Past the soft limit, well short of the ceiling. The hard tier is deliberately
 *  not surfaced, so nothing here may print the cap or count against it. */
const overBudget = {
  ...balance,
  tokensUsed: 60000,
  logsLeftEstimate: 0,
  pctRemaining: 0,
  hardLogsLeftEstimate: 37,
  hardPctRemaining: 60,
  overSoftLimit: true,
};

describe("UsageIndicator", () => {
  it("renders the pill with ~N logs left", () => {
    const w = mount(UsageIndicator, { props: { balance } });
    expect(w.find('[data-test="usage-pill"]').text()).toMatch(/20\s*logs left/i);
  });

  it("renders nothing when balance is null", () => {
    const w = mount(UsageIndicator, { props: { balance: null } });
    expect(w.find('[data-test="usage-pill"]').exists()).toBe(false);
  });

  it("renders nothing when there is no soft limit, even with a hard cap set", () => {
    const w = mount(UsageIndicator, {
      props: {
        balance: { ...balance, softLimit: null, logsLeftEstimate: null, pctRemaining: null },
      },
    });
    expect(w.find('[data-test="usage-pill"]').exists()).toBe(false);
  });

  it("never names the hard cap", async () => {
    const w = mount(UsageIndicator, { props: { balance } });
    await w.find('[data-test="usage-pill"]').trigger("click");
    const text = w.find('[data-test="usage-card"]').text();
    expect(text).not.toMatch(/ceiling/i);
    expect(text).not.toMatch(/150k/);
  });

  it("says over budget past the soft limit rather than counting to the cap", async () => {
    const w = mount(UsageIndicator, { props: { balance: overBudget } });
    const pill = w.find('[data-test="usage-pill"]');
    expect(pill.text()).toMatch(/over budget/i);
    expect(pill.text()).not.toMatch(/37/);

    await pill.trigger("click");
    const text = w.find('[data-test="usage-card"]').text();
    expect(text).not.toMatch(/ceiling/i);
    expect(text).not.toMatch(/150k/);
  });

  it("frames the soft line as an overage past the budget, not 60k of 50k", async () => {
    const w = mount(UsageIndicator, { props: { balance: overBudget } });
    await w.find('[data-test="usage-pill"]').trigger("click");
    const text = w.find('[data-test="usage-card"]').text();
    expect(text).toMatch(/10\.0k over your 50k budget/i);
    expect(text).not.toMatch(/60\.0k of 50k/i);
  });

  it("does not warn on the hard tier alone", () => {
    // 23% of the ceiling left but the soft budget is barely touched: the hard
    // tier is invisible, so it must not colour the pill either.
    const nearCeiling = {
      ...balance,
      tokensUsed: 5000,
      logsLeftEstimate: 18,
      pctRemaining: 90,
      hardLogsLeftEstimate: 14,
      hardPctRemaining: 23,
    };
    const w = mount(UsageIndicator, { props: { balance: nearCeiling } });
    expect(w.find('[data-test="usage-pill"]').classes().join(" ")).not.toMatch(/warn|low/);
  });

  it("expands to show the detail line on click", async () => {
    const w = mount(UsageIndicator, { props: { balance } });
    await w.find('[data-test="usage-pill"]').trigger("click");
    const card = w.find('[data-test="usage-card"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toMatch(/10\.0k of 50k tokens/i); // tokens used of daily budget
    expect(card.text()).toMatch(/resets at 4am/i);
    expect(card.text()).toMatch(/80%/); // pct of balance
  });

  it("does NOT warn when comfortably above the thresholds", () => {
    // 80% remaining, 20 logs left — no warning.
    const w = mount(UsageIndicator, { props: { balance } });
    expect(w.find('[data-test="usage-pill"]').classes().join(" ")).not.toMatch(/warn|low/);
  });

  it("warns when ≤30% of the balance remains", () => {
    const low = { ...balance, tokensUsed: 36000, logsLeftEstimate: 7, pctRemaining: 28 };
    const w = mount(UsageIndicator, { props: { balance: low } });
    expect(w.find('[data-test="usage-pill"]').classes().join(" ")).toMatch(/warn|low/);
  });

  it("warns when ≤2 logs left even if pct is above 30 (small-limit floor)", () => {
    // A tiny limit: 2 logs left but still 40% remaining — the logs floor catches it.
    const low = {
      ...balance,
      softLimit: 5000,
      tokensUsed: 3000,
      logsLeftEstimate: 2,
      pctRemaining: 40,
    };
    const w = mount(UsageIndicator, { props: { balance: low } });
    expect(w.find('[data-test="usage-pill"]').classes().join(" ")).toMatch(/warn|low/);
  });

  it("warns when over the soft limit", () => {
    const low = {
      ...balance,
      tokensUsed: 60000,
      logsLeftEstimate: 0,
      pctRemaining: 0,
      overSoftLimit: true,
    };
    const w = mount(UsageIndicator, { props: { balance: low } });
    expect(w.find('[data-test="usage-pill"]').classes().join(" ")).toMatch(/warn|low/);
  });

  it("when over the soft limit, reassures manual logging works", async () => {
    const over = {
      ...balance,
      tokensUsed: 60000,
      logsLeftEstimate: 0,
      pctRemaining: 0,
      overSoftLimit: true,
    };
    const w = mount(UsageIndicator, { props: { balance: over } });
    await w.find('[data-test="usage-pill"]').trigger("click");
    expect(w.find('[data-test="usage-card"]').text()).toMatch(/manual|still log/i);
  });
});
