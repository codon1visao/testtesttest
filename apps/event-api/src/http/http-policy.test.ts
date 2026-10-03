import type { AddressInfo } from "node:net";
import { request as nodeRequest } from "node:http";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../app.js";
import { AppError } from "../shared/app-error.js";
import { createLogger } from "../shared/logger.js";
import { errorCodeOf } from "../testing/http.js";
import { validateBody } from "./validate.js";

function buildApp() {
  const lines: string[] = [];
  const logger = createLogger("info", { write: (chunk: string) => void lines.push(chunk) });
  const routes = express.Router();
  routes.post("/echo", (req, res) => {
    res.json(validateBody(z.strictObject({ name: z.string() }), req.body));
  });
  routes.get("/items/:id", (req, res) => {
    res.json({ id: req.params.id });
  });
  routes.all("/any", (_req, res) => {
    res.json({ ok: true });
  });
  routes.get("/boom", () => {
    throw new Error("database password is hunter2");
  });
  routes.get("/conflict", () => {
    throw new AppError("ATTENDANCE_CONFLICT", "Reload to continue.");
  });
  routes.get("/cooldown", () => {
    throw new AppError("PROVIDER_COOLDOWN", "Wait a moment.", { retryAfterMs: 1500 });
  });
  const app = createApp({
    logger,
    policy: { allowedOrigins: ["http://localhost:5173"], allowedHosts: ["127.0.0.1", "localhost"] },
    routes: [routes],
  });
  return { app, lines };
}

describe("HTTP policy", () => {
  it("accepts a same-origin JSON mutation", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/echo")
      .set("Origin", "http://localhost:5173")
      .send({ name: "Bea" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "Bea" });
  });

  it("accepts a mutation without an Origin header (CLI and scripts)", async () => {
    const { app } = buildApp();
    expect((await request(app).post("/api/echo").send({ name: "Bea" })).status).toBe(200);
  });

  it("rejects cross-origin mutations (S1-09, S1-14)", async () => {
    const { app } = buildApp();
    const evil = await request(app)
      .post("/api/echo")
      .set("Origin", "http://evil.example")
      .send({ name: "x" });
    expect(evil.status).toBe(403);
    expect(errorCodeOf(evil)).toBe("ORIGIN_REJECTED");
    const crossSite = await request(app)
      .post("/api/echo")
      .set("Sec-Fetch-Site", "cross-site")
      .send({ name: "x" });
    expect(errorCodeOf(crossSite)).toBe("ORIGIN_REJECTED");
  });

  it("rejects unknown Host names (DNS rebinding)", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/conflict").set("Host", "attacker.example");
    expect(res.status).toBe(403);
    expect(errorCodeOf(res)).toBe("ORIGIN_REJECTED");
  });

  it("requires JSON for mutations", async () => {
    const { app } = buildApp();
    const res = await request(app).post("/api/echo").type("form").send("name=Bea");
    expect(res.status).toBe(400);
    expect(errorCodeOf(res)).toBe("VALIDATION_FAILED");
  });

  it("answers malformed and oversized JSON with 400, never 500", async () => {
    const { app } = buildApp();
    const malformed = await request(app)
      .post("/api/echo")
      .set("Content-Type", "application/json")
      .send('{"name":');
    expect(malformed.status).toBe(400);
    expect(errorCodeOf(malformed)).toBe("VALIDATION_FAILED");
    const huge = await request(app)
      .post("/api/echo")
      .send({ name: "x".repeat(70_000) });
    expect(huge.status).toBe(400);
    expect(errorCodeOf(huge)).toBe("VALIDATION_FAILED");
  });

  it("rejects unknown fields through the strict schema", async () => {
    const { app } = buildApp();
    const res = await request(app).post("/api/echo").send({ name: "Bea", admin: true });
    expect(res.status).toBe(400);
    expect(errorCodeOf(res)).toBe("VALIDATION_FAILED");
  });

  it("maps AppError codes through ERROR_HTTP_STATUS and sets Retry-After", async () => {
    const { app } = buildApp();
    expect((await request(app).get("/api/conflict")).status).toBe(409);
    const cooldown = await request(app).get("/api/cooldown");
    expect(cooldown.status).toBe(429);
    expect(cooldown.get("Retry-After")).toBe("2");
    expect(cooldown.body).toEqual({
      error: { code: "PROVIDER_COOLDOWN", message: "Wait a moment.", retryAfterMs: 1500 },
    });
  });

  it("hides unexpected errors behind INTERNAL and logs them with the request ID", async () => {
    const { app, lines } = buildApp();
    const res = await request(app).get("/api/boom").set("X-Request-Id", "req-42");
    expect(res.status).toBe(500);
    expect(errorCodeOf(res)).toBe("INTERNAL");
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
    expect(JSON.stringify(res.body)).not.toContain("stack");
    expect(lines.join("")).toContain('"requestId":"req-42"');
  });

  it("answers a malformed URL parameter with 400, never 500", async () => {
    const { app, lines } = buildApp();
    const res = await request(app).get("/api/items/%zz");
    expect(res.status).toBe(400);
    expect(errorCodeOf(res)).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(res.body)).not.toContain("URIError");
    expect(JSON.stringify(res.body)).not.toContain("stack");
    expect(lines.join("")).not.toContain('"level":50');
  });

  it("answers a body that cannot be decoded with 400, never 500", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/echo")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .send("this is not gzip");
    expect(res.status).toBe(400);
    expect(errorCodeOf(res)).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(res.body)).not.toContain("stack");
    expect(JSON.stringify(res.body)).not.toContain("incorrect header check");
  });

  it("treats any non-safe method as a mutation, so unusual verbs cannot skip the origin check", async () => {
    const { app } = buildApp();
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const { port } = server.address() as AddressInfo;
      const response = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        const req = nodeRequest(
          {
            host: "127.0.0.1",
            port,
            path: "/api/any",
            method: "PROPFIND",
            headers: { Origin: "http://evil.example" },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            res.on("end", () => {
              resolve({
                status: res.statusCode ?? 0,
                body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
              });
            });
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(response.status).toBe(403);
      expect(errorCodeOf(response)).toBe("ORIGIN_REJECTED");
    } finally {
      server.close();
    }
  });

  it("answers unknown API routes with NOT_FOUND", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(errorCodeOf(res)).toBe("NOT_FOUND");
  });

  it("echoes a safe X-Request-Id and replaces an unsafe one", async () => {
    const { app } = buildApp();
    expect(
      (await request(app).get("/api/conflict").set("X-Request-Id", "abc-123")).get("X-Request-Id"),
    ).toBe("abc-123");
    const replaced = (await request(app).get("/api/conflict").set("X-Request-Id", "bad id!")).get(
      "X-Request-Id",
    );
    expect(replaced).toMatch(/^[0-9a-f-]{36}$/);
  });
});
