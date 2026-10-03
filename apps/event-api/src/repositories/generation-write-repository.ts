import type { EventId, GenerationId, RunId } from "@event-desk/contracts";
import { GenerationIdSchema } from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import {
  AttendanceInputEntity,
  BriefingItemEntity,
  BriefingItemSourceEntity,
  FeedbackInputEntity,
  GenerationEntity,
} from "../persistence/entities/generation.entities.js";
import {
  PreviewSlotEntity,
  SavedBriefingEntity,
} from "../persistence/entities/briefing-slot.entities.js";
import type { GenerationWriteRepository, NewGeneration } from "../ports/unit-of-work.js";
import { parseStoredRow } from "./row-parsing.js";

/**
 * Writes inside the unit of work's transaction: plain INSERT/DELETE only, never save, remove or
 * manager.transaction, which would manage a transaction of their own.
 */
export class TypeOrmGenerationWriteRepository implements GenerationWriteRepository {
  constructor(private readonly manager: EntityManager) {}

  async insert(g: NewGeneration): Promise<void> {
    await this.manager.insert(GenerationEntity, {
      id: g.id,
      eventId: g.eventId,
      runId: g.runId,
      triggerType: g.trigger,
      model: g.model,
      promptVersion: g.promptVersion,
      attendanceOverview: g.attendanceOverview,
      feedbackDigest: g.feedbackDigest,
      inputCapturedAt: g.inputCapturedAt,
      generatedAt: g.generatedAt,
    });
    await this.manager.insert(
      AttendanceInputEntity,
      g.attendance.map((a) => ({
        generationId: g.id,
        eventId: g.eventId,
        memberId: a.memberId,
        attendance: a.attendance,
      })),
    );
    await this.manager.insert(
      FeedbackInputEntity,
      g.feedbackIds.map((feedbackId) => ({ generationId: g.id, eventId: g.eventId, feedbackId })),
    );
    await this.manager.insert(
      BriefingItemEntity,
      g.items.map((item) => ({
        id: item.id,
        generationId: g.id,
        section: item.section,
        position: item.position,
        text: item.text,
      })),
    );
    const sources = g.items.flatMap((item) =>
      item.sourceIds.map((feedbackId, position) => ({
        itemId: item.id,
        generationId: g.id,
        feedbackId,
        position,
      })),
    );
    if (sources.length > 0) await this.manager.insert(BriefingItemSourceEntity, sources);
  }

  async findIdByRunId(runId: RunId): Promise<GenerationId | null> {
    const row = await this.manager.findOne(GenerationEntity, {
      where: { runId },
      select: { id: true },
    });
    return row === null ? null : parseStoredRow(GenerationIdSchema, row.id, "briefing_generations");
  }

  async deleteIfUnreferenced(eventId: EventId, generationId: GenerationId): Promise<boolean> {
    const result = await this.manager
      .createQueryBuilder()
      .delete()
      .from(GenerationEntity)
      .where("id = :generationId AND event_id = :eventId", { generationId, eventId })
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM ${this.table(PreviewSlotEntity)} WHERE generation_id = :generationId)`,
      )
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM ${this.table(SavedBriefingEntity)} WHERE generation_id = :generationId)`,
      )
      .execute();
    return (result.affected ?? 0) > 0;
  }

  private table(entity: typeof PreviewSlotEntity | typeof SavedBriefingEntity): string {
    return this.manager.dataSource.getMetadata(entity).tableName;
  }
}
