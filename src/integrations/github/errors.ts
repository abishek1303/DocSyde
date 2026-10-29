export type SourceReadErrorCode =
  | "invalid-input"
  | "missing-credentials"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "timeout"
  | "upstream"
  | "unsupported-comparison"
  | "incomplete-evidence";

export class SourceReadError extends Error {
  constructor(
    public readonly code: SourceReadErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SourceReadError";
  }
}
