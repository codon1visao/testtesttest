import { SUPPLIED_MEMBERS } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { draftMatchesSaved, toFormValues, toSaveRequest } from "./attendance-form-model";

describe("attendance form model", () => {
  it("turns saved members into form values and back into a save request", () => {
    const values = toFormValues(SUPPLIED_MEMBERS);
    expect(values.members).toEqual(
      SUPPLIED_MEMBERS.map((m) => ({ id: m.id, attendance: m.attendance })),
    );
    expect(toSaveRequest(values, 3)).toEqual({
      baseAttendanceRevision: 3,
      members: SUPPLIED_MEMBERS.map((m) => ({ id: m.id, attendance: m.attendance })),
    });
  });

  it("knows when a draft equals the saved records, regardless of order", () => {
    const values = toFormValues(SUPPLIED_MEMBERS);
    expect(draftMatchesSaved(values, [...SUPPLIED_MEMBERS].reverse())).toBe(true);
    const changed = {
      members: values.members.map((m) =>
        m.id === "M03" ? { ...m, attendance: "attended" as const } : m,
      ),
    };
    expect(draftMatchesSaved(changed, SUPPLIED_MEMBERS)).toBe(false);
  });
});
