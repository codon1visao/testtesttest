import { MemberIdSchema, SUPPLIED_MEMBERS } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import {
  applyAttendanceChanges,
  diffAttendance,
  type RequestedAttendance,
} from "./diff-attendance.js";

const id = (value: string) => MemberIdSchema.parse(value);
const asRequested = (
  overrides: Record<string, RequestedAttendance["attendance"]> = {},
): RequestedAttendance[] =>
  SUPPLIED_MEMBERS.map((m) => ({ id: m.id, attendance: overrides[m.id] ?? m.attendance }));

describe("diffAttendance", () => {
  it("reports no changes for an unchanged roster", () => {
    expect(diffAttendance(SUPPLIED_MEMBERS, asRequested())).toEqual({
      kind: "changes",
      changes: [],
    });
  });

  it("is order-insensitive", () => {
    expect(diffAttendance(SUPPLIED_MEMBERS, asRequested({ M03: "attended" }).toReversed())).toEqual(
      {
        kind: "changes",
        changes: [{ memberId: "M03", from: "not_recorded", to: "attended" }],
      },
    );
  });

  it("treats a swap as two changes even though counts are equal (F2-07)", () => {
    const diff = diffAttendance(SUPPLIED_MEMBERS, asRequested({ M01: "absent", M02: "attended" }));
    expect(diff).toEqual({
      kind: "changes",
      changes: [
        { memberId: "M01", from: "attended", to: "absent" },
        { memberId: "M02", from: "absent", to: "attended" },
      ],
    });
  });

  it("rejects a roster with missing or unknown members (F2-05)", () => {
    const requested = [
      ...asRequested().slice(1),
      { id: id("M09"), attendance: "attended" as const },
    ];
    expect(diffAttendance(SUPPLIED_MEMBERS, requested)).toEqual({
      kind: "roster_mismatch",
      missing: ["M01"],
      unknown: ["M09"],
    });
  });
});

describe("applyAttendanceChanges", () => {
  it("returns new member records without mutating the input", () => {
    const changed = applyAttendanceChanges(SUPPLIED_MEMBERS, [
      { memberId: id("M03"), from: "not_recorded", to: "attended" },
    ]);
    expect(changed.find((m) => m.id === "M03")?.attendance).toBe("attended");
    expect(SUPPLIED_MEMBERS.find((m) => m.id === "M03")?.attendance).toBe("not_recorded");
  });
});
