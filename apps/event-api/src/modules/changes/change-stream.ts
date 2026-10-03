import { type EventId, EventChangedMessageSchema } from "@event-desk/contracts";
import type { ChangeNotifier } from "../../ports/change-notifier.js";

/** One open SSE response, as the hub sees it. */
export interface StreamSink {
  send(chunk: string): void;
  close(): void;
}

/** Reconnect delay the browser's EventSource uses after the stream drops (T3 §5). */
export const SSE_RETRY_MS = 3_000;
/** Comment lines keep idle proxies and the browser from dropping a quiet stream. */
export const SSE_HEARTBEAT_MS = 15_000;

export function formatChanged(version: number | null): string {
  return `event: changed\ndata: ${JSON.stringify(EventChangedMessageSchema.parse({ version }))}\n\n`;
}

/** Fans the in-process change signal out to open SSE responses (F7 "How the page learns about changes"). */
export class ChangeStreamHub {
  readonly #streams = new Map<StreamSink, () => void>();

  constructor(
    private readonly notifier: ChangeNotifier,
    private readonly options: { heartbeatMs?: number } = {},
  ) {}

  get openCount(): number {
    return this.#streams.size;
  }

  /** Writes the retry hint, forwards this event's changes and sends keep-alives. Returns detach. */
  open(eventId: EventId, sink: StreamSink): () => void {
    sink.send(`retry: ${String(SSE_RETRY_MS)}\n\n`);
    const unsubscribe = this.notifier.subscribe((changed, version) => {
      if (changed === eventId) sink.send(formatChanged(version));
    });
    const heartbeat = setInterval(() => {
      sink.send(": keep-alive\n\n");
    }, this.options.heartbeatMs ?? SSE_HEARTBEAT_MS);
    heartbeat.unref();
    const detach = () => {
      if (!this.#streams.delete(sink)) return;
      clearInterval(heartbeat);
      unsubscribe();
    };
    this.#streams.set(sink, detach);
    return detach;
  }

  /** Ends every open stream (shutdown): the HTTP server cannot close while one is open. */
  closeAll(): void {
    for (const [sink, detach] of [...this.#streams]) {
      detach();
      sink.close();
    }
  }
}
