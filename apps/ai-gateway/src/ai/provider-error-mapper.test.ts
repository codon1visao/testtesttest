import { describe, expect, it } from "vitest";
import { GatewayError } from "../shared/gateway-error.js";
import { mapProviderError, retryAfterMsFrom } from "./provider-error-mapper.js";

describe("retryAfterMsFrom", () => {
  it("reads retry-after-ms, then retry-after seconds", () => {
    expect(retryAfterMsFrom(new Headers({ "retry-after-ms": "250" }))).toBe(250);
    expect(retryAfterMsFrom(new Headers({ "retry-after": "2" }))).toBe(2000);
    expect(
      retryAfterMsFrom(new Headers({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" })),
    ).toBeUndefined();
    expect(retryAfterMsFrom(undefined)).toBeUndefined();
  });
});

describe("mapProviderError", () => {
  it("passes GatewayErrors through and maps anything unknown to INTERNAL with a safe message", () => {
    const known = new GatewayError("OUTPUT_INVALID", "x", { notSent: false });
    expect(mapProviderError(known)).toBe(known);
    const unknown = mapProviderError(new Error("secret detail from somewhere"));
    expect([unknown.code, unknown.notSent]).toEqual(["INTERNAL", false]);
    expect(unknown.message).not.toContain("secret detail");
  });
});
