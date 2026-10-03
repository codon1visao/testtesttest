import type { EventId } from "@event-desk/contracts";

/** Every Redis key this application owns lives under one of these prefixes (reset deletes only these). */
export const EVENT_DESK_KEY_PREFIX = "event-desk:";
export const BRIEFING_BATCH_KEY_PREFIX = "bull:briefing-batch:";
export const APPLICATION_KEY_PREFIXES = [EVENT_DESK_KEY_PREFIX, BRIEFING_BATCH_KEY_PREFIX] as const;

export const eventViewVersionKey = (eventId: EventId): string =>
  `event-desk:cache:event:${eventId}:ver`;
export const eventViewKey = (eventId: EventId, version: number): string =>
  `event-desk:cache:event:${eventId}:v${version}`;
