import {
  GENERATION_TRIGGERS,
  type GenerationTrigger,
  RUN_OUTCOME_STATUSES,
} from "@event-desk/contracts";
import { EntitySchema } from "typeorm";
import { asciiBin } from "./column-types.js";

export interface GenerationOutcomeRow {
  runId: string;
  eventId: string;
  triggerType: GenerationTrigger;
  status: (typeof RUN_OUTCOME_STATUSES)[number];
  errorCode: string | null;
  generationId: string | null;
  finishedAt: Date;
}

export const GenerationOutcomeEntity = new EntitySchema<GenerationOutcomeRow>({
  name: "GenerationOutcome",
  tableName: "generation_outcomes",
  columns: {
    runId: { name: "run_id", type: "varchar", length: 64, primary: true, ...asciiBin },
    eventId: { name: "event_id", type: "varchar", length: 16, ...asciiBin },
    triggerType: { name: "trigger_type", type: "enum", enum: [...GENERATION_TRIGGERS] },
    status: { type: "enum", enum: [...RUN_OUTCOME_STATUSES] },
    errorCode: { name: "error_code", type: "varchar", length: 40, nullable: true, ...asciiBin },
    generationId: { name: "generation_id", type: "char", length: 36, nullable: true, ...asciiBin },
    finishedAt: { name: "finished_at", type: "datetime", precision: 3 },
  },
});
