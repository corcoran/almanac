export type ApiError =
  | { kind: "network"; cause: unknown }
  | { kind: "http"; status: number; body: string }
  | { kind: "parse"; issues: unknown };

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    ["network", "http", "parse"].includes((value as { kind: string }).kind)
  );
}
