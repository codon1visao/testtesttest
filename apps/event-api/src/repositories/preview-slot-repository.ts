import {
  type EventId,
  type GenerationId,
  GenerationIdSchema,
  GenerationTriggerSchema,
} from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import { z } from "zod";
import type { PreviewSlotRepository, SlotHolder } from "../ports/unit-of-work.js";
import { parseStoredRow } from "./row-parsing.js";

type SlotName = "selected" | "incoming";

const HolderRowSchema = z.object({
  generation_id: GenerationIdSchema,
  trigger_type: GenerationTriggerSchema,
  input_captured_at: z.date(),
});

export class TypeOrmPreviewSlotRepository implements PreviewSlotRepository {
  constructor(private readonly manager: EntityManager) {}

  incoming(eventId: EventId): Promise<SlotHolder | null> {
    return this.holder(eventId, "incoming");
  }

  selected(eventId: EventId): Promise<SlotHolder | null> {
    return this.holder(eventId, "selected");
  }

  putIncoming(eventId: EventId, generationId: GenerationId, now: Date): Promise<void> {
    return this.put(eventId, "incoming", generationId, now);
  }

  /** The generation must not occupy the other slot (uq_slot_generation): clear it first. */
  putSelected(eventId: EventId, generationId: GenerationId, now: Date): Promise<void> {
    return this.put(eventId, "selected", generationId, now);
  }

  async clear(eventId: EventId, slot: SlotName): Promise<void> {
    await this.manager.query("DELETE FROM preview_slots WHERE event_id = ? AND slot = ?", [
      eventId,
      slot,
    ]);
  }

  private async holder(eventId: EventId, slot: SlotName): Promise<SlotHolder | null> {
    const rows = await this.manager.query<unknown[]>(
      `SELECT s.generation_id, g.trigger_type, g.input_captured_at
         FROM preview_slots s JOIN briefing_generations g ON g.id = s.generation_id
        WHERE s.event_id = ? AND s.slot = ?`,
      [eventId, slot],
    );
    const [row] = rows;
    if (row === undefined) return null;
    const parsed = parseStoredRow(HolderRowSchema, row, "preview_slots");
    return {
      generationId: parsed.generation_id,
      trigger: parsed.trigger_type,
      inputCapturedAt: parsed.input_captured_at,
    };
  }

  private async put(
    eventId: EventId,
    slot: SlotName,
    generationId: GenerationId,
    now: Date,
  ): Promise<void> {
    await this.manager.query(
      `INSERT INTO preview_slots (event_id, slot, generation_id, updated_at) VALUES (?, ?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE generation_id = new.generation_id, updated_at = new.updated_at`,
      [eventId, slot, generationId, now],
    );
  }
}
