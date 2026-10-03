import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig, loadDotEnv } from "./env.js";

const DOT_ENV = [
  "HOST=127.0.0.1",
  "PORT=4001",
  "MYSQL_URL=mysql://user:pw@127.0.0.1:3306/from_file",
  "REDIS_URL=redis://127.0.0.1:6379/3",
  "LOG_LEVEL=debug",
  "GATEWAY_HOST=127.0.0.1",
  "GATEWAY_PORT=4101",
  "GATEWAY_SERVICE_SECRET=file-secret-0123456789-0123456789-0123456789",
  "MANUAL_GENERATION_TIMEOUT_MS=45000",
  "GATEWAY_DAILY_CALL_LIMIT=5",
  "OPENAI_API_KEY=sk-test-not-a-real-key",
  "OPENAI_MODEL=gpt-test",
  "UNRELATED_SETTING=1",
].join("\n");

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dotEnvFile(content: string): Promise<URL> {
  const dir = await mkdtemp(join(tmpdir(), "event-desk-env-"));
  tempDirs.push(dir);
  const path = join(dir, ".env");
  await writeFile(path, content);
  return pathToFileURL(path);
}

/** Runs `body` against the real process.env, restoring the named keys afterwards. */
function withProcessEnv(keys: readonly string[], body: () => void): void {
  const saved = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) Reflect.deleteProperty(process.env, key);
  try {
    body();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
}

const MYSQL_URL = "mysql://event_desk:secret-pw@127.0.0.1:3306/event_desk";
const GATEWAY_SERVICE_SECRET = "gateway-secret-0123456789-0123456789-0123456789";

describe("loadConfig", () => {
  it("applies the documented defaults (T3 §13)", () => {
    expect(loadConfig({ MYSQL_URL, GATEWAY_SERVICE_SECRET })).toEqual({
      host: "127.0.0.1",
      port: 4000,
      mysqlUrl: MYSQL_URL,
      redisUrl: "redis://127.0.0.1:6379/0",
      allowedOrigins: ["http://localhost:5173"],
      allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
      eventViewCacheTtlMs: 30_000,
      mysqlQueryTimeoutMs: 5_000,
      logLevel: "info",
      gateway: { host: "127.0.0.1", port: 4100, secret: GATEWAY_SERVICE_SECRET },
      manualGenerationTimeoutMs: 60_000,
      generationLimits: { dailyAttempts: 20, batchDailyAttempts: 15 },
      batchWindowMs: 3_000,
    });
  });

  it("parses comma-separated lists and numbers", () => {
    const config = loadConfig({
      MYSQL_URL,
      GATEWAY_SERVICE_SECRET,
      PORT: "4100",
      ALLOWED_ORIGINS: "http://localhost:5173, http://127.0.0.1:5173",
      EVENT_VIEW_CACHE_TTL_MS: "0",
      MYSQL_QUERY_TIMEOUT_MS: "1500",
    });
    expect(config.port).toBe(4100);
    expect(config.allowedOrigins).toEqual(["http://localhost:5173", "http://127.0.0.1:5173"]);
    expect(config.eventViewCacheTtlMs).toBe(0);
    expect(config.mysqlQueryTimeoutMs).toBe(1_500);
  });

  it("reads the Gateway client settings and the manual generation timeout", () => {
    const config = loadConfig({
      MYSQL_URL,
      GATEWAY_SERVICE_SECRET,
      GATEWAY_HOST: "::1",
      GATEWAY_PORT: "4200",
      MANUAL_GENERATION_TIMEOUT_MS: "85000",
    });
    expect(config.gateway).toEqual({ host: "::1", port: 4200, secret: GATEWAY_SERVICE_SECRET });
    expect(config.manualGenerationTimeoutMs).toBe(85_000);
  });

  // The server must always answer before the web app's 90 s request timeout (T5 §2).
  it.each(["4999", "85001", "90000", "2.5"])("rejects MANUAL_GENERATION_TIMEOUT_MS=%s", (value) => {
    expect(() =>
      loadConfig({ MYSQL_URL, GATEWAY_SERVICE_SECRET, MANUAL_GENERATION_TIMEOUT_MS: value }),
    ).toThrow(/MANUAL_GENERATION_TIMEOUT_MS/);
  });

  it.each([undefined, "too-short-to-be-a-secret"])(
    "requires a GATEWAY_SERVICE_SECRET of at least 32 bytes (%s)",
    (secret) => {
      try {
        loadConfig({
          MYSQL_URL,
          ...(secret === undefined ? {} : { GATEWAY_SERVICE_SECRET: secret }),
        });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        const message = (error as ConfigError).message;
        expect(message).toContain("GATEWAY_SERVICE_SECRET");
        if (secret !== undefined) expect(message).not.toContain(secret);
      }
    },
  );

  it("reads the daily attempt budget and refuses a batch cap above the total", () => {
    const config = loadConfig({
      MYSQL_URL,
      GATEWAY_SERVICE_SECRET,
      GENERATION_DAILY_ATTEMPT_LIMIT: "30",
      GENERATION_BATCH_DAILY_LIMIT: "0",
    });
    expect(config.generationLimits).toEqual({ dailyAttempts: 30, batchDailyAttempts: 0 });
    expect(() =>
      loadConfig({
        MYSQL_URL,
        GATEWAY_SERVICE_SECRET,
        GENERATION_DAILY_ATTEMPT_LIMIT: "15",
        GENERATION_BATCH_DAILY_LIMIT: "16",
      }),
    ).toThrow(/GENERATION_BATCH_DAILY_LIMIT: must not exceed GENERATION_DAILY_ATTEMPT_LIMIT/);
  });

  it("reads the fixed batch window (F7)", () => {
    expect(
      loadConfig({ MYSQL_URL, GATEWAY_SERVICE_SECRET, BRIEFING_BATCH_WINDOW_MS: "1500" })
        .batchWindowMs,
    ).toBe(1_500);
  });

  // F7-16: an invalid window stops startup and names the variable.
  it.each(["0", "abc"])("rejects BRIEFING_BATCH_WINDOW_MS=%s (F7-16)", (value) => {
    expect(() =>
      loadConfig({ MYSQL_URL, GATEWAY_SERVICE_SECRET, BRIEFING_BATCH_WINDOW_MS: value }),
    ).toThrow(/BRIEFING_BATCH_WINDOW_MS/);
  });

  it("refuses a non-loopback GATEWAY_HOST (S1)", () => {
    expect(() =>
      loadConfig({ MYSQL_URL, GATEWAY_SERVICE_SECRET, GATEWAY_HOST: "10.0.0.5" }),
    ).toThrow(/GATEWAY_HOST/);
  });

  it.each(["499", "60001", "2.5"])("rejects MYSQL_QUERY_TIMEOUT_MS=%s", (value) => {
    expect(() => loadConfig({ MYSQL_URL, MYSQL_QUERY_TIMEOUT_MS: value })).toThrow(
      /MYSQL_QUERY_TIMEOUT_MS/,
    );
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
    expect(() => loadConfig({ GATEWAY_SERVICE_SECRET })).toThrow(/MYSQL_URL/);
  });
});

