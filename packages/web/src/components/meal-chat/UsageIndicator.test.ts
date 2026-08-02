import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import UsageIndicator from "./UsageIndicator.vue";

const balance = {
  tokensUsed: 10000,
  callsToday: 5,
  softLimit: 50000,
  avgTokensPerLog: 2000,
  logsLeftEstimate: 20,
  pctRemaining: 80,
  overSoftLimit: false,
  overHardCap: false,
  resetsAt: "4am",
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

  it("renders nothing when there is no soft limit", () => {
    const w = mount(UsageIndicator, {
      props: {
        balance: { ...balance, softLimit: null, logsLeftEstimate: null, pctRemaining: null },
      },
    });
    expect(w.find('[data-test="usage-pill"]').exists()).toBe(false);
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
