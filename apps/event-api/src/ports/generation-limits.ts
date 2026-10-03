import type { EventId, GenerationTrigger } from "@event-desk/contracts";

export type AttemptReservation =
  | { kind: "reserved"; day: string } // release with the same UTC day
  | { kind: "limit-reached" }
  | { kind: "unavailable" }; // store error: proceed (fail open); nothing to release

/**
 * The provider cooldown and the daily attempt budget shared by manual and batch generation
 * (F7, F8, S1). Persisted, so a restart or a terminal job cannot clear them. Never throws: a store
 * error is logged and answered permissively, because the Gateway's own daily backstop still caps spend.
 */
export interface GenerationLimits {
  cooldownUntil(eventId: EventId, now: Date): Promise<Date | null>;
  /** Keeps the later of the stored and the new end. */
  startCooldown(eventId: EventId, until: Date, now: Date): Promise<void>;
  /** One paid attempt: counts against the total, and for a batch also against the batch cap. */
  reserveAttempt(
    eventId: EventId,
    trigger: GenerationTrigger,
    now: Date,
  ): Promise<AttemptReservation>;
  /** Gives back an attempt the provider never received (Gateway `notSent: true`). */
  releaseAttempt(eventId: EventId, trigger: GenerationTrigger, day: string): Promise<void>;
}
