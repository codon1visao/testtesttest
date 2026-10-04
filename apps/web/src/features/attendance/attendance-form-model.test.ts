import { MemberIdSchema, SUPPLIED_MEMBERS } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { submittedMatchesSaved, toSaveRequest, withMemberStatus } from "./attendance-form-model";

const M03 = MemberIdSchema.parse("M03");
const statuses = (members: readonly { id: string; attendance: string }[]) =>
  members.map((m) => ({ id: m.id, attendance: m.attendance }));

describe("attendance form model", () => {
  it("changes one member's status and keeps every other member as saved, in roster order", () => {
    const changed = withMemberStatus(SUPPLIED_MEMBERS, M03, "attended");
    expect(changed).toEqual(
      SUPPLIED_MEMBERS.map((m) => ({
        id: m.id,
        attendance: m.id === M03 ? "attended" : m.attendance,
      })),
    );
    // The saved records are never changed in place.
    expect(SUPPLIED_MEMBERS.find((m) => m.id === M03)?.attendance).toBe("not_recorded");
  });

  it("builds a save request with every member and the given base revision", () => {
    expect(toSaveRequest(SUPPLIED_MEMBERS, 3)).toEqual({
      baseAttendanceRevision: 3,
      members: statuses(SUPPLIED_MEMBERS),
    });
  });

  it("knows when the submitted statuses equal the saved records, regardless of order", () => {
    const submitted = SUPPLIED_MEMBERS.map((m) => ({ id: m.id, attendance: m.attendance }));
    expect(submittedMatchesSaved(submitted, [...SUPPLIED_MEMBERS].reverse())).toBe(true);
    expect(
      submittedMatchesSaved(withMemberStatus(SUPPLIED_MEMBERS, M03, "attended"), SUPPLIED_MEMBERS),
    ).toBe(false);
    expect(submittedMatchesSaved(submitted.slice(1), SUPPLIED_MEMBERS)).toBe(false);
  });
});
