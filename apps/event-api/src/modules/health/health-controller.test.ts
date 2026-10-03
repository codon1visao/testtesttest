import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import type { HealthProbe } from "../../ports/health-probe.js";
import { createLogger } from "../../shared/logger.js";
import { healthRoutes } from "./health-controller.js";

const probe = (result: boolean | Error): HealthProbe => ({
  isUp: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
});

const appWith = (mysql: HealthProbe, redis: HealthProbe) =>
  createApp({
    logger: createLogger("silent"),
    policy: { allowedOrigins: [], allowedHosts: ["127.0.0.1"] },
    routes: [healthRoutes({ mysql, redis })],
  });

describe("GET /api/health", () => {
  it("reports both stores up", async () => {
    const res = await request(appWith(probe(true), probe(true))).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mysql: "up", redis: "up" });
    expect(res.get("Cache-Control")).toBe("no-store");
  });

  it("stays 200 when only Redis is down: the API still serves from MySQL", async () => {
    const res = await request(appWith(probe(true), probe(new Error("ECONNREFUSED")))).get(
      "/api/health",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mysql: "up", redis: "down" });
  });

  it("answers 503 when MySQL is down", async () => {
    const res = await request(appWith(probe(false), probe(true))).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ mysql: "down", redis: "up" });
  });
});
