import type { GenerationId, RunId } from "@event-desk/contracts";

export interface IdGenerator {
  generationId(): GenerationId;
  /** IDs for briefing_items rows. */
  itemId(): string;
  /** `manual:<uuidv7>` (T5 §2). */
  manualRunId(): RunId;
}
