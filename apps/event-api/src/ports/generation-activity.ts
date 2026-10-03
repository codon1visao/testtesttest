import type { EventId, GenerationStatusView } from "@event-desk/contracts";
import type { BatchJobStatus } from "./briefing-batch-queue.js";

/** Live generation state that is not in MySQL: manual run in flight, batch job, provider cooldown. */
export interface GenerationActivitySnapshot {
  manual: GenerationStatusView["manual"];
  batch: BatchJobStatus | null;
  cooldownUntil: Date | null;
}

export interface GenerationActivity {
  current(eventId: EventId): Promise<GenerationActivitySnapshot>;
}
