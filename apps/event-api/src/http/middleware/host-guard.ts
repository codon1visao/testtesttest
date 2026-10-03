import type { RequestHandler } from "express";
import { AppError } from "../../shared/app-error.js";

/** Rejects requests whose Host is not a configured name (DNS-rebinding defence, S1). Ports are ignored. */
export function hostGuard(allowedHosts: readonly string[]): RequestHandler {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  return (req, _res, next) => {
    const hostname = req.hostname as string | undefined;
    if (hostname === undefined || !allowed.has(hostname.toLowerCase())) {
      next(new AppError("ORIGIN_REJECTED", "This host name is not allowed to use the event API."));
      return;
    }
    next();
  };
}
