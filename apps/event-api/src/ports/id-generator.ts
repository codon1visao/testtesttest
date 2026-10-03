import type { GenerationId, RunId } from "@event-desk/contracts";

export interface IdGenerator {
  generationId(): GenerationId;
  /** IDs for briefing_items rows. */
  itemId(): string;
  /** `manual:<uuidv7>` (T5 §2). */
  manualRunId(): RunId;
  /** "batch_<uuidv7>": the BullMQ job ID and the run ID of a batch (T5 §3). BullMQ custom job IDs must not contain ':'. */
  batchRunId(): RunId;
}
