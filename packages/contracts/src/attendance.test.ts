import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_LABELS,
  AttendanceCountsSchema,
  AttendanceStatusSchema,
  type AttendanceStatus,
  deriveAttendanceCounts,
} from "./attendance.js";

const roster = (...statuses: AttendanceStatus[]) => statuses.map((attendance) => ({ attendance }));

describe("deriveAttendanceCounts", () => {
  it("derives the supplied initial counts 4/1/2/1", () => {
    expect(deriveAttendanceCounts(roster("attended", "absent", "not_recorded", "absent"))).toEqual({
      registered: 4,
      attended: 1,
      absent: 2,
      notRecorded: 1,
    });
  });

  it("keeps Not recorded distinct from Absent (F2-04)", () => {
    expect(
      deriveAttendanceCounts(
        roster("not_recorded", "not_recorded", "not_recorded", "not_recorded"),
      ),
    ).toEqual({ registered: 4, attended: 0, absent: 0, notRecorded: 4 });
  });

  it("handles an empty roster", () => {
    expect(deriveAttendanceCounts([])).toEqual({
      registered: 0,
      attended: 0,
      absent: 0,
      notRecorded: 0,
    });
  });
});

describe("attendance schemas", () => {
  it("rejects unknown attendance states", () => {
    expect(AttendanceStatusSchema.safeParse("late").success).toBe(false);
  });

  it("rejects counts that do not add up", () => {
    expect(
      AttendanceCountsSchema.safeParse({ registered: 4, attended: 1, absent: 1, notRecorded: 1 })
        .success,
    ).toBe(false);
  });

  it("labels every status for display", () => {
    expect(ATTENDANCE_LABELS).toEqual({
      attended: "Attended",
      absent: "Absent",
      not_recorded: "Not recorded",
    });
  });
});
