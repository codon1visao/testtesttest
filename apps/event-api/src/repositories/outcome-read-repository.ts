import { type EventId, GenerationStatusViewSchema } from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import { GenerationOutcomeEntity } from "../persistence/entities/generation-outcome.entity.js";
import type { LastOutcome, OutcomeReadRepository } from "../ports/unit-of-work.js";
import { parseStoredRow, toIsoTimestamp } from "./row-parsing.js";

const LastOutcomeSchema = GenerationStatusViewSchema.shape.lastOutcome.unwrap();

export class TypeOrmOutcomeReadRepository implements OutcomeReadRepository {
  constructor(private readonly manager: EntityManager) {}

  async latest(eventId: EventId): Promise<LastOutcome | null> {
    const row = await this.manager.findOne(GenerationOutcomeEntity, {
      where: { eventId },
      order: { finishedAt: "DESC", runId: "DESC" },
    });
    if (row === null) return null;
    return parseStoredRow(
      LastOutcomeSchema,
      {
        runId: row.runId,
        trigger: row.triggerType,
        status: row.status,
        ...(row.errorCode === null ? {} : { code: row.errorCode }),
        finishedAt: toIsoTimestamp(row.finishedAt),
      },
      "generation_outcomes",
    );
  }
}
