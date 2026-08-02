/**
 * Map a weight value to a deterministic HSL color. Same weight value
 * always yields the same color; different values get distinct hues
 * spread across the wheel. Bodyweight (null) returns a neutral muted color.
 *
 * Saturation + lightness are fixed so the whole palette feels cohesive —
 * varied hues but unified tone, won't fight the surrounding dark theme.
 */
const SATURATION = 50; // %
const LIGHTNESS = 65; // %

export function weightColor(weight_kg: number | null): string {
  if (weight_kg === null) {
    // Bodyweight: a neutral muted tone. Picked to read as "different
    // from numbered weights" without being a jarring outlier.
    return "hsl(0, 0%, 70%)";
  }
  // Hash the weight to a hue [0, 360). We multiply by the golden-ratio
  // multiplier (137.508°) to maximize hue distance across consecutive
  // integer/half-step steps, so similar weights (80, 82.5, 85) get
  // noticeably different hues.
  const golden = 137.508;
  const hue = Math.abs((weight_kg * golden) % 360);
  return `hsl(${hue.toFixed(1)}, ${SATURATION}%, ${LIGHTNESS}%)`;
}
