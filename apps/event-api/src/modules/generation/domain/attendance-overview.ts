import type { AttendanceCounts } from "@event-desk/contracts";

/**
 * The code-built "what happened" fact (F4, D16): the model never writes counts. The clause about
 * incomplete attendance appears only when someone is not recorded, never read as absence.
 */
export function buildAttendanceOverview(counts: AttendanceCounts): string {
  const noun = counts.registered === 1 ? "member" : "members";
  const facts = `${counts.registered} registered ${noun}: ${counts.attended} attended, ${counts.absent} absent, ${counts.notRecorded} not recorded`;
  return counts.notRecorded > 0 ? `${facts} (attendance is incomplete).` : `${facts}.`;
}
