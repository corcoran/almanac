/**
 * Map sleep hours to a color from red → amber → green. The gradient
 * follows the user's intuitive "is this enough sleep?" check:
 * 0h is alarming red, 6h is concerning amber, 8h is healthy green,
 * and 8+h stays green (capped, no over-saturation).
 */
const SATURATION = 55; // %
const LIGHTNESS = 55; // %

export function sleepColor(hours: number): string {
  // Two-segment linear hue:
  //   0-6h:  hue goes 0 (red) → 45 (amber)
  //   6-8h:  hue goes 45 (amber) → 135 (green)
  //   8+h:   hue stays at 135 (green)
  const clamped = Math.max(0, hours);
  let hue: number;
  if (clamped <= 6) {
    hue = (clamped / 6) * 45;
  } else if (clamped <= 8) {
    hue = 45 + ((clamped - 6) / 2) * (135 - 45);
  } else {
    hue = 135;
  }
  return `hsl(${hue.toFixed(1)}, ${SATURATION}%, ${LIGHTNESS}%)`;
}
