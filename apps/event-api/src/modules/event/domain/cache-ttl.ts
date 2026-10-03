import type { EventView } from "@event-desk/contracts";

/** Default TTL, capped at the next time-driven state change (batch cutoff, retry, cooldown). */
export function cacheTtlMs(view: EventView, now: Date, defaultTtlMs: number): number {
  const deadlines = [
    view.generation.batch?.closesAt,
    view.generation.batch?.nextAttemptAt,
    view.generation.cooldownUntil,
  ];
  let ttl = defaultTtlMs;
  for (const deadline of deadlines) {
    if (typeof deadline !== "string") continue;
    ttl = Math.min(ttl, Math.max(0, Date.parse(deadline) - now.getTime()));
  }
  return ttl;
}
