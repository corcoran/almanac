import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PastDayBanner from "./PastDayBanner.vue";

describe("PastDayBanner", () => {
  const base = { selectedDate: "2026-06-12", today: "2026-06-15" };

  it("renders the selected date and a relative-time hint", () => {
    const wrapper = mount(PastDayBanner, { props: base });
    const text = wrapper.find('[data-test="past-day-banner"]').text();
    expect(text).toMatch(/viewing/i);
    expect(text).toMatch(/3 days ago/i);
  });

  it("emits prev / next / go-today from the buttons", async () => {
    const wrapper = mount(PastDayBanner, { props: base });
    await wrapper.find('[data-test="past-day-prev"]').trigger("click");
    await wrapper.find('[data-test="past-day-next"]').trigger("click");
    await wrapper.find('[data-test="past-day-today"]').trigger("click");
    expect(wrapper.emitted("prev")).toHaveLength(1);
    expect(wrapper.emitted("next")).toHaveLength(1);
    expect(wrapper.emitted("go-today")).toHaveLength(1);
  });

  it("disables the next-day button when selectedDate is today-or-later", () => {
    const wrapper = mount(PastDayBanner, {
      props: { selectedDate: "2026-06-15", today: "2026-06-15" },
    });
    expect(
      (wrapper.find('[data-test="past-day-next"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("enables the next-day button on a past day", () => {
    const wrapper = mount(PastDayBanner, { props: base });
    expect(
      (wrapper.find('[data-test="past-day-next"]').element as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
