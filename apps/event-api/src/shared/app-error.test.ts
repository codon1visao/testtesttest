import { ERROR_HTTP_STATUS } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { AppError } from "./app-error.js";

describe("AppError", () => {
  it("carries a contracts error code, an optional field and a cause", () => {
    const cause = new Error("driver detail");
    const error = new AppError("ATTENDANCE_CONFLICT", "Reload to continue.", {
      field: "members",
      cause,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AppError");
    expect(error.code).toBe("ATTENDANCE_CONFLICT");
    expect(ERROR_HTTP_STATUS[error.code]).toBe(409);
    expect(error.field).toBe("members");
    expect(error.retryAfterMs).toBeUndefined();
    expect(error.cause).toBe(cause);
  });

  it("supports retryAfterMs for cooldown errors", () => {
    expect(new AppError("PROVIDER_COOLDOWN", "Wait.", { retryAfterMs: 1500 }).retryAfterMs).toBe(
      1500,
    );
  });
});
