import {
  type EventId,
  type GenerationId,
  GenerationIdSchema,
  GenerationTriggerSchema,
} from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import { z } from "zod";
import type { IncomingSlot, PreviewSlotRepository } from "../ports/unit-of-work.js";
import { parseStoredRow } from "./row-parsing.js";

const IncomingRowSchema = z.object({
  generation_id: GenerationIdSchema,
  trigger_type: GenerationTriggerSchema,
  input_captured_at: z.date(),
});

export class TypeOrmPreviewSlotRepository implements PreviewSlotRepository {
  constructor(private readonly manager: EntityManager) {}

  async incoming(eventId: EventId): Promise<IncomingSlot | null> {
    const rows = await this.manager.query<unknown[]>(
      `SELECT s.generation_id, g.trigger_type, g.input_captured_at
         FROM preview_slots s JOIN briefing_generations g ON g.id = s.generation_id
        WHERE s.event_id = ? AND s.slot = 'incoming'`,
      [eventId],
    );
    const [row] = rows;
    if (row === undefined) return null;
    const parsed = parseStoredRow(IncomingRowSchema, row, "preview_slots");
    return {
      generationId: parsed.generation_id,
      trigger: parsed.trigger_type,
      inputCapturedAt: parsed.input_captured_at,
    };
  }

  async putIncoming(eventId: EventId, generationId: GenerationId, now: Date): Promise<void> {
    await this.manager.query(
      `INSERT INTO preview_slots (event_id, slot, generation_id, updated_at) VALUES (?, 'incoming', ?, ?)
       ON DUPLICATE KEY UPDATE generation_id = VALUES(generation_id), updated_at = VALUES(updated_at)`,
      [eventId, generationId, now],
    );
  }
}
