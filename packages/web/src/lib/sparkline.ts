/**
 * Pure SVG path generator for a polyline sparkline (used by WeightBlock).
 *
 * Caller passes a series of `{ value }` points and pixel dimensions; we
 * return the string suitable for `<polyline points="...">`. No DOM, no
 * Vue — just math.
 */

export type SparklinePoint = { value: number };
export type SparklineDimensions = { width: number; height: number };

/**
 * Generate an SVG `points` string for a polyline sparkline. X values are
 * linearly distributed across `width`; Y values are inverted (lower
 * series value → higher Y, which is the bottom of the SVG).
 *
 * Edge cases:
 *  - Empty input → empty string (caller should not render the polyline).
 *  - Single-point input → one "x,y" pair at the chart's center.
 *  - Flat input (all values equal) → all points at vertical center.
 *
 * Returns a string suitable for `<polyline points="...">`.
 */
export function sparklinePoints(series: SparklinePoint[], dims: SparklineDimensions): string {
  if (series.length === 0) return "";
  if (series.length === 1) {
    return `${dims.width / 2},${dims.height / 2}`;
  }

  const values = series.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const xStep = dims.width / (series.length - 1);

  return series
    .map((p, i) => {
      const x = i * xStep;
      const y =
        range === 0 ? dims.height / 2 : dims.height - ((p.value - min) / range) * dims.height;
      return `${x},${y}`;
    })
    .join(" ");
}
