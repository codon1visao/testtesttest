import { type EventId, GenerationStatusViewSchema, type RunId } from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import { GenerationOutcomeEntity } from "../persistence/entities/generation-outcome.entity.js";
import type { LastOutcome, NewOutcome, OutcomeWriteRepository } from "../ports/unit-of-work.js";
import { parseStoredRow, toIsoTimestamp } from "./row-parsing.js";

const LastOutcomeSchema = GenerationStatusViewSchema.shape.lastOutcome.unwrap();

export class TypeOrmOutcomeRepository implements OutcomeWriteRepository {
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

  async exists(runId: RunId): Promise<boolean> {
    return (await this.manager.count(GenerationOutcomeEntity, { where: { runId } })) > 0;
  }

  async record(outcome: NewOutcome): Promise<void> {
    await this.manager.query(
      `INSERT INTO generation_outcomes (run_id, event_id, trigger_type, status, error_code, generation_id, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE run_id = run_id`,
      [
        outcome.runId,
        outcome.eventId,
        outcome.trigger,
        outcome.status,
        outcome.errorCode,
        outcome.generationId,
        outcome.finishedAt,
      ],
    );
    // The derived table works around MySQL's ban on LIMIT in an IN subquery over the same table.
    await this.manager.query(
      `DELETE FROM generation_outcomes WHERE event_id = ? AND run_id NOT IN (
         SELECT run_id FROM (SELECT run_id FROM generation_outcomes WHERE event_id = ?
           ORDER BY finished_at DESC, run_id DESC LIMIT 20) AS keep)`,
      [outcome.eventId, outcome.eventId],
    );
  }
}
