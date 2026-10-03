import { describe, expect, it } from "vitest";
import { errorMetadata } from "./error-metadata.js";

function systemError(code: unknown, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("errorMetadata", () => {
  it("keeps a Node system error code such as EADDRINUSE", () => {
    expect(errorMetadata(systemError("EADDRINUSE", "listen EADDRINUSE 127.0.0.1:4100"))).toEqual({
      errorClass: "Error",
      code: "EADDRINUSE",
    });
  });

  it("never carries the message, and drops codes that are not plain identifiers", () => {
    for (const code of ["has spaces sk-test", 42, "x".repeat(65), ""]) {
      const metadata = errorMetadata(systemError(code, "sk-test-secret in the message"));
      expect(metadata).toEqual({ errorClass: "Error" });
    }
  });

  it("names non-Error values by their type", () => {
    expect(errorMetadata("boom")).toEqual({ errorClass: "string" });
  });
});
