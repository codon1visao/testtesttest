/**
 * A per-process ceiling on provider calls per UTC day (S1). The event API owns the real budget
 * (Plan 5); this only bounds the damage of a caller bug. It resets when the Gateway restarts.
 */
export class UsageBackstop {
  private readonly limit: number;
  private readonly now: () => Date;
  private day = "";
  private used = 0;

  constructor(limit: number, now: () => Date) {
    this.limit = limit;
    this.now = now;
  }

  tryConsume(): boolean {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }
}
