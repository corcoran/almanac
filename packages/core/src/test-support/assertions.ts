import type { Mock } from "vitest";

/**
 * Shared test-only assertion helpers. These turn the `T | undefined` that
 * `noUncheckedIndexedAccess` produces into either a narrowed value or a thrown
 * error with context — so tests express their non-null invariants at the call
 * site instead of reaching for `!`.
 */

export function defined<T>(value: T | null | undefined, context: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected a defined value: ${context}`);
  }
  return value;
}

export function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) {
    throw new Error(`Expected an element at index ${index} (length ${arr.length})`);
  }
  return value;
}

// Returns the argument tuple of the nth recorded call, asserting it happened.
export function nthCall<A extends unknown[]>(mock: Mock<(...args: A) => unknown>, n: number): A {
  const call = mock.mock.calls[n];
  if (call === undefined) {
    throw new Error(`Expected mock call ${n}, but only ${mock.mock.calls.length} call(s) recorded`);
  }
  return call;
}
