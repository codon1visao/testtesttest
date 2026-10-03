import {
  AttendanceStatusSchema,
  type Member,
  MemberIdSchema,
  type SaveAttendanceRequest,
} from "@event-desk/contracts";
import { z } from "zod";

export const AttendanceFormSchema = z.object({
  members: z.array(z.object({ id: MemberIdSchema, attendance: AttendanceStatusSchema })),
});
export type AttendanceFormValues = z.input<typeof AttendanceFormSchema>;
export type AttendanceFormOutput = z.output<typeof AttendanceFormSchema>;

/** Saved members already carry validated (branded) IDs, so their values are the schema's output shape. */
export function toFormValues(
  members: readonly Pick<Member, "id" | "attendance">[],
): AttendanceFormOutput {
  return { members: members.map((m) => ({ id: m.id, attendance: m.attendance })) };
}

export function toSaveRequest(
  values: AttendanceFormOutput,
  baseAttendanceRevision: number,
): SaveAttendanceRequest {
  return {
    baseAttendanceRevision,
    members: values.members.map((m) => ({ id: m.id, attendance: m.attendance })),
  };
}

/** After a lost response: did the server already save exactly this draft? */
export function draftMatchesSaved(
  values: AttendanceFormValues,
  saved: readonly Pick<Member, "id" | "attendance">[],
): boolean {
  const savedById = new Map(saved.map((m) => [m.id as string, m.attendance]));
  return (
    values.members.length === saved.length &&
    values.members.every((m) => savedById.get(m.id) === m.attendance)
  );
}
