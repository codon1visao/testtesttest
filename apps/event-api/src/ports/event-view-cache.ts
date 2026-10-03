import type { EventId, EventView } from "@event-desk/contracts";

/** The version read before the database read, and the cached view at that version if any. */
export interface CachedEventView {
  version: number;
  view: EventView | null;
}

/** Versioned cache of the single event read (T3 §7). MySQL stays authoritative. */
export interface EventViewCache {
  lookup(eventId: EventId): Promise<CachedEventView>;
  /** Stores at the version observed by lookup(); a late store lands on a retired version. */
  store(eventId: EventId, version: number, view: EventView, ttlMs: number): Promise<void>;
  /** INCR the version, then DEL the old entry. Returns the new version. */
  invalidate(eventId: EventId): Promise<number>;
}
