import { describe, expect, it } from "vitest";
import { ResetRefusedError, resettableDatabase } from "./reset-store.js";

describe("resettableDatabase", () => {
  it.each(["event_desk", "event_desk_test"])("allows %s", (name) => {
    expect(resettableDatabase(`mysql://u:p@127.0.0.1:3306/${name}`)).toBe(name);
  });

  it.each(["mysql", "production", "event_desk_2", ""])("refuses %j", (name) => {
    expect(() => resettableDatabase(`mysql://u:p@127.0.0.1:3306/${name}`)).toThrow(
      ResetRefusedError,
    );
  });
});
