import { randomUUID } from "node:crypto";
import type { RequestHandler, Response } from "express";
import type { Logger } from "../../shared/logger.js";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;
const requestLoggers = new WeakMap<Response, Logger>();

/** Assigns a request ID (echoed as X-Request-Id), a child logger, and logs one line per request. */
export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get("x-request-id");
    const requestId =
      incoming !== undefined && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    const log = logger.child({ requestId });
    const startedAt = performance.now();
    requestLoggers.set(res, log);
    res.setHeader("X-Request-Id", requestId);
    res.on("finish", () => {
      log.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        },
        "request completed",
      );
    });
    next();
  };
}

export function requestLogger(res: Response, fallback: Logger): Logger {
  return requestLoggers.get(res) ?? fallback;
}
