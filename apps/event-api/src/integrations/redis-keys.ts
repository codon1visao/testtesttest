import type { EventId } from "@event-desk/contracts";

/** Every Redis key this application owns lives under one of these prefixes (reset deletes only these). */
export const EVENT_DESK_KEY_PREFIX = "event-desk:";
export const BRIEFING_BATCH_KEY_PREFIX = "bull:briefing-batch:";
export const APPLICATION_KEY_PREFIXES = [EVENT_DESK_KEY_PREFIX, BRIEFING_BATCH_KEY_PREFIX] as const;

export const eventViewVersionKey = (eventId: EventId): string =>
  `${EVENT_DESK_KEY_PREFIX}cache:event:${eventId}:ver`;
export const eventViewKey = (eventId: EventId, version: number): string =>
  `${EVENT_DESK_KEY_PREFIX}cache:event:${eventId}:v${version}`;

export const cooldownKey = (eventId: EventId): string =>
  `${EVENT_DESK_KEY_PREFIX}gen:cooldown:${eventId}`;
export const usageKey = (eventId: EventId, day: string, bucket: "total" | "batch"): string =>
  `${EVENT_DESK_KEY_PREFIX}gen:usage:${eventId}:${day}:${bucket}`;
