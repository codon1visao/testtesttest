import type { FeedbackId, MemberAttendance } from "@event-desk/contracts";

/** What a generation read: per-member attendance and the note-ID set. */
export interface InputSnapshot {
  attendance: readonly MemberAttendance[];
  feedbackIds: readonly FeedbackId[];
}

/**
 * F7 rule 6: nothing new when every member's status and the note-ID set are unchanged.
 * Order-insensitive; member IDs and note IDs are unique within an input.
 */
export function sameInput(a: InputSnapshot, b: InputSnapshot): boolean {
  if (
    a.attendance.length !== b.attendance.length ||
    a.feedbackIds.length !== b.feedbackIds.length
  ) {
    return false;
  }
  const statuses = new Map<string, string>(
    a.attendance.map((entry) => [entry.memberId, entry.attendance]),
  );
  const notes = new Set<string>(a.feedbackIds);
  return (
    b.attendance.every((entry) => statuses.get(entry.memberId) === entry.attendance) &&
    b.feedbackIds.every((id) => notes.has(id))
  );
}
