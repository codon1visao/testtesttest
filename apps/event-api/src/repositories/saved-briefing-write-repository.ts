import { type EventId, GenerationIdSchema } from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import {
  SavedBriefingEntity,
  SavedBriefingItemEntity,
} from "../persistence/entities/briefing-slot.entities.js";
import type {
  SavedBriefingWrite,
  SavedBriefingWriteRepository,
  StoredSavedBriefing,
} from "../ports/unit-of-work.js";
import { parseStoredRow } from "./row-parsing.js";

export class TypeOrmSavedBriefingWriteRepository implements SavedBriefingWriteRepository {
  constructor(private readonly manager: EntityManager) {}

  async get(eventId: EventId): Promise<StoredSavedBriefing | null> {
    const row = await this.manager.findOne(SavedBriefingEntity, { where: { eventId } });
    if (row === null) return null;
    const texts = await this.manager.find(SavedBriefingItemEntity, { where: { eventId } });
    return {
      generationId: parseStoredRow(GenerationIdSchema, row.generationId, "saved_briefings"),
      attendanceOverview: row.attendanceOverview,
      itemTexts: new Map(texts.map((text) => [text.itemId, text.text])),
    };
  }

  /** T4 TX8 steps 1–3, in an order that keeps every composite FK valid. */
  async replace(saved: SavedBriefingWrite): Promise<void> {
    await this.manager.query("DELETE FROM saved_briefing_items WHERE event_id = ?", [
      saved.eventId,
    ]);
    await this.manager.query(
      `INSERT INTO saved_briefings (event_id, generation_id, attendance_overview, saved_at) VALUES (?, ?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE generation_id = new.generation_id, attendance_overview = new.attendance_overview, saved_at = new.saved_at`,
      [saved.eventId, saved.generationId, saved.attendanceOverview, saved.savedAt],
    );
    const values = [...saved.itemTexts].map(([itemId, text]) => ({
      eventId: saved.eventId,
      generationId: saved.generationId,
      itemId,
      text,
    }));
    if (values.length > 0) await this.manager.insert(SavedBriefingItemEntity, values);
  }
}