describe("loadDotEnv (S1-12)", () => {
  it("copies only the event API's own keys: the OpenAI key never reaches its environment", async () => {
    const target: NodeJS.ProcessEnv = {};
    loadDotEnv(await dotEnvFile(DOT_ENV), target);
    expect(target).toEqual({
      HOST: "127.0.0.1",
      PORT: "4001",
      MYSQL_URL: "mysql://user:pw@127.0.0.1:3306/from_file",
      REDIS_URL: "redis://127.0.0.1:6379/3",
      LOG_LEVEL: "debug",
      GATEWAY_HOST: "127.0.0.1",
      GATEWAY_PORT: "4101",
      GATEWAY_SERVICE_SECRET: "file-secret-0123456789-0123456789-0123456789",
      MANUAL_GENERATION_TIMEOUT_MS: "45000",
    });
  });

  it("allowlists every key the config schema reads", async () => {
    const keys = [
      "HOST",
      "PORT",
      "MYSQL_URL",
      "REDIS_URL",
      "ALLOWED_ORIGINS",
      "ALLOWED_HOSTS",
      "EVENT_VIEW_CACHE_TTL_MS",
      "MYSQL_QUERY_TIMEOUT_MS",
      "LOG_LEVEL",
      "GATEWAY_HOST",
      "GATEWAY_PORT",
      "GATEWAY_SERVICE_SECRET",
      "MANUAL_GENERATION_TIMEOUT_MS",
      "BRIEFING_BATCH_WINDOW_MS",
    ];
    const target: NodeJS.ProcessEnv = {};
    loadDotEnv(await dotEnvFile(keys.map((key) => `${key}=x`).join("\n")), target);
    expect(Object.keys(target).sort()).toEqual([...keys].sort());
  });

  it("lets variables already in the environment win over the file", async () => {
    const target: NodeJS.ProcessEnv = {
      MYSQL_URL: "mysql://env@127.0.0.1/env_wins",
      LOG_LEVEL: "",
    };
    loadDotEnv(await dotEnvFile(DOT_ENV), target);
    expect(target.MYSQL_URL).toBe("mysql://env@127.0.0.1/env_wins");
    expect(target.LOG_LEVEL).toBe("");
  });

  it("writes to process.env by default and never sets OPENAI_*", async () => {
    const url = await dotEnvFile(DOT_ENV);
    withProcessEnv(["MYSQL_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "UNRELATED_SETTING"], () => {
      loadDotEnv(url);
      expect(process.env.MYSQL_URL).toBe("mysql://user:pw@127.0.0.1:3306/from_file");
      expect(process.env.OPENAI_API_KEY).toBeUndefined();
      expect(process.env.OPENAI_MODEL).toBeUndefined();
      expect(process.env.UNRELATED_SETTING).toBeUndefined();
    });
  });

  it("is a no-op when the file does not exist", async () => {
    const missing = new URL("missing.env", await dotEnvFile(""));
    const target: NodeJS.ProcessEnv = {};
    expect(() => {
      loadDotEnv(missing, target);
    }).not.toThrow();
    expect(target).toEqual({});
  });
});
