import { describe, expect, it } from "vitest";
import { AppError } from "../shared/app-error.js";
import { isConnectionError, toStoreError } from "./store-errors.js";

describe("toStoreError", () => {
  it("passes AppErrors through unchanged", () => {
    const error = new AppError("EVENT_NOT_FOUND", "Event E999 was not found.");
    expect(toStoreError(error)).toBe(error);
  });

  it.each(["ECONNREFUSED", "PROTOCOL_CONNECTION_LOST", "ETIMEDOUT"])(
    "maps %s to STORE_UNAVAILABLE",
    (code) => {
      const direct = toStoreError(Object.assign(new Error("x"), { code }));
      const wrapped = toStoreError(
        Object.assign(new Error("query failed"), { driverError: { code } }),
      );
      expect(direct.code).toBe("STORE_UNAVAILABLE");
      expect(wrapped.code).toBe("STORE_UNAVAILABLE");
      expect(direct.message).toBe("The event store is unavailable. Try again shortly.");
    },
  );

  it.each([
    ["ER_LOCK_WAIT_TIMEOUT", 1205],
    ["ER_LOCK_DEADLOCK", 1213],
    ["PROTOCOL_SEQUENCE_TIMEOUT", undefined],
  ])(
    "maps %s (a lock wait, deadlock or query timeout) to a busy STORE_UNAVAILABLE",
    (code, errno) => {
      const driverError = Object.assign(new Error("x"), { code, errno });
      const direct = toStoreError(driverError);
      const wrapped = toStoreError(Object.assign(new Error("query failed"), { driverError }));
      for (const error of [direct, wrapped]) {
        expect(error.code).toBe("STORE_UNAVAILABLE");
        expect(error.message).toBe("The event store is busy. Try again shortly.");
      }
      expect(direct.cause).toBe(driverError);
    },
  );

  it("maps other database failures to INTERNAL and keeps the cause", () => {
    const cause = Object.assign(new Error("duplicate"), { driverError: { code: "ER_DUP_ENTRY" } });
    const error = toStoreError(cause);
    expect(error.code).toBe("INTERNAL");
    expect(error.cause).toBe(cause);
    expect(isConnectionError(cause)).toBe(false);
  });
});
