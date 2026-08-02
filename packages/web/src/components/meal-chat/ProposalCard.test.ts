import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ProposalCard from "./ProposalCard.vue";

const estimated = {
  source: "estimated" as const,
  name: "Chicken burrito",
  kcal: 640,
  protein_g: 35,
  carb_g: 70,
  fat_g: 22,
  suggest_store: false,
};

const stored = {
  source: "stored" as const,
  stored_meal_id: 7,
  name: "Protein Oatmeal",
};

describe("ProposalCard — estimated", () => {
  it("pre-fills macro inputs with the estimate", () => {
    const wrapper = mount(ProposalCard, {
      props: { meal: estimated, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    expect((wrapper.find('[data-test="card-kcal"]').element as HTMLInputElement).value).toBe("640");
    expect((wrapper.find('[data-test="card-protein"]').element as HTMLInputElement).value).toBe(
      "35",
    );
  });

  it("defaults the time field to now when eaten_at is absent (viewing today)", () => {
    const wrapper = mount(ProposalCard, {
      props: { meal: estimated, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    const time = (wrapper.find('[data-test="card-time"]').element as HTMLInputElement).value;
    expect(time).toMatch(/^\d{2}:\d{2}$/); // current local HH:MM
    expect(wrapper.find('[data-test="card-time-hint"]').text()).toMatch(/now/i);
  });

  it("uses the captured time and a 'from your message' hint when eaten_at is present", () => {
    const wrapper = mount(ProposalCard, {
      props: {
        meal: { ...estimated, eaten_at: "2026-06-22T13:00:00" },
        viewedDate: "2026-06-22",
        realToday: "2026-06-22",
      },
    });
    expect((wrapper.find('[data-test="card-time"]').element as HTMLInputElement).value).toBe(
      "13:00",
    );
    expect(wrapper.find('[data-test="card-time-hint"]').text()).toMatch(/message/i);
  });

  it("falls back to a conversation-established time (not now) when eaten_at is absent", () => {
    // The follow-up re-estimate omitted eaten_at, but the chat already
    // established 12:30 earlier — the card must inherit it, not jump to now.
    const wrapper = mount(ProposalCard, {
      props: {
        meal: estimated, // no eaten_at
        viewedDate: "2026-06-22",
        realToday: "2026-06-22",
        fallbackTime: "12:30",
      },
    });
    expect((wrapper.find('[data-test="card-time"]').element as HTMLInputElement).value).toBe(
      "12:30",
    );
    expect(wrapper.find('[data-test="card-time-hint"]').text()).toMatch(/earlier/i);
  });

  it("prefers the meal's own captured time over the fallback", () => {
    const wrapper = mount(ProposalCard, {
      props: {
        meal: { ...estimated, eaten_at: "2026-06-22T13:00:00" },
        viewedDate: "2026-06-22",
        realToday: "2026-06-22",
        fallbackTime: "08:00",
      },
    });
    expect((wrapper.find('[data-test="card-time"]').element as HTMLInputElement).value).toBe(
      "13:00",
    );
    expect(wrapper.find('[data-test="card-time-hint"]').text()).toMatch(/message/i);
  });

  it("emits log-estimated with composed naive-local eaten_at (no Z) and edited values", async () => {
    const wrapper = mount(ProposalCard, {
      props: { meal: estimated, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    await wrapper.find('[data-test="card-time"]').setValue("13:30");
    await wrapper.find('[data-test="card-kcal"]').setValue("700");
    await wrapper.find('[data-test="card-log"]').trigger("click");

    const events = wrapper.emitted("log-estimated");
    expect(events).toBeTruthy();
    const [body, save] = events?.[0] as [Record<string, unknown>, boolean];
    expect(body.kcal).toBe(700);
    expect(body.name).toBe("Chicken burrito");
    expect(body.eaten_at).toBe("2026-06-22T13:30:00");
    expect(body.eaten_at).not.toContain("Z");
    expect(save).toBe(false);
  });

  it("logs on the meal's CAPTURED date, not viewedDate (day-boundary regression)", async () => {
    // The model captured "for lunch" as 2026-06-22T12:30. By the time the user
    // clarifies/logs it's just past local midnight, so viewedDate has rolled to
    // 2026-06-23. The logged eaten_at must keep the captured DATE (06-22), not
    // re-stamp the time onto the new viewed day.
    const wrapper = mount(ProposalCard, {
      props: {
        meal: { ...estimated, eaten_at: "2026-06-22T12:30:00" },
        viewedDate: "2026-06-23",
        realToday: "2026-06-23",
      },
    });
    await wrapper.find('[data-test="card-log"]').trigger("click");
    const [body] = (wrapper.emitted("log-estimated")?.[0] ?? []) as [Record<string, unknown>];
    expect(body.eaten_at).toBe("2026-06-22T12:30:00"); // captured date kept, not 06-23
  });

  it("composes a user-edited time onto the captured date too", async () => {
    const wrapper = mount(ProposalCard, {
      props: {
        meal: { ...estimated, eaten_at: "2026-06-22T12:30:00" },
        viewedDate: "2026-06-23",
        realToday: "2026-06-23",
      },
    });
    await wrapper.find('[data-test="card-time"]').setValue("13:45");
    await wrapper.find('[data-test="card-log"]').trigger("click");
    const [body] = (wrapper.emitted("log-estimated")?.[0] ?? []) as [Record<string, unknown>];
    expect(body.eaten_at).toBe("2026-06-22T13:45:00"); // edited time, captured date
  });

  it("falls back to viewedDate when the meal carries no captured date", async () => {
    // No eaten_at on the meal → time field defaults; compose on viewedDate.
    const wrapper = mount(ProposalCard, {
      props: { meal: estimated, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    await wrapper.find('[data-test="card-time"]').setValue("09:15");
    await wrapper.find('[data-test="card-log"]').trigger("click");
    const [body] = (wrapper.emitted("log-estimated")?.[0] ?? []) as [Record<string, unknown>];
    expect(body.eaten_at).toBe("2026-06-22T09:15:00");
  });

  it("inherits the conversation's established DATE (not just time) on a re-estimate", async () => {
    // A re-estimate with no own date inherits both fallbackTime + fallbackDate
    // from an earlier turn. Even though viewedDate has rolled to 06-23, the meal
    // logs on the established 06-22.
    const wrapper = mount(ProposalCard, {
      props: {
        meal: estimated, // no eaten_at
        viewedDate: "2026-06-23",
        realToday: "2026-06-23",
        fallbackTime: "12:30",
        fallbackDate: "2026-06-22",
      },
    });
    await wrapper.find('[data-test="card-log"]').trigger("click");
    const [body] = (wrapper.emitted("log-estimated")?.[0] ?? []) as [Record<string, unknown>];
    expect(body.eaten_at).toBe("2026-06-22T12:30:00");
  });

  it("pre-checks Save when suggest_store is true and passes it through on log", async () => {
    const wrapper = mount(ProposalCard, {
      props: {
        meal: { ...estimated, suggest_store: true },
        viewedDate: "2026-06-22",
        realToday: "2026-06-22",
      },
    });
    expect((wrapper.find('[data-test="card-save"]').element as HTMLInputElement).checked).toBe(
      true,
    );
    await wrapper.find('[data-test="card-log"]').trigger("click");
    const [, save] = (wrapper.emitted("log-estimated")?.[0] ?? []) as [unknown, boolean];
    expect(save).toBe(true);
  });

  it("disables Log and does not emit when kcal is cleared", async () => {
    const wrapper = mount(ProposalCard, {
      props: { meal: estimated, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    await wrapper.find('[data-test="card-kcal"]').setValue("");
    const logBtn = wrapper.find('[data-test="card-log"]');
    expect((logBtn.element as HTMLButtonElement).disabled).toBe(true);
    await logBtn.trigger("click");
    expect(wrapper.emitted("log-estimated")).toBeFalsy();
  });

  it("emits dismiss when Dismiss is clicked", async () => {
    const wrapper = mount(ProposalCard, {
      props: { meal: estimated, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    await wrapper.find('[data-test="card-dismiss"]').trigger("click");
    expect(wrapper.emitted("dismiss")).toBeTruthy();
  });
});

describe("ProposalCard — stored", () => {
  it("shows the matched name read-only, no macro inputs", () => {
    const wrapper = mount(ProposalCard, {
      props: { meal: stored, viewedDate: "2026-06-22", realToday: "2026-06-22" },
    });
    expect(wrapper.text()).toMatch(/Protein Oatmeal/);
    expect(wrapper.find('[data-test="card-kcal"]').exists()).toBe(false);
  });

  it("shows an editable time field on a stored card, seeded from its eaten_at", () => {
    const wrapper = mount(ProposalCard, {
      props: {
        meal: { ...stored, eaten_at: "2026-06-22T12:30:00" },
        viewedDate: "2026-06-22",
        realToday: "2026-06-22",
      },
    });
    expect((wrapper.find('[data-test="card-time"]').element as HTMLInputElement).value).toBe(
      "12:30",
    );
    expect(wrapper.find('[data-test="card-time-hint"]').text()).toMatch(/message/i);
  });

  it("stored card inherits the conversation fallback time when it has no own eaten_at", () => {
    const wrapper = mount(ProposalCard, {
      props: {
        meal: stored,
        viewedDate: "2026-06-22",
        realToday: "2026-06-22",
        fallbackTime: "12:30",
      },
    });
    expect((wrapper.find('[data-test="card-time"]').element as HTMLInputElement).value).toBe(
      "12:30",
    );
    expect(wrapper.find('[data-test="card-time-hint"]').text()).toMatch(/earlier/i);
  });

  it("emits log-stored with the id AND a composed naive-local eaten_at (no Z)", async () => {
    const wrapper = mount(ProposalCard, {
      props: {
        meal: stored,
        viewedDate: "2026-06-22",
        realToday: "2026-06-22",
        fallbackTime: "12:30",
      },
    });
    await wrapper.find('[data-test="card-log"]').trigger("click");
    const ev = wrapper.emitted("log-stored");
    expect(ev).toBeTruthy();
    const [id, eatenAt] = ev?.[0] as [number, string];
    expect(id).toBe(7); // the `stored` fixture's stored_meal_id
    expect(eatenAt).toBe("2026-06-22T12:30:00");
    expect(eatenAt).not.toContain("Z");
  });
});
