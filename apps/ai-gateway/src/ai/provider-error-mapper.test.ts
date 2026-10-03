import { describe, expect, it } from "vitest";
import { GatewayError } from "../shared/gateway-error.js";
import { mapProviderError, mapRunFailure, retryAfterMsFrom } from "./provider-error-mapper.js";

describe("retryAfterMsFrom", () => {
  it("reads retry-after-ms, then retry-after seconds", () => {
    expect(retryAfterMsFrom(new Headers({ "retry-after-ms": "250" }))).toBe(250);
    expect(retryAfterMsFrom(new Headers({ "retry-after": "2" }))).toBe(2000);
    expect(
      retryAfterMsFrom(new Headers({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" })),
    ).toBeUndefined();
    expect(retryAfterMsFrom(undefined)).toBeUndefined();
  });

  it("treats an empty or whitespace header as absent, not as zero", () => {
    expect(retryAfterMsFrom(new Headers({ "retry-after-ms": "" }))).toBeUndefined();
    expect(retryAfterMsFrom(new Headers({ "retry-after": "   " }))).toBeUndefined();
    expect(retryAfterMsFrom(new Headers({ "retry-after-ms": " ", "retry-after": "3" }))).toBe(3000);
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

describe("mapRunFailure", () => {
  it("M-1: our fired deadline wins, even when agents-core rethrows the signal's own reason", () => {
    const controller = new AbortController();
    controller.abort();
    const reason: unknown = controller.signal.reason; // a DOMException AbortError, as throwIfAborted() throws it
    const error = mapRunFailure(reason, controller.signal);
    expect([error.code, error.notSent]).toEqual(["DEADLINE_EXCEEDED", false]);
    expect(error.cause).toBe(reason);

    const timedOut = AbortSignal.abort(new DOMException("deadline", "TimeoutError"));
    expect(mapRunFailure(timedOut.reason, timedOut).code).toBe("DEADLINE_EXCEEDED");
  });

  it("maps through mapProviderError while the deadline has not fired", () => {
    const live = new AbortController().signal;
    expect(mapRunFailure(new DOMException("x", "AbortError"), live).code).toBe("INTERNAL");
  });
});
