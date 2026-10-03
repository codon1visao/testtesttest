import { afterEach, describe, expect, it } from "vitest";
import { createOpenAIClient, OPENAI_BASE_URL } from "./openai-client.js";

const savedLog = process.env.OPENAI_LOG;
afterEach(() => {
  if (savedLog === undefined) Reflect.deleteProperty(process.env, "OPENAI_LOG");
  else process.env.OPENAI_LOG = savedLog;
});

describe("createOpenAIClient", () => {
  it("S1: keeps SDK logging off even when OPENAI_LOG=debug would print request bodies", () => {
    process.env.OPENAI_LOG = "debug";
    const client = createOpenAIClient({ apiKey: "sk-test-not-a-real-key", timeoutMs: 5_000 });
    expect(client.logLevel).toBe("off");
  });

  it("F8: never retries and calls only the fixed endpoint", () => {
    const client = createOpenAIClient({ apiKey: "sk-test-not-a-real-key", timeoutMs: 5_000 });
    expect([client.maxRetries, client.timeout, client.baseURL]).toEqual([
      0,
      5_000,
      OPENAI_BASE_URL,
    ]);
  });
});
