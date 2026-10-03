import type { AttendanceChange, AttendanceStatus, Member, MemberId } from "@event-desk/contracts";

export interface RequestedAttendance {
  readonly id: MemberId;
  readonly attendance: AttendanceStatus;
}

export type AttendanceDiff =
  | { kind: "changes"; changes: AttendanceChange[] }
  | { kind: "roster_mismatch"; missing: MemberId[]; unknown: MemberId[] };

/** The request must list every registered member exactly once; only real status differences count. */
export function diffAttendance(
  current: readonly Pick<Member, "id" | "attendance">[],
  requested: readonly RequestedAttendance[],
): AttendanceDiff {
  const requestedById = new Map(requested.map((entry) => [entry.id, entry.attendance]));
  const rosterIds = new Set(current.map((member) => member.id));
  const missing = current
    .filter((member) => !requestedById.has(member.id))
    .map((member) => member.id);
  const unknown = requested.filter((entry) => !rosterIds.has(entry.id)).map((entry) => entry.id);
  if (missing.length > 0 || unknown.length > 0)
    return { kind: "roster_mismatch", missing, unknown };
  const changes = current.flatMap((member) => {
    const to = requestedById.get(member.id);
    return to === undefined || to === member.attendance
      ? []
      : [{ memberId: member.id, from: member.attendance, to }];
  });
  return { kind: "changes", changes };
}

export function applyAttendanceChanges(
  members: readonly Member[],
  changes: readonly AttendanceChange[],
): Member[] {
  const next = new Map(changes.map((change) => [change.memberId, change.to]));
  return members.map((member) => ({
    ...member,
    attendance: next.get(member.id) ?? member.attendance,
  }));
}
