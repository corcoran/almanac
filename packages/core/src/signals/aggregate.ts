/**
 * A windowed aggregate. Always present (never null); zero-data is represented
 * by `days_with_data: 0`, not by a null wrapper. Lets callers tell "no data"
 * from "summed to zero" and lets two aggregators expose different denominators
 * without silently disagreeing about the same name.
 */
export type Aggregate = {
  value: number;
  window_days: number;
  days_with_data: number;
};

export function makeAggregate(
  value: number,
  window_days: number,
  days_with_data: number,
  opts: { round?: boolean } = {},
): Aggregate {
  const round = opts.round ?? true;
  return {
    value: round ? Math.round(value) : value,
    window_days,
    days_with_data,
  };
}
