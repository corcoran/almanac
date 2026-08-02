/**
 * Tiny array accessors that keep `noUncheckedIndexedAccess` honest.
 *
 * `first`/`last` return `T | undefined` so callers must handle empty — use them
 * with a `??` fallback. `requireNonEmpty` is for the case where a non-empty
 * invariant is established earlier (a `.length` guard, by-construction config):
 * it narrows the type to a non-empty tuple so subsequent `arr[0]` / `arr.at(-1)`
 * accesses are provably defined, turning a silent `undefined` into a thrown
 * error if the invariant is ever violated.
 */

/** A readonly array proven to hold at least one element. */
export type NonEmptyArray<T> = readonly [T, ...T[]];

export function first<T>(arr: NonEmptyArray<T>): T;
export function first<T>(arr: readonly T[]): T | undefined;
export function first<T>(arr: readonly T[]): T | undefined {
  return arr[0];
}

export function last<T>(arr: NonEmptyArray<T>): T;
export function last<T>(arr: readonly T[]): T | undefined;
export function last<T>(arr: readonly T[]): T | undefined {
  // `length - 1` is a computed index, so it stays `T | undefined` to the
  // compiler even on a NonEmptyArray; the overloads above restore the
  // narrower return type for the proven-non-empty case.
  return arr[arr.length - 1];
}

export function requireNonEmpty<T>(arr: readonly T[], context: string): NonEmptyArray<T> {
  if (arr.length === 0) {
    throw new Error(`Expected a non-empty array: ${context}`);
  }
  return arr as NonEmptyArray<T>;
}

/**
 * Median of a non-empty list of numbers. Sorts a copy (does not mutate the
 * input). For an even count, returns the mean of the two central values.
 * Caller must pass a non-empty array.
 */
export function median(xs: readonly [number, ...number[]]): number {
  const [head] = xs;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid];
  const lo = sorted[mid - 1];
  if (sorted.length % 2 === 1) return hi ?? head;
  if (hi === undefined || lo === undefined) return head;
  return (lo + hi) / 2;
}
