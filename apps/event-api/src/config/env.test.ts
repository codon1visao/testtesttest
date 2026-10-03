import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./env.js";

const MYSQL_URL = "mysql://event_desk:secret-pw@127.0.0.1:3306/event_desk";

describe("loadConfig", () => {
  it("applies the documented defaults (T3 §13)", () => {
    expect(loadConfig({ MYSQL_URL })).toEqual({
      host: "127.0.0.1",
      port: 4000,
      mysqlUrl: MYSQL_URL,
      redisUrl: "redis://127.0.0.1:6379/0",
      allowedOrigins: ["http://localhost:5173"],
      allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
      eventViewCacheTtlMs: 30_000,
      logLevel: "info",
    });
  });

  it("parses comma-separated lists and numbers", () => {
    const config = loadConfig({
      MYSQL_URL,
      PORT: "4100",
      ALLOWED_ORIGINS: "http://localhost:5173, http://127.0.0.1:5173",
      EVENT_VIEW_CACHE_TTL_MS: "0",
    });
    expect(config.port).toBe(4100);
    expect(config.allowedOrigins).toEqual(["http://localhost:5173", "http://127.0.0.1:5173"]);
    expect(config.eventViewCacheTtlMs).toBe(0);
  });

  it("refuses to bind anywhere but loopback (S1)", () => {
    expect(() => loadConfig({ MYSQL_URL, HOST: "0.0.0.0" })).toThrow(ConfigError);
  });

  it("names every invalid variable without echoing secret values", () => {
    try {
      loadConfig({ MYSQL_URL: "postgres://user:secret-pw@db/x", PORT: "70000" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).toContain("MYSQL_URL");
      expect(message).toContain("PORT");
      expect(message).not.toContain("secret-pw");
    }
  });

  it("requires MYSQL_URL", () => {
    expect(() => loadConfig({})).toThrow(/MYSQL_URL/);
  });
});
