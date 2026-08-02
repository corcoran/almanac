/** One render-ready calendar grid cell (no per-mode data attached). */
export type CalendarCell = {
  date: string; // YYYY-MM-DD
  dayNumber: number;
  isInMonth: boolean;
  isToday: boolean;
};

/**
 * The 42-cell (6 weeks × 7 cols) month walk: first cell is the Sunday
 * on-or-before the month's first day. Date math runs at UTC noon to avoid
 * DST surprises — all dates in and out are pre-resolved YYYY-MM-DD strings.
 *
 * NOTE: this deliberately mirrors CalendarGrid.vue's `cells` computed rather
 * than being extracted from it — changes to the existing workout calendar
 * are header-only by spec decision (see the intake-calendar design doc).
 */
export function useCalendarCells(month: string, today: string): CalendarCell[] {
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));

  const firstOfMonth = new Date(Date.UTC(year, monthNum - 1, 1, 12, 0, 0));
  const firstCell = new Date(firstOfMonth);
  firstCell.setUTCDate(firstCell.getUTCDate() - firstCell.getUTCDay());

  const out: CalendarCell[] = [];
  const cursor = new Date(firstCell);
  for (let i = 0; i < 42; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    out.push({
      date: iso,
      dayNumber: cursor.getUTCDate(),
      isInMonth: iso.startsWith(`${month}-`),
      isToday: iso === today,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
