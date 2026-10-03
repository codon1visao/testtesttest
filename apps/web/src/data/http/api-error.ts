import { assertNever, type HttpErrorCode } from "@event-desk/contracts";

export type ApiErrorKind = "http" | "network" | "timeout" | "invalid-response";

export interface ApiErrorDetails {
  status?: number;
  code?: HttpErrorCode;
  field?: string;
  retryAfterMs?: number;
  cause?: unknown;
}

/** Every failed API call surfaces as an ApiError; components never see Axios errors. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  readonly code: HttpErrorCode | undefined;
  readonly field: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(kind: ApiErrorKind, message: string, details: ApiErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "ApiError";
    this.kind = kind;
    this.status = details.status;
    this.code = details.code;
    this.field = details.field;
    this.retryAfterMs = details.retryAfterMs;
  }

  /**
   * The request may have reached the server: reconcile with saved state before retrying (F2, F5).
   * An invalid response counts too: the server answered, so a write may have happened even though
   * its reply could not be read.
   */
  get outcomeUnknown(): boolean {
    switch (this.kind) {
      case "network":
      case "timeout":
      case "invalid-response":
        return true;
      case "http":
        return false;
      default:
        return assertNever(this.kind, "API error kind");
    }
  }
}

/** One plain sentence for the coordinator. API messages are authored, user-facing text. */
export function describeApiError(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Try again.";
  switch (error.kind) {
    case "http":
      return error.message;
    case "network":
      return "Could not reach the event API. Check that it is running, then try again.";
    case "timeout":
      return "The event API took too long to answer. Try again.";
    case "invalid-response":
      return "The event API sent an unexpected response. Reload the page; if it persists, the app and API may be out of step.";
    default:
      return assertNever(error.kind, "API error kind");
  }
}
