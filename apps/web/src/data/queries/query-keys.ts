import type { EventId } from "@event-desk/contracts";

export const queryKeys = {
  event: (eventId: EventId) => ["event", eventId] as const,
};
