import type { EventId } from "@event-desk/contracts";
import { useQuery } from "@tanstack/react-query";
import { fetchEvent } from "../api/event-api";
import { queryKeys } from "./query-keys";

/** The event aggregate: the single canonical copy of members, notes and briefings (F3 reference contract). */
export function useEventQuery(eventId: EventId) {
  return useQuery({
    queryKey: queryKeys.event(eventId),
    queryFn: ({ signal }) => fetchEvent(eventId, signal),
  });
}
