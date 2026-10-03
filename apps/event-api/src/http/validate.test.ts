import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "../shared/app-error.js";
import { parseEventId, validateBody } from "./validate.js";

describe("parseEventId", () => {
  it("accepts a well-formed ID", () => {
    expect(parseEventId("E101")).toBe("E101");
  });

  it.each(["e101", "E101 ", " E101", "\u0000", "../E101", "E1", ""])(
    "answers %j with EVENT_NOT_FOUND (binary-collation IDs)",
    (raw) => {
      expect(() => parseEventId(raw)).toThrow(AppError);
      try {
        parseEventId(raw);
      } catch (error) {
        expect((error as AppError).code).toBe("EVENT_NOT_FOUND");
      }
    },
  );
});

describe("validateBody", () => {
  const schema = z.strictObject({ members: z.array(z.strictObject({ id: z.string() })) });

  it("returns the parsed body", () => {
    expect(validateBody(schema, { members: [{ id: "M01" }] })).toEqual({
      members: [{ id: "M01" }],
    });
  });

  it("reports the first failing field", () => {
    try {
      validateBody(schema, { members: [{ id: 7 }] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("VALIDATION_FAILED");
      expect((error as AppError).field).toBe("members.0.id");
    }
  });
});
