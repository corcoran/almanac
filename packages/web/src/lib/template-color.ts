/**
 * Map a template name to a deterministic palette color. Same name always
 * yields the same color; the hash spreads names across 12 hand-picked hues
 * chosen to read well on the dark theme.
 *
 * The first three entries (amber/blue/salmon) match the mock's
 * `--t-push / --t-pull / --t-legs` swatches so any template literally named
 * PUSH/PULL/LEGS (unhashed) doesn't drift far visually — but assignment is
 * still purely hash-driven, so swap order doesn't matter.
 *
 * Case-sensitive by design: two templates that differ only by case are
 * treated as distinct entries by the user, and the color follows.
 *
 * Palette size = 12 (up from 8) and the hash multiplier is 33 (up from 31).
 * Both numbers were chosen together: the original 31-multiplier produces
 * djb2-style hashes whose pairwise differences for the common v1 names
 * (PULL A / LEGS A, PULL B / LEGS B, ...) are multiples of 8 *and* 12, so
 * widening the palette alone would not have separated them. Multiplier 33
 * with size 12 disambiguates all the v1-critical name pairs — see
 * template-color.test.ts for the regression pins.
 */
// `as const` makes this a non-empty tuple, so PALETTE[0] is `string` (not
// `string | undefined`) and serves as the type-safe fallback below.
const PALETTE = [
  "#f1c453", // amber
  "#6ea8ff", // blue
  "#e26b6b", // salmon
  "#4cc38a", // green
  "#d8b4fe", // purple
  "#6ee7a8", // mint
  "#f5c25a", // gold
  "#f08a8a", // pink
  "#7ed4d6", // teal
  "#c9b380", // sand
  "#b48cf2", // lavender
  "#e89aae", // rose
] as const;

/** Stable string hash → non-negative integer. Deterministic across runs. */
function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function templateColor(name: string): string {
  // `?? PALETTE[0]` is the type-safe fallback: modulo PALETTE.length always
  // indexes a valid entry, but noUncheckedIndexedAccess can't prove that, and
  // PALETTE[0] is `string` (not `string | undefined`) since PALETTE is a
  // non-empty tuple.
  return PALETTE[stableHash(name) % PALETTE.length] ?? PALETTE[0];
}
