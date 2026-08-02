import { at } from "@almanac/core/test-support";
import { describe, expect, it } from "vitest";
import { useCalendarCells } from "./useCalendarCells.js";

describe("useCalendarCells", () => {
  it("returns exactly 42 cells starting the Sunday on-or-before the 1st", () => {
    // June 1 2026 is a Monday — the grid starts Sunday May 31.
    const cells = useCalendarCells("2026-06", "2026-06-10");
    expect(cells).toHaveLength(42);
    expect(at(cells, 0).date).toBe("2026-05-31");
    expect(at(cells, 41).date).toBe("2026-07-11");
  });

  it("flags in-month cells and counts the month's days", () => {
    const cells = useCalendarCells("2026-06", "2026-06-10");
    const inMonth = cells.filter((c) => c.isInMonth);
    expect(inMonth).toHaveLength(30);
    expect(at(inMonth, 0).date).toBe("2026-06-01");
    expect(at(inMonth, 29).date).toBe("2026-06-30");
    expect(at(cells, 0).isInMonth).toBe(false); // May 31 spill
  });

  it("flags isToday on exactly the today cell", () => {
    const cells = useCalendarCells("2026-06", "2026-06-10");
    const todays = cells.filter((c) => c.isToday);
    expect(todays).toHaveLength(1);
    expect(at(todays, 0).date).toBe("2026-06-10");
  });

  it("flags no cell as today when today is outside the rendered window", () => {
    const cells = useCalendarCells("2026-01", "2026-06-10");
    expect(cells.some((c) => c.isToday)).toBe(false);
  });

  it("walks across a year boundary (January grid starts in December)", () => {
    // Jan 1 2026 is a Thursday — grid starts Sunday Dec 28 2025.
    const cells = useCalendarCells("2026-01", "2026-06-10");
    expect(at(cells, 0).date).toBe("2025-12-28");
    expect(at(cells, 0).dayNumber).toBe(28);
    expect(at(cells, 41).date).toBe("2026-02-07");
  });

  it("starts on the 1st when the month opens on a Sunday", () => {
    // March 1 2026 is a Sunday — the leading-spill subtraction is a no-op.
    const cells = useCalendarCells("2026-03", "2026-06-10");
    expect(at(cells, 0).date).toBe("2026-03-01");
    expect(at(cells, 41).date).toBe("2026-04-11");
  });

  it("carries the UTC day-of-month as dayNumber, including spill cells", () => {
    const cells = useCalendarCells("2026-06", "2026-06-10");
    const first = cells.find((c) => c.date === "2026-06-01");
    expect(first?.dayNumber).toBe(1);
    // Leading spill (May 31) and trailing spill (July 11) keep their own
    // day-of-month, not the displayed month's.
    expect(at(cells, 0).dayNumber).toBe(31);
    expect(at(cells, 41).dayNumber).toBe(11);
  });
});
