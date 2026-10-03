import { type ApiErrorBody, ERROR_HTTP_STATUS } from "@event-desk/contracts";
import type { ErrorRequestHandler } from "express";
import { AppError } from "../../shared/app-error.js";
import type { Logger } from "../../shared/logger.js";
import { requestLogger } from "./request-context.js";

const BODY_PARSER_MESSAGES: Record<string, string> = {
  "entity.parse.failed": "The request body is not valid JSON.",
  "entity.too.large": "The request body is too large.",
  "encoding.unsupported": "The request body encoding is not supported.",
  "charset.unsupported": "The request body charset is not supported.",
  "request.aborted": "The request was aborted.",
};

function bodyParserMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("type" in error)) return undefined;
  return typeof error.type === "string" ? BODY_PARSER_MESSAGES[error.type] : undefined;
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const parserMessage = bodyParserMessage(error);
  if (parserMessage !== undefined)
    return new AppError("VALIDATION_FAILED", parserMessage, { cause: error });
  return new AppError("INTERNAL", "Something went wrong. Try again.", { cause: error });
}

export function errorBody(error: AppError): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.field === undefined ? {} : { field: error.field }),
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    },
  };
}

/** The single place where errors become HTTP responses. 5xx bodies never carry internals. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const appError = toAppError(error);
    const status = ERROR_HTTP_STATUS[appError.code];
    const log = requestLogger(res, logger);
    if (status >= 500) log.error({ err: error, code: appError.code }, "request failed");
    else log.info({ code: appError.code }, "request rejected");
    if (appError.retryAfterMs !== undefined) {
      res.setHeader("Retry-After", String(Math.ceil(appError.retryAfterMs / 1000)));
    }
    res.status(status).json(errorBody(appError));
  };
}
