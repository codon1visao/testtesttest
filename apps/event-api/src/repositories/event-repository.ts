import {
  type AttendanceChange,
  type EventId,
  EventSummarySchema,
  FeedbackNoteSchema,
  MemberSchema,
} from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import { z } from "zod";
import {
  EventEntity,
  type EventRow,
  FeedbackNoteEntity,
  MemberEntity,
} from "../persistence/entities/event.entities.js";
import type { EventAggregate, EventWriteRepository } from "../ports/unit-of-work.js";
import { AppError } from "../shared/app-error.js";
import { parseStoredRow, toIsoTimestamp } from "./row-parsing.js";

const StoredRevisionsSchema = z.object({
  attendanceRevision: z.int().min(0),
  briefingRevision: z.int().min(0),
});

export class TypeOrmEventRepository implements EventWriteRepository {
  constructor(private readonly manager: EntityManager) {}

  async findAggregate(eventId: EventId): Promise<EventAggregate | null> {
    const row = await this.manager.findOne(EventEntity, { where: { id: eventId } });
    return row === null ? null : this.withChildren(row);
  }

  async lockForUpdate(eventId: EventId): Promise<EventAggregate> {
    const row = await this.manager
      .createQueryBuilder(EventEntity, "event")
      .setLock("pessimistic_write")
      .where("event.id = :id", { id: eventId })
      .getOne();
    if (row === null) throw new AppError("EVENT_NOT_FOUND", `Event ${eventId} was not found.`);
    return this.withChildren(row);
  }

  async applyAttendanceChanges(
    eventId: EventId,
    changes: readonly AttendanceChange[],
  ): Promise<void> {
    if (changes.length === 0) return;
    for (const change of changes) {
      await this.manager.update(
        MemberEntity,
        { eventId, id: change.memberId },
        { attendance: change.to },
      );
    }
    await this.manager.increment(EventEntity, { id: eventId }, "attendanceRevision", 1);
  }

  async bumpBriefingRevision(eventId: EventId): Promise<void> {
    await this.manager.increment(EventEntity, { id: eventId }, "briefingRevision", 1);
  }

  private async withChildren(row: EventRow): Promise<EventAggregate> {
    const event = parseStoredRow(
      EventSummarySchema,
      { id: row.id, name: row.name, clubName: row.clubName, status: row.status },
      "events",
    );
    const revisions = parseStoredRow(StoredRevisionsSchema, row, "events");
    const memberRows = await this.manager.find(MemberEntity, {
      where: { eventId: event.id },
      order: { displayOrder: "ASC" },
    });
    if (memberRows.length === 0) {
      throw new AppError(
        "STORE_CORRUPT",
        `Event ${event.id} has no registered members. The store needs manual recovery.`,
      );
    }
    const noteRows = await this.manager.find(FeedbackNoteEntity, {
      where: { eventId: event.id },
      order: { displayOrder: "ASC" },
    });
    return {
      event,
      ...revisions,
      members: memberRows.map((m) =>
        parseStoredRow(
          MemberSchema,
          { id: m.id, name: m.name, attendance: m.attendance },
          "members",
        ),
      ),
      feedback: noteRows.map((n) =>
        parseStoredRow(
          FeedbackNoteSchema,
          { id: n.id, text: n.text, receivedAt: toIsoTimestamp(n.receivedAt) },
          "feedback_notes",
        ),
      ),
    };
  }
}
