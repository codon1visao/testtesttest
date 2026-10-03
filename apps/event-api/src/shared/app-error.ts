import type { HttpErrorCode } from "@event-desk/contracts";

export interface AppErrorOptions {
  field?: string;
  retryAfterMs?: number;
  cause?: unknown;
}

/** The only error type the application throws on purpose; the HTTP layer maps `code` to a status. */
export class AppError extends Error {
  readonly code: HttpErrorCode;
  readonly field: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(code: HttpErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.field = options.field;
    this.retryAfterMs = options.retryAfterMs;
  }
}
