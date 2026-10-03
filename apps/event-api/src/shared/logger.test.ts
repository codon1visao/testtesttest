import { QueryFailedError } from "typeorm";
import { describe, expect, it } from "vitest";
import { AppError } from "./app-error.js";
import { createLogger } from "./logger.js";

function captureLogger() {
  const lines: string[] = [];
  const logger = createLogger("info", { write: (chunk: string) => void lines.push(chunk) });
  return { logger, lines };
}

/** The shape TypeORM 1.1.1 throws for a failed mysql2 query: driver properties copied onto it. */
function duplicateEntryError(): QueryFailedError {
  return new QueryFailedError(
    "INSERT INTO feedback_notes (text) VALUES (?)",
    ["Secret feedback text"],
    Object.assign(new Error("Duplicate entry"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
      sql: "INSERT INTO feedback_notes (text) VALUES ('Secret feedback text')",
      sqlMessage: "Duplicate entry",
    }),
  );
}

describe("createLogger", () => {
  it("logs a real QueryFailedError without SQL text or parameters, keeping the error code", () => {
    const { logger, lines } = captureLogger();
    logger.error({ err: duplicateEntryError() }, "write failed");
    const output = lines.join("");
    expect(output).toContain("write failed");
    expect(output).not.toContain("Secret feedback text");
    expect(output).not.toContain("INSERT");
    expect(output).toContain("ER_DUP_ENTRY");
    expect(JSON.parse(output)).toMatchObject({
      err: { type: "QueryFailedError", message: "Duplicate entry", errno: 1062 },
    });
  });

  it("scrubs the same error when it is the cause of an AppError", () => {
    const { logger, lines } = captureLogger();
    const error = new AppError("INTERNAL", "The event store could not complete the request.", {
      cause: duplicateEntryError(),
    });
    logger.error({ err: error }, "request failed");
    const output = lines.join("");
    expect(output).not.toContain("Secret feedback text");
    expect(output).not.toContain("INSERT");
    expect(output).toContain("ER_DUP_ENTRY");
    expect(JSON.parse(output)).toMatchObject({
      err: { type: "AppError", code: "INTERNAL", cause: { code: "ER_DUP_ENTRY" } },
    });
  });

  it("scrubs every error of an AggregateError", () => {
    const { logger, lines } = captureLogger();
    logger.error({ err: new AggregateError([duplicateEntryError()], "several failed") }, "failed");
    const output = lines.join("");
    expect(output).not.toContain("Secret feedback text");
    expect(output).not.toContain("INSERT");
    expect(output).toContain("ER_DUP_ENTRY");
  });

  it("drops Redis command arguments, which carry the serialised event view", () => {
    const { logger, lines } = captureLogger();
    const command = { name: "set", args: ["key", '{"feedback":"Secret note"}'] };
    const error = Object.assign(new Error("redis rejected the command"), { command });
    logger.error({ err: error }, "store failed");
    logger.error({ err: new Error("wrapper", { cause: error }) }, "wrapped store failed");
    const output = lines.join("");
    expect(output).toContain("store failed");
    expect(output).toContain("wrapped store failed");
    expect(output).not.toContain("Secret note");
    expect(output).not.toContain('"args"');
  });

  it("tags every line with the service name", () => {
    const { logger, lines } = captureLogger();
    logger.info("hello");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ service: "event-api", msg: "hello" });
  });
});
