import { z } from "zod";
import { assertNever } from "./assert-never.js";
import { MemberIdSchema } from "./ids.js";

export const ATTENDANCE_STATUSES = ["attended", "absent", "not_recorded"] as const;
export const AttendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;

export const ATTENDANCE_LABELS = {
  attended: "Attended",
  absent: "Absent",
  not_recorded: "Not recorded",
} as const satisfies Record<AttendanceStatus, string>;

export const MemberSchema = z.strictObject({
  id: MemberIdSchema,
  name: z.string().min(1).max(120),
  attendance: AttendanceStatusSchema,
});
export type Member = z.infer<typeof MemberSchema>;

/** One member's status as captured in a generation's input snapshot. */
export const MemberAttendanceSchema = z.strictObject({
  memberId: MemberIdSchema,
  attendance: AttendanceStatusSchema,
});
export type MemberAttendance = z.infer<typeof MemberAttendanceSchema>;

const count = z.int().min(0);
export const AttendanceCountsSchema = z
  .strictObject({ registered: count, attended: count, absent: count, notRecorded: count })
  .refine((c) => c.registered === c.attended + c.absent + c.notRecorded, {
    message: "registered must equal attended + absent + notRecorded",
  });
export type AttendanceCounts = z.infer<typeof AttendanceCountsSchema>;

/** Counts are always derived from saved records, never stored or accepted from a client. */
export function deriveAttendanceCounts(
  members: readonly { readonly attendance: AttendanceStatus }[],
): AttendanceCounts {
  const counts = { registered: members.length, attended: 0, absent: 0, notRecorded: 0 };
  for (const { attendance } of members) {
    switch (attendance) {
      case "attended":
        counts.attended += 1;
        break;
      case "absent":
        counts.absent += 1;
        break;
      case "not_recorded":
        counts.notRecorded += 1;
        break;
      default:
        assertNever(attendance, "attendance status");
    }
  }
  return counts;
}
