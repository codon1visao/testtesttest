import type { RequestHandler } from "express";
import { AppError } from "../../shared/app-error.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Fail closed: anything that is not a known-safe method (including unusual verbs) is a mutation. */
export function isMutation(method: string): boolean {
  return !SAFE_METHODS.has(method);
}

/**
 * Cross-origin mutations are rejected (S1). Browsers always send Origin on mutations, so a
 * request without one comes from a non-browser client (the feedback script, curl); the
 * loopback bind is the boundary for those.
 */
export function originGuard(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (!isMutation(req.method)) {
      next();
      return;
    }
    const origin = req.get("origin");
    const crossSite = req.get("sec-fetch-site") === "cross-site";
    if (crossSite || (origin !== undefined && !allowed.has(origin))) {
      next(new AppError("ORIGIN_REJECTED", "This page is not allowed to change event data."));
      return;
    }
    next();
  };
}
