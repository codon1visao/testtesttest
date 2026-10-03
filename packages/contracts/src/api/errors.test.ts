import { describe, expect, it } from "vitest";
import { ApiErrorBodySchema, ERROR_CODES, ERROR_HTTP_STATUS } from "./errors.js";

describe("error codes (T3 §5)", () => {
  it("map every code to an HTTP status", () => {
    for (const code of ERROR_CODES) expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
  });

  it.each([
    ["VALIDATION_FAILED", 400],
    ["ORIGIN_REJECTED", 403],
    ["EVENT_NOT_FOUND", 404],
    ["ATTENDANCE_CONFLICT", 409],
    ["GENERATION_NOT_AVAILABLE", 409],
    ["REFERENCE_INVALID", 422],
    ["FEEDBACK_LIMIT_REACHED", 422],
    ["PROVIDER_COOLDOWN", 429],
    ["OUTPUT_INVALID", 502],
    ["GATEWAY_UNAVAILABLE", 503],
    ["AI_OUTCOME_UNKNOWN", 504],
    ["STORE_CORRUPT", 500],
  ] as const)("maps %s to %i", (code, status) => {
    expect(ERROR_HTTP_STATUS[code]).toBe(status);
  });

  it("validates the error envelope and rejects unknown codes", () => {
    const body = {
      error: { code: "PROVIDER_COOLDOWN", message: "Try again later.", retryAfterMs: 1500 },
    };
    expect(ApiErrorBodySchema.safeParse(body).success).toBe(true);
    expect(ApiErrorBodySchema.safeParse({ error: { code: "TEAPOT", message: "x" } }).success).toBe(
      false,
    );
  });
});
