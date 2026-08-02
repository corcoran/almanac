/**
 * Relative-date formatting for "last session" chevrons and similar
 * "how long ago" displays. Falls back to absolute (short month + day)
 * once the gap exceeds 13 days — matching the spec's stim-state thinking
 * (in_window is 7d, fading 7-14d, detrained 14d+); past detrained,
 * "22 days ago" is less useful than "May 5."
 */

/**
 * Format `iso` as a relative date relative to `now`.
 * @param iso  ISO timestamp string of the past event.
 * @param now  The reference "current time" (defaults to new Date()). Passed
 *             explicitly so tests can pin it.
 * @returns "Today", "Yesterday", "N days ago", or e.g. "May 5" for >13 days.
 */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  // Compute calendar-day delta in the local timezone. The date math is done
  // by zeroing the hours of both dates so DST or evening-session timestamps
  // don't round inconsistently.
  const past = new Date(iso);
  const pastDay = new Date(past.getFullYear(), past.getMonth(), past.getDate());
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msPerDay = 86_400_000;
  const days = Math.round((nowDay.getTime() - pastDay.getTime()) / msPerDay);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days >= 2 && days <= 13) return `${days} days ago`;
  // 14+ days → fall back to absolute. Include year if not current year.
  const opts: Intl.DateTimeFormatOptions =
    past.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return new Intl.DateTimeFormat(undefined, opts).format(past);
}

/**
 * Format `iso` as a long absolute date+time for tooltip use.
 * "May 19, 2026 at 5:42 PM" (locale-aware).
 */
export function formatAbsoluteDateTime(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${date} at ${time}`;
}
