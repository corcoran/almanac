import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AlcoholCard from "./AlcoholCard.vue";

function mountCard(props: Record<string, unknown> = {}) {
  return mount(AlcoholCard, {
    props: {
      alcohol: { drinks_count: 2, est_kcal: 300, _key: 1 },
      viewedDate: "2026-08-02",
      realToday: "2026-08-02",
      ...props,
    },
  });
}

describe("AlcoholCard", () => {
  it("renders drinks and kcal, and NO macro (P/C/F) inputs", () => {
    const w = mountCard();
    expect(w.get('[data-test="alc-drinks"]').element).toBeTruthy();
    expect(w.get('[data-test="alc-kcal"]').element).toBeTruthy();
    // The defining difference from a meal card: no protein/carb/fat fields.
    expect(w.find('[data-test="card-protein"]').exists()).toBe(false);
    expect(w.find('[data-test="card-carb"]').exists()).toBe(false);
    expect(w.find('[data-test="card-fat"]').exists()).toBe(false);
  });

  it("emits log-alcohol with drinks_count, est_kcal, started_at on Log", async () => {
    const w = mountCard();
    await w.get('[data-test="alc-log"]').trigger("click");
    const events = w.emitted("log-alcohol");
    expect(events).toBeTruthy();
    const [payload] = events?.[0] as [
      { drinks_count: number; est_kcal: number; started_at: string },
    ];
    expect(payload.drinks_count).toBe(2);
    expect(payload.est_kcal).toBe(300);
    expect(payload.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it("disables Log when kcal is blank", async () => {
    const w = mountCard();
    await w.get('[data-test="alc-kcal"]').setValue("");
    expect(w.get('[data-test="alc-log"]').attributes("disabled")).toBeDefined();
  });

  it("emits dismiss on Dismiss", async () => {
    const w = mountCard();
    await w.get('[data-test="alc-dismiss"]').trigger("click");
    expect(w.emitted("dismiss")).toBeTruthy();
  });

  it("allows a fractional drinks_count (e.g. a half drink)", async () => {
    const w = mountCard({ alcohol: { drinks_count: 1.5, est_kcal: 210, _key: 1 } });
    // 1.5 drinks is valid (schema is .positive(), not .int()), so Log is enabled.
    expect(w.get('[data-test="alc-log"]').attributes("disabled")).toBeUndefined();
    await w.get('[data-test="alc-log"]').trigger("click");
    const [payload] = (w.emitted("log-alcohol")?.[0] ?? []) as [{ drinks_count: number }];
    expect(payload.drinks_count).toBe(1.5);
  });

  it("pins started_at to the session's OWN captured date, not viewedDate", async () => {
    // The model captured the drinks on 2026-08-01 (before the viewed day). The
    // logged started_at must keep that day, not re-stamp onto viewedDate.
    const w = mountCard({
      alcohol: { drinks_count: 2, est_kcal: 300, started_at: "2026-08-01T21:30:00", _key: 1 },
      viewedDate: "2026-08-02",
    });
    await w.get('[data-test="alc-log"]').trigger("click");
    const [payload] = (w.emitted("log-alcohol")?.[0] ?? []) as [{ started_at: string }];
    expect(payload.started_at).toBe("2026-08-01T21:30:00");
  });
});
