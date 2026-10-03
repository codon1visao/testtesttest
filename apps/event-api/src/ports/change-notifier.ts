import type { EventId } from "@event-desk/contracts";

export type ChangeListener = (eventId: EventId) => void;

/** In-process "the event view changed" signal; Plan 5's SSE stream subscribes to it. */
export interface ChangeNotifier {
  notify(eventId: EventId): void;
  subscribe(listener: ChangeListener): () => void;
}
