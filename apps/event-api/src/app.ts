import express, { type Express, type Router } from "express";
import { errorHandler } from "./http/middleware/error-handler.js";
import { hostGuard } from "./http/middleware/host-guard.js";
import { notFound } from "./http/middleware/not-found.js";
import { originGuard } from "./http/middleware/origin-guard.js";
import { requestContext } from "./http/middleware/request-context.js";
import { requireJson } from "./http/middleware/require-json.js";
import type { Logger } from "./shared/logger.js";

export interface HttpPolicy {
  allowedOrigins: readonly string[];
  allowedHosts: readonly string[];
}

export interface AppOptions {
  logger: Logger;
  policy: HttpPolicy;
  routes: readonly Router[];
}

/** Builds the Express app from routers; the composition root decides which routers exist. */
export function createApp({ logger, policy, routes }: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestContext(logger));
  app.use(hostGuard(policy.allowedHosts));
  app.use(originGuard(policy.allowedOrigins));
  app.use(requireJson);
  app.use(express.json({ limit: "64kb" }));
  const api = express.Router();
  for (const router of routes) api.use(router);
  app.use("/api", api);
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
