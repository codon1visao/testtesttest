import type { EventId, GenerationStatusView } from "@event-desk/contracts";

/** Live generation state that is not in MySQL: manual run in flight, batch job, provider cooldown. */
export type GenerationActivitySnapshot = Pick<
  GenerationStatusView,
  "manual" | "batch" | "cooldownUntil"
>;

export interface GenerationActivity {
  current(eventId: EventId): Promise<GenerationActivitySnapshot>;
}
