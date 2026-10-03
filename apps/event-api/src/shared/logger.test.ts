import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

function captureLogger() {
  const lines: string[] = [];
  const logger = createLogger("info", { write: (chunk: string) => void lines.push(chunk) });
  return { logger, lines };
}

describe("createLogger", () => {
  it("redacts SQL parameters and queries from logged errors (S1: no raw notes in logs)", () => {
    const { logger, lines } = captureLogger();
    const error = Object.assign(new Error("insert failed"), {
      query: "INSERT INTO feedback_notes …",
      parameters: ["Secret feedback text"],
    });
    logger.error({ err: error }, "write failed");
    const output = lines.join("");
    expect(output).toContain("write failed");
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("Secret feedback text");
    expect(output).not.toContain("INSERT INTO");
  });

  it("redacts Redis command arguments, which carry the serialised event view", () => {
    const { logger, lines } = captureLogger();
    const command = { name: "set", args: ["key", '{"feedback":"Secret note"}'] };
    const error = Object.assign(new Error("redis rejected the command"), { command });
    logger.error({ err: error }, "store failed");
    logger.error({ err: new Error("wrapper", { cause: error }) }, "wrapped store failed");
    const output = lines.join("");
    expect(output).toContain("store failed");
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("Secret note");
  });

  it("tags every line with the service name", () => {
    const { logger, lines } = captureLogger();
    logger.info("hello");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ service: "event-api", msg: "hello" });
  });
});
