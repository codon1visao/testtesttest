import type { EventId } from "@event-desk/contracts";
import type { ChangeListener, ChangeNotifier } from "../../ports/change-notifier.js";
import type { Logger } from "../../shared/logger.js";

export class InProcessChangeNotifier implements ChangeNotifier {
  readonly #listeners = new Set<ChangeListener>();

  constructor(private readonly logger: Logger) {}

  notify(eventId: EventId, version: number | null): void {
    for (const listener of this.#listeners) {
      try {
        listener(eventId, version);
      } catch (error) {
        this.logger.warn({ err: error, eventId }, "change listener failed");
      }
    }
  }

  subscribe(listener: ChangeListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
