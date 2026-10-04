import type {
  AttendanceStatus,
  Member,
  MemberId,
  SaveAttendanceRequest,
} from "@event-desk/contracts";

/** One member's status, as saved and as sent. The roster is fixed (F2: no add/remove). */
export type MemberAttendance = Pick<Member, "id" | "attendance">;

/** The saved roster with one member's new status: a save always sends every member (F2). */
export function withMemberStatus(
  saved: readonly MemberAttendance[],
  memberId: MemberId,
  attendance: AttendanceStatus,
): MemberAttendance[] {
  return saved.map((m) => ({
    id: m.id,
    attendance: m.id === memberId ? attendance : m.attendance,
  }));
}

export function toSaveRequest(
  members: readonly MemberAttendance[],
  baseAttendanceRevision: number,
): SaveAttendanceRequest {
  return {
    baseAttendanceRevision,
    members: members.map((m) => ({ id: m.id, attendance: m.attendance })),
  };
}

/** After a lost response: did the server already save exactly these statuses? */
export function submittedMatchesSaved(
  submitted: readonly MemberAttendance[],
  saved: readonly MemberAttendance[],
): boolean {
  const savedById = new Map(saved.map((m) => [m.id as string, m.attendance]));
  return (
    submitted.length === saved.length &&
    submitted.every((m) => savedById.get(m.id) === m.attendance)
  );
}
