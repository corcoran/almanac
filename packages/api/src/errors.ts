export type ErrorCode =
  | "validation_failed"
  | "not_found"
  | "conflict"
  | "conflict_active_phase"
  | "unknown_exercise"
  | "db_constraint"
  | "unauthorized"
  | "forbidden"
  | "llm_disabled"
  | "usage_limit_exceeded"
  | "internal";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function toErrorBody(err: ApiError) {
  return { error: { code: err.code, message: err.message, details: err.details } };
}
