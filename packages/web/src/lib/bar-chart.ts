/**
 * Pure geometry for the sleep histogram (used by SleepBlock).
 *
 * The histogram represents a fixed run of calendar days (passed as
 * `windowDates`), one bar per day. Days with a logged night render a real
 * bar; days without render a "ghost" slot (hours: null, height 0) so gaps in
 * logging stay visible and a multi-day-old night doesn't sit flush against
 * the most recent one.
 *
 * The component owns the SVG/CSS rendering; this helper only returns the
 * shape data (bar height percents + the 8h reference line position) so the
 * math is unit-testable in isolation.
 */

const SLEEP_TARGET_HOURS = 8;

export type SleepNight = { slept_on: string; hours: number };

export type SleepBarGeometryDims = { width: number; height: number; gap: number };

export type SleepBar =
  | {
      slept_on: string;
      logged: true;
      /** Hours slept. */
      hours: number;
      /** Height as percent of chart height (0-100). */
      heightPct: number;
      /** True if the logged night is under the 8h target. */
      isShort: boolean;
    }
  | {
      slept_on: string;
      logged: false;
      /** Null for an unlogged (ghost) day. */
      hours: null;
      /** Ghost slots have zero height. */
      heightPct: 0;
      /** Ghosts are never short. */
      isShort: false;
    };

export type SleepBarGeometry = {
  bars: SleepBar[];
  /** Y position of the 8h reference line, as % from the bottom (0-100). */
  referenceLinePct: number;
};

/**
 * Compute the geometry of the sleep histogram over `windowDates` (ordered
 * oldest-left … newest-right YYYY-MM-DD). Each window date becomes one bar;
 * logged nights are matched onto their date, unmatched dates become ghosts.
 *
 * Bars scale to `max(SLEEP_TARGET_HOURS, observed_max)` over the LOGGED
 * nights only, so the 8h reference line is always visible. With no logged
 * nights, scale falls back to the 8h target (reference line at the top).
 *
 * `dims` is accepted for forward-compatibility (the component may want
 * pixel-sized output later) but the implementation returns shape-relative
 * percents.
 */
export function sleepBarGeometry(
  nights: SleepNight[],
  windowDates: string[],
  _dims: SleepBarGeometryDims,
): SleepBarGeometry {
  const byDate = new Map(nights.map((n) => [n.slept_on, n]));

  const observedMax = nights.length > 0 ? Math.max(...nights.map((n) => n.hours)) : 0;
  const scaleMax = Math.max(SLEEP_TARGET_HOURS, observedMax);
  const referenceLinePct = (SLEEP_TARGET_HOURS / scaleMax) * 100;

  const bars: SleepBar[] = windowDates.map((date) => {
    const night = byDate.get(date);
    if (!night) {
      return {
        slept_on: date,
        hours: null,
        logged: false,
        heightPct: 0,
        isShort: false,
      };
    }
    return {
      slept_on: date,
      hours: night.hours,
      logged: true,
      heightPct: (night.hours / scaleMax) * 100,
      isShort: night.hours < SLEEP_TARGET_HOURS,
    };
  });

  return { bars, referenceLinePct };
}
