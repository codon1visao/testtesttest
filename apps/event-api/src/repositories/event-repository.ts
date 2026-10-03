import {
  type AttendanceChange,
  type EventId,
  EventIdSchema,
  EventSummarySchema,
  FeedbackNoteSchema,
  MemberSchema,
} from "@event-desk/contracts";
import { type EntityManager, IsNull, Not } from "typeorm";
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

  async pendingFeedbackEventIds(): Promise<EventId[]> {
    const rows = await this.manager.find(EventEntity, {
      where: { feedbackPendingSince: Not(IsNull()) },
      select: { id: true },
    });
    return rows.map((row) => parseStoredRow(EventIdSchema, row.id, "events"));
  }

  async feedbackState(
    eventId: EventId,
  ): Promise<{ nextFeedbackNumber: number; pendingSince: Date | null }> {
    const row = await this.manager.findOne(EventEntity, {
      where: { id: eventId },
      select: { id: true, nextFeedbackNumber: true, feedbackPendingSince: true },
    });
    if (row === null) throw new AppError("EVENT_NOT_FOUND", `Event ${eventId} was not found.`);
    return { nextFeedbackNumber: row.nextFeedbackNumber, pendingSince: row.feedbackPendingSince };
  }

  async recordFeedbackReceived(eventId: EventId, at: Date): Promise<void> {
    await this.manager.query(
      `UPDATE events SET next_feedback_number = next_feedback_number + 1,
              feedback_pending_since = COALESCE(feedback_pending_since, ?) WHERE id = ?`,
      [at, eventId],
    );
  }

  async clearFeedbackPending(eventId: EventId): Promise<void> {
    await this.manager.update(EventEntity, { id: eventId }, { feedbackPendingSince: null });
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
