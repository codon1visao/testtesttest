import { z } from "zod";
import { AttendanceStatusSchema, type Member, type MemberAttendance } from "./attendance.js";
import { compareFeedbackIds } from "./feedback.js";
import { type FeedbackId, FeedbackIdSchema, MemberIdSchema } from "./ids.js";

export const FreshnessSchema = z.strictObject({
  current: z.boolean(),
  attendanceChanges: z.array(
    z.strictObject({
      memberId: MemberIdSchema,
      from: AttendanceStatusSchema,
      to: AttendanceStatusSchema,
    }),
  ),
  newFeedbackIds: z.array(FeedbackIdSchema),
});
export type Freshness = z.infer<typeof FreshnessSchema>;

/** One member whose saved status differs from a snapshot (also the shape of an attendance diff). */
export type AttendanceChange = Freshness["attendanceChanges"][number];

/** What a generation captured: per-member statuses and the note set it read. */
export interface FreshnessBaseline {
  attendance: readonly MemberAttendance[];
  feedbackIds: readonly FeedbackId[];
  feedbackDigest: string;
}

/** The current saved records. */
export interface FreshnessCurrent {
  members: readonly Pick<Member, "id" | "attendance">[];
  feedbackIds: readonly FeedbackId[];
  feedbackDigest: string;
}

/**
 * D5: compare the captured snapshot with current saved data. Any real status difference is a
 * change (a swap is two), an exact revert matches again, and new notes are listed by ID.
 * The roster is fixed for this build (F2), so only members in the snapshot are compared.
 * Revision counters play no part: they exist only for write conflicts.
 */
export function computeFreshness(
  baseline: FreshnessBaseline,
  current: FreshnessCurrent,
): Freshness {
  const statusById = new Map(current.members.map((member) => [member.id, member.attendance]));
  const attendanceChanges = baseline.attendance.flatMap(({ memberId, attendance: from }) => {
    const to = statusById.get(memberId);
    return to === undefined || to === from ? [] : [{ memberId, from, to }];
  });

  const captured = new Set(baseline.feedbackIds);
  const newFeedbackIds = current.feedbackIds
    .filter((id) => !captured.has(id))
    .toSorted(compareFeedbackIds);
  const feedbackChanged = current.feedbackDigest !== baseline.feedbackDigest;

  return {
    current: attendanceChanges.length === 0 && !feedbackChanged,
    attendanceChanges,
    newFeedbackIds,
  };
}
