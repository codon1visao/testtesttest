import { SUPPLIED_EVENT, SUPPLIED_FEEDBACK, SUPPLIED_MEMBERS } from "@event-desk/contracts";
import type { DataSource } from "typeorm";
import { EventEntity, FeedbackNoteEntity, MemberEntity } from "./entities/event.entities.js";
import { isDuplicateKeyError } from "./mysql-errors.js";

/**
 * TX1: initialise E101 exactly once. Seeding happens only when the event row is absent.
 * Partial or corrupt data is left untouched for recovery (F1 rule 6); it is never reseeded.
 */
export async function seedIfMissing(
  dataSource: DataSource,
  now: Date,
): Promise<"seeded" | "existing"> {
  try {
    return await dataSource.transaction(async (manager): Promise<"seeded" | "existing"> => {
      const existing = await manager.findOne(EventEntity, { where: { id: SUPPLIED_EVENT.id } });
      if (existing !== null) return "existing";
      await manager.insert(EventEntity, {
        id: SUPPLIED_EVENT.id,
        name: SUPPLIED_EVENT.name,
        clubName: SUPPLIED_EVENT.clubName,
        status: SUPPLIED_EVENT.status,
        attendanceRevision: 0,
        briefingRevision: 0,
        nextFeedbackNumber: SUPPLIED_FEEDBACK.length + 1,
        feedbackPendingSince: null,
      });
      await manager.insert(
        MemberEntity,
        SUPPLIED_MEMBERS.map((member, index) => ({
          eventId: SUPPLIED_EVENT.id,
          id: member.id,
          name: member.name,
          attendance: member.attendance,
          displayOrder: index + 1,
        })),
      );
      await manager.insert(
        FeedbackNoteEntity,
        SUPPLIED_FEEDBACK.map((note, index) => ({
          eventId: SUPPLIED_EVENT.id,
          id: note.id,
          text: note.text,
          origin: "seed" as const,
          submissionId: null,
          receivedAt: now,
          displayOrder: index + 1,
        })),
      );
      return "seeded";
    });
  } catch (error) {
    // Another process seeded between our check and insert: the data now exists.
    if (isDuplicateKeyError(error)) return "existing";
    throw error;
  }
}
