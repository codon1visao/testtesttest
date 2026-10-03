import type { EventId } from "@event-desk/contracts";
import { type EntityManager, In } from "typeorm";
import {
  PreviewSlotEntity,
  type PreviewSlotName,
  SavedBriefingEntity,
  SavedBriefingItemEntity,
} from "../persistence/entities/briefing-slot.entities.js";
import {
  AttendanceInputEntity,
  BriefingItemEntity,
  BriefingItemSourceEntity,
  FeedbackInputEntity,
  GenerationEntity,
} from "../persistence/entities/generation.entities.js";
import type {
  BriefingReadRepository,
  BriefingSlots,
  StoredBriefing,
} from "../ports/unit-of-work.js";
import { AppError } from "../shared/app-error.js";
import { assembleStoredBriefing, type GenerationRecord } from "./briefing-mapping.js";

const EMPTY_SLOTS: BriefingSlots = { saved: null, selected: null, incoming: null };

/** Set-based reads (never N+1): slots and saved row, referenced generations, their inputs, items and sources. */
export class TypeOrmBriefingReadRepository implements BriefingReadRepository {
  constructor(private readonly manager: EntityManager) {}

  async loadSlots(eventId: EventId): Promise<BriefingSlots> {
    const slotRows = await this.manager.find(PreviewSlotEntity, { where: { eventId } });
    const savedRow = await this.manager.findOne(SavedBriefingEntity, { where: { eventId } });
    const ids = [
      ...new Set([
        ...slotRows.map((s) => s.generationId),
        ...(savedRow ? [savedRow.generationId] : []),
      ]),
    ];
    if (ids.length === 0) return EMPTY_SLOTS;

    const records = await this.loadRecords(ids);
    const recordFor = (generationId: string): GenerationRecord => {
      const record = records.get(generationId);
      if (record === undefined) {
        throw new AppError(
          "STORE_CORRUPT",
          `Generation ${generationId} is referenced but missing. The store needs manual recovery.`,
        );
      }
      return record;
    };
    const slot = (name: PreviewSlotName): StoredBriefing | null => {
      const row = slotRows.find((s) => s.slot === name);
      return row === undefined ? null : assembleStoredBriefing(recordFor(row.generationId));
    };

    let saved: StoredBriefing | null = null;
    if (savedRow !== null) {
      const textRows = await this.manager.find(SavedBriefingItemEntity, { where: { eventId } });
      saved = assembleStoredBriefing(recordFor(savedRow.generationId), {
        attendanceOverview: savedRow.attendanceOverview,
        savedAt: savedRow.savedAt,
        itemTexts: new Map(textRows.map((row) => [row.itemId, row.text])),
      });
    }
    return { saved, selected: slot("selected"), incoming: slot("incoming") };
  }

  private async loadRecords(ids: string[]): Promise<Map<string, GenerationRecord>> {
    const byGeneration = { generationId: In(ids) };
    const generations = await this.manager.find(GenerationEntity, { where: { id: In(ids) } });
    const attendanceInputs = await this.manager.find(AttendanceInputEntity, {
      where: byGeneration,
    });
    const feedbackInputs = await this.manager.find(FeedbackInputEntity, { where: byGeneration });
    const items = await this.manager.find(BriefingItemEntity, { where: byGeneration });
    const sources = await this.manager.find(BriefingItemSourceEntity, { where: byGeneration });
    return new Map(
      generations.map((generation) => [
        generation.id,
        {
          generation,
          attendanceInputs: attendanceInputs.filter((row) => row.generationId === generation.id),
          feedbackInputs: feedbackInputs.filter((row) => row.generationId === generation.id),
          items: items.filter((row) => row.generationId === generation.id),
          sources: sources.filter((row) => row.generationId === generation.id),
        },
      ]),
    );
  }
}
