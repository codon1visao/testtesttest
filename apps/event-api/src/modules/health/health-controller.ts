import express, { type Router } from "express";
import type { HealthProbe } from "../../ports/health-probe.js";

export interface HealthProbes {
  mysql: HealthProbe;
  redis: HealthProbe;
}

const isUp = (probe: HealthProbe) => probe.isUp().catch(() => false);

/** MySQL is required (503 when down); Redis is optional because reads fall back to MySQL. */
export function healthRoutes(probes: HealthProbes): Router {
  const router = express.Router();
  router.get("/health", async (_req, res) => {
    const [mysql, redis] = await Promise.all([isUp(probes.mysql), isUp(probes.redis)]);
    res
      .set("Cache-Control", "no-store")
      .status(mysql ? 200 : 503)
      .json({ mysql: mysql ? "up" : "down", redis: redis ? "up" : "down" });
  });
  return router;
}
