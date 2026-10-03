import { ATTENDANCE_LABELS, type Freshness, type Member } from "@event-desk/contracts";

/** D5/F6: attendance is named first because it changes the counts the overview states. */
export function freshnessTitle(freshness: Freshness): string | null {
  if (freshness.current) return null;
  return freshness.attendanceChanges.length > 0
    ? "Out of date — attendance changed since this briefing was generated"
    : "Out of date — new feedback since this briefing was generated";
}

export function attendanceChangeLines(freshness: Freshness, members: readonly Member[]): string[] {
  const names = new Map(members.map((member) => [member.id as string, member.name]));
  return freshness.attendanceChanges.map(
    (change) =>
      `${names.get(change.memberId) ?? change.memberId}: ${ATTENDANCE_LABELS[change.from]} → ${ATTENDANCE_LABELS[change.to]}`,
  );
}

export function newNotesLine(freshness: Freshness): string | null {
  const ids = freshness.newFeedbackIds;
  if (ids.length === 0) return null;
  return `${String(ids.length)} new ${ids.length === 1 ? "note" : "notes"} since this briefing: ${ids.join(", ")}`;
}
