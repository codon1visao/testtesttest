import express, { type Router } from "express";
import type { HealthProbe } from "../../ports/health-probe.js";

export interface HealthProbes {
  mysql: HealthProbe;
  redis: HealthProbe;
}

export interface HealthOptions {
  /** A probe that has not answered by then counts as down. */
  timeoutMs?: number;
}

const DEFAULT_PROBE_TIMEOUT_MS = 1_500;

async function isUp(probe: HealthProbe, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
  });
  try {
    return await Promise.race([probe.isUp().catch(() => false), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** MySQL is required (503 when down); Redis is optional because reads fall back to MySQL. */
export function healthRoutes(
  probes: HealthProbes,
  { timeoutMs = DEFAULT_PROBE_TIMEOUT_MS }: HealthOptions = {},
): Router {
  const router = express.Router();
  router.get("/health", async (_req, res) => {
    const [mysql, redis] = await Promise.all([
      isUp(probes.mysql, timeoutMs),
      isUp(probes.redis, timeoutMs),
    ]);
    res
      .set("Cache-Control", "no-store")
      .status(mysql ? 200 : 503)
      .json({ mysql: mysql ? "up" : "down", redis: redis ? "up" : "down" });
  });
  return router;
}
