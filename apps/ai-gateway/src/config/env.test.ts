import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig, loadDotEnv } from "./env.js";

const SECRET = "local-dev-gateway-secret-change-me-0123456789";
const KEY = "sk-test-not-a-real-key";

const DOT_ENV = [
  "HOST=127.0.0.1",
  "PORT=4001",
  "MYSQL_URL=mysql://user:pw@127.0.0.1:3306/from_file",
  "REDIS_URL=redis://127.0.0.1:6379/3",
  "LOG_LEVEL=debug",
  "GATEWAY_HOST=127.0.0.1",
  "GATEWAY_PORT=4101",
  "GATEWAY_SERVICE_SECRET=file-secret-0123456789-0123456789-0123456789",
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

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("loadConfig", () => {
  it("starts without a provider key (Review Focus 5): provider is null", () => {
    const config = loadConfig({ GATEWAY_SERVICE_SECRET: SECRET });
    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 4100,
      provider: null,
      dailyCallLimit: 40,
    });
  });

  it("treats empty variables from a copied .env.example as unset", () => {
    const config = loadConfig({
      GATEWAY_SERVICE_SECRET: SECRET,
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
      OPENAI_REASONING_EFFORT: "",
    });
    expect(config.provider).toBeNull();
  });

  it("builds the provider settings when a key and model are set", () => {
    const config = loadConfig({
      GATEWAY_SERVICE_SECRET: SECRET,
      OPENAI_API_KEY: KEY,
      OPENAI_MODEL: "gpt-x",
      OPENAI_REASONING_EFFORT: "low",
    });
    expect(config.provider).toEqual({
      apiKey: KEY,
      model: "gpt-x",
      reasoningEffort: "low",
      timeoutMs: 50_000,
      maxOutputTokens: 4_000,
    });
  });

  it("requires a model once a key is set", () => {
    expect(problemsOf({ GATEWAY_SERVICE_SECRET: SECRET, OPENAI_API_KEY: KEY })).toEqual([
      "OPENAI_MODEL: is required when OPENAI_API_KEY is set",
    ]);
  });

  it("requires a service secret of at least 32 bytes and a loopback host", () => {
    const problems = problemsOf({ GATEWAY_SERVICE_SECRET: "short", GATEWAY_HOST: "0.0.0.0" });
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/GATEWAY_SERVICE_SECRET/);
    expect(problems.join("\n")).toMatch(/GATEWAY_HOST/);
  });

  it("never echoes secret values in its problems", () => {
    const problems = problemsOf({
      GATEWAY_SERVICE_SECRET: "short-secret",
      OPENAI_API_KEY: KEY,
      GATEWAY_PORT: "x",
    });
    expect(problems.join("\n")).not.toMatch(/short-secret|sk-test/);
  });
});

describe("loadDotEnv (S1-12)", () => {
  it("copies only the Gateway's own keys: event API storage URLs never reach its environment", async () => {
    const target: NodeJS.ProcessEnv = {};
    loadDotEnv(await dotEnvFile(DOT_ENV), target);
    expect(target).toEqual({
      LOG_LEVEL: "debug",
      GATEWAY_HOST: "127.0.0.1",
      GATEWAY_PORT: "4101",
      GATEWAY_SERVICE_SECRET: "file-secret-0123456789-0123456789-0123456789",
      GATEWAY_DAILY_CALL_LIMIT: "5",
      OPENAI_API_KEY: KEY,
      OPENAI_MODEL: "gpt-test",
    });
  });

  it("allowlists every key the config schema reads", async () => {
    const keys = [
      "GATEWAY_HOST",
      "GATEWAY_PORT",
      "GATEWAY_SERVICE_SECRET",
      "OPENAI_API_KEY",
      "OPENAI_MODEL",
      "OPENAI_REASONING_EFFORT",
      "OPENAI_TIMEOUT_MS",
      "MAX_OUTPUT_TOKENS",
      "GATEWAY_MAX_CALL_MS",
      "GATEWAY_RESPONSE_MARGIN_MS",
      "GATEWAY_DAILY_CALL_LIMIT",
      "LOG_LEVEL",
    ];
    const target: NodeJS.ProcessEnv = {};
    loadDotEnv(await dotEnvFile(keys.map((key) => `${key}=x`).join("\n")), target);
    expect(Object.keys(target).sort()).toEqual([...keys].sort());
  });

  it("lets variables already in the environment win over the file", async () => {
    const target: NodeJS.ProcessEnv = { OPENAI_MODEL: "gpt-from-env", OPENAI_API_KEY: "" };
    loadDotEnv(await dotEnvFile(DOT_ENV), target);
    expect(target.OPENAI_MODEL).toBe("gpt-from-env");
    expect(target.OPENAI_API_KEY).toBe("");
  });

  it("writes to process.env by default and never sets MYSQL_URL or REDIS_URL", async () => {
    const url = await dotEnvFile(DOT_ENV);
    withProcessEnv(
      ["MYSQL_URL", "REDIS_URL", "GATEWAY_DAILY_CALL_LIMIT", "UNRELATED_SETTING"],
      () => {
        loadDotEnv(url);
        expect(process.env.GATEWAY_DAILY_CALL_LIMIT).toBe("5");
        expect(process.env.MYSQL_URL).toBeUndefined();
        expect(process.env.REDIS_URL).toBeUndefined();
        expect(process.env.UNRELATED_SETTING).toBeUndefined();
      },
    );
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
