export type CalendarMode = "workouts" | "intake";

export const CALENDAR_MODE_KEY = "almanac.calendar.mode";

/** Last-used calendar mode; anything unexpected degrades to "workouts". */
export function loadCalendarMode(): CalendarMode {
  return localStorage.getItem(CALENDAR_MODE_KEY) === "intake" ? "intake" : "workouts";
}

export function saveCalendarMode(mode: CalendarMode): void {
  localStorage.setItem(CALENDAR_MODE_KEY, mode);
}
