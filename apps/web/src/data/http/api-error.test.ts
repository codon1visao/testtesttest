import { AxiosError } from "axios";
import { describe, expect, it } from "vitest";
import { toApiError } from "./api-client";
import { ApiError, describeApiError } from "./api-error";

describe("ApiError", () => {
  it("marks network and timeout failures as an unknown outcome (the request may have landed)", () => {
    expect(new ApiError("network", "x").outcomeUnknown).toBe(true);
    expect(new ApiError("timeout", "x").outcomeUnknown).toBe(true);
    expect(
      new ApiError("http", "x", { status: 409, code: "ATTENDANCE_CONFLICT" }).outcomeUnknown,
    ).toBe(false);
  });
});

describe("describeApiError", () => {
  it("uses the API's own message for contract errors", () => {
    const error = new ApiError("http", "Attendance was saved elsewhere.", {
      status: 409,
      code: "ATTENDANCE_CONFLICT",
    });
    expect(describeApiError(error)).toBe("Attendance was saved elsewhere.");
  });

  it("explains transport failures in plain words", () => {
    expect(describeApiError(new ApiError("network", "x"))).toMatch(
      /could not reach the event api/i,
    );
    expect(describeApiError(new ApiError("timeout", "x"))).toMatch(/took too long/i);
    expect(describeApiError(new ApiError("invalid-response", "x"))).toMatch(/unexpected response/i);
  });

  it("never shows raw non-API errors", () => {
    expect(describeApiError(new TypeError("cannot read properties of undefined"))).toBe(
      "Something went wrong. Try again.",
    );
  });
});

describe("toApiError", () => {
  it("maps an Axios timeout to kind timeout", () => {
    expect(toApiError(new AxiosError("timeout of 15000ms exceeded", "ECONNABORTED"))).toMatchObject(
      { kind: "timeout" },
    );
    expect(toApiError(new AxiosError("timeout", "ETIMEDOUT"))).toMatchObject({ kind: "timeout" });
  });

  it("passes ApiErrors through and wraps anything else as network", () => {
    const original = new ApiError("http", "x", { status: 400 });
    expect(toApiError(original)).toBe(original);
    expect(toApiError(new Error("boom"))).toMatchObject({ kind: "network" });
  });
});
