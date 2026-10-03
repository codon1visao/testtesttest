import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./env.js";

const SECRET = "local-dev-gateway-secret-change-me-0123456789";
const KEY = "sk-test-not-a-real-key";

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
