import { z } from "zod";
import { AttendanceCountsSchema, AttendanceStatusSchema, MemberSchema } from "../attendance.js";
import { FreshnessSchema } from "../freshness.js";
import { MemberIdSchema } from "../ids.js";
import { RevisionSchema } from "./event-view.js";

/** The roster check (exactly the four registered members) needs the store, so it is server-side. */
export const SaveAttendanceRequestSchema = z.strictObject({
  baseAttendanceRevision: RevisionSchema,
  members: z
    .array(z.strictObject({ id: MemberIdSchema, attendance: AttendanceStatusSchema }))
    .min(1)
    .max(100)
    .refine((members) => new Set(members.map((m) => m.id)).size === members.length, {
      message: "Each member may appear only once",
    }),
});
export type SaveAttendanceRequest = z.infer<typeof SaveAttendanceRequestSchema>;

export const BriefingFreshnessSummarySchema = z.strictObject({
  savedBriefing: FreshnessSchema.nullable(),
  selectedPreview: FreshnessSchema.nullable(),
  incomingPreview: FreshnessSchema.nullable(),
});

export const SaveAttendanceResponseSchema = z.strictObject({
  members: z.array(MemberSchema),
  counts: AttendanceCountsSchema,
  attendanceRevision: RevisionSchema,
  freshness: BriefingFreshnessSummarySchema,
});
export type SaveAttendanceResponse = z.infer<typeof SaveAttendanceResponseSchema>;
