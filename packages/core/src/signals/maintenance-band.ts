export const MAINTENANCE_BAND_PCT = 0.05;

/**
 * Grace band around the strict target for cut/bulk status evaluation.
 * Days that miss the target but stay within ±STATUS_GRACE_PCT of TDEE
 * count as on_track instead of at_risk. The band scales with the user's
 * body (TDEE), not with deficit magnitude, so gentle and aggressive
 * cutters get the same buffer.
 *
 * NOT used for maintenance phases (those use MAINTENANCE_BAND_PCT against
 * target, a tighter and target-relative band).
 */
export const STATUS_GRACE_PCT = 0.1;

export function isWithinMaintenanceBand(intake: number, target: number): boolean {
  return Math.abs(intake - target) <= target * MAINTENANCE_BAND_PCT;
}
