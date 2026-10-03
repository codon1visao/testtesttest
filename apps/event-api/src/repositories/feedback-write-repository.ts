import { type EventId, type FeedbackNote, FeedbackNoteSchema } from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import { FeedbackNoteEntity } from "../persistence/entities/event.entities.js";
import type { FeedbackWriteRepository, NewFeedbackNote } from "../ports/unit-of-work.js";
import { parseStoredRow, toIsoTimestamp } from "./row-parsing.js";

export class TypeOrmFeedbackWriteRepository implements FeedbackWriteRepository {
  constructor(private readonly manager: EntityManager) {}

  async findBySubmissionId(eventId: EventId, submissionId: string): Promise<FeedbackNote | null> {
    const row = await this.manager.findOne(FeedbackNoteEntity, {
      where: { eventId, submissionId },
    });
    return row === null
      ? null
      : parseStoredRow(
          FeedbackNoteSchema,
          { id: row.id, text: row.text, receivedAt: toIsoTimestamp(row.receivedAt) },
          "feedback_notes",
        );
  }

  async insert(note: NewFeedbackNote): Promise<void> {
    await this.manager.insert(FeedbackNoteEntity, {
      eventId: note.eventId,
      id: note.id,
      text: note.text,
      origin: "submitted",
      submissionId: note.submissionId,
      receivedAt: note.receivedAt,
      displayOrder: note.displayOrder,
    });
  }
}
