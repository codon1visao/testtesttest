import type { EventId, GenerationTrigger } from "@event-desk/contracts";
import type { AttemptReservation, GenerationLimits } from "../ports/generation-limits.js";

/** In-memory limits for service and processor tests; mirrors the Redis adapter's rules. */
export class FakeGenerationLimits implements GenerationLimits {
  cooldownEnd: Date | null = null;
  readonly used = { total: 0, batch: 0 };
  constructor(private readonly caps = { dailyAttempts: 20, batchDailyAttempts: 15 }) {}

  cooldownUntil(_eventId: EventId, now: Date): Promise<Date | null> {
    return Promise.resolve(
      this.cooldownEnd !== null && this.cooldownEnd > now ? this.cooldownEnd : null,
    );
  }
  startCooldown(_eventId: EventId, until: Date): Promise<void> {
    if (this.cooldownEnd === null || until > this.cooldownEnd) this.cooldownEnd = until;
    return Promise.resolve();
  }
  reserveAttempt(
    _eventId: EventId,
    trigger: GenerationTrigger,
    now: Date,
  ): Promise<AttemptReservation> {
    const batch = trigger === "feedback_batch";
    if (
      this.used.total >= this.caps.dailyAttempts ||
      (batch && this.used.batch >= this.caps.batchDailyAttempts)
    ) {
      return Promise.resolve({ kind: "limit-reached" });
    }
    this.used.total += 1;
    if (batch) this.used.batch += 1;
    return Promise.resolve({ kind: "reserved", day: now.toISOString().slice(0, 10) });
  }
  releaseAttempt(_eventId: EventId, trigger: GenerationTrigger): Promise<void> {
    this.used.total = Math.max(0, this.used.total - 1);
    if (trigger === "feedback_batch") this.used.batch = Math.max(0, this.used.batch - 1);
    return Promise.resolve();
  }
}
