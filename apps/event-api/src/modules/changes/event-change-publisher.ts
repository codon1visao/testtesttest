import type { EventId } from "@event-desk/contracts";
import type { ChangeNotifier } from "../../ports/change-notifier.js";
import type { EventViewCache } from "../../ports/event-view-cache.js";
import type { Logger } from "../../shared/logger.js";
import type { CacheBypass } from "./cache-bypass.js";

/** Runs after every commit (and, from Plan 5, every queue-state change): flush, then notify. */
export class EventChangePublisher {
  constructor(
    private readonly cache: EventViewCache,
    private readonly bypass: CacheBypass,
    private readonly notifier: ChangeNotifier,
    private readonly logger: Logger,
  ) {}

  /** Never throws: MySQL already holds the truth; a failed flush only switches reads to MySQL. */
  async publish(eventId: EventId): Promise<void> {
    try {
      await this.cache.invalidate(eventId);
      this.bypass.clear();
    } catch (error) {
      this.bypass.activate();
      this.logger.warn(
        { err: error, eventId },
        "event view cache flush failed; reading from MySQL until a flush succeeds",
      );
    }
    this.notifier.notify(eventId);
  }
}
