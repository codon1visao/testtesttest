import { ERROR_HTTP_STATUS } from "@event-desk/contracts";
import type { GatewayErrorCode } from "@event-desk/contracts/gateway-rpc";
import { describe, expect, it } from "vitest";
import { gatewayFailureError } from "./gateway-failure.js";

const fail = (code: GatewayErrorCode, notSent = false, retryAfterMs?: number) =>
  gatewayFailureError({
    ok: false,
    code,
    notSent,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });

describe("gatewayFailureError (T3 §5, F4, F8)", () => {
  it.each([
    ["GATEWAY_UNAVAILABLE", "GATEWAY_UNAVAILABLE", 503],
    ["GATEWAY_AUTH_FAILED", "GATEWAY_UNAVAILABLE", 503],
    ["PROVIDER_TEMPORARY", "GATEWAY_UNAVAILABLE", 503],
    ["VALIDATION_FAILED", "INTERNAL", 500],
    ["INTERNAL", "INTERNAL", 500],
    ["PROVIDER_NOT_CONFIGURED", "PROVIDER_NOT_CONFIGURED", 503],
    ["PROVIDER_RATE_LIMITED", "PROVIDER_COOLDOWN", 429],
    ["DAILY_LIMIT_REACHED", "DAILY_LIMIT_REACHED", 429],
    ["PROVIDER_REFUSED", "PROVIDER_REFUSED", 502],
    ["OUTPUT_INCOMPLETE", "OUTPUT_INCOMPLETE", 502],
    ["OUTPUT_INVALID", "OUTPUT_INVALID", 502],
    ["DEADLINE_EXCEEDED", "DEADLINE_EXCEEDED", 504],
    ["AI_OUTCOME_UNKNOWN", "AI_OUTCOME_UNKNOWN", 504],
  ] as const)("maps %s to %s (%i)", (gatewayCode, httpCode, status) => {
    const error = fail(gatewayCode);
    expect(error.code).toBe(httpCode);
    expect(ERROR_HTTP_STATUS[error.code]).toBe(status);
    expect(error.message).toMatch(/\.$/);
  });

  it("carries the provider's wait, or a 60 s default, for a rate limit", () => {
    expect(fail("PROVIDER_RATE_LIMITED", false, 1_500).retryAfterMs).toBe(1_500);
    expect(fail("PROVIDER_RATE_LIMITED").retryAfterMs).toBe(60_000);
  });

  it("tells the coordinator that an uncertain attempt may have been charged", () => {
    expect(fail("AI_OUTCOME_UNKNOWN").message).toMatch(/may have been charged/);
    expect(fail("DEADLINE_EXCEEDED").message).toMatch(/may have been charged/);
    expect(fail("GATEWAY_UNAVAILABLE", true).message).toMatch(/saved work is unchanged/);
  });

  it("explains an unknown outcome for a lost connection and for no answer in time alike", () => {
    expect(fail("AI_OUTCOME_UNKNOWN").message).toMatch(/did not confirm the result/);
    expect(fail("AI_OUTCOME_UNKNOWN").message).toMatch(/connection was lost/);
    expect(fail("AI_OUTCOME_UNKNOWN").message).toMatch(/no answer arrived in time/);
  });

  it("words the wait in whole seconds, never zero", () => {
    expect(fail("PROVIDER_RATE_LIMITED", true, 200).message).toBe(
      "The AI provider is limiting requests. Try again in 1 second.",
    );
    expect(fail("PROVIDER_RATE_LIMITED", true, 2_500).message).toBe(
      "The AI provider is limiting requests. Try again in 3 seconds.",
    );
  });

  it("Plan 3B carry-forward: DEADLINE_EXCEEDED that never reached the provider is not 'may have been charged'", () => {
    const error = fail("DEADLINE_EXCEEDED", true);
    expect(error.code).toBe("GATEWAY_UNAVAILABLE");
    expect(error.message).not.toMatch(/charged/);
  });
});
