import type { EventId, EventView } from "@event-desk/contracts";
import { useQuery } from "@tanstack/react-query";
import { fetchEvent } from "../api/event-api";
import { queryKeys } from "./query-keys";

export const POLL_INTERVAL_MS = 5_000;
export const BUSY_POLL_INTERVAL_MS = 1_000;

/** F7: no polling while the stream is open; 1 s while a batch collects or generates; otherwise 5 s. */
export function pollIntervalMs(view: EventView | undefined, live: boolean): number | false {
  if (live) return false;
  const state = view?.generation.batch?.state;
  return state === "collecting" || state === "generating"
    ? BUSY_POLL_INTERVAL_MS
    : POLL_INTERVAL_MS;
}

/** The event aggregate: the single canonical copy of members, notes and briefings (F3 reference contract). */
export function useEventQuery(eventId: EventId, { live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.event(eventId),
    queryFn: ({ signal }) => fetchEvent(eventId, signal),
    refetchInterval: (query) => pollIntervalMs(query.state.data, live),
  });
}
