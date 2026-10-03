import type { RequestHandler } from "express";
import { AppError } from "../../shared/app-error.js";

export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Cross-origin mutations are rejected (S1). Browsers always send Origin on mutations, so a
 * request without one comes from a non-browser client (the feedback script, curl); the
 * loopback bind is the boundary for those.
 */
export function originGuard(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (!MUTATING_METHODS.has(req.method)) {
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
