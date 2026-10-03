import { describe, expect, it } from "vitest";
import {
  ApiErrorBodySchema,
  BATCH_ONLY_ERROR_CODES,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  HTTP_ERROR_CODES,
} from "./errors.js";

describe("error codes (T3 §5)", () => {
  it("maps every HTTP code to a status, and only HTTP codes", () => {
    for (const code of HTTP_ERROR_CODES)
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
    expect(Object.keys(ERROR_HTTP_STATUS).toSorted()).toEqual([...HTTP_ERROR_CODES].toSorted());
  });

  it("partitions every code into HTTP or batch-only", () => {
    const http = new Set<string>(HTTP_ERROR_CODES);
    expect(BATCH_ONLY_ERROR_CODES.filter((code) => http.has(code))).toEqual([]);
    expect([...HTTP_ERROR_CODES, ...BATCH_ONLY_ERROR_CODES].toSorted()).toEqual(
      [...ERROR_CODES].toSorted(),
    );
  });

  it.each([
    ["VALIDATION_FAILED", 400],
    ["ORIGIN_REJECTED", 403],
    ["EVENT_NOT_FOUND", 404],
    ["NOT_FOUND", 404],
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
    const batchOnly = { error: { code: "PROVIDER_TEMPORARY", message: "x" } };
    expect(ApiErrorBodySchema.safeParse(batchOnly).success).toBe(false);
  });
});
