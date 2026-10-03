import type { EventId } from "@event-desk/contracts";

/**
 * `version` is the event view version after the change (T3 §5: SSE `changed` messages carry it),
 * or null when the cache flush failed and no new version exists.
 */
export type ChangeListener = (eventId: EventId, version: number | null) => void;

/** In-process "the event view changed" signal; Plan 5's SSE stream subscribes to it. */
export interface ChangeNotifier {
  notify(eventId: EventId, version: number | null): void;
  subscribe(listener: ChangeListener): () => void;
}
